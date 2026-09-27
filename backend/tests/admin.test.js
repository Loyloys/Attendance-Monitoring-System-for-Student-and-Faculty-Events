import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, createUser, getModels, login, nextId, request, reset, send, setup, teardown } from './helpers.js';

before(setup);
after(teardown);
beforeEach(reset);

test('administrator account operations persist in MongoDB without exposing passwords', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const { agent } = await login('ADM001');
  const created = await send(agent, 'post', '/api/admin/users/', {
    id: 'STU900', username: 'student900', name: 'Student Nine Hundred',
    email: 'student900@cot.edu', contact: '09120000000', department: 'BSIT',
    role: 'Student', password: 'temporary-pass',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.password, undefined);
  const updated = await send(agent, 'patch', '/api/admin/users/STU900/', { status: 'Inactive' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.status, 'Inactive');
  const state = await agent.get('/api/admin/state/');
  assert.equal(state.status, 200);
  assert.ok(state.body.users.some((user) => user.id === 'STU900' && user.status === 'Inactive'));
  const stored = await getModels().User.findOne({ accountId: 'STU900' }).select('+passwordHash');
  assert.match(stored.passwordHash, /^pbkdf2_sha256\$/);
});

test('manual attendance correction and removal use the shared unique attendance collection', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user);
  const { agent } = await login('ADM001');
  const created = await send(agent, 'post', '/api/admin/attendance/', {
    eventId: event._id, personId: 'STU001', status: 'Late', source: 'Manual addition',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const duplicate = await send(agent, 'post', '/api/admin/attendance/', { eventId: event._id, personId: 'STU001', status: 'Present' });
  assert.equal(duplicate.status, 409);
  const corrected = await send(agent, 'patch', `/api/admin/attendance/${created.body.id}/`, { status: 'present', note: 'Corrected' });
  assert.equal(corrected.status, 200);
  assert.equal(corrected.body.status, 'Present');
  assert.equal(corrected.body.source, 'Manual correction');
  assert.equal((await send(agent, 'delete', `/api/admin/attendance/${created.body.id}/`)).status, 204);
  assert.equal(await getModels().EventAttendance.countDocuments({ eventId: event._id }), 0);
});

test('administrator evaluation forms and responses are MongoDB-backed', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user);
  const { agent } = await login('ADM001');
  const form = await send(agent, 'post', '/api/admin/forms/', {
    title: 'Event evaluation', eventId: event._id, active: true,
    questions: [{ prompt: 'How would you rate the event?', type: 'rating', required: true }],
  });
  assert.equal(form.status, 201, JSON.stringify(form.body));
  await getModels().EvaluationResponse.create({
    _id: 'RES-1', formId: form.body.id, eventId: event._id, attendeeId: student.user._id,
    answers: { [form.body.questions[0].id]: '5' }, submittedAt: new Date(),
  });
  const updated = await send(agent, 'post', '/api/admin/forms/', { ...form.body, title: 'Updated evaluation' });
  assert.equal(updated.status, 200);
  const state = await agent.get('/api/admin/state/');
  assert.equal(state.body.forms[0].title, 'Updated evaluation');
  assert.equal(state.body.responses[0].attendeeName, 'STU001');
  assert.equal((await send(agent, 'delete', `/api/admin/forms/${form.body.id}/`)).status, 204);
  assert.equal(await getModels().EvaluationResponse.countDocuments({ formId: form.body.id }), 0);
});

test('legacy browser administrator data is archived once without replacing migrated records', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const { agent } = await login('ADM001');
  const payload = { version: 1, users: [{ id: 'STU001', passwordHash: 'must-not-be-archived' }], events: [], attendance: [], forms: [], responses: [], revokedIdentifiers: [] };
  const first = await send(agent, 'post', '/api/admin/import-legacy-browser/', { payload });
  assert.equal(first.status, 201);
  assert.equal(first.body.archived, true);
  assert.equal(first.body.duplicate, false);
  assert.equal(first.body.credentialsRemoved, true);
  const second = await send(agent, 'post', '/api/admin/import-legacy-browser/', { payload });
  assert.equal(second.status, 201);
  assert.equal(second.body.duplicate, true);
  assert.equal(await getModels().LegacyBrowserSnapshot.countDocuments({ sourceKey: 'cot-admin-requirements-v1' }), 1);
  assert.equal(await getModels().User.countDocuments({ username: 'STU001' }), 0);
  const snapshot = await getModels().LegacyBrowserSnapshot.findOne({ sourceKey: 'cot-admin-requirements-v1' }).lean();
  assert.equal(snapshot.payload.users[0].passwordHash, undefined);
});

test('data remains available after the backend database connection restarts', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const event = await createEvent(faculty.user, { name: 'Persistence Event' });
  assert.equal(await getModels().Event.countDocuments({ _id: event._id }), 1);
  const database = await import('../src/config/database.js');
  await database.disconnectDatabase();
  await database.connectDatabase();
  assert.equal(await getModels().Event.countDocuments({ _id: event._id }), 1);
  assert.equal((await request().get('/api/health/')).status, 200);
});
