import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agent, createUser, getModels, login, request, reset, send, setup, teardown } from './helpers.js';

const CLIENT_ID = '1234567890-test.apps.googleusercontent.com';
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let googleService = null;

before(setup);
after(teardown);
beforeEach(reset);
afterEach(() => googleService?.__resetGoogleTokenVerifier());

async function stubVerifier(payload) {
  googleService = googleService || await import('../src/services/googleAuthService.js');
  googleService.__setGoogleTokenVerifier(async () => payload);
  return googleService;
}

function claims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    sub: 'google-sub-0001',
    email: 'new.user@gmail.com',
    email_verified: true,
    name: 'New User',
    picture: 'https://lh3.googleusercontent.com/a/photo',
    iat: now - 10,
    exp: now + 3600,
    ...overrides,
  };
}

/** Mirrors the browser: start the flow to collect a nonce, then submit a credential. */
async function googleSignIn(client, overrides = {}, body = {}) {
  const start = await send(client, 'post', '/api/auth/google/session/', {});
  assert.equal(start.status, 200, JSON.stringify(start.body));
  await stubVerifier(claims({ nonce: start.body.nonce, ...overrides }));
  return send(client, 'post', '/api/auth/google/', { credential: 'fake-credential', ...body });
}

/**
 * Runs `body` with a temporary GOOGLE_ALLOWED_HOSTED_DOMAINS value. The env module
 * freezes its config at import time, so the subdomain process is the honest way to
 * prove the real configuration path rather than a test-only override.
 */
function withHostedDomains(domains, script) {
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: { ...process.env, GOOGLE_ALLOWED_HOSTED_DOMAINS: domains, GOOGLE_CLIENT_ID: CLIENT_ID },
    encoding: 'utf8',
  });
}


test('exposes the public Google configuration and no secret', async () => {
  const response = await request().get('/api/auth/google/config/');
  assert.equal(response.status, 200);
  assert.equal(response.body.enabled, true);
  assert.equal(response.body.clientId, CLIENT_ID);
  assert.equal(JSON.stringify(response.body).toLowerCase().includes('secret'), false);
});

test('password login still works and CSRF guards the Google routes', async () => {
  await createUser({ username: 'STU001', role: 'student' });
  const { agent: client, user } = await login('STU001');
  assert.equal(user.id, 'STU001');
  const blocked = await client.post('/api/auth/google/').send({ credential: 'x' });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.detail, /CSRF/);
});

test('a linked Google identity signs into its account and keeps its role', async () => {
  const { user } = await createUser({ username: 'FAC001', role: 'faculty' });
  await getModels().User.updateOne({ _id: user._id }, {
    $set: { googleSub: 'google-sub-fac', googleEmail: 'fac@cot.edu', googleEmailNormalized: 'fac@cot.edu' },
    $addToSet: { authProviders: 'google' },
  });
  const client = agent();
  const response = await googleSignIn(client, { sub: 'google-sub-fac', email: 'fac@cot.edu' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.status, 'signed_in');
  assert.equal(response.body.user.id, 'FAC001');
  assert.equal(response.body.user.role, 'faculty');
  assert.equal(response.body.user.googleLinked, true);
  assert.equal((await client.get('/api/auth/me/')).body.username, 'FAC001');
});

test('a new Google identity registers as a student with no password', async () => {
  const client = agent();
  const started = await googleSignIn(client);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, 'profile_incomplete');
  assert.equal(started.body.prefill.email, 'new.user@gmail.com');
  assert.equal(started.body.prefill.name, 'New User');
  const completed = await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU700', department: 'BSIT', name: 'New User', phone: '09171234567',
  });
  assert.equal(completed.status, 201, JSON.stringify(completed.body));
  assert.equal(completed.body.user.role, 'student');
  assert.equal(completed.body.user.id, 'STU700');
  const stored = await getModels().User.findOne({ accountIdNormalized: 'stu700' }).select('+passwordHash');
  assert.equal(stored.passwordHash, null);
  assert.deepEqual([...stored.authProviders], ['google']);
  assert.equal(stored.isStaff, false);
  assert.equal(stored.isSuperuser, false);
  const profile = await getModels().UserProfile.findOne({ userId: stored._id }).lean();
  assert.equal(profile.role, 'student');
  assert.equal((await client.get('/api/auth/me/')).status, 200);
});


