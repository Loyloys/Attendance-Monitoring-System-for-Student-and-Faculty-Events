import test, { after, afterEach, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agent, createUser, csrfToken, getModels, login, request, reset, send, setup, teardown } from './helpers.js';

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
    // The POLICY selects which rule runs, so a domain list is only consulted
    // when the policy actually asks for it.
    env: { ...process.env, GOOGLE_ACCESS_POLICY: 'institutional', GOOGLE_ALLOWED_HOSTED_DOMAINS: domains, GOOGLE_CLIENT_ID: CLIENT_ID },
    encoding: 'utf8',
  });
}


test('exposes the public Google configuration and no secret', async () => {
  const response = await request().get('/api/auth/google/config/');
  assert.equal(response.status, 200);
  assert.equal(response.body.enabled, true);
  assert.equal(response.body.configurationAvailable, true);
  assert.equal(response.body.clientIdPresent, true);
  assert.equal(response.body.settingAvailable, true);
  assert.equal(response.body.settingEnabled, true);
  assert.equal(response.body.clientId, CLIENT_ID);
  assert.equal(JSON.stringify(response.body).toLowerCase().includes('secret'), false);
  // This workspace runs the private test policy, and the endpoint must say so
  // rather than implying an institutional restriction is in place.
  assert.equal(response.body.mode, 'development_test');
  assert.equal(response.body.developmentTesting, true);
  assert.equal(response.body.domainRestricted, false);
  assert.equal(response.body.schoolApproved, false);
  // The allowlist is a server-side secret of configuration: it is never returned.
  assert.equal(JSON.stringify(response.body).toLowerCase().includes('gmail.com'), false);

  const client = agent();
  const session = await send(client, 'post', '/api/auth/google/session/', {});
  assert.equal(session.status, 200);
  for (const key of ['enabled', 'configurationAvailable', 'clientIdPresent', 'settingAvailable', 'settingEnabled', 'mode']) {
    assert.equal(session.body[key], response.body[key], `${key} must match the public config endpoint`);
  }
  assert.equal(typeof session.body.nonce, 'string');
});

test('a missing Admin OAuth setting defaults to disabled, distinct from missing backend configuration', async () => {
  await getModels().SystemSetting.deleteOne({ _id: 'google_oauth_enabled' });

  const response = await request().get('/api/auth/google/config/');
  assert.equal(response.status, 200);
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.settingAvailable, true);
  assert.equal(response.body.settingEnabled, false);
  assert.equal(response.body.configurationAvailable, true);
  assert.equal(response.body.clientIdPresent, true);
});

test('Google OAuth follows the administrator setting while manual sign-in stays available', async () => {
  await createUser({ username: 'STU020', role: 'student' });
  const signupClient = agent();
  const signupStart = await googleSignIn(signupClient, {
    email: 'tester@example.com',
    sub: 'google-sub-disabled-signup',
  });
  assert.equal(signupStart.body.status, 'profile_incomplete');

  await getModels().SystemSetting.findByIdAndUpdate(
    'google_oauth_enabled',
    { $set: { value: false } },
    { upsert: true },
  );

  const config = await request().get('/api/auth/google/config/');
  assert.equal(config.status, 200);
  assert.equal(config.body.enabled, false);
  assert.equal(config.body.mode, 'unavailable');
  assert.equal(config.body.configurationAvailable, true);
  assert.equal(config.body.clientIdPresent, true);
  assert.equal(config.body.settingAvailable, true);
  assert.equal(config.body.settingEnabled, false);

  const client = agent();
  const googleSession = await send(client, 'post', '/api/auth/google/session/', {});
  assert.equal(googleSession.status, 200);
  assert.equal(googleSession.body.enabled, false);
  assert.equal(googleSession.body.nonce, null);
  assert.equal(googleSession.body.configurationAvailable, config.body.configurationAvailable);
  assert.equal(googleSession.body.settingEnabled, config.body.settingEnabled);
  const refusedGoogleLogin = await send(client, 'post', '/api/auth/google/', { credential: 'fake-credential' });
  assert.equal(refusedGoogleLogin.status, 503);
  assert.match(refusedGoogleLogin.body.detail, /disabled by an administrator/);
  assert.equal((await client.get('/api/auth/me/')).status, 401);

  const refusedSignup = await send(signupClient, 'post', '/api/auth/google/complete-profile/', {});
  assert.equal(refusedSignup.status, 503);
  assert.match(refusedSignup.body.detail, /Google signup is disabled/);
  assert.equal(await getModels().SignupRequest.countDocuments({ googleSub: 'google-sub-disabled-signup' }), 0);
  assert.equal((await signupClient.get('/api/auth/me/')).status, 401);

  const manual = await login('STU020');
  assert.equal(manual.user.role, 'student');
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

test('a new Google identity submits a pending signup request with no User yet', async () => {
  const client = agent();
  const started = await googleSignIn(client);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, 'profile_incomplete');
  assert.equal(started.body.prefill.email, 'new.user@gmail.com');
  assert.equal(started.body.prefill.name, 'New User');
  const completed = await send(client, 'post', '/api/auth/google/complete-profile/', {});
  // AD003.3: pending request stored; no User, no role, no session.
  assert.equal(completed.status, 202, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'signup_pending');
  assert.equal(await getModels().User.countDocuments({ accountIdNormalized: 'stu700' }), 0);
  const request = await getModels().SignupRequest.findOne({ googleEmailNormalized: 'new.user@gmail.com' }).lean();
  assert.ok(request);
  assert.equal(request.status, 'pending');
  assert.equal((await client.get('/api/auth/me/')).status, 401);
});


test('profile completion cannot be bypassed without a verified identity', async () => {
  const client = agent();
  const response = await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU701', department: 'IT', name: 'Sneaky',
  });
  assert.equal(response.status, 400);
  assert.match(response.body.profile, /Start Google sign-in again/);
  assert.equal(await getModels().User.countDocuments({ accountIdNormalized: 'stu701' }), 0);
});

