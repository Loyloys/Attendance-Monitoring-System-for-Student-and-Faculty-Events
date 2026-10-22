import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agent, createUser, getModels, login, minutes, nextId, request, reset, send, setup, teardown } from './helpers.js';
import { AttendanceCode, Event, EventAttendance } from '../src/models/index.js';
import { INDEX_CREATION_EXCLUDED_MODELS } from '../src/config/database.js';
import { QR_PREFIX } from '../src/utils/domain.js';
import { sha256 } from '../src/utils/identifiers.js';
import { encryptSecret } from '../src/utils/secretBox.js';
import {
  __setTrackingIndexVerified,
  checkoutTrackingSession,
  finalizeExpiredSessions,
  getTrackingSession,
  isTrackingIndexReady,
  startTrackingSession,
  updateTrackingSession,
} from '../src/services/attendanceSessionService.js';
import { recordEventAttendance } from '../src/services/eventService.js';
import { isQrIndexReady } from '../src/services/eventQrService.js';
import { serializeEventContext } from '../src/services/eventSerializer.js';
import { LOCATION_POLICY } from '../src/utils/domain.js';
import { verifyAttendanceLocation } from '../src/utils/events.js';
import {
  TRACKING_MAX_OBSERVATION_AGE_SECONDS,
  effectiveTrackingMaxAgeSeconds,
} from '../src/utils/attendancePolicy.js';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

before(async () => {
  await setup();
  // The unique index is what makes the single-session rule atomic, and in this
  // isolated database the test helpers do create it. Declaring it here keeps the
  // rest of the suite focused on behaviour rather than on the rollout.
  __setTrackingIndexVerified(true);
});
after(teardown);
beforeEach(reset);

/**
 * Guards the startup-safety rule that the rest of the rollout gate rests on.
 *
 * An exclusion list alone proves nothing: Mongoose's `autoIndex`/`autoCreate`
 * defaults (both true) build EVERY registered model asynchronously once the
 * connection opens. Left on, an ordinary `npm start` creates `attendancesessions`
 * and its unique index on the live database, silently performing the
 * approval-gated rollout that is supposed to require an explicit step.
 *
 * This therefore runs in a CHILD PROCESS. Inside this suite the index has already
 * been built by the helpers and Mongoose caches that state per process, so an
 * in-process check would still pass with the bug reintroduced - it would not be a
 * real guard. A fresh process is the only faithful reproduction of a start.
 */
test('a normal start does not create the attendance-session collection or its unique index', () => {
  const scratchUri = process.env.MONGODB_URI.replace(/[^/]+$/, 'university_attendance_test_startup_probe');
  // A fresh process is the only faithful reproduction of a start, and it uses its
  // own scratch database so nothing here touches the suite's data.
  const script = [
    "import mongoose from 'mongoose';",
    'process.env.MONGODB_URI = ' + JSON.stringify(scratchUri) + ';',
    "const db = await import('./src/config/database.js');",
    'await db.connectDatabase();',
    'await db.ensureDatabaseIndexes();',
    // Any automatic build would land asynchronously a moment after connecting.
    'await new Promise((r) => setTimeout(r, 3000));',
    'const names = await mongoose.connection.db.listCollections().toArray();',
    "const present = names.some((n) => n.name === 'attendancesessions');",
    'let unique = false;',
    'if (present) {',
    "  const ix = await mongoose.connection.db.collection('attendancesessions').indexes();",
    "  unique = ix.some((i) => i.name === 'unique_user_event_session' && i.unique === true);",
    '}',
    "console.log('RESULT' + JSON.stringify({ present, unique, autoIndex: mongoose.get('autoIndex'), autoCreate: mongoose.get('autoCreate') }));",
    'await mongoose.connection.dropDatabase();',
    'await db.disconnectDatabase();',
  ].join('\n');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: { ...process.env },
    encoding: 'utf8',
  });
  const result = JSON.parse(output.trim().split('\n').pop().replace(/^RESULT/, ''));

  assert.equal(result.autoIndex, false, 'autoIndex must be off, or a start rebuilds every model');
  assert.equal(result.autoCreate, false, 'autoCreate must be off, or a start creates the collection');
  assert.equal(result.present, false, 'a routine start must not create attendancesessions');
  assert.equal(result.unique, false, 'a routine start must not create unique_user_event_session');
  assert.equal(
    INDEX_CREATION_EXCLUDED_MODELS.includes('AttendanceSession'),
    true,
    'the model must stay on the exclusion list',
  );
});

/**
 * The same guard for the QR credential index.
 *
 * Excluding only `AttendanceSession` was not enough: `AttendanceCode` is a
 * non-excluded model, so a routine restart would apply
 * `unique_active_code_per_event` to the live database - the very rollout that
 * has to be authorised separately. This reproduces a start in a child process
 * against a scratch database and asserts the QR index is NOT created, and that
 * the collection itself is not auto-created either.
 */
test('a normal start does not create the event-code collection or its unique index', () => {
  const scratchUri = process.env.MONGODB_URI.replace(/[^/]+$/, 'university_attendance_test_qr_probe');
  const script = [
    "import mongoose from 'mongoose';",
    'process.env.MONGODB_URI = ' + JSON.stringify(scratchUri) + ';',
    "const db = await import('./src/config/database.js');",
    'await db.connectDatabase();',
    'await db.ensureDatabaseIndexes();',
    'await new Promise((r) => setTimeout(r, 3000));',
    'const names = await mongoose.connection.db.listCollections().toArray();',
    "const present = names.some((n) => n.name === 'attendancecodes');",
    'let unique = false;',
    'if (present) {',
    "  const ix = await mongoose.connection.db.collection('attendancecodes').indexes();",
    "  unique = ix.some((i) => i.name === 'unique_active_code_per_event' && i.unique === true);",
    '}',
    "console.log('RESULT' + JSON.stringify({ present, unique }));",
    'await mongoose.connection.dropDatabase();',
    'await db.disconnectDatabase();',
  ].join('\n');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: backendRoot,
    env: { ...process.env },
    encoding: 'utf8',
  });
  const result = JSON.parse(output.trim().split('\n').pop().replace(/^RESULT/, ''));

  assert.equal(result.present, false, 'a routine start must not create attendancecodes');
  assert.equal(result.unique, false, 'a routine start must not create unique_active_code_per_event');
  assert.equal(
    INDEX_CREATION_EXCLUDED_MODELS.includes('AttendanceCode'),
    true,
    'AttendanceCode must stay on the exclusion list, or a restart performs the QR rollout',
  );
});

