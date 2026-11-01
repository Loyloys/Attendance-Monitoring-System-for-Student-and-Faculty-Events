import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEvent, createUser, getModels, login, nextId, reset, send, setup, teardown } from './helpers.js';

before(setup);
after(teardown);
beforeEach(reset);

/** Creates an ended event and archives it as administrator. */
async function createArchivedEvent(adminUser, overrides = {}) {
  const now = Date.now();
  const event = await createEvent(adminUser.user, {
    startsAt: new Date(now - 200 * 60 * 1000),
    endsAt: new Date(now - 100 * 60 * 1000),
    ...overrides,
  });
  const { agent: admin } = await login(adminUser.accountId);
  const archived = await send(admin, 'post', `/api/admin/events/${event._id}/archive/`);
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  assert.ok((await getModels().Event.findById(event._id).lean()).archivedAt);
  return event;
}

test('student sees archived events they registered for, with their own registration status', async () => {
  const student = await createUser({ username: 'STU001', role: 'student' });
  const admin = await createUser({ username: 'ADM001', role: 'admin' });

  const archived = await createArchivedEvent(admin);
  await getModels().EventRegistration.create({
    _id: await nextId('eventRegistration'),
    eventId: archived._id,
    attendeeId: student.user._id,
    status: 'registered',
    registeredAt: new Date(),
  });

  const { agent: stu } = await login('STU001');
  const archivedList = await stu.get('/api/events/archived/');
  assert.equal(archivedList.status, 200);
  assert.equal(archivedList.body.length, 1);
  assert.equal(archivedList.body[0].id, archived._id);
  assert.equal(archivedList.body[0].name, archived.name);
  assert.equal(archivedList.body[0].venue, archived.venue);
  assert.equal(archivedList.body[0].registration_status, 'registered');
  assert.equal(archivedList.body[0].attendance_status, null);
  assert.equal(archivedList.body[0].can_register, false);
  assert.equal(archivedList.body[0].can_check_in, false);

  const regularList = await stu.get('/api/events/');
  assert.ok(!regularList.body.some((row) => row.id === archived._id));
});

test('student sees archived events they attended, with their own attendance status', async () => {
  const student = await createUser({ username: 'STU001', role: 'student' });
  const admin = await createUser({ username: 'ADM001', role: 'admin' });

  const archived = await createArchivedEvent(admin);
  await getModels().EventAttendance.create({
    _id: await nextId('eventAttendance'),
    eventId: archived._id,
    attendeeId: student.user._id,
    status: 'present',
    method: 'qr',
    recordedAt: new Date(),
  });

  const { agent: stu } = await login('STU001');
  const archivedList = await stu.get('/api/events/archived/');
  assert.equal(archivedList.status, 200);
  assert.equal(archivedList.body.length, 1);
  assert.equal(archivedList.body[0].id, archived._id);
  assert.equal(archivedList.body[0].attendance_status, 'present');
  assert.equal(archivedList.body[0].registration_status, null);
});

test('student sees both registered and attended archived events in one list', async () => {
  const student = await createUser({ username: 'STU001', role: 'student' });
  const admin = await createUser({ username: 'ADM001', role: 'admin' });

  const registeredEvent = await createArchivedEvent(admin, { name: 'Registered-only event' });
  const attendedEvent = await createArchivedEvent(admin, { name: 'Attended-only event' });

  await getModels().EventRegistration.create({
    _id: await nextId('eventRegistration'),
    eventId: registeredEvent._id,
    attendeeId: student.user._id,
    status: 'registered',
    registeredAt: new Date(),
  });
  await getModels().EventAttendance.create({
    _id: await nextId('eventAttendance'),
    eventId: attendedEvent._id,
    attendeeId: student.user._id,
    status: 'late',
    method: 'rfid',
    recordedAt: new Date(),
  });

  const { agent: stu } = await login('STU001');
  const archivedList = await stu.get('/api/events/archived/');
  assert.equal(archivedList.status, 200);
  assert.equal(archivedList.body.length, 2);
  const ids = archivedList.body.map((row) => row.id).sort();
  assert.deepEqual(ids, [attendedEvent._id, registeredEvent._id].sort());
  assert.equal(archivedList.body.find((row) => row.id === registeredEvent._id).registration_status, 'registered');
  assert.equal(archivedList.body.find((row) => row.id === attendedEvent._id).attendance_status, 'late');
});