test('a browser supplied role is rejected during Google registration', async () => {
  const client = agent();
  await googleSignIn(client);
  const response = await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU702', department: 'IT', name: 'Aspirer', role: 'admin',
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

test('pending, rejected, and archived linked Google accounts receive no session', async () => {
  const blockedAccounts = [
    { username: 'STU015', googleSub: 'google-pending', approvalStatus: 'pending' },
    { username: 'STU016', googleSub: 'google-rejected', approvalStatus: 'rejected' },
    { username: 'STU017', googleSub: 'google-archived', archivedAt: new Date() },
  ];
  for (const { username, googleSub, ...changes } of blockedAccounts) {
    const { user } = await createUser({ username, role: 'student' });
    await getModels().User.updateOne({ _id: user._id }, {
      $set: {
        googleSub,
        googleEmail: `${username.toLowerCase()}@cot.edu`,
        googleEmailNormalized: `${username.toLowerCase()}@cot.edu`,
        ...changes,
      },
      $addToSet: { authProviders: 'google' },
    });
  }

  for (const { googleSub, username } of blockedAccounts) {
    const client = agent();
    const response = await googleSignIn(client, {
      sub: googleSub,
      email: `${username.toLowerCase()}@cot.edu`,
    });
    assert.equal(response.status, 403, JSON.stringify(response.body));
    assert.equal((await client.get('/api/auth/me/')).status, 401);
  }
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

test('simultaneous signup requests for one identity create a single pending request', async () => {
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
    send(first.client, 'post', '/api/auth/google/complete-profile/', {}),
    (async () => {
      await stubVerifier(claims());
      return send(second.client, 'post', '/api/auth/google/complete-profile/', {});
    })(),
  ]);
  // AD003.3: both submissions converge on one pending request; no User exists.
  assert.ok(
    [responseA.status, responseB.status].every((status) => [202, 409].includes(status)),
    `expected pending/duplicate handling, got ${JSON.stringify([responseA.body, responseB.body])}`,
  );
  assert.equal(await getModels().SignupRequest.countDocuments({ googleSub: 'google-sub-0001' }), 1);
  assert.equal(await getModels().User.countDocuments({ googleSub: 'google-sub-0001' }), 0);
});

test('a pending signup reaches no attendance feature until admin approval', async () => {
  const client = agent();
  await googleSignIn(client);
  const submitted = await send(client, 'post', '/api/auth/google/complete-profile/', {});
  assert.equal(submitted.status, 202, JSON.stringify(submitted.body));
  // No session: refresh and logout paths stay unauthenticated.
  assert.equal((await client.get('/api/auth/me/')).status, 401);
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
    'console.log(JSON.stringify({ enabled: config.enabled, clientIdPresent: Boolean(config.clientId) }));',
    'try { await verifyGoogleCredential("anything"); console.log("NO_ERROR"); }',
    'catch (error) { console.log(String(error.status)); }',
  ].join('\n');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: { ...process.env, GOOGLE_CLIENT_ID: '' },
    encoding: 'utf8',
  });
  const [configLine, statusLine] = output.trim().split('\n');
  assert.deepEqual(JSON.parse(configLine), { enabled: false, clientIdPresent: false });
  assert.equal(statusLine, '503');
});

