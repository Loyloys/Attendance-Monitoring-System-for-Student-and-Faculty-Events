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
  const inactiveCreate = await send(agent, 'post', '/api/admin/users/', {
    id: 'STU901', username: 'student901', name: 'Student Nine Hundred One',
    email: 'student901@cot.edu', contact: '09120000001', department: 'BSIT',
    role: 'Student', password: 'temporary-pass', status: 'Inactive',
  });
  assert.equal(inactiveCreate.status, 400);
  assert.equal(await getModels().User.exists({ accountId: 'STU901' }), null);
  const statusChange = await send(agent, 'patch', '/api/admin/users/STU900/', { status: 'Inactive' });
  assert.equal(statusChange.status, 400);
  assert.match(statusChange.body.status, /not available/i);
  const state = await agent.get('/api/admin/state/');
  assert.equal(state.status, 200);
  assert.ok(state.body.users.some((user) => user.id === 'STU900' && user.status === 'Active'));
  const stored = await getModels().User.findOne({ accountId: 'STU900' }).select('+passwordHash');
  assert.match(stored.passwordHash, /^pbkdf2_sha256\$/);
});

test('AD002.5: archiving blocks access and preserves the account and attendance history; restore is reversible', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  await createUser({ username: 'ADM001', role: 'admin' });
  const event = await createEvent(faculty.user);
  const recordId = await nextId('eventAttendance');
  await getModels().EventAttendance.create({
    _id: recordId,
    eventId: event._id,
    attendeeId: student.user._id,
    status: 'present',
    method: 'qr',
    recordedAt: new Date(),
  });
  const { agent: admin } = await login('ADM001');
  const { agent: studentSession } = await login('STU001');

  const archived = await send(admin, 'post', '/api/admin/users/STU001/archive/', {});
  assert.equal(archived.status, 200, JSON.stringify(archived.body));
  assert.equal(archived.body.status, 'Archived');
  const storedArchive = await getModels().User.findOne({ accountId: 'STU001' }).lean();
  assert.ok(storedArchive.archivedAt);
  assert.equal(storedArchive.archivedWasActive, true);
  assert.equal((await studentSession.get('/api/auth/me/')).status, 401);
  assert.ok(await getModels().User.findOne({ accountId: 'STU001' }));
  assert.ok(await getModels().UserProfile.findOne({ userId: student.user._id }));
  assert.equal(await getModels().EventAttendance.countDocuments({ attendeeId: student.user._id }), 1);
  assert.equal(await getModels().AuditLog.countDocuments({ action: 'account_archived', targetUserId: student.user._id }), 1);

  const restored = await send(admin, 'post', '/api/admin/users/STU001/restore/', {});
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.status, 'Active');
  assert.equal((await (await login('STU001')).agent.get('/api/auth/me/')).status, 200);
  assert.equal(await getModels().AuditLog.countDocuments({ action: 'account_restored', targetUserId: student.user._id }), 1);
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

test('an account with no event registrations is reported as created, not as attending', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  await createEvent(faculty.user);
  const { agent } = await login('ADM001');

  const state = await agent.get('/api/admin/state/');
  assert.equal(state.status, 200);
  const student = state.body.users.find((user) => user.id === 'STU001');
  // Having an account is not having registered for anything.
  assert.equal(student.eventRegistrationCount, 0);
  assert.equal(student.attendanceCount, 0);

  // The detail view states the same thing explicitly.
  const detail = await agent.get('/api/admin/users/STU001/registrations/');
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  assert.deepEqual(detail.body.registrations, []);
});

