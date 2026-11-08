import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { agent, createUser, getModels, login, reset, send, setup, teardown } from './helpers.js';
import { __setEmailConfigForTests, __resetEmailTransportFactory, __setEmailTransportFactory } from '../src/services/emailService.js';
import { __setGoogleTokenVerifier, __resetGoogleTokenVerifier } from '../src/services/googleAuthService.js';
import { createDjangoPassword } from '../src/utils/passwords.js';
import { stableCaseInsensitive } from '../src/utils/identifiers.js';

before(setup);
after(teardown);
beforeEach(reset);

const CLIENT_ID = '1234567890-test.apps.googleusercontent.com';
const APPLIED_PASSWORD = 'correct-horse-11';
const WRONG_PASSWORD = 'wrong-password-99';
// Allowed by the suite's GOOGLE_DEV_TEST_EMAILS allowlist (see tests/helpers.js),
// so the stubbed Google OAuth flow accepts it. Never a real account.
const GOOGLE_EMAIL = 'stu@cot.edu';
const SMTP_APP_PASSWORD = 'abcd efgh ijkl mnop';

// A Google-approved account: verified Google identity, approved/active,
// application password set through the setup flow (Django hash only).
async function createGoogleApprovedUser({ password = APPLIED_PASSWORD, role = 'student' } = {}) {
  const models = getModels();
  const user = await models.User.create({
    accountId: 'GOO001',
    accountIdNormalized: stableCaseInsensitive('GOO001'),
    username: 'GOO001',
    usernameNormalized: stableCaseInsensitive('GOO001'),
    passwordHash: password ? createDjangoPassword(password, 1_000) : null,
    authProviders: password ? ['google', 'password'] : ['google'],
    googleSub: 'google-sub-manual-1',
    googleEmail: GOOGLE_EMAIL,
    googleEmailNormalized: stableCaseInsensitive(GOOGLE_EMAIL),
    googleHostedDomain: '',
    googlePictureUrl: '',
    googleLinkedAt: new Date(),
    email: GOOGLE_EMAIL,
    emailNormalized: stableCaseInsensitive(GOOGLE_EMAIL),
    isActive: true,
    approvalStatus: 'approved',
  });
  await models.UserProfile.create({ userId: user._id, role, displayName: 'Google Manual', department: 'IT', phone: '' });
  return user;
}

function stubEmailDelivery() {
  __setEmailConfigForTests({
    smtpHost: 'smtp.test.invalid',
    smtpPort: 2525,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: 'University Attendance <attendance@example.test>',
    publicAppUrl: 'http://localhost:5173',
    isProduction: false,
  });
  __setEmailTransportFactory(() => ({
    sendMail: async (message) => ({ accepted: [message.to] }),
  }));
}