test('a Google-only account cannot be signed into with a password', async () => {
  const client = agent();
  await googleSignIn(client);
  await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU703', department: 'IT', name: 'No Password',
  });
  const fresh = agent();
  const response = await send(fresh, 'post', '/api/auth/login/', { identifier: 'STU703', password: 'anything' });
  assert.equal(response.status, 400);
  assert.equal(response.body.detail, 'The account identifier or password is incorrect.');
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

test('the recorded Workspace domain comes from the hd claim, not the email suffix', async () => {
  googleService = googleService || await import('../src/services/googleAuthService.js');
  const start = await send(agent(), 'post', '/api/auth/google/session/', {});
  // The address and the claim deliberately disagree: a personal-looking address
  // carrying a Workspace domain. The identity the server builds must take the
  // address from `email` and the domain from `hd`, with neither guessed from the
  // other. This is the raw decision the whole flow rests on.
  await stubVerifier(claims({
    nonce: start.body.nonce, email: 'person@gmail.com', hd: 'cot.edu',
  }));
  const identity = await googleService.verifyGoogleCredential('fake-credential', { nonce: start.body.nonce });
  assert.equal(identity.email, 'person@gmail.com');
  assert.equal(identity.hostedDomain, 'cot.edu');
  assert.notEqual(identity.email.split('@')[1], identity.hostedDomain);
});

test('an account outside the private test list is refused even though the token is valid', async () => {
  const client = agent();
  const response = await googleSignIn(client, { email: 'stranger@gmail.com', sub: 'google-sub-stranger' });
  assert.equal(response.status, 403, JSON.stringify(response.body));
  assert.equal(response.body.code, 'google_test_account_not_allowed');
  assert.match(response.body.detail, /not on the private development test list/);
  // Refused means refused: no account, no session, and no pending identity that
  // the profile step could turn into a user.
  assert.equal(await getModels().User.countDocuments({ googleSub: 'google-sub-stranger' }), 0);
  assert.equal((await client.get('/api/auth/me/')).status, 401);
});

test('the private test list matches whole addresses only, never a suffix or a domain', async () => {
  googleService = googleService || await import('../src/services/googleAuthService.js');
  // Each of these is a different way to try to ride in on a listed address.
  // `new.user@gmail.com` is on the list; none of the following are.
  const impostors = [
    'new.user+extra@gmail.com',
    'xnew.user@gmail.com',
    'new.user@gmail.com.evil.example',
    'new.user@evil.example',
  ];
  for (const email of impostors) {
    const nonce = 'a-nonce-for-the-impostor-cases';
    await stubVerifier(claims({ nonce, email }));
    await assert.rejects(
      googleService.verifyGoogleCredential('fake-credential', { nonce }),
      (error) => {
        assert.equal(error.status, 403, email);
        assert.equal(error.code, 'google_test_account_not_allowed', email);
        return true;
      },
      `${email} must be refused`,
    );
  }
});