/**
 * The other half of the contract: the explicit rollout path really does create
 * the index, and re-running it is a no-op that DROPS NOTHING. This is what
 * makes it safe to run against a database that already has the index.
 */
test('the explicit rollout creates the gated indexes without dropping anything', async () => {
  const { AttendanceCode, AttendanceSession } = getModels();

  // Start from a database with no gated collections at all.
  await AttendanceCode.collection.drop().catch(() => undefined);
  await AttendanceSession.collection.drop().catch(() => undefined);
  assert.equal(await isQrIndexReady(), false, 'precondition: no QR index yet');

  // The approved step (npm run rollout:attendance-indexes) does exactly this.
  await AttendanceCode.createIndexes();
  await AttendanceSession.createIndexes();
  assert.equal(await isQrIndexReady(), true, 'the rollout must create the QR index');
  assert.equal(await isTrackingIndexReady(), true, 'the rollout must create the tracking index');

  // Record the indexes, then run it AGAIN and prove nothing was dropped.
  const before = (await AttendanceCode.collection.indexes()).map((i) => i.name).sort();
  await AttendanceCode.createIndexes();
  const after = (await AttendanceCode.collection.indexes()).map((i) => i.name).sort();
  assert.deepEqual(after, before, 're-running the rollout must not remove any index');
});

const VENUE = { latitude: 14.5995, longitude: 120.9842 };

/** The minimal context `serializeEventContext` needs to shape an event. */
function studentContext(overrides = {}) {
  return {
    userRole: 'student',
    registration: null,
    attendance: null,
    feedbackSubmitted: false,
    certificateId: null,
    organizerName: 'Faculty One',
    isOrganizer: false,
    // Mirrors a real student's eligibility: `eventAllows` is true for a
    // student-facing event whose audience includes them. Asserting on this keeps
    // the test honest - a `false` here would make `can_check_in` false for a
    // reason that has nothing to do with registration, and the assertion below
    // would then be testing the wrong rule.
    eventAllows: true,
    status: 'ongoing',
    now: new Date(),
    ...overrides,
  };
}

test('the student payload carries the required attendance separately from the event length', () => {
  // The bug this pins: the student's card labelled `duration_minutes` - the
  // event's total length - as "Required duration", so a 2-minute requirement
  // rendered as "2h 5m". The requirement was saved correctly all along but was
  // never sent to students, so the card could not show it even if it wanted to.
  const startsAt = new Date('2026-10-03T14:08:00.000Z');
  const endsAt = new Date('2026-10-03T16:13:00.000Z');
  const event = {
    _id: 'e-1', name: 'Tracking event', venue: 'Hall', audience: 'all',
    startsAt, endsAt, status: 'published',
    registrationRequired: false, attendanceMethod: 'qr',
    checkInOpensAt: startsAt, checkInClosesAt: endsAt, lateCutoff: endsAt,
    locationVerificationRequired: true,
    requiredAttendanceMinutes: 2,
  };

  const serialized = serializeEventContext(event, studentContext());

  assert.equal(serialized.required_attendance_minutes, 2, 'the student must receive the saved requirement');
  assert.equal(serialized.duration_minutes, 125, 'the event length is a separate number');
  assert.equal(
    serialized.required_attendance_minutes,
    2,
    'a 2-minute requirement must never be reported as the 125-minute event length',
  );
  assert.notEqual(serialized.required_attendance_minutes, serialized.duration_minutes);
});

test('an unconfigured requirement is reported as null, never borrowed from the event length', () => {
  // "Not configured" is a real state. Substituting the event length would invent
  // an attendance rule no administrator set, and would demand that a student stay
  // for the whole event.
  const startsAt = new Date('2026-10-03T14:08:00.000Z');
  const event = {
    _id: 'e-2', name: 'Unconfigured', venue: 'Hall', audience: 'all',
    startsAt, endsAt: new Date(startsAt.getTime() + 125 * 60_000), status: 'published',
    registrationRequired: false, attendanceMethod: 'qr',
    checkInOpensAt: startsAt, checkInClosesAt: startsAt, lateCutoff: startsAt,
    requiredAttendanceMinutes: null,
  };

  const serialized = serializeEventContext(event, studentContext());

  assert.equal(serialized.required_attendance_minutes, null, 'null means not configured');
  assert.equal(serialized.duration_minutes, 125, 'the event length is still reported truthfully');
  assert.notEqual(serialized.required_attendance_minutes, serialized.duration_minutes);

  // An absent field must behave the same as an explicit null, not become NaN.
  const { requiredAttendanceMinutes: _omitted, ...withoutField } = event;
  assert.equal(serializeEventContext(withoutField, studentContext()).required_attendance_minutes, null);
});

test('the student payload reports registration state without inventing a reason', () => {
  // The check-in window must actually be OPEN around `now`, otherwise
  // `can_check_in` is false for the unrelated reason that the event has not
  // started, and these assertions would prove nothing about registration.
  const now = new Date();
  const base = {
    _id: 'e-3', name: 'Event', venue: 'Hall', audience: 'all',
    startsAt: new Date(now.getTime() - 60 * 60_000),
    endsAt: new Date(now.getTime() + 60 * 60_000), status: 'published',
    attendanceMethod: 'qr',
    checkInOpensAt: new Date(now.getTime() - 60 * 60_000),
    checkInClosesAt: new Date(now.getTime() + 60 * 60_000),
    lateCutoff: new Date(now.getTime() + 15 * 60_000),
    requiredAttendanceMinutes: 2,
  };

  // Registration NOT required: the student is eligible to check in with no
  // registration row at all. `can_check_in` must be true - refusing here would
  // wrongly imply registration is needed for this event.
  const open = serializeEventContext({ ...base, registrationRequired: false }, studentContext());
  assert.equal(open.registration_status, 'not_required');
  assert.equal(open.can_register, false, 'there is nothing to register for');
  assert.equal(open.can_check_in, true, 'no registration is required to check in');
  assert.equal(open.registration_deadline, null, 'no deadline exists when none was set');

  // Already registered: the status is reported, and registering is not re-offered.
  const registered = serializeEventContext(
    { ...base, registrationRequired: true },
    studentContext({ registration: { status: 'registered' } }),
  );
  assert.equal(registered.registration_status, 'registered');
  assert.equal(registered.can_register, false, 'an existing registration is not re-offered');

  // Registration required but absent, while the event is still upcoming: this is
  // the genuine "you can still register" case.
  const upcoming = serializeEventContext(
    { ...base, registrationRequired: true, status: 'published' },
    studentContext({ status: 'upcoming' }),
  );
  assert.equal(upcoming.registration_status, 'required');
  assert.equal(upcoming.can_register, true);
  assert.equal(upcoming.can_check_in, false, 'registration is required before check-in');
});
test('a stationary attendee still earns credit while the device keeps reporting fresh fixes', async () => {
  // The browser may not move at all. As long as each observation is genuinely
  // new, successive Inside observations credit the interval between them.
  const { event, student } = await trackingEvent({ requiredAttendanceMinutes: 5 });
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);

  let at = t0;
  for (let i = 0; i < 3; i += 1) {
    at = new Date(at.getTime() + 10_000);
    const step = await update(user, session, at);
    assert.equal(step.locationState, 'inside');
    assert.equal(step.creditedSeconds, (i + 1) * 10, `stationary credit after step ${i + 1}`);
  }
  const final = await getTrackingSession(user, event._id, at);
  assert.equal(final.creditedSeconds, 30);
  assert.equal(final.state, 'tracking', 'a stationary user inside is still tracking');
});

