import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  agent,
  createUser,
  getModels,
  login,
  request,
  reset,
  send,
  setup,
  teardown,
} from './helpers.js';

const messages = [];

before(async () => {
  await setup();
  const { __setEmailConfigForTests, __setEmailTransportFactory } = await import('../src/services/emailService.js');
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
    sendMail: async (message) => { messages.push(message); return { accepted: [message.to], messageId: 'test-message' }; },
  }));
});
after(async () => {
  const { __resetEmailTransportFactory } = await import('../src/services/emailService.js');
  __resetEmailTransportFactory();
  await teardown();
});
beforeEach(async () => {
  messages.length = 0;
  await reset();
});

function actionToken(message) {
  const match = message.text.match(/token=([A-Za-z0-9_-]+)/);
  assert.ok(match, 'email contains a link token');
  return match[1];
}

test('manual email verification is single-use and infers exact roles only after ownership verification', async () => {
  const applicant = agent();
  const requested = await send(applicant, 'post', '/api/auth/email/signup/', { email: 'Alice@student.buksu.edu.ph' });
  assert.equal(requested.status, 202);
  assert.equal(messages.length, 1);
  assert.equal(await getModels().SignupRequest.countDocuments({}), 0);
  assert.equal(await getModels().User.countDocuments({}), 0);
  const tokenRecord = await getModels().EmailActionToken.findOne({ purpose: 'verify-signup-email' }).lean();
  assert.notEqual(tokenRecord._id, actionToken(messages[0]));

  const verified = await send(applicant, 'post', '/api/auth/email/verify/', { token: actionToken(messages[0]) });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  const signup = await getModels().SignupRequest.findOne({ googleEmailNormalized: 'alice@student.buksu.edu.ph' }).lean();
  assert.equal(signup.provider, 'email');
  assert.equal(signup.pendingRole, 'student');
  assert.ok(signup.emailVerifiedAt);
  assert.equal(await getModels().User.countDocuments({}), 0);
  assert.equal((await applicant.get('/api/auth/me/')).status, 401);
  assert.equal((await applicant.get('/api/events/')).status, 401);

  const reused = await send(applicant, 'post', '/api/auth/email/verify/', { token: actionToken(messages[0]) });
  assert.equal(reused.status, 401);

  const outside = agent();
  await send(outside, 'post', '/api/auth/email/signup/', { email: 'review@elsewhere.example' });
  const outsideToken = actionToken(messages[1]);
  const unverifiedCount = await getModels().SignupRequest.countDocuments({});
  assert.equal(unverifiedCount, 1);
  const outsideVerified = await send(outside, 'post', '/api/auth/email/verify/', { token: outsideToken });
  assert.equal(outsideVerified.status, 200);
  const outsideRequest = await getModels().SignupRequest.findOne({ googleEmailNormalized: 'review@elsewhere.example' }).lean();
  assert.equal(outsideRequest.pendingRole, '');

  const expired = agent();
  await send(expired, 'post', '/api/auth/email/signup/', { email: 'expiry@faculty.buksu.edu.ph' });
  const expiredToken = actionToken(messages[2]);
  await getModels().EmailActionToken.updateOne(
    { purpose: 'verify-signup-email', emailNormalized: 'expiry@faculty.buksu.edu.ph' },
    { $set: { expiresAt: new Date(Date.now() - 1_000) } },
  );
  const expiredResponse = await send(expired, 'post', '/api/auth/email/verify/', { token: expiredToken });
  assert.equal(expiredResponse.status, 401);
});

test('approval creates an account and sends one-use password setup without creating a session', async () => {
  const applicant = agent();
  await send(applicant, 'post', '/api/auth/email/signup/', { email: 'ready@student.buksu.edu.ph' });
  const verificationToken = actionToken(messages[0]);
  const verified = await send(applicant, 'post', '/api/auth/email/verify/', { token: verificationToken });
  assert.equal(verified.status, 200);
  const signup = await getModels().SignupRequest.findOne({ googleEmailNormalized: 'ready@student.buksu.edu.ph' }).lean();
  const adminRecord = await createUser({ username: 'ADM-EMAIL', role: 'admin' });
  const admin = await login('ADM-EMAIL');
  const approval = await send(admin.agent, 'post', `/api/admin/signup-requests/${signup._id}/approve/`, {
    accountId: 'STU-EMAIL-1',
    department: 'IT',
    role: 'Student',
  });
  assert.equal(approval.status, 201, JSON.stringify(approval.body));
  assert.equal(messages.length, 2);
  assert.match(messages[1].subject, /application password/i);
  assert.equal((await applicant.get('/api/auth/me/')).status, 401);
  const user = await getModels().User.findOne({ emailNormalized: 'ready@student.buksu.edu.ph' }).select('+passwordHash').lean();
  assert.ok(user);
  assert.equal(user.passwordHash, null);
  assert.equal(user.authProviders.includes('google'), false);
  assert.equal(user.approvalStatus, 'approved');
  assert.equal(Boolean(await getModels().UserProfile.exists({ userId: user._id, role: 'student', department: 'IT' })), true);

  const setupToken = actionToken(messages[1]);
  const setup = await send(applicant, 'post', '/api/auth/password/setup/', { token: setupToken, password: 'campus-password-strong' });
  assert.equal(setup.status, 200, JSON.stringify(setup.body));
  const saved = await getModels().User.findById(user._id).select('+passwordHash').lean();
  const { verifyDjangoPassword } = await import('../src/utils/passwords.js');
  assert.equal(verifyDjangoPassword('campus-password-strong', saved.passwordHash), true);
  assert.notEqual(saved.passwordHash, 'campus-password-strong');
  assert.equal((await send(applicant, 'post', '/api/auth/password/setup/', { token: setupToken, password: 'another-password-strong' })).status, 401);
  assert.equal((await login('STU-EMAIL-1', 'campus-password-strong')).user.role, 'student');
  assert.ok(adminRecord.user);

  await send(applicant, 'post', '/api/auth/email/signup/', { email: 'expired-link@faculty.buksu.edu.ph' });
  await send(applicant, 'post', '/api/auth/email/verify/', { token: actionToken(messages[2]) });
  const expiredRequest = await getModels().SignupRequest.findOne({ googleEmailNormalized: 'expired-link@faculty.buksu.edu.ph' }).lean();
  await send(admin.agent, 'post', `/api/admin/signup-requests/${expiredRequest._id}/approve/`, {
    accountId: 'FAC-EMAIL-EXPIRED',
    department: 'BSEMC',
    role: 'Faculty',
  });
  const expiredSetupToken = actionToken(messages[3]);
  await getModels().EmailActionToken.updateOne(
    { purpose: 'set-application-password', emailNormalized: 'expired-link@faculty.buksu.edu.ph' },
    { $set: { expiresAt: new Date(Date.now() - 1_000) } },
  );
  const expiredSetup = await send(applicant, 'post', '/api/auth/password/setup/', {
    token: expiredSetupToken,
    password: 'expired-password-strong',
  });
  assert.equal(expiredSetup.status, 401);
});

