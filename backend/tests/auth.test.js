import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agent, createUser, getModels, csrfToken, login, request, reset, send, setup, teardown } from './helpers.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

before(setup);
after(teardown);
beforeEach(reset);

test('rejects non-object and non-string login payloads', async () => {
  const client = agent();
  const csrf = await csrfToken(client);
  const arrayResponse = await client.post('/api/auth/login/').set('X-CSRFToken', csrf).send([]);
  assert.equal(arrayResponse.status, 400);
  const invalid = await client.post('/api/auth/login/').set('X-CSRFToken', csrf).send({ identifier: 123, password: ['no'] });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.identifier, 'A string value is required.');
});

test('rejects unsafe requests without a valid CSRF token', async () => {
  const response = await request().post('/api/auth/login/').send({ identifier: 'STU001', password: 'test-pass-123' });
  assert.equal(response.status, 403);
  assert.match(response.body.detail, /CSRF/);
});

test('rejects an untrusted browser origin', async () => {
  const client = agent();
  const token = await csrfToken(client);
  const response = await client.post('/api/auth/login/')
    .set('Origin', 'https://attacker.example')
    .set('X-CSRFToken', token)
    .send({ identifier: 'STU001', password: 'test-pass-123' });
  assert.equal(response.status, 403);
});

test('logs in, restores the session, and logs out', async () => {
  const created = await createUser({ username: 'STU001', role: 'student' });
  const { agent, user } = await login('STU001');
  assert.equal(user.id, 'STU001');
  assert.equal(user.role, 'student');
  const restored = await agent.get('/api/auth/me/');
  assert.equal(restored.status, 200);
  assert.equal(restored.body.username, created.user.username);
  const logout = await send(agent, 'post', '/api/auth/logout/');
  assert.equal(logout.status, 204);
  assert.equal((await agent.get('/api/auth/me/')).status, 401);
});

test('does not require or send a reCAPTCHA token when the persisted setting is disabled', async () => {
  await createUser({ username: 'CAPTCHA_OFF', role: 'student' });
  await getModels().SystemSetting.create({ _id: 'recaptcha_enabled', value: false });

  const response = await send(agent(), 'post', '/api/auth/login/', {
    identifier: 'CAPTCHA_OFF',
    password: 'test-pass-123',
  });
  assert.equal(response.status, 200, JSON.stringify(response.body));
});

test('exposes the reCAPTCHA enforcement setting to the anonymous login page', async () => {
  await getModels().SystemSetting.create({ _id: 'recaptcha_enabled', value: false });
  await getModels().SystemSetting.create({ _id: 'recaptcha_site_key', value: 'public-site-key' });
  const response = await request().get('/api/admin/settings/recaptcha/');
  assert.equal(response.status, 200);
  assert.equal(response.body.enabled, false);
  assert.equal(response.body.available, true);
  assert.equal(typeof response.body.configured, 'boolean');
  assert.equal(response.body.siteKey, 'public-site-key');
});