test('an event left unconfigured cannot start tracking and existing events are untouched', async () => {
  const { event, student } = await trackingEvent({ requiredAttendanceMinutes: null });
  await assert.rejects(start(asUser(student), event, new Date()), detail(/needs configuration/i));
  const stored = await getModels().Event.findById(event._id).lean();
  assert.equal(stored.requiredAttendanceMinutes, null, 'no value is invented for the event');
});

test('tracking is refused while the unique index has not been created by the rollout', async () => {
  // Proves the feature is OFF by default: a freshly started server must not accept
  // a tracking session until the approved rollout step has created the index.
  //
  // The index is genuinely DROPPED rather than a flag merely being cleared. The
  // gate asks the database whether the index exists; clearing the cache flag on
  // its own cannot prove the gate works, and would keep passing even if the gate
  // were removed entirely.
  const { event, student } = await trackingEvent();
  await getModels().AttendanceSession.collection.dropIndex('unique_user_event_session');
  __setTrackingIndexVerified(false);
  try {
    await assert.rejects(
      start(asUser(student), event, new Date()),
      /not enabled on this server yet/i,
    );
    // Nothing was written while disabled.
    assert.equal(await getModels().AttendanceSession.countDocuments({ eventId: event._id }), 0);
  } finally {
    // Put the rollout back the way the approved step would leave it.
    await getModels().AttendanceSession.createIndexes();
    __setTrackingIndexVerified(true);
  }
  // The existing one-shot attendance scan is unaffected while tracking is off.
  assert.equal(await getModels().AttendanceSession.countDocuments({ eventId: event._id }), 0);
});

/** A fix `seconds` old relative to `now`, at the venue or `meters` away. */
const fix = (now, seconds = 0, meters = 0) => ({
  latitude: VENUE.latitude + (meters / 111_320),
  longitude: VENUE.longitude,
  accuracy: 5,
  capturedAt: new Date(now.getTime() - seconds * 1000).toISOString(),
});
const asUser = (account) => ({ _id: account.user._id, accountId: account.user.accountId, profile: account.profile });
/** Field errors travel in details, which is this codebase's convention. */
const detail = (re) => (error) => re.test(error?.details ? Object.values(error.details).join(' ') : error?.message ?? '');

async function trackingEvent(overrides = {}) {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const now = Date.now();
  const event = await Event.create({
    name: 'Tracking Event',
    startsAt: new Date(now - 60_000),
    endsAt: new Date(now + minutes(120)),
    venue: 'Innovation Hall',
    organizerId: faculty.user._id,
    status: 'published',
    audience: 'all',
    registrationRequired: false,
    checkInOpensAt: new Date(now - 60_000),
    checkInClosesAt: new Date(now + minutes(120)),
    lateCutoff: new Date(now + minutes(10)),
    attendanceMethod: 'qr',
    venueLatitude: VENUE.latitude,
    venueLongitude: VENUE.longitude,
    venueRadiusMeters: 100,
    requiredAttendanceMinutes: 10,
    ...overrides,
  });
  // A QR event now demands a real credential, so the fixture issues one. The
  // tracking scenarios are about crediting time, not about the credential
  // itself, which has its own dedicated tests.
  const secret = 'tracking-fixture-token';
  const fullToken = `${QR_PREFIX}:${event._id}:${secret}`;
  await AttendanceCode.create({
    _id: await nextId('attendanceCode'),
    eventId: event._id,
    createdById: faculty.user._id,
    tokenHash: sha256(secret),
    tokenEncrypted: encryptSecret(secret),
    expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    active: true,
  });
  // Carried on the returned fixture so every `start(...)` call site stays
  // unchanged; a plain property on a Mongoose document is not persisted.
  event.trackingToken = fullToken;
  return {
    event,
    faculty,
    student: await createUser({ username: 'STU001', role: 'student' }),
    token: fullToken,
  };
}

const start = (user, event, now, meters = 0) =>
  startTrackingSession(user, { token: event.trackingToken, method: 'qr', location: fix(now, 0, meters) }, now);
const update = (user, session, now, meters = 0) =>
  updateTrackingSession(user, session.id, { location: fix(now, 0, meters) }, now);
test('tracking starts only on a valid Inside observation and the server owns the total', async () => {
  const { event, student } = await trackingEvent();
  const t0 = new Date(Date.now() + 1_000);
  const started = await start(asUser(student), event, t0);
  assert.equal(started.state, 'tracking');
  assert.equal(started.locationState, 'inside');
  assert.equal(started.creditedSeconds, 0, 'no time is credited at the instant of the scan');
  assert.equal(started.requiredMinutes, 10);
  assert.equal(started.arrival, 'on_time');
  assert.equal(started.durationOutcome, 'in_progress');
});