test('profile completion cannot be bypassed without a verified identity', async () => {
  const client = agent();
  const response = await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU701', department: 'BSIT', name: 'Sneaky',
  });
  assert.equal(response.status, 400);
  assert.match(response.body.profile, /Start Google sign-in again/);
  assert.equal(await getModels().User.countDocuments({ accountIdNormalized: 'stu701' }), 0);
});

test('a browser supplied role is rejected during Google registration', async () => {
  const client = agent();
  await googleSignIn(client);
  const response = await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU702', department: 'BSIT', name: 'Aspirer', role: 'admin',
  });
  assert.equal(response.status, 400);
  assert.match(response.body.role, /assigned by an administrator/);
  assert.equal(await getModels().User.countDocuments({ accountIdNormalized: 'stu702' }), 0);
});

test('a matching email never silently merges into an existing account', async () => {
  const { user } = await createUser({ username: 'STU001', role: 'student', email: 'shared@cot.edu' });
  const client = agent();
  const response = await googleSignIn(client, { email: 'shared@cot.edu' });
  assert.equal(response.status, 409);
  assert.match(response.body.detail, /already uses this email/);
  const stored = await getModels().User.findById(user._id).lean();
  assert.equal(stored.googleSub, null);
  assert.equal((await client.get('/api/auth/me/')).status, 401);
});

test('a deactivated account stays blocked through Google', async () => {
  const { user } = await createUser({ username: 'STU001', role: 'student' });
  await getModels().User.updateOne({ _id: user._id }, {
    $set: { isActive: false, googleSub: 'google-sub-blocked', googleEmail: 'blocked@cot.edu', googleEmailNormalized: 'blocked@cot.edu' },
  });
  const client = agent();
  const response = await googleSignIn(client, { sub: 'google-sub-blocked', email: 'blocked@cot.edu' });
  assert.equal(response.status, 403);
  assert.match(response.body.detail, /deactivated/);
  assert.equal((await client.get('/api/auth/me/')).status, 401);
});

test('rejects malformed, wrong-audience, wrong-issuer, expired and unverified credentials', async () => {
  const cases = [
    ['wrong audience', claims({ aud: 'other.apps.googleusercontent.com' }), 401, /different application/],
    ['wrong issuer', claims({ iss: 'https://evil.example' }), 401, /untrusted issuer/],
    ['expired', claims({ exp: Math.floor(Date.now() / 1000) - 600 }), 401, /expired/],
    ['unverified email', claims({ email_verified: false }), 403, /verified email/],
    ['missing subject', claims({ sub: '' }), 401, /missing an account identifier/],
  ];
  for (const [label, payload, status, pattern] of cases) {
    const client = agent();
    await send(client, 'post', '/api/auth/google/session/', {});
    await stubVerifier({ ...payload, nonce: (await send(client, 'post', '/api/auth/google/session/', {})).body.nonce });
    const response = await send(client, 'post', '/api/auth/google/', { credential: 'fake-credential' });
    assert.equal(response.status, status, `${label}: ${JSON.stringify(response.body)}`);
    assert.match(response.body.detail, pattern, label);
    assert.equal((await client.get('/api/auth/me/')).status, 401, label);
  }
});

test('a real library call rejects a genuinely invalid token', async () => {
  googleService = googleService || await import('../src/services/googleAuthService.js');
  googleService.__resetGoogleTokenVerifier();
  const client = agent();
  await send(client, 'post', '/api/auth/google/session/', {});
  const response = await send(client, 'post', '/api/auth/google/', { credential: 'not.a.real.jwt' });
  assert.equal(response.status, 401);
  assert.match(response.body.detail, /could not be verified/);
});