test('rejection creates no account; admin OAuth setting is protected, persistent, and fails closed', async () => {
  const applicant = agent();
  await send(applicant, 'post', '/api/auth/email/signup/', { email: 'reject@student.buksu.edu.ph' });
  await send(applicant, 'post', '/api/auth/email/verify/', { token: actionToken(messages[0]) });
  const signup = await getModels().SignupRequest.findOne({ googleEmailNormalized: 'reject@student.buksu.edu.ph' }).lean();
  await createUser({ username: 'ADM-SET', role: 'admin' });
  await createUser({ username: 'STU-SET', role: 'student' });
  const admin = await login('ADM-SET');
  const student = await login('STU-SET');
  const unauthorized = await send(student.agent, 'put', '/api/admin/settings/google-oauth/', { enabled: true });
  assert.equal(unauthorized.status, 403);
  assert.equal((await student.agent.get('/api/admin/settings/google-oauth/')).status, 403);
  const saved = await send(admin.agent, 'put', '/api/admin/settings/google-oauth/', { enabled: false });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.enabled, false);
  assert.equal((await request().get('/api/auth/google/config/')).body.enabled, false);
  assert.equal((await send(agent(), 'post', '/api/auth/google/session/', {})).body.enabled, false);
  assert.equal((await send(agent(), 'post', '/api/auth/google/', { credential: 'not-accepted' })).status, 503);
  assert.equal((await login('ADM-SET')).user.role, 'admin');
  const reenabled = await send(admin.agent, 'put', '/api/admin/settings/google-oauth/', { enabled: true });
  assert.equal(reenabled.status, 200);
  assert.equal(reenabled.body.enabled, true);

  const rejected = await send(admin.agent, 'post', `/api/admin/signup-requests/${signup._id}/reject/`, {});
  assert.equal(rejected.status, 200);
  assert.equal(await getModels().User.exists({ emailNormalized: 'reject@student.buksu.edu.ph' }), null);

  await getModels().SystemSetting.deleteOne({ _id: 'google_oauth_enabled' });
  assert.equal((await request().get('/api/auth/google/config/')).body.enabled, false);
  assert.equal((await admin.agent.get('/api/admin/settings/google-oauth/')).status, 200);
  assert.equal((await admin.agent.get('/api/admin/settings/google-oauth/')).body.enabled, false);
});

test('announcement publishing is admin-only and recipient targeting is enforced', async () => {
  await createUser({ username: 'ADM-ANN', role: 'admin' });
  await createUser({ username: 'STU-ANN', role: 'student' });
  await createUser({ username: 'FAC-ANN', role: 'faculty' });
  const admin = await login('ADM-ANN');
  const student = await login('STU-ANN');
  const faculty = await login('FAC-ANN');
  assert.equal((await send(student.agent, 'post', '/api/admin/announcements/', {
    title: 'forbidden', message: 'not admin', audience: 'all',
  })).status, 403);
  const created = await send(admin.agent, 'post', '/api/admin/announcements/', {
    title: 'Faculty only', message: 'A targeted message', audience: 'faculty',
  });
  assert.equal(created.status, 201);
  assert.equal((await student.agent.get('/api/announcements/')).body.length, 0);
  const received = await faculty.agent.get('/api/announcements/');
  assert.equal(received.status, 200);
  assert.equal(received.body.length, 1);
  assert.equal(received.body[0].id, created.body.id);
  const adminList = await admin.agent.get('/api/admin/announcements/');
  assert.equal(adminList.status, 200);
  assert.equal(adminList.body.length, 1);
});