test('Student and Faculty tracking starts from each signed-in user’s recorded scan without replaying its QR token', async () => {
  const { event, faculty, student, token } = await trackingEvent();
  const user = asUser(student);
  const scannedAt = new Date();
  const attendance = await recordEventAttendance(user, {
    token,
    method: 'qr',
    location: fix(scannedAt),
  });
  const trackingAt = new Date(scannedAt.getTime() + 1_000);

  const session = await startTrackingSession(user, {
    attendanceId: attendance._id,
    method: 'qr',
    location: fix(trackingAt),
  }, trackingAt);
  assert.equal(session.eventId, event._id);
  assert.equal(session.state, 'tracking');
  assert.equal(session.creditedSeconds, 0);
  assert.equal(await EventAttendance.countDocuments({ eventId: event._id, attendeeId: student.user._id }), 1);
  const resumed = await startTrackingSession(user, {
    attendanceId: attendance._id,
    method: 'qr',
    location: fix(new Date(trackingAt.getTime() + 1_000)),
  }, new Date(trackingAt.getTime() + 1_000));
  assert.equal(resumed.id, session.id, 'retry resumes the existing session');
  assert.equal(await EventAttendance.countDocuments({ eventId: event._id, attendeeId: student.user._id }), 1);

  const facultyUser = asUser(faculty);
  const facultyAttendance = await recordEventAttendance(facultyUser, {
    token,
    method: 'qr',
    location: fix(scannedAt),
  });
  const facultySession = await startTrackingSession(facultyUser, {
    attendanceId: facultyAttendance._id,
    method: 'qr',
    location: fix(trackingAt),
  }, trackingAt);
  assert.equal(facultySession.eventId, event._id);
  assert.equal(facultySession.state, 'tracking');
  assert.equal(await EventAttendance.countDocuments({ eventId: event._id, attendeeId: faculty.user._id }), 1);

  const otherStudent = await createUser({ username: 'STU002', role: 'student' });
  await assert.rejects(
    startTrackingSession(asUser(otherStudent), {
      attendanceId: attendance._id,
      method: 'qr',
      location: fix(trackingAt),
    }, trackingAt),
    detail(/server-confirmed attendance check-in/i),
  );
});

test('a replayed observation cannot earn credit, however often it is resent', async () => {
  // FRESHNESS IS NOT SPACING. The crediting rule cares about the SPACING of
  // accepted observations (MAX_CREDIT_GAP_SECONDS, 30 s); the FRESHNESS rule is
  // separate (LOCATION_MAX_AGE_SECONDS, 120 s) and is what stops an OLD fix from
  // being replayed. Without the freshness check an attacker - or a browser stuck
  // replaying a cached position - could resend one stale-but-Inside fix every
  // 10 s and accumulate credit forever without ever standing at the venue.
  //
  // Each resend is only 10 s after the previous one, so the 30 s spacing rule is
  // satisfied on EVERY call. If freshness were not independently enforced, this
  // test would accumulate 20 s, 30 s, 40 s... and pass with a large total.
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);

  // One fix, taken ONCE, then presented as if it were freshly measured on every
  // submission: 200 s old each time. Under the 120 s age limit that is stale.
  const replayedFix = fix(t0, 200);
  for (const step of [1, 2, 3, 4]) {
    const at = new Date(t0.getTime() + step * 10_000);
    await assert.rejects(
      updateTrackingSession(user, session.id, { location: replayedFix }, at),
      detail(/too old/i),
      `resend ${step} is 200 s old and must be refused`,
    );
    const current = await getTrackingSession(user, event._id, at);
    assert.equal(
      current.creditedSeconds,
      0,
      `a replayed fix must never credit, not even on resend ${step}`,
    );
  }

  // The boundary is a real threshold, not a blanket refusal: a fix measured 30 s
  // before this submission is 30 s old - inside the 120 s limit - so it is
  // accepted. That proves the refusals above are discriminating on AGE rather
  // than rejecting every observation for some unrelated reason.
  const acceptedAt = new Date(t0.getTime() + 50_000);
  const freshEnough = await updateTrackingSession(
    user,
    session.id,
    { location: fix(acceptedAt, 30) },
    acceptedAt,
  );
  assert.equal(freshEnough.state, 'tracking');
});

/**
 * The 30 s TRACKING freshness rule, proved as its own rule.
 *
 * The rejection above is a 200 s fix, which the 120 s GENERAL location-age limit
 * already refuses on its own. That single case therefore cannot show whether a
 * stricter tracking rule exists. These tests use ages that are all INSIDE the
 * general 120 s limit - 31, 60 and 119 s - so each refusal can only have come
 * from the tracking rule, never from the general one.
 *
 * The cadence is the real one (10 s), so the 30 s crediting-spacing rule is
 * satisfied on every single submission. If freshness were not enforced
 * independently, each of these would credit 10 s and the session would reach the
 * required duration while the phone sat nowhere near the venue.
 */
test('readings aged 31, 60 and 119 seconds are refused by the 30-second tracking rule, not the general age limit', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);

  // Precondition: every age below is ACCEPTED by the general location-age rule.
  // The one-shot scan uses only that rule, so proving it against the SAME event
  // is what makes the tracking refusals below meaningful rather than a duplicate
  // of the general check. (verifyAttendanceLocation needs only the geofence, so
  // one fixture event serves for all three ages.)
  for (const age of [31, 60, 119]) {
    assert.ok(
      age <= LOCATION_POLICY.maxAgeSeconds,
      `${age}s must be inside the general ${LOCATION_POLICY.maxAgeSeconds}s limit, or this test proves nothing`,
    );
    assert.doesNotThrow(
      () => verifyAttendanceLocation(event, fix(new Date(), age), new Date()),
      `the one-shot scan must still accept a ${age}s-old fix`,
    );
  }

  // CONTROL FIRST, on a live session. One genuinely fresh reading, 10 s after the
  // start, credits normally. This is what makes the refusals below meaningful:
  // they happen to a session that demonstrably credits, so they cannot be passing
  // because something unrelated was already broken.
  const controlAt = new Date(t0.getTime() + 10_000);
  const control = await updateTrackingSession(user, session.id, { location: fix(controlAt, 0) }, controlAt);
  assert.equal(control.state, 'tracking');
  assert.equal(control.creditedSeconds, 10, 'a fresh reading credits normally');
  const creditedAfterControl = control.creditedSeconds;

  // Each is submitted 10 s after the previous one: inside MAX_CREDIT_GAP_SECONDS
  // (30 s), so the crediting-spacing rule is satisfied every time. If freshness
  // were not enforced independently, each of these would credit another 10 s.
  let at = controlAt;
  for (const age of [31, 60, 119]) {
    at = new Date(at.getTime() + 10_000);
    await assert.rejects(
      updateTrackingSession(user, session.id, { location: fix(at, age) }, at),
      detail(/seconds old/i),
      `a ${age}s-old reading must be refused while tracking`,
    );
    const current = await getTrackingSession(user, event._id, at);
    assert.equal(
      current.creditedSeconds,
      creditedAfterControl,
      `a ${age}s-old reading must never credit`,
    );
  }

  // A fresh reading on the SAME cadence is ACCEPTED again, so the refusals above
  // discriminate on freshness and not on some unrelated fault. Note it credits
  // nothing, and that is correct for an independent reason worth pinning: the
  // three refused submissions never updated `lastReceivedAt`, so the interval
  // between the last genuinely-received update and this one is 40 s - wider than
  // MAX_CREDIT_GAP_SECONDS (30 s). The crossing happened somewhere unknown during
  // that gap, so it is deliberately never credited. Freshness and crediting
  // spacing are separate rules and this asserts both at once.
  const freshAt = new Date(at.getTime() + 10_000);
  const accepted = await updateTrackingSession(user, session.id, { location: fix(freshAt, 0) }, freshAt);
  assert.equal(accepted.state, 'tracking', 'a fresh reading is accepted after the stale ones');
  assert.equal(
    accepted.creditedSeconds,
    creditedAfterControl,
    'the 40s gap since the last received update exceeds the 30s crediting bound, so it earns nothing',
  );

  // And the very next reading - only 10 s after that one - credits again, so the
  // session is genuinely live and the refusals were discriminating, not fatal.
  const next = new Date(freshAt.getTime() + 10_000);
  const resumed = await updateTrackingSession(user, session.id, { location: fix(next, 0) }, next);
  assert.equal(resumed.creditedSeconds, creditedAfterControl + 10, 'crediting resumes on the next fresh reading');
});