test('the real verifier refuses a well-formed token with a forged signature', async () => {
  // This is the check the rest of the suite stubs out, so it is asserted here
  // against the genuine google-auth-library call. The claims below are all valid
  // (correct audience, issuer, fresh expiry, verified email, correct nonce), so
  // the ONLY reason to refuse is that the RSA signature is not Google's.
  googleService = googleService || await import('../src/services/googleAuthService.js');
  googleService.__resetGoogleTokenVerifier();

  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'attacker-key' });
  const payload = encode({
    aud: CLIENT_ID,
    iss: 'https://accounts.google.com',
    sub: 'forged-subject',
    email: 'attacker@gmail.com',
    email_verified: true,
    name: 'Attacker',
    iat: now - 10,
    exp: now + 3600,
  });
  const forged = `${header}.${payload}.${crypto
    .sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), privateKey)
    .toString('base64url')}`;

  const client = agent();
  const start = await send(client, 'post', '/api/auth/google/session/', {});
  assert.equal(start.status, 200, JSON.stringify(start.body));
  // Bind the forged token to this session's real nonce, so nonce checking passes
  // too and the signature is the only remaining reason to refuse.
  const [h, p] = forged.split('.');
  const body = JSON.parse(Buffer.from(p, 'base64url').toString());
  body.nonce = start.body.nonce;
  const reboundPayload = Buffer.from(JSON.stringify(body)).toString('base64url');
  const rebound = `${h}.${reboundPayload}.${crypto
    .sign('RSA-SHA256', Buffer.from(`${h}.${reboundPayload}`), privateKey)
    .toString('base64url')}`;

  const response = await send(client, 'post', '/api/auth/google/', { credential: rebound });
  assert.equal(response.status, 401, `expected 401, got ${response.status}: ${JSON.stringify(response.body)}`);
  assert.match(response.body.detail, /could not be verified/);
  // No account was created and no session was established.
  assert.equal((await client.get('/api/auth/me/')).status, 401);
  assert.equal(await getModels().User.countDocuments({ googleSub: 'forged-subject' }), 0);
});

test('the nonce must match the session and cannot be replayed', async () => {
  const client = agent();
  await send(client, 'post', '/api/auth/google/session/', {});
  await stubVerifier(claims({ nonce: 'a-different-nonce' }));
  const mismatch = await send(client, 'post', '/api/auth/google/', { credential: 'fake-credential' });
  assert.equal(mismatch.status, 401);
  assert.match(mismatch.body.detail, /matched to your session/);

  const replay = agent();
  const start = await send(replay, 'post', '/api/auth/google/session/', {});
  await stubVerifier(claims({ nonce: start.body.nonce }));
  await send(replay, 'post', '/api/auth/google/', { credential: 'fake-credential' });
  // The nonce is single use, so the replayed credential is refused even though
  // the session no longer holds the nonce it was issued for.
  const again = await send(replay, 'post', '/api/auth/google/', { credential: 'fake-credential' });
  assert.equal(again.status, 401);
  assert.match(again.body.detail, /has expired|matched to your session/);
});

test('simultaneous registrations for one identity create a single account', async () => {
  const open = async (accountId) => {
    const client = agent();
    const opened = await googleSignIn(client);
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    assert.equal(opened.body.status, 'profile_incomplete');
    return { client, accountId };
  };
  const first = await open('STU704');
  const second = await open('STU705');
  const service = googleService;
  const [responseA, responseB] = await Promise.all([
    send(first.client, 'post', '/api/auth/google/complete-profile/', { accountId: first.accountId, department: 'BSIT', name: 'Race One' }),
    (async () => {
      await stubVerifier(claims());
      return send(second.client, 'post', '/api/auth/google/complete-profile/', { accountId: second.accountId, department: 'BSIT', name: 'Race Two' });
    })(),
  ]);
  assert.ok(
    [responseA.status, responseB.status].includes(201),
    `expected one account to be created, got ${JSON.stringify([responseA.body, responseB.body])}`,
  );
  assert.equal(await getModels().User.countDocuments({ googleSub: 'google-sub-0001' }), 1);
  assert.equal(await getModels().UserProfile.countDocuments(), 1);
});

test('session survives a refresh and logout invalidates it', async () => {
  const client = agent();
  await googleSignIn(client);
  await send(client, 'post', '/api/auth/google/complete-profile/', { accountId: 'STU706', department: 'BSIT', name: 'Session Test' });
  assert.equal((await client.get('/api/auth/me/')).status, 200);
  assert.equal((await send(client, 'post', '/api/auth/logout/')).status, 204);
  assert.equal((await client.get('/api/auth/me/')).status, 401);
});