test('requires and verifies a reCAPTCHA token when the persisted setting is enabled', async () => {
  await createUser({ username: 'CAPTCHA_ON', role: 'student' });
  await getModels().SystemSetting.create({ _id: 'recaptcha_enabled', value: true });
  const previousSecret = process.env.RECAPTCHA_SECRET_KEY;
  const previousFetch = globalThis.fetch;
  process.env.RECAPTCHA_SECRET_KEY = 'test-recaptcha-secret';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
  try {
    const missing = await send(agent(), 'post', '/api/auth/login/', {
      identifier: 'CAPTCHA_ON',
      password: 'test-pass-123',
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.detail, 'Please complete the reCAPTCHA before signing in.');

    const valid = await send(agent(), 'post', '/api/auth/login/', {
      identifier: 'CAPTCHA_ON',
      password: 'test-pass-123',
      recaptchaToken: 'test-token',
    });
    assert.equal(valid.status, 200, JSON.stringify(valid.body));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.RECAPTCHA_SECRET_KEY;
    else process.env.RECAPTCHA_SECRET_KEY = previousSecret;
  }
});

test('identifiers use the stored role and ignore a browser-supplied role', async () => {
  const student = await createUser({ username: 'STU010', role: 'student', email: 'student010@cot.edu' });
  await createUser({ username: 'FAC010', role: 'faculty', email: 'faculty010@cot.edu' });
  await createUser({ username: 'ADM010', role: 'admin', email: 'admin010@cot.edu' });
  const attempts = [
    { identifier: student.user.accountId, suppliedRole: 'admin', expectedRole: 'student' },
    { identifier: 'faculty010@cot.edu', suppliedRole: 'admin', expectedRole: 'faculty' },
    { identifier: 'ADM010', suppliedRole: 'student', expectedRole: 'admin' },
  ];
  for (const { identifier, suppliedRole, expectedRole } of attempts) {
    const client = agent();
    const response = await send(client, 'post', '/api/auth/login/', {
      identifier,
      password: 'test-pass-123',
      role: suppliedRole,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.role, expectedRole);
    assert.equal((await client.get('/api/auth/me/')).body.role, expectedRole);
  }
});

test('pending, rejected, inactive, and archived accounts receive no login session', async () => {
  const blockedAccounts = [
    { username: 'STU011', approvalStatus: 'pending' },
    { username: 'STU012', approvalStatus: 'rejected' },
    { username: 'STU013', isActive: false },
    { username: 'STU014', archivedAt: new Date() },
  ];
  for (const { username, ...changes } of blockedAccounts) {
    const { user } = await createUser({ username, role: 'student' });
    await getModels().User.updateOne({ _id: user._id }, { $set: changes });
  }

  const messages = [];
  for (const { username } of blockedAccounts) {
    const client = agent();
    const response = await send(client, 'post', '/api/auth/login/', {
      identifier: username,
      password: 'test-pass-123',
    });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    messages.push(response.body.detail);
    assert.equal((await client.get('/api/auth/me/')).status, 401);
  }
  assert.ok(messages.every(message => message === 'The account identifier or password is incorrect.'));
});

test('rejects an incorrect password without disclosing which field failed', async () => {
  await createUser({ username: 'STU001', role: 'student' });
  const client = agent();
  const token = await csrfToken(client);
  const response = await client.post('/api/auth/login/').set('X-CSRFToken', token).send({ identifier: 'STU001', password: 'wrong' });
  assert.equal(response.status, 400);
  assert.equal(response.body.detail, 'The account identifier or password is incorrect.');
});

test('rejects ambiguous email identifiers', async () => {
  const first = await createUser({ username: 'STU001', role: 'student', email: 'ambiguous@cot.edu' });
  await createUser({ username: 'STU002', role: 'student', email: 'ambiguous@cot.edu' });
  const client = agent();
  const token = await csrfToken(client);
  const response = await client.post('/api/auth/login/').set('X-CSRFToken', token).send({ identifier: first.user.email, password: 'test-pass-123' });
  assert.equal(response.status, 400);
});

test('locks accounts after repeated failed attempts', async () => {
  await createUser({ username: 'STU001', role: 'student' });
  const client = agent();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = await csrfToken(client);
    const response = await client.post('/api/auth/login/').set('X-CSRFToken', token).send({ identifier: 'STU001', password: 'wrong' });
    assert.equal(response.status, 400);
  }
  const token = await csrfToken(client);
  const locked = await client.post('/api/auth/login/').set('X-CSRFToken', token).send({ identifier: 'STU001', password: 'test-pass-123' });
  assert.equal(locked.status, 429);
  assert.match(locked.body.detail, /Too many failed attempts/);
});

test('cookie names come from configuration so a test instance cannot collide with the normal app', async () => {
  // On this instance (no overrides) the normal names are issued.
  const response = await agent().get('/api/auth/csrf/');
  const cookies = response.headers['set-cookie'] ?? [];
  assert.ok(cookies.some(cookie => cookie.startsWith('sessionid=')), 'session cookie name');
  assert.ok(cookies.some(cookie => cookie.startsWith('csrftoken=')), 'csrf cookie name');

  // Two instances on the same origin would otherwise overwrite each other's
  // cookies, so both names must be renameable. Proven through the real config
  // module, which freezes at import time.
  const script = "import { env } from './src/config/env.js'; console.log(JSON.stringify([env.sessionCookieName, env.csrfCookieName, env.deploymentLabel]));";
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: {
      ...process.env,
      SESSION_COOKIE_NAME: 'googletest_sessionid',
      CSRF_COOKIE_NAME: 'googletest_csrftoken',
      DEPLOYMENT_LABEL: 'TEST ENVIRONMENT',
    },
    encoding: 'utf8',
  });
  const [sessionName, csrfName, label] = JSON.parse(output.trim().split('\n').pop());
  assert.equal(sessionName, 'googletest_sessionid');
  assert.equal(csrfName, 'googletest_csrftoken');
  assert.equal(label, 'TEST ENVIRONMENT');
});

test('health reports the environment label and CSRF cookie name, and is silent when unlabelled', async () => {
  const response = await request().get('/api/health/');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.csrfCookieName, 'csrftoken');
  // The normal app sends no label, so the frontend renders no banner at all.
  assert.equal(response.body.deploymentLabel, '');
});

test('updates a profile while protecting administrator-managed fields', async () => {
  const created = await createUser({ username: 'STU001', role: 'student' });
  const { agent } = await login('STU001');
  const updated = await send(agent, 'patch', '/api/profile/', { name: 'Updated Name', email: 'updated@cot.edu', phone: '09123456789' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'Updated Name');
  const protectedResponse = await send(agent, 'patch', '/api/profile/', { name: 'Again', role: 'admin' });
  assert.equal(protectedResponse.status, 400);
  const models = (await import('../src/models/index.js'));
  const profile = await models.UserProfile.findOne({ userId: created.user._id }).lean();
  assert.equal(profile.role, 'student');
  assert.equal(profile.displayName, 'Updated Name');
});