/**
 * REPLAY: the same observation timestamp resubmitted while it is still inside
 * the general 120 s age limit.
 *
 * The test above only shows that a STALE observation is refused. This shows the
 * other half: the duplicate/out-of-order guard makes a repeated submission a
 * no-op even while the observation is perfectly fresh, so time cannot be
 * manufactured by sending one fix over and over.
 */
test('a repeated submission of one observation timestamp earns nothing while it is still inside the general age limit', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);

  // ONE fix, taken once. Every resend below carries that identical capturedAt,
  // so the duplicate guard - not staleness - is what makes them no-ops.
  const singleFix = fix(t0, 0);

  // Resent 10 s and 20 s after it was taken: still inside the 30 s tracking
  // freshness window AND the 120 s general limit, so nothing here is refused for
  // being old. Each call is a silent idempotent no-op, which is the point - a
  // browser replaying a cached position must not accumulate time just by
  // sending the same fix every 10 s.
  for (const step of [1, 2]) {
    const at = new Date(t0.getTime() + step * 10_000);
    await updateTrackingSession(user, session.id, { location: singleFix }, at);
    const current = await getTrackingSession(user, event._id, at);
    assert.equal(
      current.creditedSeconds,
      0,
      `resending one observation (step ${step}) must never credit; 10s spacing alone would credit ${step * 10}s`,
    );
  }

  // A genuinely NEW observation afterwards credits the ONE interval since the
  // original fix - proving the session is live and was refusing duplicates, not
  // merely broken. (30 s after the last RECEIVED update, exactly the crediting
  // bound, so this interval is legitimately creditable.)
  const freshAt = new Date(t0.getTime() + 30_000);
  const after = await updateTrackingSession(user, session.id, { location: fix(freshAt, 0) }, freshAt);
  assert.equal(after.creditedSeconds, 30, 'the single real interval is credited exactly once');

  // The same replayed fix, resent much later: 40 s and 90 s old. Both are still
  // INSIDE the general 120 s location-age limit, so the general rule alone would
  // accept them. The 30 s TRACKING freshness rule is what refuses them, and the
  // total does not move. This is the replay case the 200 s test cannot reach.
  for (const age of [40, 90]) {
    const at = new Date(freshAt.getTime() + (age - 30) * 1000);
    await assert.rejects(
      updateTrackingSession(user, session.id, { location: singleFix }, at),
      detail(/seconds old/i),
      `replaying the original fix at ${age}s old must be refused`,
    );
    const current = await getTrackingSession(user, event._id, at);
    assert.equal(current.creditedSeconds, 30, `a replay at ${age}s must not credit`);
  }
});

/**
 * The two age limits are SEPARATE settings, not one number under two names.
 *
 * Pinned deliberately. If someone later collapsed them - for example by making
 * the tracking rule read LOCATION_POLICY.maxAgeSeconds - this fails loudly,
 * because the tracking window would silently widen from 30 s to 120 s and the
 * replay tests above would start accepting stale readings.
 */
test('the tracking freshness window is a separate, stricter setting than the general location age limit', async () => {
  assert.equal(TRACKING_MAX_OBSERVATION_AGE_SECONDS, 30, 'the agreed tracking freshness rule is 30 seconds');
  assert.equal(LOCATION_POLICY.maxAgeSeconds, 120, 'the general location-age setting stays 120 seconds');
  assert.equal(
    effectiveTrackingMaxAgeSeconds(),
    30,
    'the applied tracking limit is the stricter 30 s, not the general 120 s',
  );
  assert.ok(
    effectiveTrackingMaxAgeSeconds() < LOCATION_POLICY.maxAgeSeconds,
    'tracking must never be MORE permissive than the general rule',
  );
});

test('an Outside observation cannot start a session', async () => {
  const { event, student } = await trackingEvent();
  await assert.rejects(start(asUser(student), event, new Date(), 5000), detail(/outside the event check-in zone/i));
});

test('an event with no administrator-set duration reports that tracking needs configuration', async () => {
  const { event, student } = await trackingEvent({ requiredAttendanceMinutes: null });
  await assert.rejects(start(asUser(student), event, new Date()), detail(/needs configuration/i));
});

test('Inside then Inside credits the expected interval on the server clock', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);
  const t1 = new Date(t0.getTime() + 10_000);
  const after = await update(user, session, t1);
  assert.equal(after.creditedSeconds, 10, 'exactly the 10s between the two Inside observations');
  assert.equal(after.state, 'tracking');
  const second = await update(user, session, new Date(t1.getTime() + 10_000));
  assert.equal(second.creditedSeconds, 20);
});

test('Inside then Outside pauses and credits nothing for the uncertain crossing', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);
  const outside = await update(user, session, new Date(t0.getTime() + 10_000), 5000);
  assert.equal(outside.state, 'paused');
  assert.equal(outside.pauseReason, 'outside_venue');
  assert.equal(outside.creditedSeconds, 0, 'the crossing interval is never credited');
});

test('Outside then Inside resumes without crediting the outside gap', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);
  const t1 = new Date(t0.getTime() + 10_000);
  assert.equal((await update(user, session, t1, 5000)).creditedSeconds, 0);
  const t2 = new Date(t1.getTime() + 300_000);
  const back = await update(user, session, t2);
  assert.equal(back.state, 'tracking', 'the SAME session resumes');
  assert.equal(back.creditedSeconds, 0, 'the outside gap earns nothing');
  const resumed = await update(user, session, new Date(t2.getTime() + 10_000));
  assert.equal(resumed.creditedSeconds, 10, 'only the new Inside interval is credited');
});

