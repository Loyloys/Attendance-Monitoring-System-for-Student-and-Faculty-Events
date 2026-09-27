import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { atVenue, createEvent, createUser, csrfToken, getModels, login, request, reset, send, setup, teardown } from './helpers.js';

before(setup);
after(teardown);
beforeEach(reset);

test('keeps events audience-filtered and supports administrator event CRUD', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'STU001', role: 'student' });
  await createUser({ username: 'ADM001', role: 'admin' });
  await createEvent(faculty.user, { audience: 'student', name: 'Student Only' });
  await createEvent(faculty.user, { audience: 'faculty', name: 'Faculty Only' });
  const { agent: student } = await login('STU001');
  const { agent: admin } = await login('ADM001');
  const events = await student.get('/api/events/');
  assert.equal(events.status, 200);
  assert.ok(events.body.some((event) => event.name === 'Student Only'));
  assert.ok(!events.body.some((event) => event.name === 'Faculty Only'));

  const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const createdEvent = await send(admin, 'post', '/api/admin/events/', {
    name: 'New Express Event', description: 'Created through Express', date,
    start: '09:00', end: '10:00', cutoff: '09:15', venue: 'Test Hall',
    audience: 'student', method: 'qr', status: 'published', requiredForAttendance: true,
  });
  assert.equal(createdEvent.status, 201, JSON.stringify(createdEvent.body));
  const patched = await send(admin, 'patch', `/api/admin/events/${createdEvent.body.id}/`, { venue: 'Updated Hall', audience: 'faculty' });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.venue, 'Updated Hall');
  assert.equal(patched.body.audience, 'Faculty');
  const cancelled = await send(admin, 'post', `/api/admin/events/${createdEvent.body.id}/cancel/`);
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.status, 'Cancelled');
  const missingCutoff = await send(admin, 'post', '/api/admin/events/', {
    name: 'Missing cutoff', date, start: '09:00', end: '10:00', venue: 'Hall',
    audience: 'student', method: 'qr', status: 'published',
  });
  assert.equal(missingCutoff.status, 400);
  assert.equal(missingCutoff.body.cutoff, 'This field is required.');
});

test('registration is idempotent and only open for upcoming registration-required events', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'STU001', role: 'student' });
  const upcoming = await createEvent(faculty.user, {
    registrationRequired: true,
    startsAt: new Date(Date.now() + 86_400_000),
    endsAt: new Date(Date.now() + 93_600_000),
  });
  const ongoing = await createEvent(faculty.user, { registrationRequired: true });
  const { agent } = await login('STU001');
  const first = await send(agent, 'post', `/api/events/${upcoming._id}/registrations/`);
  assert.equal(first.status, 201);
  const second = await send(agent, 'post', `/api/events/${upcoming._id}/registrations/`);
  assert.equal(second.status, 200);
  assert.equal(second.body.message, 'You are already registered for this event.');
  assert.equal((await send(agent, 'post', `/api/events/${ongoing._id}/registrations/`)).status, 400);
  assert.equal(await getModels().EventRegistration.countDocuments({ eventId: upcoming._id }), 1);
});

test('QR attendance records once under simultaneous duplicate scans', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user);
  const { agent: facultyAgent } = await login('FAC001');
  const code = await send(facultyAgent, 'post', `/api/events/${event._id}/check-in-code/`);
  assert.equal(code.status, 200);
  assert.match(code.body.token, /^COT-EVENT:[0-9a-f-]{36}:/);
  const { agent: studentAgent } = await login('STU001');
  const token = await csrfToken(studentAgent);
  const scan = () => studentAgent.post('/api/attendance/scan/').set('X-CSRFToken', token).send({ token: code.body.token, method: 'qr', location: atVenue() });
  const responses = await Promise.all([scan(), scan()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  assert.equal(await getModels().EventAttendance.countDocuments({ eventId: event._id, attendeeId: student.user._id }), 1);
});

test('rejects expired QR codes and another user identifier', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student', card: 'RFID-STU001' });
  const other = await createUser({ username: 'STU002', role: 'student', card: 'RFID-STU002' });
  const event = await createEvent(faculty.user);
  const { agent: facultyAgent } = await login('FAC001');
  const code = await send(facultyAgent, 'post', `/api/events/${event._id}/check-in-code/`);
  await getModels().AttendanceCode.updateOne({ eventId: event._id }, { $set: { expiresAt: new Date(Date.now() - 1_000) } });
  const { agent: studentAgent } = await login('STU001');
  assert.equal((await send(studentAgent, 'post', '/api/attendance/scan/', { token: code.body.token, method: 'qr', location: atVenue() })).status, 400);
  const rfidEvent = await createEvent(faculty.user, { attendanceMethod: 'rfid' });
  const wrong = await send(studentAgent, 'post', '/api/attendance/scan/', { eventId: rfidEvent._id, identifier: other.profile.cardIdentifier, method: 'rfid', location: atVenue() });
  assert.equal(wrong.status, 403);
  const own = await send(studentAgent, 'post', '/api/attendance/scan/', { eventId: rfidEvent._id, identifier: student.profile.cardIdentifier, method: 'rfid', location: atVenue() });
  assert.equal(own.status, 201);
});