test('the private test list ignores casing and surrounding space, and nothing else', async () => {
  const client = agent();
  const response = await googleSignIn(client, { email: '  New.User@Gmail.com  ', sub: 'google-sub-case' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.status, 'profile_incomplete');
  assert.equal(response.body.prefill.email, 'new.user@gmail.com');
});

test('an empty test list closes the flow instead of allowing every account', () => {
  // The dangerous case: the switch is on but nobody was named. This must fail
  // closed, not open.
  const script = `
    import { googlePublicConfig, googleSignInMode } from './src/services/googleAuthService.js';
    const config = googlePublicConfig();
    console.log(JSON.stringify({ mode: googleSignInMode(), enabled: config.enabled }));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: {
      ...process.env,
      GOOGLE_ACCESS_POLICY: 'development_test',
      GOOGLE_DEV_TEST_EMAILS: '',
      GOOGLE_ALLOWED_HOSTED_DOMAINS: '',
      GOOGLE_CLIENT_ID: CLIENT_ID,
    },
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output.trim().split('\n').pop());
  assert.equal(parsed.mode, 'unavailable');
  assert.equal(parsed.enabled, false);
});

test('an unconfigured server refuses a credential outright rather than accepting it', () => {
  const script = `
    import crypto from 'node:crypto';
    import { env } from './src/config/env.js';
    import { verifyGoogleCredential, __setGoogleTokenVerifier } from './src/services/googleAuthService.js';
    const now = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(8).toString('hex');
    __setGoogleTokenVerifier(async () => ({ aud: env.googleClientId, iss: 'https://accounts.google.com',
      sub: 's1', email: 'anyone@gmail.com', email_verified: true, iat: now - 5, exp: now + 600, nonce }));
    try { await verifyGoogleCredential('token', { nonce }); console.log('ACCEPTED'); }
    catch (error) { console.log(JSON.stringify({ status: error.status })); }
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: {
      ...process.env,
      GOOGLE_ACCESS_POLICY: 'off',
      GOOGLE_DEV_TEST_EMAILS: '',
      GOOGLE_ALLOWED_HOSTED_DOMAINS: '',
      GOOGLE_CLIENT_ID: CLIENT_ID,
    },
    encoding: 'utf8',
  });
  // A perfectly valid, correctly signed Google token is still refused, because
  // no policy is configured to say who may use it.
  assert.equal(JSON.parse(output.trim().split('\n').pop()).status, 503);
});

test('the selected policy decides, and the presence of a domain list does not override it', () => {
  // The old behaviour inferred the rule from configuration. The policy enum
  // removes that ambiguity, so both directions are asserted: the policy picks
  // the rule, and a stray domain list cannot quietly switch it.
  const script = `
    import crypto from 'node:crypto';
    import { env } from './src/config/env.js';
    import { googlePublicConfig, verifyGoogleCredential, __setGoogleTokenVerifier } from './src/services/googleAuthService.js';
    const now = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(8).toString('hex');
    __setGoogleTokenVerifier(async () => ({ aud: env.googleClientId, iss: 'https://accounts.google.com',
      sub: 's1', email: 'listed.test.account@gmail.com', email_verified: true, iat: now - 5, exp: now + 600, nonce }));
    try { const id = await verifyGoogleCredential('token', { nonce }); console.log(JSON.stringify({ mode: googlePublicConfig().mode, result: ['accepted', id.hostedDomain] })); }
    catch (error) { console.log(JSON.stringify({ mode: googlePublicConfig().mode, result: ['rejected', error.status, error.code] })); }
  `;
  const common = {
    ...process.env,
    // A domain list AND a test list are both present in both runs; only the
    // policy differs, so any difference in outcome is the policy's doing.
    GOOGLE_ALLOWED_HOSTED_DOMAINS: 'cot.edu',
    GOOGLE_DEV_TEST_EMAILS: 'listed.test.account@gmail.com',
    GOOGLE_CLIENT_ID: CLIENT_ID,
  };
  const asInstitutional = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot, env: { ...common, GOOGLE_ACCESS_POLICY: 'institutional' }, encoding: 'utf8',
  }).trim().split('\n').pop());
  assert.equal(asInstitutional.mode, 'institutional');
  // No `hd` claim on a personal account: refused, even though it is on the test
  // list. The institutional rule is genuinely in force.
  assert.deepEqual(asInstitutional.result, ['rejected', 403, 'google_domain_not_allowed']);

  const asDevTest = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot, env: { ...common, GOOGLE_ACCESS_POLICY: 'development_test' }, encoding: 'utf8',
  }).trim().split('\n').pop());
  assert.equal(asDevTest.mode, 'development_test');
  // The domain list being present does not matter under this policy.
  assert.deepEqual(asDevTest.result, ['accepted', '']);
  assert.equal(
    JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
      "import { googlePublicConfig } from './src/services/googleAuthService.js'; console.log(JSON.stringify(googlePublicConfig().schoolApproved));"], {
      cwd: backendRoot, env: { ...common, GOOGLE_ACCESS_POLICY: 'institutional' }, encoding: 'utf8',
    }).trim().split('\n').pop()),
    false,
    'a domain list must never imply school approval',
  );
});