test('student does not see archived events they have no connection to (privacy)', async () => {
  const student = await createUser({ username: 'STU001', role: 'student' });
  const otherStudent = await createUser({ username: 'STU002', role: 'student' });
  const admin = await createUser({ username: 'ADM001', role: 'admin' });

  const otherArchived = await createArchivedEvent(admin);
  await getModels().EventRegistration.create({
    _id: await nextId('eventRegistration'),
    eventId: otherArchived._id,
    attendeeId: otherStudent.user._id,
    status: 'registered',
    registeredAt: new Date(),
  });

  const { agent: stu } = await login('STU001');
  const archivedList = await stu.get('/api/events/archived/');
  assert.equal(archivedList.status, 200);
  assert.equal(archivedList.body.length, 0);
});

test('student does not see non-archived events in the archived list', async () => {
  const student = await createUser({ username: 'STU001', role: 'student' });
  const admin = await createUser({ username: 'ADM001', role: 'admin' });

  const activeEvent = await createEvent(admin.user);
  await getModels().EventRegistration.create({
    _id: await nextId('eventRegistration'),
    eventId: activeEvent._id,
    attendeeId: student.user._id,
    status: 'registered',
    registeredAt: new Date(),
  });

  const { agent: stu } = await login('STU001');
  const archivedList = await stu.get('/api/events/archived/');
  assert.equal(archivedList.status, 200);
  assert.equal(archivedList.body.length, 0);
});

test('student with no archived events gets an empty list', async () => {
  const student = await createUser({ username: 'STU001', role: 'student' });
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  await createArchivedEvent(admin);

  const { agent: stu } = await login('STU001');
  const archivedList = await stu.get('/api/events/archived/');
  assert.equal(archivedList.status, 200);
  assert.equal(archivedList.body.length, 0);
});

test('faculty sees archived events they attended, with their own attendance status', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const admin = await createUser({ username: 'ADM001', role: 'admin' });

  const archived = await createArchivedEvent(admin);
  await getModels().EventAttendance.create({
    _id: await nextId('eventAttendance'),
    eventId: archived._id,
    attendeeId: faculty.user._id,
    status: 'absent',
    method: 'barcode',
    recordedAt: new Date(),
  });

  const { agent: fac } = await login('FAC001');
  const archivedList = await fac.get('/api/events/archived/');
  assert.equal(archivedList.status, 200);
  assert.equal(archivedList.body.length, 1);
  assert.equal(archivedList.body[0].id, archived._id);
  assert.equal(archivedList.body[0].attendance_status, 'absent');
  assert.equal(archivedList.body[0].registration_status, null);
});

test('faculty does not see archived events they have no connection to', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const otherStudent = await createUser({ username: 'STU002', role: 'student' });
  const admin = await createUser({ username: 'ADM001', role: 'admin' });

  const otherArchived = await createArchivedEvent(admin);
  await getModels().EventAttendance.create({
    _id: await nextId('eventAttendance'),
    eventId: otherArchived._id,
    attendeeId: otherStudent.user._id,
    status: 'present',
    method: 'qr',
    recordedAt: new Date(),
  });

  const { agent: fac } = await login('FAC001');
  const archivedList = await fac.get('/api/events/archived/');
  assert.equal(archivedList.status, 200);
  assert.equal(archivedList.body.length, 0);
});

test('archived events cannot be registered for, checked into, or viewed in detail', async () => {
  const student = await createUser({ username: 'STU001', role: 'student' });
  const admin = await createUser({ username: 'ADM001', role: 'admin' });

  const archived = await createArchivedEvent(admin);
  await getModels().EventRegistration.create({
    _id: await nextId('eventRegistration'),
    eventId: archived._id,
    attendeeId: student.user._id,
    status: 'registered',
    registeredAt: new Date(),
  });

  const { agent: stu } = await login('STU001');

  const registerResp = await send(stu, 'post', `/api/events/${archived._id}/registrations/`);
  assert.equal(registerResp.status, 400);

  const detailResp = await stu.get(`/api/events/${archived._id}/`);
  assert.equal(detailResp.status, 404);
});

test('admin archive behavior is preserved: admin sees all archived events via admin archive endpoint', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  const student = await createUser({ username: 'STU001', role: 'student' });

  const archived = await createArchivedEvent(admin);
  const notArchived = await createEvent(admin.user);

  const { agent: adm } = await login('ADM001');
  const adminArchive = await adm.get('/api/admin/archive/');
  assert.equal(adminArchive.status, 200);
  assert.ok(adminArchive.body.some((row) => row.id === archived._id));
  assert.ok(!adminArchive.body.some((row) => row.id === notArchived._id));

  const meArchive = await send(adm, 'get', '/api/events/archived/');
  assert.equal(meArchive.status, 403);
});