test('a gap longer than 30 seconds credits nothing', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);
  const late = await update(user, session, new Date(t0.getTime() + 45_000));
  assert.equal(late.creditedSeconds, 0, 'a 45s gap exceeds the 30s crediting bound');
});

test('an inaccurate fix pauses instead of crediting', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);
  const t1 = new Date(t0.getTime() + 10_000);
  await assert.rejects(
    updateTrackingSession(user, session.id, { location: { ...fix(t1), accuracy: 5_000 } }, t1),
    detail(/not precise enough/i),
  );
  assert.equal((await getTrackingSession(user, event._id, t1)).creditedSeconds, 0, 'a refused fix never credits');
});

test('duplicate and out-of-order updates cannot double-count', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);
  const t1 = new Date(t0.getTime() + 10_000);
  assert.equal((await update(user, session, t1)).creditedSeconds, 10);

  // An exact replay of the same observation is idempotent.
  assert.equal((await update(user, session, t1)).creditedSeconds, 10, 'a duplicate credits nothing extra');

  // An older observation is refused outright.
  await assert.rejects(
    updateTrackingSession(user, session.id, { location: fix(t0) }, new Date(t1.getTime() + 10_000)),
    /out of order/i,
  );
  assert.equal((await getTrackingSession(user, event._id, new Date(t1.getTime() + 10_000))).creditedSeconds, 10);
});

test('concurrent updates from two tabs cannot both credit the same interval', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);
  const t1 = new Date(t0.getTime() + 10_000);
  await Promise.all([update(user, session, t1), update(user, session, t1)]);
  assert.equal((await getTrackingSession(user, event._id, t1)).creditedSeconds, 10, 'credited exactly once');
});

test('the required duration is a threshold: credit continues after it is met, and Late stays Late', async () => {
  const { event, student } = await trackingEvent({ requiredAttendanceMinutes: 1 });
  const user = asUser(student);
  // Arrive after lateCutoff so arrival is classified late.
  const t0 = new Date(event.lateCutoff.getTime() + 60_000);
  const session = await start(user, event, t0);
  assert.equal(session.arrival, 'late');

  // Accumulate in steps within the 30s crediting bound: 20 + 20 + 20 = 60s.
  let step = t0;
  let met = session;
  for (let i = 0; i < 3; i += 1) {
    step = new Date(step.getTime() + 20_000);
    met = await update(user, session, step);
  }
  assert.equal(met.creditedSeconds, 60);
  assert.equal(met.durationOutcome, 'met', 'required duration met');
  assert.equal(met.arrival, 'late', 'meeting the duration must NOT convert a late arrival to on time');
  // The threshold is not a cap: staying longer must still be counted.
  assert.equal(met.state, 'tracking', 'tracking continues past the threshold');
  assert.equal(met.remainingSeconds, 0);

  const beyond = await update(user, session, new Date(step.getTime() + 20_000));
  assert.equal(beyond.creditedSeconds, 80, 'time beyond the threshold is still credited');
  assert.equal(beyond.durationOutcome, 'met');
  assert.equal(beyond.arrival, 'late', 'arrival is never rewritten');
});

test('checkout ends the session and further credit is refused', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);
  const t1 = new Date(t0.getTime() + 10_000);
  await update(user, session, t1);
  const out = await checkoutTrackingSession(user, session.id, t1);
  assert.equal(out.state, 'completed');
  assert.equal(out.creditedSeconds, 10, 'time earned before checkout is preserved');

  const t2 = new Date(t1.getTime() + 10_000);
  await assert.rejects(update(user, session, t2), /checked out/i);
  assert.equal((await getTrackingSession(user, event._id, t2)).creditedSeconds, 10, 'no credit after checkout');
});

test('event end stops further credit even with no heartbeat', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  await start(user, event, new Date());
  const stored = await getTrackingSession(user, event._id, new Date(event.endsAt.getTime() + 60_000));
  assert.equal(stored.state, 'completed');
  assert.equal(stored.pauseReason, 'event_ended');
  assert.equal(stored.creditedSeconds, 0);
});

test('a stale session reads as paused while the event is still running', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  await start(user, event, t0);
  const stored = await getTrackingSession(user, event._id, new Date(t0.getTime() + 120_000));
  assert.equal(stored.state, 'paused');
  assert.equal(stored.pauseReason, 'location_stale');
});

test('earned time survives a reconnect because it is persisted server-side', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date();
  const session = await start(user, event, t0);
  const t1 = new Date(t0.getTime() + 20_000);
  await update(user, session, t1);
  assert.equal((await getTrackingSession(user, event._id, t1)).creditedSeconds, 20, 'a fresh request still reports it');
  assert.equal((await getModels().AttendanceSession.findById(session.id).lean()).creditedSeconds, 20);
});

test('one user cannot update another person session', async () => {
  const { event, student } = await trackingEvent();
  const other = await createUser({ username: 'STU002', role: 'student' });
  const user = asUser(student);
  const session = await start(user, event, new Date());
  await assert.rejects(update(asUser(other), session, new Date()), /only update your own/i);
});

test('the tracking endpoints enforce authentication and role boundaries over HTTP', async () => {
  // trackingEvent() already creates STU001, FAC001 and the event.
  await createUser({ username: 'ADM001', role: 'admin' });
  const { event } = await trackingEvent();

  assert.equal((await request().get(`/api/attendance/session/event/${event._id}/`)).status, 401);
  // An unsafe POST also has to satisfy the global CSRF layer, so it is sent with a
  // valid token and no session - otherwise CSRF (403) would mask the real 401.
  assert.equal((await send(agent(), 'post', '/api/attendance/session/', { eventId: event._id })).status, 401);

  const { agent: studentClient } = await login('STU001');
  assert.equal((await studentClient.get(`/api/attendance/sessions/event/${event._id}/`)).status, 403);

  const { agent: adminClient } = await login('ADM001');
  assert.equal((await adminClient.get(`/api/attendance/sessions/event/${event._id}/`)).status, 200);

  // The assigned organizer may monitor; another faculty member may not.
  const { agent: organizer } = await login('FAC001');
  assert.equal((await organizer.get(`/api/attendance/sessions/event/${event._id}/`)).status, 200);
  await createUser({ username: 'FAC999', role: 'faculty' });
  const { agent: stranger } = await login('FAC999');
  assert.equal((await stranger.get(`/api/attendance/sessions/event/${event._id}/`)).status, 403);
});

test('registration is still required before a student can start tracking', async () => {
  const { event, student } = await trackingEvent({ registrationRequired: true });
  await assert.rejects(start(asUser(student), event, new Date()), detail(/Register for this event/i));
});