test('linking attaches Google to the signed-in account and refuses a taken subject', async () => {
  await createUser({ username: 'STU001', role: 'student', email: 'stu001@cot.edu' });
  await createUser({ username: 'FAC001', role: 'faculty' });
  await getModels().User.updateOne({ username: 'FAC001' }, {
    $set: { googleSub: 'google-sub-taken', googleEmail: 'fac@cot.edu', googleEmailNormalized: 'fac@cot.edu' },
  });
  const { agent: client } = await login('STU001');
  // STU001 is already signed in. Submitting FAC001's Google identity must link
  // nothing and must not switch accounts, so the session is left untouched.
  const takenStart = await send(client, 'post', '/api/auth/google/session/', {});
  await stubVerifier(claims({ nonce: takenStart.body.nonce, sub: 'google-sub-taken', email: 'fac@cot.edu' }));
  const rejected = await send(client, 'post', '/api/auth/google/link/', { credential: 'fake-credential' });
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.detail, /already linked to another/);
  assert.equal((await client.get('/api/auth/me/')).body.username, 'STU001');

  const freeStart = await send(client, 'post', '/api/auth/google/session/', {});
  await stubVerifier(claims({ nonce: freeStart.body.nonce, sub: 'google-sub-free', email: 'mine@gmail.com' }));
  const linked = await send(client, 'post', '/api/auth/google/link/', { credential: 'fake-credential' });
  assert.equal(linked.status, 200, JSON.stringify(linked.body));
  assert.equal(linked.body.googleLinked, true);
  const stored = await getModels().User.findOne({ username: 'STU001' }).lean();
  assert.equal(stored.googleSub, 'google-sub-free');
  assert.equal(stored.email, 'stu001@cot.edu', 'linking must not overwrite the account email');
});

test('an unauthenticated caller cannot link a Google identity', async () => {
  const client = agent();
  const start = await send(client, 'post', '/api/auth/google/session/', {});
  await stubVerifier(claims({ nonce: start.body.nonce }));
  const response = await send(client, 'post', '/api/auth/google/link/', { credential: 'fake-credential' });
  assert.equal(response.status, 401);
});

test('a missing client id leaves the server in a clear unavailable state', () => {
  const script = [
    "import { googlePublicConfig, verifyGoogleCredential } from './src/services/googleAuthService.js';",
    'const config = googlePublicConfig();',
    'console.log(JSON.stringify({ enabled: config.enabled, clientId: config.clientId }));',
    'try { await verifyGoogleCredential("anything"); console.log("NO_ERROR"); }',
    'catch (error) { console.log(String(error.status)); }',
  ].join('\n');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: { ...process.env, GOOGLE_CLIENT_ID: '' },
    encoding: 'utf8',
  });
  const [configLine, statusLine] = output.trim().split('\n');
  assert.deepEqual(JSON.parse(configLine), { enabled: false, clientId: null });
  assert.equal(statusLine, '503');
});

test('a Google-only account cannot be signed into with a password', async () => {
  const client = agent();
  await googleSignIn(client);
  await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU703', department: 'BSIT', name: 'No Password',
  });
  const fresh = agent();
  const response = await send(fresh, 'post', '/api/auth/login/', { identifier: 'STU703', password: 'anything' });
  assert.equal(response.status, 400);
  assert.equal(response.body.detail, 'The ID/username or password is incorrect.');
});

test('the approved Workspace domain list is enforced against the verified hd claim', () => {
  const script = `
    import crypto from 'node:crypto';
    import { env } from './src/config/env.js';
    import { verifyGoogleCredential, __setGoogleTokenVerifier } from './src/services/googleAuthService.js';
    const now = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(8).toString('hex');
    const base = { aud: env.googleClientId, iss: 'https://accounts.google.com', sub: 's1',
      email: 'someone@gmail.com', email_verified: true, iat: now - 5, exp: now + 600, nonce };
    const results = {};
    for (const [label, hd] of [['approved', 'cot.edu'], ['unapproved', 'evil.example'], ['personal', null]]) {
      __setGoogleTokenVerifier(async () => ({ ...base, ...(hd ? { hd } : {}) }));
      try { const id = await verifyGoogleCredential('token', { nonce }); results[label] = ['accepted', id.hostedDomain]; }
      catch (error) { results[label] = ['rejected', error.status, error.code]; }
    }
    console.log(JSON.stringify({ configured: env.googleAllowedHostedDomains, results }));
  `;
  const parsed = JSON.parse(withHostedDomains('COT.edu, @sub.cot.edu', script).trim().split('\n').pop());
  // Normalized: case-folded with the leading @ removed.
  assert.deepEqual(parsed.configured, ['cot.edu', 'sub.cot.edu']);
  assert.deepEqual(parsed.results.approved, ['accepted', 'cot.edu']);
  assert.deepEqual(parsed.results.unapproved, ['rejected', 403, 'google_domain_not_allowed']);
  // A personal Gmail account carries no hd claim at all, and is refused.
  assert.deepEqual(parsed.results.personal, ['rejected', 403, 'google_domain_not_allowed']);
});