test('approved Google-linked account signs in manually with its Google email and application password', async () => {
  await createGoogleApprovedUser();
  const client = agent();
  // Mixed case proves the existing normalization rules resolve the Google email.
  const response = await send(client, 'post', '/api/auth/login/', {
    identifier: 'STU@COT.EDU',
    password: APPLIED_PASSWORD,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.email, GOOGLE_EMAIL);
  assert.equal((await client.get('/api/auth/me/')).status, 200);
});

test('approved Google-linked account can request its first application password setup link', async () => {
  const user = await createGoogleApprovedUser({ password: null });
  stubEmailDelivery();
  const client = agent();
  const response = await send(client, 'post', '/api/auth/password/request-setup/', { email: GOOGLE_EMAIL });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.match(response.body.message, /email with the next step/i);

  const models = getModels();
  const token = await models.EmailActionToken.findOne({ userId: user._id, purpose: 'set-application-password' });
  assert.ok(token);
});

test('password setup request does not reveal whether an account exists', async () => {
  stubEmailDelivery();
  const client = agent();
  const response = await send(client, 'post', '/api/auth/password/request-setup/', { email: 'unknown@gmail.com' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.match(response.body.message, /email with the next step/i);
});

test('the same approved account signs in with its account ID', async () => {
  await createGoogleApprovedUser();
  const { user } = await login('GOO001', APPLIED_PASSWORD);
  assert.equal(user.id, 'GOO001');
});

test('wrong passwords and missing application passwords are rejected with guidance, never a session', async () => {
  await createGoogleApprovedUser();
  const wrongClient = agent();
  const wrong = await send(wrongClient, 'post', '/api/auth/login/', { identifier: GOOGLE_EMAIL, password: WRONG_PASSWORD });
  assert.equal(wrong.status, 400);
  assert.equal((await wrongClient.get('/api/auth/me/')).status, 401);

  await getModels().User.updateOne(
    { accountIdNormalized: 'goo001' },
    { $set: { passwordHash: null, authProviders: ['google'] } },
  );
  const missingClient = agent();
  const missing = await send(missingClient, 'post', '/api/auth/login/', { identifier: GOOGLE_EMAIL, password: 'any-password-12' });
  assert.equal(missing.status, 400, JSON.stringify(missing.body));
  assert.match(missing.body.detail || '', /No application password is set|Google sign-in|setup link/);
  assert.equal(missing.body.code, 'password_setup_required');
  assert.equal((await missingClient.get('/api/auth/me/')).status, 401);
});

test('Google passwords and SMTP App Passwords are never accepted as application passwords', async () => {
  await createGoogleApprovedUser();
  for (const notAnAppPassword of ['my-google-password-1', SMTP_APP_PASSWORD]) {
    const client = agent();
    const response = await send(client, 'post', '/api/auth/login/', { identifier: GOOGLE_EMAIL, password: notAnAppPassword });
    assert.equal(response.status, 400, `${notAnAppPassword}: ${JSON.stringify(response.body)}`);
    assert.equal((await client.get('/api/auth/me/')).status, 401);
  }
});

test('pending, rejected, inactive, and archived Google-linked accounts cannot sign in', async () => {
  const models = getModels();
  const states = [
    { key: 'pending', patch: { approvalStatus: 'pending' } },
    { key: 'rejected', patch: { approvalStatus: 'rejected' } },
    { key: 'inactive', patch: { isActive: false } },
    { key: 'archived', patch: { archivedAt: new Date() } },
  ];
  for (const { key, patch } of states) {
    await models.User.deleteMany({});
    await models.UserProfile.deleteMany({});
    await createGoogleApprovedUser();
    await models.User.updateOne({ accountIdNormalized: 'goo001' }, { $set: patch });
    const client = agent();
    const response = await send(client, 'post', '/api/auth/login/', { identifier: GOOGLE_EMAIL, password: APPLIED_PASSWORD });
    assert.equal(response.status, 400, `${key}: ${JSON.stringify(response.body)}`);
    // Blocked accounts keep the generic error (no setup hint, no disclosure).
    assert.ok(!String(response.body.detail || '').includes('No application password'), key);
    assert.equal((await client.get('/api/auth/me/')).status, 401, key);
  }
});

test('Google OAuth sign-in still works independently and honors the admin enable/disable setting', async () => {
  const models = getModels();
  await createGoogleApprovedUser();
  // The nonce is bound to the session: start and submit on the SAME client,
  // exactly like the browser popup flow.
  const googleClient = agent();
  const start = await send(googleClient, 'post', '/api/auth/google/session/', {});
  assert.equal(start.status, 200);
  __setGoogleTokenVerifier(async () => ({
    sub: 'google-sub-manual-1',
    email: GOOGLE_EMAIL,
    email_verified: true,
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1_000) + 300,
    iat: Math.floor(Date.now() / 1_000),
    name: 'Google Manual',
    picture: '',
    nonce: start.body.nonce,
  }));
  try {
    const signedIn = await send(googleClient, 'post', '/api/auth/google/', { credential: 'fake-credential' });
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
    assert.equal(signedIn.body.status, 'signed_in');
  } finally {
    __resetGoogleTokenVerifier();
  }

  await models.SystemSetting.findByIdAndUpdate('google_oauth_enabled', { $set: { value: false } }, { upsert: true });
  const disabledClient = agent();
  const disabledStart = await send(disabledClient, 'post', '/api/auth/google/session/', {});
  assert.equal(disabledStart.status, 200);
  __setGoogleTokenVerifier(async () => ({
    sub: 'google-sub-manual-1',
    email: GOOGLE_EMAIL,
    email_verified: true,
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    exp: Math.floor(Date.now() / 1_000) + 300,
    iat: Math.floor(Date.now() / 1_000),
    name: 'Google Manual',
    picture: '',
    nonce: disabledStart.body.nonce,
  }));
  try {
    const refused = await send(disabledClient, 'post', '/api/auth/google/', { credential: 'fake-credential' });
    assert.equal(refused.status, 503, JSON.stringify(refused.body));
  } finally {
    __resetGoogleTokenVerifier();
  }
});

test('setup link can be resent by an admin and a consumed token cannot be reused', async () => {
  let capturedText = '';
  __setEmailConfigForTests({
    smtpHost: 'smtp.test.invalid',
    smtpPort: 2525,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: 'University Attendance <attendance@example.test>',
    publicAppUrl: 'http://localhost:5173',
    isProduction: false,
  });
  __setEmailTransportFactory(() => ({
    // Capture the email body (which embeds the single-use link) without sending
    // anything or logging credentials, hashes, or email contents.
    sendMail: async (message) => {
      capturedText = String(message.text || '');
      return { accepted: [message.to] };
    },
  }));
  try {
    await createGoogleApprovedUser({ password: null });
    await createUser({ username: 'ADM900', role: 'admin' });
    const { agent: adminClient } = await login('ADM900');
    const models = getModels();

    const first = await send(adminClient, 'post', '/api/admin/users/GOO001/password-setup/', {});
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.status, 'sent');
    // The raw single-use value is only ever inside the delivered link; the
    // database stores its SHA-256 hash and the API never returns the value.
    const rawToken = new URL(capturedText.match(/https?:\/\/\S+/)?.[0] || '').searchParams.get('token') || '';
    assert.ok(rawToken.length >= 32);
    const stored = await models.EmailActionToken.find({ purpose: 'set-application-password' }).lean();
    assert.equal(stored.length, 1);
    assert.equal(stored[0].consumedAt, null);
    assert.ok(!JSON.stringify(first.body).includes(rawToken));

    const used = await send(agent(), 'post', '/api/auth/password/setup/', {
      token: rawToken,
      password: 'a-brand-new-12',
    });
    assert.equal(used.status, 200, JSON.stringify(used.body));

    // The same link cannot be reused, and the account signs in with the new
    // application password via its Google email.
    const reused = await send(agent(), 'post', '/api/auth/password/setup/', {
      token: rawToken,
      password: 'another-new-34',
    });
    assert.equal(reused.status, 401, JSON.stringify(reused.body));
    assert.match(reused.body.detail || '', /invalid|expired|already used/i);
    const { user } = await login(GOOGLE_EMAIL, 'a-brand-new-12');
    assert.equal(user.id, 'GOO001');
  } finally {
    __resetEmailTransportFactory();
  }
});

test('expired setup links are refused and unconfigured email reports accurately', async () => {
  const models = getModels();
  await createGoogleApprovedUser({ password: null });
  await createUser({ username: 'ADM901', role: 'admin' });
  const { agent: adminClient } = await login('ADM901');

  let capturedText = '';
  stubEmailDelivery();
  __setEmailTransportFactory(() => ({
    sendMail: async (message) => {
      capturedText = String(message.text || '');
      return { accepted: [message.to] };
    },
  }));
  let rawToken = '';
  try {
    const resendResult = await send(adminClient, 'post', '/api/admin/users/GOO001/password-setup/', {});
    assert.equal(resendResult.status, 200, JSON.stringify(resendResult.body));
    rawToken = new URL(capturedText.match(/https?:\/\/\S+/)?.[0] || '').searchParams.get('token') || '';
    assert.ok(rawToken.length >= 32);
  } finally {
    __resetEmailTransportFactory();
  }
  const stored = await models.EmailActionToken.find({ purpose: 'set-application-password' }).sort({ createdAt: -1 }).lean();
  assert.ok(stored.length >= 1);
  await models.EmailActionToken.updateOne({ _id: stored[0]._id }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
  // Even the genuine token is refused once expired, without leaking contents.
  const expiredAttempt = await send(agent(), 'post', '/api/auth/password/setup/', {
    token: rawToken,
    password: 'a-brand-new-12',
  });
  assert.equal(expiredAttempt.status, 401, JSON.stringify(expiredAttempt.body));
  assert.match(expiredAttempt.body.detail || '', /invalid|expired|already used/i);

  // With delivery unconfigured, the admin resend reports 503 instead of
  // claiming an email was sent. Clear the config explicitly: this environment
  // may itself carry real SMTP settings.
  __setEmailConfigForTests({
    smtpHost: '',
    smtpPort: 0,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    smtpFrom: '',
    publicAppUrl: '',
    isProduction: false,
  });
  let unconfigured;
  try {
    unconfigured = await send(adminClient, 'post', '/api/admin/users/GOO001/password-setup/', {});
  } finally {
    __resetEmailTransportFactory();
  }
  assert.equal(unconfigured.status, 503, JSON.stringify(unconfigured.body));
  assert.match(unconfigured.body.detail || '', /Configure|unavailable/i);
});