test('the private test mode cannot be switched on in production', () => {
  // NODE_ENV=production must refuse to boot rather than quietly ignoring the
  // setting, so a misconfigured deployment fails loudly instead of exposing it.
  const script = "import './src/config/env.js'; console.log('LOADED');";
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      SESSION_SECRET: 'production-session-secret-with-at-least-32-characters',
      GOOGLE_CLIENT_ID: CLIENT_ID,
      GOOGLE_ACCESS_POLICY: 'development_test',
      GOOGLE_DEV_TEST_EMAILS: 'someone@gmail.com',
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
});

test('the open policy accepts any verified Google account and reports itself honestly', () => {
  // Deliberately nothing but a client id: the whole point of the policy enum is
  // that `open` is a choice, not something an empty domain list implies.
  const script = `
    import crypto from 'node:crypto';
    import { env } from './src/config/env.js';
    import { googlePublicConfig, verifyGoogleCredential, __setGoogleTokenVerifier } from './src/services/googleAuthService.js';
    const now = Math.floor(Date.now() / 1000);
    const out = {};
    for (const [label, extra] of [['personal-gmail', {}], ['work-account', { hd: 'some-university.edu' }]]) {
      const nonce = crypto.randomBytes(8).toString('hex');
      __setGoogleTokenVerifier(async () => ({ aud: env.googleClientId, iss: 'https://accounts.google.com',
        sub: 's-' + label, email: label + '@mail.test', email_verified: true,
        iat: now - 5, exp: now + 600, nonce, ...extra }));
      try { const id = await verifyGoogleCredential('token', { nonce }); out[label] = ['accepted', id.email]; }
      catch (error) { out[label] = ['rejected', error.status, error.code]; }
    }
    const config = googlePublicConfig();
    console.log(JSON.stringify({ mode: config.mode, policy: config.policy,
      openRegistration: config.openRegistration, schoolApproved: config.schoolApproved, out }));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: { ...process.env, GOOGLE_ACCESS_POLICY: 'open', GOOGLE_ALLOWED_HOSTED_DOMAINS: '', GOOGLE_CLIENT_ID: CLIENT_ID },
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output.trim().split('\n').pop());
  assert.equal(parsed.mode, 'open');
  assert.equal(parsed.policy, 'open');
  assert.equal(parsed.openRegistration, true);
  // Still not a school approval, even though the app now accepts any account.
  assert.equal(parsed.schoolApproved, false);
  assert.deepEqual(parsed.out['personal-gmail'], ['accepted', 'personal-gmail@mail.test']);
  assert.deepEqual(parsed.out['work-account'], ['accepted', 'work-account@mail.test']);
});

test('the off policy refuses a valid credential, so open is never reached by accident', () => {
  const script = `
    import crypto from 'node:crypto';
    import { env } from './src/config/env.js';
    import { googleSignInMode, verifyGoogleCredential, __setGoogleTokenVerifier } from './src/services/googleAuthService.js';
    const now = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomBytes(8).toString('hex');
    __setGoogleTokenVerifier(async () => ({ aud: env.googleClientId, iss: 'https://accounts.google.com',
      sub: 's1', email: 'anyone@gmail.com', email_verified: true, iat: now - 5, exp: now + 600, nonce }));
    try { await verifyGoogleCredential('token', { nonce }); console.log('ACCEPTED'); }
    catch (error) { console.log(JSON.stringify({ mode: googleSignInMode(), status: error.status })); }
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: { ...process.env, GOOGLE_ACCESS_POLICY: 'off', GOOGLE_ALLOWED_HOSTED_DOMAINS: '', GOOGLE_CLIENT_ID: CLIENT_ID },
    encoding: 'utf8',
  });
  const parsed = JSON.parse(output.trim().split('\n').pop());
  assert.equal(parsed.mode, 'unavailable');
  assert.equal(parsed.status, 503);
});

test('a new Google signup stays pending and reaches no attendance feature until approval', async () => {
  const client = agent();
  const started = await googleSignIn(client, { email: 'new.user@gmail.com', sub: 'google-sub-pending' });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const completed = await send(client, 'post', '/api/auth/google/complete-profile/', {});
  // GST001.0/AD003.3: OAuth alone grants no role or access; no User exists.
  assert.equal(completed.status, 202, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'signup_pending');
  assert.equal(await getModels().User.countDocuments({ accountIdNormalized: 'stu500' }), 0);

  // No session, and the pending identity reaches no attendance feature.
  assert.equal((await client.get('/api/auth/me/')).status, 401);
  for (const path of ['/api/events/', '/api/attendance/me/']) {
    const blocked = await client.get(path);
    assert.equal(blocked.status, 401, `${path} must stay unreachable: ${JSON.stringify(blocked.body)}`);
  }
});