test('the decision comes from the verified hd claim, not the email suffix', async () => {
  await createUser({ username: 'STU001', role: 'student' });
  await getModels().User.updateOne({ username: 'STU001' }, { $set: { googleSub: 'google-sub-hd' } });
  const client = agent();
  const start = await send(client, 'post', '/api/auth/google/session/', {});
  // The address suffix deliberately disagrees with hd. Only the claim may decide.
  await stubVerifier(claims({
    nonce: start.body.nonce, sub: 'google-sub-hd', email: 'person@gmail.com', hd: 'cot.edu',
  }));
  const response = await send(client, 'post', '/api/auth/google/', { credential: 'fake-credential' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.status, 'signed_in');
  assert.equal((await client.get('/api/auth/me/')).body.username, 'STU001');
});

test('selecting Faculty cannot sign into a Student account, and no role is changed', async () => {
  const { user } = await createUser({ username: 'STU001', role: 'student' });
  await getModels().User.updateOne({ _id: user._id }, { $set: { googleSub: 'google-sub-stu' } });
  const client = agent();
  const response = await googleSignIn(client, { sub: 'google-sub-stu', email: 'stu@cot.edu' }, { selectedRole: 'faculty' });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'role_mismatch');
  assert.equal(response.body.accountRole, 'student');
  assert.equal(response.body.selectedRole, 'faculty');
  assert.equal(response.body.correctPath, '/login/student');
  assert.match(response.body.detail, /registered as Student/);
  // The stored role is untouched and no session was created.
  assert.equal((await getModels().UserProfile.findOne({ userId: user._id }).lean()).role, 'student');
  assert.equal((await client.get('/api/auth/me/')).status, 401);
});

test('a matching selection signs in normally and an invented selection is ignored', async () => {
  const { user } = await createUser({ username: 'FAC001', role: 'faculty' });
  await getModels().User.updateOne({ _id: user._id }, { $set: { googleSub: 'google-sub-fac2' } });
  const matching = await googleSignIn(agent(), { sub: 'google-sub-fac2', email: 'fac@cot.edu' }, { selectedRole: 'faculty' });
  assert.equal(matching.status, 200, JSON.stringify(matching.body));
  assert.equal(matching.body.user.role, 'faculty');

  const invented = await googleSignIn(agent(), { sub: 'google-sub-fac2', email: 'fac@cot.edu' }, { selectedRole: 'superadmin' });
  assert.equal(invented.status, 200, JSON.stringify(invented.body));
  assert.equal(invented.body.user.role, 'faculty');
});

test('a new identity chosen on the Faculty screen still registers as a Student', async () => {
  const client = agent();
  const started = await googleSignIn(client, {}, { selectedRole: 'faculty' });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, 'profile_incomplete');

  // The selected account type is never forwarded as a role, and a role supplied
  // at this step is still refused outright.
  const attempted = await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU708', department: 'BSIT', name: 'New User', role: 'faculty',
  });
  assert.equal(attempted.status, 400);
  assert.match(attempted.body.role, /assigned by an administrator/);
  assert.equal(await getModels().User.countDocuments({ accountIdNormalized: 'stu708' }), 0);

  const completed = await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU708', department: 'BSIT', name: 'New User',
  });
  assert.equal(completed.status, 201, JSON.stringify(completed.body));
  assert.equal(completed.body.user.role, 'student');
  const created = await getModels().User.findOne({ accountIdNormalized: 'stu708' });
  assert.equal((await getModels().UserProfile.findOne({ userId: created._id }).lean()).role, 'student');
  assert.equal(created.isSuperuser, false);
  assert.equal(created.isStaff, false);
});
