import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { atVenue, createEvent, createUser, getModels, login, send, setup, teardown, reset } from './helpers.js';
import { serializeEventContext } from '../src/services/eventSerializer.js';

/**
 * REGRESSION: registration and "counts toward the attendance percentage" are two
 * unrelated questions, and they used to be ONE stored value.
 *
 * THE DEFECT THIS COVERS. The administrator event write contract had no
 * `registrationRequired` field at all. `validateWriteValues` wrote
 * `registrationRequired: data.requiredForAttendance ?? ...`, and
 * `serializeAdminEvent` published `registrationRequired` back under the name
 * `requiredForAttendance`. The `Event` model had no `requiredForAttendance`
 * field either.
 *
 * So the single checkbox labelled "Required for percentage" actually decided
 * whether every Student had to register before scanning - and it defaulted to
 * ON, so every event created through the admin form silently demanded a
 * registration the administrator never asked for.
 *
 * The observable symptom was a dead end: the card said "Registration required",
 * the Register button was hidden because the event had already started, and
 * scanning refused with "Register for this event before checking in." with
 * nothing on the screen able to satisfy it.
 */

before(setup);
after(teardown);
beforeEach(reset);

const MANILA_OFFSET_MS = 8 * 3_600_000;
/**
 * A `YYYY-MM-DD` date in Asia/Manila wall-clock terms, which is what the write
 * contract parses.
 *
 * Shifting `now` forward by the offset makes its UTC fields read as Manila
 * wall-clock fields, and those fields are then formatted DIRECTLY. Converting
 * them back to an instant first and taking that instant's UTC date would be
 * wrong: Manila midnight is 16:00 UTC on the PREVIOUS day, so it would silently
 * return yesterday - and the event would be created a day early.
 */
function manilaDate(offsetDays = 0) {
  const manilaNow = new Date(Date.now() + MANILA_OFFSET_MS);
  return new Date(Date.UTC(
    manilaNow.getUTCFullYear(),
    manilaNow.getUTCMonth(),
    manilaNow.getUTCDate() + offsetDays,
  )).toISOString().slice(0, 10);
}

/** The minimum admin payload the write contract accepts, plus the fields under test. */
function adminPayload(overrides) {
  return {
    name: 'Registration policy event',
    description: 'Created by the registration policy test.',
    date: manilaDate(7),
    start: '09:00',
    end: '10:00',
    cutoff: '09:15',
    venue: 'Innovation Hall',
    audience: 'student',
    method: 'qr',
    status: 'published',
    ...overrides,
  };
}

test('the percentage flag does NOT turn on registration, and registration does not touch it', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  const { agent: admin } = await login('ADM001');

  // THE EXACT COMBINATION THAT WAS BROKEN. "Counts toward the percentage" ON,
  // registration untouched. The old code stored registrationRequired: true here.
  const countsOnly = await send(admin, 'post', '/api/admin/events/', adminPayload({
    name: 'Counts toward the percentage only',
    requiredForAttendance: true,
  }));
  assert.equal(countsOnly.status, 201, JSON.stringify(countsOnly.body));
  assert.equal(countsOnly.body.requiredForAttendance, true, 'the percentage flag is stored');
  assert.equal(
    countsOnly.body.registrationRequired,
    false,
    'an event that merely counts toward a percentage must NOT require registration',
  );

  // And the reverse direction: registration required, percentage untouched.
  const registersOnly = await send(admin, 'post', '/api/admin/events/', adminPayload({
    name: 'Requires registration only',
    registrationRequired: true,
  }));
  assert.equal(registersOnly.status, 201, JSON.stringify(registersOnly.body));
  assert.equal(registersOnly.body.registrationRequired, true);
  assert.equal(
    registersOnly.body.requiredForAttendance,
    false,
    'registration must not silently switch on the percentage flag either',
  );

  // Stored values, read straight from Mongo, not from the response.
  const stored = await getModels().Event.findById(countsOnly.body.id).lean();
  assert.equal(stored.registrationRequired, false);
  assert.equal(stored.requiredForAttendance, true);
});
test('an event created without either flag demands no registration when scanned', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  const { agent: admin } = await login('ADM001');

  // Nothing registration-related is sent at all. This is what the admin form did
  // before the fix, except it also sent requiredForAttendance: true by default.
  //
  // Dated TODAY with a full-day window, so the check-in window is genuinely open
  // and the scan below can only ever be about a REGISTRATION reason - never
  // "the event has not started yet", which would prove nothing.
  const created = await send(admin, 'post', '/api/admin/events/', adminPayload({
    name: 'No policy flags at all',
    date: manilaDate(0),
    start: '00:00',
    end: '23:59',
    cutoff: '23:00',
    // A geofence so the scan is refused, or accepted, for a REGISTRATION reason
    // rather than for missing venue configuration.
    venueLatitude: 14.5995,
    venueLongitude: 120.9842,
    venueRadiusMeters: 150,
  }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.registrationRequired, false, 'registration is never assumed');

  // THE PROOF THAT THE ORIGINAL SYMPTOM IS GONE: with no registration required,
  // the scan must not demand one. A Student with no registration row checks in.
  const event = await getModels().Event.findById(created.body.id).lean();
  // Creating a QR event through the admin API ALREADY issues its credential, so
  // the code is read and decrypted here rather than issuing a second one - the
  // collection enforces one active code per event.
  const { decryptSecret } = await import('../src/utils/secretBox.js');
  const issued = await getModels().AttendanceCode.findOne({ eventId: event._id, active: true }).lean();
  assert.ok(issued, 'a QR event must have an issued credential to scan with');
  const secret = decryptSecret(issued.tokenEncrypted);
  const { agent: student } = await login('STU001');
  const scan = await send(student, 'post', '/api/attendance/scan/', {
    token: `COT-EVENT:${event._id}:${secret}`,
    method: 'qr',
    location: atVenue(),
  });
  assert.equal(
    scan.status,
    201,
    `scanning an event that needs no registration must not demand one: ${JSON.stringify(scan.body)}`,
  );
  assert.equal(
    await getModels().EventRegistration.countDocuments({ eventId: event._id }),
    0,
    'the scan must not quietly create a registration either',
  );
});

