import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, createUser, getModels, login, minutes, reset, send, setup, teardown } from './helpers.js';

before(setup);
after(teardown);
beforeEach(reset);

test('successful login and profile update create safe audit entries', async () => {
  const { user } = await createUser({ username: 'STU001', role: 'student', name: 'Student One' });
  const client = await login('STU001');
  const loginEntry = await getModels().AuditLog.findOne({ action: 'login_succeeded', targetUserId: user._id }).lean();
  assert.ok(loginEntry);
  assert.match(loginEntry.detail, /application credentials/);

  const updated = await send(client.agent, 'patch', '/api/profile/', { name: 'Student Renamed', phone: '123' });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  const profileEntry = await getModels().AuditLog.findOne({ action: 'profile_updated', targetUserId: user._id }).lean();
  assert.ok(profileEntry);
  assert.match(profileEntry.detail, /name/);
  assert.doesNotMatch(profileEntry.detail, /123/);
});

test('registration and cancellation each create one successful audit entry', async () => {
  const { user } = await createUser({ username: 'STU001', role: 'student' });
  const client = await login('STU001');
  const event = await createEvent(user, {
    name: 'Registration Audit Event',
    startsAt: new Date(Date.now() + minutes(30)),
    endsAt: new Date(Date.now() + minutes(150)),
    checkInOpensAt: new Date(Date.now() + minutes(1)),
    checkInClosesAt: new Date(Date.now() + minutes(150)),
    registrationRequired: true,
  });

  const registered = await send(client.agent, 'post', `/api/events/${event._id}/registrations/`);
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const repeated = await send(client.agent, 'post', `/api/events/${event._id}/registrations/`);
  assert.equal(repeated.status, 200, JSON.stringify(repeated.body));
  const cancelled = await send(client.agent, 'delete', `/api/events/${event._id}/registrations/`);
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));

  assert.equal(await getModels().AuditLog.countDocuments({ action: 'event_registered', targetUserId: user._id, targetEventId: event._id }), 1);
  assert.equal(await getModels().AuditLog.countDocuments({ action: 'event_registration_cancelled', targetUserId: user._id, targetEventId: event._id }), 1);
});

test('failed registration does not create an audit entry', async () => {
  const { user } = await createUser({ username: 'STU001', role: 'student' });
  const client = await login('STU001');
  const response = await send(client.agent, 'post', '/api/events/not-an-event/registrations/');
  assert.equal(response.status, 400);
  assert.equal(await getModels().AuditLog.countDocuments({ action: 'event_registered', targetUserId: user._id }), 0);
});

test('activity log remains admin-only and returns actor and event metadata', async () => {
  const { user: admin } = await createUser({ username: 'ADM001', role: 'admin', name: 'Admin One' });
  await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(admin, { name: 'Admin Activity Event' });
  await getModels().AuditLog.create({
    actorId: admin._id,
    actorName: 'Admin One',
    actorRole: 'admin',
    action: 'event_created',
    targetEventId: event._id,
    eventName: event.name,
    detail: 'Created event.',
  });

  const adminLogin = await login('ADM001');
  const response = await adminLogin.agent.get('/api/admin/audit-log/?search=Admin%20Activity');
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body[0].eventName, event.name);
  assert.equal(response.body[0].actor, 'Admin One');

  const studentClient = await login('STU001');
  const denied = await studentClient.agent.get('/api/admin/audit-log/');
  assert.equal(denied.status, 403);
});