test('requires registration before a student can check in', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user, { registrationRequired: true });
  const { agent } = await login('STU001');
  const response = await send(agent, 'post', '/api/attendance/scan/', { eventId: event._id, method: 'qr' });
  assert.equal(response.status, 400);
  assert.equal(response.body.registration, 'Register for this event before checking in.');
});

test('feedback requires attendance and remains one response per user and event', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user);
  const { agent } = await login('STU001');
  assert.equal((await send(agent, 'post', `/api/events/${event._id}/feedback/`, { rating: 5 })).status, 400);
  await getModels().EventAttendance.create({
    _id: await (await import('../src/utils/ids.js')).nextNumericId('eventAttendance'),
    eventId: event._id, attendeeId: student.user._id, status: 'present', method: 'qr', recordedAt: new Date(),
  });
  assert.equal((await send(agent, 'post', `/api/events/${event._id}/feedback/`, { rating: 5, comments: 'Useful' })).status, 201);
  assert.equal((await send(agent, 'post', `/api/events/${event._id}/feedback/`, { rating: 4 })).status, 409);
});

test('enforces role isolation and faculty assignment scope', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const otherFaculty = await createUser({ username: 'FAC002', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  await createUser({ username: 'ADM001', role: 'admin' });
  const managed = await createEvent(faculty.user);
  const unauthorized = await createEvent(otherFaculty.user);
  await getModels().EventAttendance.create({
    _id: await (await import('../src/utils/ids.js')).nextNumericId('eventAttendance'),
    eventId: managed._id, attendeeId: student.user._id, status: 'present', method: 'qr', recordedAt: new Date(),
  });
  const { agent: studentAgent } = await login('STU001');
  const { agent: facultyAgent } = await login('FAC001');
  const { agent: adminAgent } = await login('ADM001');
  assert.equal((await studentAgent.get('/api/events/managed/')).status, 403);
  assert.equal((await studentAgent.get('/api/admin/state/')).status, 403);
  assert.equal((await facultyAgent.get('/api/admin/events/')).status, 403);
  assert.equal((await adminAgent.get('/api/admin/state/')).status, 200);
  const monitoring = await facultyAgent.get(`/api/events/${managed._id}/attendance/`);
  assert.equal(monitoring.status, 200);
  assert.equal(monitoring.body.summary.present, 1);
  assert.equal(monitoring.body.attendees[0].id, 'STU001');
  assert.equal((await facultyAgent.get(`/api/events/${unauthorized._id}/attendance/`)).status, 400);
  const pdf = await facultyAgent.get(`/api/reports/events/${managed._id}.pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers['content-type'], /application\/pdf/);
});

test('personal history and certificate download are owner-scoped', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const other = await createUser({ username: 'STU002', role: 'student' });
  const event = await createEvent(faculty.user);
  const nextId = (await import('../src/utils/ids.js')).nextNumericId;
  await getModels().EventAttendance.create({
    _id: await nextId('eventAttendance'), eventId: event._id, attendeeId: student.user._id,
    status: 'present', method: 'qr', recordedAt: new Date(),
  });
  await getModels().EventAttendance.create({
    _id: await nextId('eventAttendance'), eventId: event._id, attendeeId: other.user._id,
    status: 'present', method: 'qr', recordedAt: new Date(),
  });
  const certificate = await getModels().EventCertificate.create({
    _id: await nextId('eventCertificate'), eventId: event._id, studentId: student.user._id,
    issuedById: faculty.user._id, reference: 'REF-1', message: 'Awarded',
  });
  const { agent: owner } = await login('STU001');
  const history = await owner.get('/api/attendance/me/');
  assert.equal(history.status, 200);
  assert.equal(history.body.records.length, 1);
  assert.equal(history.body.records[0].eventId, event._id);
  assert.equal((await owner.get('/api/reports/me.pdf')).status, 200);
  assert.equal((await owner.get(`/api/certificates/${certificate._id}/download/`)).status, 200);
  const { agent: otherAgent } = await login('STU002');
  assert.equal((await otherAgent.get(`/api/certificates/${certificate._id}/download/`)).status, 404);
});