test('create -> save -> reopen keeps the registration policy an administrator set', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  const { agent: admin } = await login('ADM001');

  const deadline = new Date(Date.now() + 3 * 86_400_000);
  const created = await send(admin, 'post', '/api/admin/events/', adminPayload({
    name: 'Reopened after saving',
    registrationRequired: true,
    registrationDeadline: deadline.toISOString(),
    requiredForAttendance: false,
  }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.registrationRequired, true);
  assert.equal(created.body.registrationDeadline, deadline.toISOString());

  // REOPEN: the administrator list is what the edit form is populated from, so
  // it has to report both flags under their own names.
  const state = await admin.get('/api/admin/state/');
  assert.equal(state.status, 200);
  const reopened = state.body.events.find((event) => event.id === created.body.id);
  assert.ok(reopened, 'the saved event must be listed for the administrator');
  assert.equal(reopened.registrationRequired, true, 'reopening must show registration is required');
  assert.equal(reopened.requiredForAttendance, false, 'reopening must show the percentage flag separately');
  assert.ok(reopened.registrationDeadline, 'the deadline must survive the round trip');

  // EDITING SOMETHING ELSE MUST NOT SILENTLY CHANGE REGISTRATION.
  const renamed = await send(admin, 'patch', `/api/admin/events/${created.body.id}/`, { name: 'Renamed, policy untouched' });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.registrationRequired, true, 'a rename must not close registration');
  assert.equal(renamed.body.requiredForAttendance, false);

  // AND IT CAN BE CLEARED DELIBERATELY.
  const cleared = await send(admin, 'patch', `/api/admin/events/${created.body.id}/`, { registrationRequired: false });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.registrationRequired, false, 'an administrator can turn registration off');
});



test('a bad registration flag is reported under its own name, not the percentage one', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'ADM001', role: 'admin' });
  const { agent: admin } = await login('ADM001');
  const bad = await send(admin, 'post', '/api/admin/events/', adminPayload({ registrationRequired: 'yes please' }));
  assert.equal(bad.status, 400);
  assert.ok(
    bad.body.registrationRequired,
    `the error must name the registration field, not requiredForAttendance: ${JSON.stringify(bad.body)}`,
  );
  assert.ok(faculty.user);
});