test('registering for an event is recorded separately from attendance', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  await createUser({ username: 'ADM001', role: 'admin' });
  const now = Date.now();
  const event = await createEvent(faculty.user, {
    registrationRequired: true,
    // Registration is only open while the event is upcoming, so this one has to
    // start in the future. The existing deadline/capacity rules are untouched.
    startsAt: new Date(now + 7_200_000),
    endsAt: new Date(now + 10_800_000),
    checkInOpensAt: new Date(now + 7_200_000),
    checkInClosesAt: new Date(now + 10_800_000),
    lateCutoff: new Date(now + 7_800_000),
  });
  const { agent: studentClient } = await login('STU001');

  // Register for the event. This creates a REGISTRATION only.
  const registered = await send(studentClient, 'post', `/api/events/${event._id}/registrations/`, {});
  assert.equal(registered.status, 201, JSON.stringify(registered.body));

  const { agent: adminClient } = await login('ADM001');
  const detail = await adminClient.get('/api/admin/users/STU001/registrations/');
  assert.equal(detail.status, 200);
  const row = detail.body.registrations.find((item) => item.eventId === event._id);
  assert.equal(row.registrationStatus, 'registered');
  assert.ok(row.registeredAt, 'a registration must record when it happened');
  // The key assertion: registered is NOT present. Nothing was scanned.
  assert.equal(row.attendanceStatus, null, 'registering must never imply attendance');
  assert.equal(row.checkedInAt, null);

  // The count reflects the registration, and attendance is still zero.
  const state = await adminClient.get('/api/admin/state/');
  const listed = state.body.users.find((user) => user.id === 'STU001');
  assert.equal(listed.eventRegistrationCount, 1);
  assert.equal(listed.attendanceCount, 0);

  // Once attendance genuinely exists it is reported, and still separately.
  await send(adminClient, 'post', '/api/admin/attendance/', {
    eventId: event._id, personId: 'STU001', status: 'Present', source: 'Manual addition',
  });
  const after = await adminClient.get('/api/admin/users/STU001/registrations/');
  const updated = after.body.registrations.find((item) => item.eventId === event._id);
  assert.equal(updated.attendanceStatus, 'Present');
  assert.equal(updated.registrationStatus, 'registered');
  assert.ok(updated.checkedInAt);
  // The role is genuinely used, so silence it for the lint rule.
  assert.ok(student.user);
});

test('per-user registrations are administrator-only and never exposed to students', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  await createEvent(faculty.user);
  const { agent: studentClient } = await login('STU001');

  // A student cannot read anyone else's registration list, including their own.
  const forbidden = await studentClient.get('/api/admin/users/STU001/registrations/');
  assert.equal(forbidden.status, 403, JSON.stringify(forbidden.body));

  // Nor can they reach another student's, or the list at all.
  assert.equal((await studentClient.get('/api/admin/users/ADM001/registrations/')).status, 403);
  assert.equal((await studentClient.get('/api/admin/users/')).status, 403);

  // Unauthenticated is refused outright.
  assert.equal((await request().get('/api/admin/users/STU001/registrations/')).status, 401);

  // An administrator can.
  const { agent: adminClient } = await login('ADM001');
  assert.equal((await adminClient.get('/api/admin/users/STU001/registrations/')).status, 200);
});

test('one event with a missing createdAt cannot take down the whole admin workspace', async () => {
  // REGRESSION. A record written by a raw driver (bypassing Mongoose) can lack
  // `createdAt`, because `createdAt` is a MODEL default and Mongoose - not
  // MongoDB - is what applies it. The admin serializer formats that field with
  // `toISOString()`, and `new Date(undefined).toISOString()` throws
  // `RangeError: Invalid time value`. Because `adminState()` builds EVERY event
  // in one map, that single throw rejected the whole request and answered 500
  // to every administrator screen at once - dashboard, users, events,
  // attendance, reports and feedback - while the offending event stayed
  // invisible and unfixable from the UI.
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'ADM001', role: 'admin' });
  const healthy = await createEvent(faculty.user);
  const malformed = await createEvent(faculty.user, { name: 'Missing createdAt' });

  // Strip the field the way a raw insert would leave it.
  await getModels().Event.collection.updateOne(
    { _id: malformed._id },
    { $unset: { createdAt: '' } },
  );

  const { agent } = await login('ADM001');

  // The whole list still loads: one bad row must not fail every screen.
  const state = await agent.get('/api/admin/state/');
  assert.equal(state.status, 200, JSON.stringify(state.body));
  assert.ok(
    state.body.events.some((event) => event.id === healthy._id),
    'the healthy event must still be listed',
  );

  // The bad event is VISIBLE and honestly reported as unknown, not hidden and
  // not given an invented date. Being able to see it is what makes it fixable.
  const listed = state.body.events.find((event) => event.id === malformed._id);
  assert.ok(listed, 'the event with a missing createdAt must still be listed');
  assert.equal(listed.createdAt, null, 'a missing timestamp must report null, never a fabricated date');

  // The standalone admin event list must survive it too.
  const events = await agent.get('/api/admin/events/');
  assert.equal(events.status, 200, JSON.stringify(events.body));
  assert.ok(events.body.some((event) => event.id === malformed._id));

  // A well-formed event keeps a real ISO timestamp - the fix must not turn
  // every date into null.
  assert.match(
    state.body.events.find((event) => event.id === healthy._id).createdAt,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
  );
});