/**
 * GST008: duration-based ATTENDANCE QUALIFICATION, as distinct from the session
 * state the tests above already cover.
 *
 * The question is not "is the session tracking" but "has this attendance been
 * earned". A scan records a CHECK-IN; the requirement is served over time, by
 * the server, from credited seconds only.
 */

/** The stored attendance row for this attendee/event. */
const row = (event, account) => EventAttendance
  .findOne({ eventId: event._id, attendeeId: account.user._id })
  .lean();

/** Records the check-in the way the scan endpoint does. */
const checkIn = (user, event, now) => recordEventAttendance(user, {
  token: event.trackingToken, method: 'qr', location: fix(now, 0, 0),
});

/** Credits `steps` observations at the 10 s reporting cadence. */
const accrue = async (user, session, from, steps) => {
  let current = session;
  for (let step = 1; step <= steps; step += 1) {
    current = await update(user, session, new Date(from.getTime() + step * 10_000));
  }
  return current;
};

test('a scan alone does NOT qualify a duration-required attendee', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);

  await checkIn(user, event, t0);
  const recorded = await row(event, student);
  assert.equal(recorded.qualification, 'pending', 'a scan records a check-in, not a qualification');
  assert.equal(recorded.verifiedSeconds, 0);
  assert.equal(recorded.requiredAttendanceMinutes, 10);
  // The CHECK-IN itself is preserved and untouched. Qualification is a separate
  // axis and must not erase the fact that the person arrived.
  assert.equal(recorded.status, 'present');
  assert.ok(recorded.recordedAt, 'the check-in timestamp still exists');

  const session = await start(user, event, t0);
  assert.equal(session.creditedSeconds, 0);
  assert.equal((await row(event, student)).qualification, 'pending');

test('meeting the threshold qualifies a LATE arrival as Late, never as Present', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  // The CHECK-IN is on time, at the real clock.
  //
  // It must be: `recordEventAttendance` reads the REAL clock, so a timestamp
  // placed past the cut-off would be a future reading and is correctly refused
  // as an invalid timestamp. The LATENESS that matters here is the tracking
  // arrival, which is what decides qualification.
  const checkInAt = new Date();
  await checkIn(user, event, checkInAt);
  assert.equal((await row(event, student)).qualification, 'pending', 'an on-time scan is still only pending');

  // Tracking STARTS after the cut-off, so the session's arrival is late. This is
  // the case worth proving: serving the full required duration afterwards must
  // NOT quietly convert a late arrival into a present one.
  const t0 = new Date(event.lateCutoff.getTime() + 60_000);
  const session = await start(user, event, t0);
  assert.equal(session.arrival, 'late', 'the arrival classification is independent of duration');
  const current = await accrue(user, session, t0, 60);
  assert.ok(current.creditedSeconds >= 600);

  const qualified = await row(event, student);
  assert.equal(qualified.qualification, 'late', 'serving the duration must NOT un-arrive the person');
  assert.equal(qualified.qualificationReason, null);
});

test('outside, stale and unavailable gaps are never credited, and a pause is not an absence', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);
  await checkIn(user, event, t0);
  const session = await start(user, event, t0);

  const inside = await update(user, session, new Date(t0.getTime() + 10_000));
  assert.equal(inside.locationState, 'inside');
  const outside = await update(user, session, new Date(t0.getTime() + 20_000), 5_000);
  assert.equal(outside.locationState, 'outside');
  assert.equal(outside.creditedSeconds, inside.creditedSeconds, 'an outside observation credits nothing');
  assert.equal(outside.state, 'paused');

  // Still unqualified, and emphatically NOT absent: they may walk back in.
  const paused = await row(event, student);
  assert.equal(paused.qualification, 'pending', 'a pause is not an absence');
  assert.equal(paused.locationState, 'outside');
  assert.equal(paused.trackingState, 'paused');

  // A STALE observation is refused outright rather than credited. The fix claims
  // to have been taken far enough in the past to fail the freshness rule, so
  // this exercises the server's age check and not the geofence.
  await assert.rejects(
    updateTrackingSession(
      user,
      session.id,
      { location: fix(new Date(t0.getTime() + 30_000), 600) },
      new Date(t0.getTime() + 30_000),
    ),
    detail(/too old/i),
  );
});

test('event end with insufficient verified time finalizes the record as Absent', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);
  await checkIn(user, event, t0);
  const session = await start(user, event, t0);
  await update(user, session, new Date(t0.getTime() + 10_000));
  assert.equal((await row(event, student)).qualification, 'pending');

  // The student never reports again and never reopens the page. The event ends.
  const afterEnd = new Date(event.endsAt.getTime() + 60_000);
  const finished = await finalizeExpiredSessions(afterEnd);
  assert.ok(finished.length >= 1, 'the sweep finalized the abandoned session');

  const finalized = await row(event, student);
  assert.equal(finalized.qualification, 'absent', 'an ended event with too little time is absent');
  assert.equal(finalized.qualificationReason, 'Required attendance duration not met.');
  assert.equal(finalized.trackingState, 'ended');
  // The check-in is still on record: finalizing the duration never erases arrival.
  assert.ok(finalized.recordedAt);
  assert.ok(['present', 'late'].includes(finalized.status));
});

});

test('verified inside time accumulates and the threshold qualifies an on-time arrival', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);
  await checkIn(user, event, t0);
  const session = await start(user, event, t0);
  const current = await accrue(user, session, t0, 60);
  assert.ok(current.creditedSeconds >= 600, 'ten minutes of verified inside time');
  assert.equal(current.durationOutcome, 'met');

  const qualified = await row(event, student);
  assert.equal(qualified.qualification, 'present');
  assert.equal(qualified.qualificationReason, null, 'a qualified record carries no outstanding reason');
  assert.equal(qualified.verifiedSeconds, current.creditedSeconds, 'the mirror copies server-owned seconds');
});


test('event end with ENOUGH verified time qualifies rather than marking absent', async () => {
  const { event, student } = await trackingEvent({ requiredAttendanceMinutes: 1 });
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);
  await checkIn(user, event, t0);
  const session = await start(user, event, t0);
  const current = await accrue(user, session, t0, 7);
  assert.ok(current.creditedSeconds >= 60, 'the one-minute requirement was actually served');

  await finalizeExpiredSessions(new Date(event.endsAt.getTime() + 60_000));
  const finalized = await row(event, student);
  assert.ok(finalized.verifiedSeconds >= 60);
  assert.equal(finalized.qualification, 'present', 'enough served time must not become absent');
  assert.equal(finalized.trackingState, 'ended');
});