test('the student payload explains WHY registration is unavailable instead of hiding it', () => {
  const now = new Date();
  const base = {
    _id: 'e-reg', name: 'Event', venue: 'Hall', audience: 'student',
    startsAt: new Date(now.getTime() - 60 * 60_000),
    endsAt: new Date(now.getTime() + 60 * 60_000),
    checkInOpensAt: new Date(now.getTime() - 60 * 60_000),
    checkInClosesAt: new Date(now.getTime() + 60 * 60_000),
    lateCutoff: new Date(now.getTime() + 15 * 60_000),
    status: 'published',
    attendanceMethod: 'qr',
  };
  const student = (extra = {}) => ({ userRole: 'student', eventAllows: true, status: 'ongoing', ...extra });

  // NOT REQUIRED: nothing to register for, and check-in is allowed.
  const notRequired = serializeEventContext({ ...base, registrationRequired: false }, student());
  assert.equal(notRequired.registration_status, 'not_required');
  assert.equal(notRequired.registration_unavailable_reason, null);
  assert.equal(notRequired.can_check_in, true, 'no registration is required to check in');

  // REQUIRED AND OPEN: the action is offered, and no reason is published.
  const open = serializeEventContext(
    { ...base, registrationRequired: true, startsAt: new Date(now.getTime() + 86_400_000), endsAt: new Date(now.getTime() + 90_000_000) },
    student({ status: 'upcoming' }),
  );
  assert.equal(open.registration_status, 'required');
  assert.equal(open.can_register, true, 'an upcoming event must offer the Register action');
  assert.equal(open.registration_unavailable_reason, null, 'an open registration publishes no excuse');

  // REQUIRED BUT ALREADY STARTED: this is the reported dead end. The action is
  // unavailable, and the reason says so instead of the control vanishing.
  const started = serializeEventContext({ ...base, registrationRequired: true }, student());
  assert.equal(started.can_register, false);
  assert.equal(
    started.registration_unavailable_reason,
    'Registration closed - this event has already started.',
    'a started event must say registration is closed rather than hide the action',
  );

  // REQUIRED, STILL UPCOMING, BUT THE DEADLINE HAS PASSED: a different reason.
  const pastDeadline = serializeEventContext(
    { ...base, registrationRequired: true, registrationDeadline: new Date(now.getTime() - 60_000), startsAt: new Date(now.getTime() + 86_400_000), endsAt: new Date(now.getTime() + 90_000_000) },
    student({ status: 'upcoming' }),
  );
  assert.equal(pastDeadline.can_register, false);
  assert.match(pastDeadline.registration_unavailable_reason, /deadline/i);

  // ALREADY REGISTERED: the status is reported and no excuse is published.
  const registered = serializeEventContext(
    { ...base, registrationRequired: true },
    student({ registration: { status: 'registered' } }),
  );
  assert.equal(registered.registration_status, 'registered');
  assert.equal(registered.registration_unavailable_reason, null, 'a registered student has nothing to be told');

  // FACULTY ARE NEVER GATED BY REGISTRATION, so they get no reason either.
  const facultyView = serializeEventContext({ ...base, registrationRequired: true }, { userRole: 'faculty', eventAllows: true, status: 'ongoing' });
  assert.equal(facultyView.registration_unavailable_reason, null);
  assert.equal(facultyView.can_check_in, true, 'registration gates students, not faculty');
});

test('registration blocks a student only while it is genuinely required', async () => {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const open = await createEvent(faculty.user, { registrationRequired: true });
  const secret = 'registration-policy-secret';
  await getModels().AttendanceCode.create({
    _id: await (await import('../src/utils/ids.js')).nextNumericId('attendanceCode'),
    eventId: open._id,
    createdById: faculty.user._id,
    tokenHash: (await import('../src/utils/identifiers.js')).sha256(secret),
    tokenEncrypted: (await import('../src/utils/secretBox.js')).encryptSecret(secret),
    expiresAt: new Date(Date.now() + 60 * 60_000),
    active: true,
  });
  const { agent } = await login('STU001');

  const refused = await send(agent, 'post', '/api/attendance/scan/', {
    token: `COT-EVENT:${open._id}:${secret}`, method: 'qr', location: atVenue(),
  });
  assert.equal(refused.status, 400);
  assert.match(refused.body.registration, /Register for this event/i);

  // Registering is genuinely refused for an event that has already started, so
  // the scan refusal is a real rule rather than an unreachable instruction.
  const registrationAttempt = await send(agent, 'post', `/api/events/${open._id}/registrations/`);
  assert.equal(registrationAttempt.status, 400);
  assert.match(registrationAttempt.body.event, /closed/i);

  // A FACULTY member is never blocked by a student registration rule.
  await createUser({ username: 'FAC002', role: 'faculty' });
  const { agent: facultyAgent } = await login('FAC002');
  const facultyScan = await send(facultyAgent, 'post', '/api/attendance/scan/', {
    token: `COT-EVENT:${open._id}:${secret}`, method: 'qr', location: atVenue(),
  });
  assert.equal(facultyScan.status, 201, JSON.stringify(facultyScan.body));
  assert.ok(student.user);
});
