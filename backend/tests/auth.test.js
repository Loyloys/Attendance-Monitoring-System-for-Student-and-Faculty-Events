import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { agent, createUser, csrfToken, login, request, reset, send, setup, teardown } from './helpers.js';

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

test('rejects an incorrect password without disclosing which field failed', async () => {
  await createUser({ username: 'STU001', role: 'student' });
  const client = agent();
  const token = await csrfToken(client);
  const response = await client.post('/api/auth/login/').set('X-CSRFToken', token).send({ identifier: 'STU001', password: 'wrong' });
  assert.equal(response.status, 400);
  assert.equal(response.body.detail, 'The ID/username or password is incorrect.');
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