test('a refresh or a retry never duplicates the session, the row, or credited time', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);
  await checkIn(user, event, t0);
  const session = await start(user, event, t0);
  const progressed = await update(user, session, new Date(t0.getTime() + 10_000));
  const credited = progressed.creditedSeconds;
  assert.ok(credited > 0, 'time actually accrued before the refresh');

  // Re-scanning resumes the SAME session rather than starting a second one.
  const resumed = await start(user, event, new Date(t0.getTime() + 15_000));
  assert.equal(resumed.id, session.id, 'a rescan resumes the existing session');
  assert.equal(await EventAttendance.countDocuments({ eventId: event._id, attendeeId: user._id }), 1, 'exactly one attendance row');
  assert.equal(await getModels().AttendanceSession.countDocuments({ eventId: event._id, userId: user._id }), 1, 'exactly one session');

  // A replayed observation is idempotent: credited time does not move.
  const replayed = await update(user, session, new Date(t0.getTime() + 10_000));
  assert.equal(replayed.creditedSeconds, credited, 'an identical observation credits nothing twice');
  assert.equal((await row(event, student)).verifiedSeconds, credited);
});


test('an explicit checkout before the duration finalizes the record as Absent', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);
  await checkIn(user, event, t0);
  const session = await start(user, event, t0);
  const progressed = await update(user, session, new Date(t0.getTime() + 10_000));
  assert.ok(progressed.creditedSeconds > 0, 'some time was actually served before leaving');

  const done = await checkoutTrackingSession(user, session.id, new Date(t0.getTime() + 20_000));
  assert.equal(done.state, 'completed');
  assert.equal(done.arrival, 'on_time', 'checkout preserves the arrival classification');

  const afterCheckout = await row(event, student);
  assert.equal(afterCheckout.qualification, 'absent', 'APPROVED POLICY: leaving before the duration is an absence');
  assert.equal(
    afterCheckout.qualificationReason,
    'Checked out before required attendance duration was met.',
  );
  assert.equal(afterCheckout.trackingState, 'ended');

  // The CHECK-IN SURVIVES the absence, and the credited time is PRESERVED: the
  // record still shows the person arrived and how long they actually stayed.
  assert.ok(['present', 'late'].includes(afterCheckout.status), 'the check-in is not erased by an absence');
  assert.ok(afterCheckout.recordedAt, 'the check-in timestamp still exists');
  assert.equal(afterCheckout.verifiedSeconds, progressed.creditedSeconds, 'leaving does not reset earned time');

  // Checkout remains final and terminal, exactly as before: a second call is a
  // no-op that returns the SAME finished session rather than restarting or
  // erroring, and it must not re-credit or re-open anything.
  const again = await checkoutTrackingSession(user, session.id, new Date(t0.getTime() + 30_000));
  assert.equal(again.id, session.id, 'a repeated checkout cannot start a different session');
  assert.equal(again.state, 'completed');
  assert.equal(again.creditedSeconds, done.creditedSeconds, 're-checking out credits nothing further');
  assert.equal((await row(event, student)).verifiedSeconds, afterCheckout.verifiedSeconds);
});

test('someone who MEETS the requirement stays qualified when they later leave', async () => {
  // The two scenarios are deliberately separate: serving the duration first must
  // NOT let a later checkout demote them to absent.
  const { event, student } = await trackingEvent({ requiredAttendanceMinutes: 1 });
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);
  await checkIn(user, event, t0);
  const session = await start(user, event, t0);
  await accrue(user, session, t0, 7);

  const qualifiedBeforeLeaving = await row(event, student);
  assert.equal(qualifiedBeforeLeaving.qualification, 'present', 'the requirement was served first');

  const done = await checkoutTrackingSession(user, session.id, new Date(t0.getTime() + 120_000));
  assert.equal(done.state, 'completed');

  const afterLeaving = await row(event, student);
  assert.equal(afterLeaving.qualification, 'present', 'leaving after qualifying must NOT become absent');
  assert.equal(afterLeaving.qualificationReason, null);
  assert.equal(afterLeaving.trackingState, 'ended');
  assert.ok(afterLeaving.verifiedSeconds >= 60, 'the earned time is still shown');
});

test('a temporary pause is NOT an explicit checkout and does not finalize', async () => {
  // Losing location, going outside, or closing the tab must never be treated as
  // leaving. The record stays PENDING so the attendee can resume.
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);
  await checkIn(user, event, t0);
  const session = await start(user, event, t0);
  await update(user, session, new Date(t0.getTime() + 10_000));

  // Step well outside the fence: crediting stops, but nothing finalizes.
  const outside = await update(user, session, new Date(t0.getTime() + 20_000), 5_000);
  assert.equal(outside.state, 'paused');

  const paused = await row(event, student);
  assert.equal(paused.qualification, 'pending', 'a pause is not a checkout and not an absence');
  assert.equal(paused.qualificationReason, 'Required in-zone time has not been served yet.');
  assert.notEqual(paused.qualificationReason, 'Checked out before required attendance duration was met.');
});

test('an administrator override is never overwritten by the automatic rule', async () => {
  const { event, student } = await trackingEvent();
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);
  await checkIn(user, event, t0);
  const session = await start(user, event, t0);

  // An administrator qualifies the record by hand, exactly as the admin API does.
  const record = await row(event, student);
  await EventAttendance.updateOne({ _id: record._id }, {
    $set: {
      qualification: 'present',
      qualificationReason: 'Set by an administrator.',
      manualOverride: true,
      manualOverrideAt: new Date(),
    },
  });

  // The event ends without enough served time. The rule must not undo the human.
  await accrue(user, session, t0, 1);
  await finalizeExpiredSessions(new Date(event.endsAt.getTime() + 60_000));
  const preserved = await row(event, student);
  assert.equal(preserved.qualification, 'present', 'an override survives event-end finalization');
  assert.equal(preserved.qualificationReason, 'Set by an administrator.');
  assert.equal(preserved.manualOverride, true, 'the override stays visible and auditable');
});

test('an event with no duration requirement keeps its established behaviour', async () => {
  const { event, student } = await trackingEvent({ requiredAttendanceMinutes: null });
  const user = asUser(student);
  const t0 = new Date(Date.now() + 1_000);
  await checkIn(user, event, t0);

  const recorded = await row(event, student);
  assert.equal(recorded.qualification, null, 'no duration means no qualification axis at all');
  assert.equal(recorded.qualificationReason, null);
  assert.equal(recorded.requiredAttendanceMinutes, null);
  // The original status - the thing every existing report already reads - is
  // untouched, so established behaviour is preserved exactly.
  assert.equal(recorded.status, 'present');
});