test('deleting an account with attendance history is refused instead of silently cascade-deleting it', async () => {
  // AD002.5: attendance/feedback history is the institutional record and must
  // never be silently erased. Archiving is the reversible alternative.
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'ADM001', role: 'admin' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user);
  const { agent } = await login('ADM001');

  // A brand-new account with no history is still deletable.
  const fresh = await createUser({ username: 'STU900', role: 'student' });
  assert.equal((await send(agent, 'delete', '/api/admin/users/STU900/')).status, 204);
  assert.equal(await getModels().User.countDocuments({ _id: fresh.user._id }), 0);

  // Give STU001 real history, then prove the delete is refused and the rows survive.
  await getModels().EventAttendance.create({
    _id: 1, eventId: event._id, attendeeId: student.user._id,
    status: 'present', method: 'qr', recordedAt: new Date(), source: 'Scan',
  });
  await getModels().EventRegistration.create({
    _id: 2, eventId: event._id, attendeeId: student.user._id,
    status: 'registered', registeredAt: new Date(),
  });

  const refused = await send(agent, 'delete', '/api/admin/users/STU001/');
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.match(refused.body.detail, /attendance history/i);
  assert.match(refused.body.detail, /Archive the account instead/);

  // The history is untouched - this is the whole point of the guard.
  assert.equal(await getModels().EventAttendance.countDocuments({ attendeeId: student.user._id }), 1);
  assert.equal(await getModels().EventRegistration.countDocuments({ attendeeId: student.user._id }), 1);
  assert.equal(await getModels().User.countDocuments({ _id: student.user._id }), 1);

  // Blocking/deactivation is no longer exposed through the account update API.
  assert.equal((await send(agent, 'patch', '/api/admin/users/STU001/', { status: 'Inactive' })).status, 400);
  assert.equal(await getModels().EventAttendance.countDocuments({ attendeeId: student.user._id }), 1);
});

test('the last active administrator cannot be demoted', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const { agent } = await login('ADM001');

  // AD003: protect the final Admin from an accidental role change.
  const demote = await send(agent, 'patch', '/api/admin/users/ADM001/', { role: 'Faculty' });
  assert.equal(demote.status, 400, JSON.stringify(demote.body));
  assert.match(demote.body.detail, /active Admin/i);

  // Nothing changed.
  const profile = await getModels().UserProfile.findOne({ role: 'admin' }).lean();
  const user = await getModels().User.findById(profile.userId).lean();
  assert.equal(user.isActive, true);

  // With a second admin present, a demotion is allowed.
  await createUser({ username: 'ADM002', role: 'admin' });
  assert.equal((await send(agent, 'patch', '/api/admin/users/ADM001/', { role: 'Faculty' })).status, 200);
  const audit = await getModels().AuditLog.find({ action: 'role_changed' }).lean();
  assert.equal(audit.length >= 1, true, 'a role change must be audited');
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