test('an admin-approved signup creates the User with the assigned role', async () => {
  const client = agent();
  await googleSignIn(client, { email: 'new.user@gmail.com', sub: 'google-sub-student-only' });
  await send(client, 'post', '/api/auth/google/complete-profile/', {});

  await createUser({ username: 'ADM009', role: 'admin' });
  const { agent: adminClient } = await login('ADM009');
  const pending = await getModels().SignupRequest.findOne({ googleSub: 'google-sub-student-only' }).lean();
  assert.ok(pending);
  const approved = await send(adminClient, 'post', `/api/admin/signup-requests/${pending._id}/approve/`, {
    role: 'Student', department: 'IT', accountId: 'STU501',
  });
  assert.equal(approved.status, 201, JSON.stringify(approved.body));
  assert.equal(approved.body.role, 'Student');
  const created = await getModels().User.findOne({ accountIdNormalized: 'stu501' }).select('+passwordHash');
  assert.ok(created);
  assert.equal(created.passwordHash, null);
  // Approval creates the account but never signs the pending browser in.
  assert.equal((await client.get('/api/auth/me/')).status, 401);
});

test('a legacy pending account stays blocked and administrators cannot change its approval state', async () => {
  const { user } = await createUser({ username: 'STU600', role: 'student' });
  await getModels().User.updateOne({ _id: user._id }, { $set: { approvalStatus: 'pending' } });
  await createUser({ username: 'ADM001', role: 'admin' });
  const { agent: adminClient } = await login('ADM001');

  // A legacy pending record cannot establish an account session.
  const pendingClient = agent();
  const loginAttempt = await send(pendingClient, 'post', '/api/auth/login/', {
    identifier: 'STU600',
    password: 'test-pass-123',
  });
  assert.equal(loginAttempt.status, 400);
  assert.equal((await pendingClient.get('/api/auth/me/')).status, 401);

  // An unauthenticated user cannot change the approval state.
  const asStudent = await send(pendingClient, 'patch', '/api/admin/users/STU600/', { approvalStatus: 'approved' });
  assert.equal(asStudent.status, 401, 'an unauthenticated user must never be able to restore anyone');

  const attemptedApproval = await send(adminClient, 'patch', '/api/admin/users/STU600/', { approvalStatus: 'approved' });
  assert.equal(attemptedApproval.status, 400, JSON.stringify(attemptedApproval.body));
  assert.equal((await getModels().User.findById(user._id).lean()).approvalStatus, 'pending');
  const stillBlocked = await send(pendingClient, 'post', '/api/auth/login/', {
    identifier: 'STU600',
    password: 'test-pass-123',
  });
  assert.equal(stillBlocked.status, 400);
  assert.equal((await pendingClient.get('/api/auth/me/')).status, 401);
  assert.equal((await getModels().UserProfile.findOne({ userId: user._id }).lean()).role, 'student');
});

test('a legacy inactive account remains blocked while status mutations are unavailable', async () => {
  const { user } = await createUser({ username: 'STU650', role: 'student' });
  await createUser({ username: 'ADM003', role: 'admin' });
  const { agent: adminClient } = await login('ADM003');
  const { agent: client } = await login('STU650');
  assert.equal((await client.get('/api/attendance/me/')).status, 200);

  await getModels().User.updateOne({ _id: user._id }, { $set: { isActive: false } });
  // The existing session is refused outright for a legacy inactive record.
  assert.equal((await client.get('/api/attendance/me/')).status, 401);
  const attemptedReactivation = await send(adminClient, 'patch', '/api/admin/users/STU650/', { status: 'Active' });
  assert.equal(attemptedReactivation.status, 400, JSON.stringify(attemptedReactivation.body));
  assert.equal((await getModels().User.findById(user._id).lean()).isActive, false);
  // And it cannot sign back in.
  const blockedClient = agent();
  const again = await send(blockedClient, 'post', '/api/auth/login/', { identifier: 'STU650', password: 'test-pass-123' });
  assert.equal(again.status, 400, JSON.stringify(again.body));
});

test('a rejected account is refused even though it was signed in', async () => {
  await createUser({ username: 'STU700', role: 'student' });
  const { agent: client } = await login('STU700');
  assert.equal((await client.get('/api/attendance/me/')).status, 200);

  await createUser({ username: 'ADM002', role: 'admin' });
  const { agent: adminClient } = await login('ADM002');
  await getModels().User.updateOne({ username: 'STU700' }, { $set: { approvalStatus: 'rejected' } });
  const rejected = await send(adminClient, 'patch', '/api/admin/users/STU700/', { approvalStatus: 'approved' });
  assert.equal(rejected.status, 400);
  assert.equal((await getModels().User.findOne({ username: 'STU700' }).lean()).approvalStatus, 'rejected');

  const blocked = await client.get('/api/attendance/me/');
  assert.equal(blocked.status, 403, JSON.stringify(blocked.body));
  assert.equal(blocked.body.code, 'account_rejected');

  const freshClient = agent();
  const refused = await send(freshClient, 'post', '/api/auth/login/', {
    identifier: 'STU700',
    password: 'test-pass-123',
  });
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.equal(refused.body.detail, 'The account identifier or password is incorrect.');
  assert.equal((await freshClient.get('/api/auth/me/')).status, 401);
});

test('an unauthenticated request cannot approve an account or grant a privileged role', async () => {
  const { user: target } = await createUser({ username: 'STU800', role: 'student' });
  await getModels().User.updateOne({ _id: target._id }, { $set: { approvalStatus: 'pending' } });

  // A valid CSRF token but no session. Sending it without a token would only
  // prove CSRF works, so the token is fetched properly to reach authentication.
  const client = agent();
  const token = await csrfToken(client);
  const anonymous = await client.patch('/api/admin/users/STU800/')
    .set('X-CSRFToken', token)
    .send({ approvalStatus: 'approved', role: 'Admin' });
  assert.equal(anonymous.status, 401);
  assert.equal((await getModels().User.findById(target._id).lean()).approvalStatus, 'pending');
  assert.equal((await getModels().UserProfile.findOne({ userId: target._id }).lean()).role, 'student');
});

test('a new Google signup stays pending and never receives a privileged role', async () => {
  const client = agent();
  await googleSignIn(client, { email: 'new.user@gmail.com', sub: 'google-sub-priv' }, { selectedRole: 'admin' });

  // A browser-supplied role is refused outright, and no request is stored.
  const attempted = await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU900', department: 'IT', name: 'New User', role: 'admin',
  });
  assert.equal(attempted.status, 400, JSON.stringify(attempted.body));
  assert.match(attempted.body.role, /assigned by an administrator/);
  assert.equal(await getModels().User.countDocuments({ accountIdNormalized: 'stu900' }), 0);

  // A clean submission, still chosen on the Administrator screen, produces a
  // PENDING request. Selecting a privileged account type grants nothing.
  const completed = await send(client, 'post', '/api/auth/google/complete-profile/', {});
  assert.equal(completed.status, 202, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'signup_pending');
  assert.equal(await getModels().User.countDocuments({ accountIdNormalized: 'stu900' }), 0);
  const pending = await getModels().SignupRequest.findOne({ googleSub: 'google-sub-priv' }).lean();
  assert.ok(pending);
  assert.equal(pending.status, 'pending');
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

test('a new identity chosen on the Faculty screen stays pending with no role granted', async () => {
  const client = agent();
  const started = await googleSignIn(client, {}, { selectedRole: 'faculty' });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.status, 'profile_incomplete');

  // The selected account type is never forwarded as a role, and a role supplied
  // at this step is still refused outright.
  const attempted = await send(client, 'post', '/api/auth/google/complete-profile/', {
    accountId: 'STU708', department: 'IT', name: 'New User', role: 'faculty',
  });
  assert.equal(attempted.status, 400);
  assert.match(attempted.body.role, /assigned by an administrator/);
  assert.equal(await getModels().User.countDocuments({ accountIdNormalized: 'stu708' }), 0);

  const completed = await send(client, 'post', '/api/auth/google/complete-profile/', {});
  // AD003.3: pending request; no User and no role until admin approval.
  assert.equal(completed.status, 202, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'signup_pending');
  assert.equal(await getModels().User.countDocuments({ accountIdNormalized: 'stu708' }), 0);
  assert.ok(await getModels().SignupRequest.findOne({ googleSub: 'google-sub-0001' }).lean());
});
