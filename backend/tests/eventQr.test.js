/**
 * GST006 event QR credential lifecycle.
 *
 * Runs against the ISOLATED test database (helpers.js points MONGODB_URI at
 * university_attendance_test and drops it between tests), never the live one.
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { atVenue, createEvent, createUser, getModels, login, reset, send, setup, teardown } from './helpers.js';
import { __setQrIndexVerified, isQrIndexReady } from '../src/services/eventQrService.js';

before(async () => {
  await setup();
  // `setup` explicitly created the approval-gated indexes in this isolated
  // database, which is exactly what the approved rollout step does on a live
  // one. Declaring readiness here keeps the rest of the file about behaviour
  // rather than about the rollout gate.
  __setQrIndexVerified(true);
});
after(teardown);
beforeEach(reset);

const QR_PREFIX = 'COT-EVENT';
const minutes = (value) => value * 60 * 1_000;

/** An event whose whole check-in window is a week away. */
async function futureEvent(organizerUser, overrides = {}) {
  const now = Date.now();
  const day = 60 * 24 * 7;
  return createEvent(organizerUser, {
    startsAt: new Date(now + minutes(day)),
    endsAt: new Date(now + minutes(day + 120)),
    checkInOpensAt: new Date(now + minutes(day - 30)),
    checkInClosesAt: new Date(now + minutes(day + 120)),
    lateCutoff: new Date(now + minutes(day + 15)),
    ...overrides,
  });
}

/**
 * An event owned by the given account.
 *
 * The organizer id must be the real User ObjectId, so this reads the created
 * user rather than taking a string: `Event.organizerId` is a ref, and passing a
 * username fails the cast before any QR rule is even reached.
 */
async function eventOwnedBy(created) {
  return createEvent(created.user);
}

test('an administrator can issue and re-read the code without rotating it', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  const event = await eventOwnedBy(admin);
  const { agent } = await login('ADM001');

  const first = await send(agent, 'get', `/api/admin/events/${event._id}/qr/`);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.match(first.body.token, new RegExp(`^${QR_PREFIX}:[0-9a-f-]{36}:`));

  // Re-reading returns the SAME token: viewing is not a rotation.
  const second = await send(agent, 'get', `/api/admin/events/${event._id}/qr/`);
  assert.equal(second.status, 200);
  assert.equal(second.body.token, first.body.token, 'viewing must not rotate the code');
  assert.equal(second.body.created, false);

  // Exactly one credential: a single-active-code guarantee, not merely an
  // idempotent write path.
  assert.equal(await getModels().AttendanceCode.countDocuments({ eventId: event._id, active: true }), 1);
});

test('the credential is recoverable, and the status view never leaks it', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  const event = await eventOwnedBy(admin);
  const { agent } = await login('ADM001');
  const issued = await send(agent, 'get', `/api/admin/events/${event._id}/qr/`);
  assert.equal(issued.status, 200);

  const record = await getModels().AttendanceCode.findOne({ eventId: event._id, active: true }).lean();
  const secret = issued.body.token.split(':')[2];

  // A hash alone cannot recover the token; the encrypted copy can, which is the
  // whole reason retrieval still works after a refresh.
  assert.notEqual(record.tokenHash, secret);
  assert.match(record.tokenHash, /^[0-9a-f]{64}$/);
  const { decryptSecret } = await import('../src/utils/secretBox.js');
  assert.equal(decryptSecret(record.tokenEncrypted), secret);

  const status = await send(agent, 'get', `/api/admin/events/${event._id}/qr/status/`);
  assert.equal(status.status, 200);
  assert.equal(JSON.stringify(status.body).includes(secret), false, 'status must not leak the token');
});

test('regeneration is explicit and invalidates the previous code', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  const event = await eventOwnedBy(admin);
  const { agent } = await login('ADM001');
  const first = await send(agent, 'get', `/api/admin/events/${event._id}/qr/`);

  const rotated = await send(agent, 'post', `/api/admin/events/${event._id}/qr/`);
  assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
  assert.notEqual(rotated.body.token, first.body.token, 'an explicit POST must replace the code');
  assert.equal(rotated.body.rotated, true);
  assert.equal(await getModels().AttendanceCode.countDocuments({ eventId: event._id, active: true }), 1);

  await createUser({ username: 'STU001', role: 'student' });
  const { agent: student } = await login('STU001');
  const scan = await send(student, 'post', '/api/attendance/scan/', {
    token: first.body.token, method: 'qr', location: atVenue(),
  });
  assert.equal(scan.status, 400, 'a rotated code must be refused');
});

test('a code can be issued before check-in opens, but scans are still refused', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  const event = await futureEvent(admin.user);
  const { agent } = await login('ADM001');

  const issued = await send(agent, 'get', `/api/admin/events/${event._id}/qr/`);
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  assert.equal(issued.body.usability, 'not_yet_open');

  await createUser({ username: 'STU001', role: 'student' });
  const { agent: student } = await login('STU001');
  const scan = await send(student, 'post', '/api/attendance/scan/', {
    token: issued.body.token, method: 'qr', location: atVenue(),
  });
  assert.equal(scan.status, 400, 'a scan before the window opens must be refused');
  assert.match(JSON.stringify(scan.body), /check-in window is closed/i);
});

test('a future event code cannot expire before its own event', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  const event = await futureEvent(admin.user);
  const { agent } = await login('ADM001');
  const issued = await send(agent, 'get', `/api/admin/events/${event._id}/qr/`);
  assert.equal(issued.status, 200);

  // Expiry is the end of THIS event's window, not "an hour from now".
  assert.equal(new Date(issued.body.expiresAt).getTime(), new Date(event.checkInClosesAt).getTime());
  assert.ok(new Date(issued.body.expiresAt).getTime() > Date.now() + minutes(60 * 24 * 7));
});

test('creating a QR event issues its code; a non-QR event issues none', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const { agent } = await login('ADM001');
  const day = new Date(Date.now() + minutes(60 * 24)).toISOString().slice(0, 10);

  const created = await send(agent, 'post', '/api/admin/events/', {
    name: 'Orientation', description: 'New students', date: day,
    start: '09:00', end: '12:00', cutoff: '09:15', venue: 'Hall A',
    audience: 'all', method: 'qr', status: 'published', requiredForAttendance: true,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.qr.ok, true, JSON.stringify(created.body.qr));
  assert.match(created.body.qr.qr.token, new RegExp(`^${QR_PREFIX}:`));

  const barcode = await send(agent, 'post', '/api/admin/events/', {
    name: 'Manual roll call', description: 'No QR', date: day,
    start: '09:00', end: '12:00', cutoff: '09:15', venue: 'Hall B',
    audience: 'all', method: 'barcode', status: 'published', requiredForAttendance: false,
  });
  assert.equal(barcode.status, 201, JSON.stringify(barcode.body));
  assert.equal(barcode.body.qr.ok, false);
  assert.equal(await getModels().AttendanceCode.countDocuments({ eventId: barcode.body.id }), 0);
});

test('faculty may manage only assigned events; a student may manage none', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const owner = await createUser({ username: 'FAC001', role: 'faculty' });
  await createUser({ username: 'FAC002', role: 'faculty' });
  await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(owner.user);

  const assigned = await login('FAC001');
  assert.equal((await send(assigned.agent, 'get', `/api/events/${event._id}/check-in-code/`)).status, 200);

  const outsider = await login('FAC002');
  const refused = await send(outsider.agent, 'get', `/api/events/${event._id}/check-in-code/`);
  assert.equal(refused.status, 400, 'an unassigned faculty member must be refused');

  const learner = await login('STU001');
  assert.equal((await send(learner.agent, 'get', `/api/events/${event._id}/check-in-code/`)).status, 403);
  assert.equal((await send(learner.agent, 'post', `/api/events/${event._id}/check-in-code/`)).status, 403);
});

test('an administrator manages a code for an event they do not organize', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const organizerUser = await createUser({ username: 'FAC001', role: 'faculty' });
  const event = await createEvent(organizerUser.user);
  const { agent } = await login('ADM001');
  assert.equal((await send(agent, 'get', `/api/admin/events/${event._id}/qr/`)).status, 200);
});

test('an unknown event status is refused rather than silently published', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const { agent } = await login('ADM001');
  const day = new Date(Date.now() + minutes(60 * 24)).toISOString().slice(0, 10);
  const response = await send(agent, 'post', '/api/admin/events/', {
    name: 'Unapproved', description: 'Should never go live', date: day,
    start: '09:00', end: '12:00', cutoff: '09:15', venue: 'Hall C',
    audience: 'all', method: 'qr', status: 'pending', requiredForAttendance: false,
  });
  // There is no stored pending/proposal state, so it is rejected outright rather
  // than quietly becoming a published event.
  assert.equal(response.status, 400, JSON.stringify(response.body));
  assert.equal(await getModels().Event.countDocuments({ name: 'Unapproved' }), 0);
});

test('concurrent issuance converges on exactly one credential', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  const event = await eventOwnedBy(admin);
  const { agent } = await login('ADM001');

  const results = await Promise.all(
    Array.from({ length: 5 }, () => send(agent, 'get', `/api/admin/events/${event._id}/qr/`)),
  );
  for (const result of results) assert.equal(result.status, 200, JSON.stringify(result.body));

  const tokens = new Set(results.map((result) => result.body.token));
  assert.equal(tokens.size, 1, 'concurrent issuance must converge on one token');
  assert.equal(await getModels().AttendanceCode.countDocuments({ eventId: event._id, active: true }), 1);
});

/*
 * CREDENTIAL ENFORCEMENT - direct API regression tests.
 *
 * Written after a real defect was found by the browser suite: a QR event could
 * be checked into by sending `{ eventId, identifier, method: 'qr' }` with NO
 * credential, because the token lookup only ran when a token was present. These
 * are asserted at the API boundary so the rule stays pinned even if the UI
 * changes.
 */
test('a QR event refuses an event-id-only request with no credential', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(admin.user);
  const { agent } = await login('STU001');

  const response = await send(agent, 'post', '/api/attendance/scan/', {
    eventId: event._id,
    identifier: 'anything at all',
    method: 'qr',
    location: atVenue(),
  });
  assert.equal(response.status, 400, JSON.stringify(response.body));
  assert.match(response.body.detail, /QR code is required/i);
  assert.equal(
    await getModels().EventAttendance.countDocuments({ eventId: event._id }),
    0,
    'no attendance may be written without a credential',
  );
});

test('changing the requested method cannot be used to skip QR validation', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(admin.user);
  const { agent } = await login('STU001');

  // The event is a QR event. Asking for it as barcode/rfid, and supplying the
  // attendee's OWN card value so the ownership check would pass, must still not
  // check in: the method must match the event, and the event demands a code.
  for (const method of ['barcode', 'rfid']) {
    const response = await send(agent, 'post', '/api/attendance/scan/', {
      eventId: event._id,
      identifier: 'STU001',
      method,
      location: atVenue(),
    });
    assert.equal(response.status, 400, `${method} must be refused for a QR event`);
    assert.match(JSON.stringify(response.body), /scan method is not enabled|QR code is required/i);
  }
  assert.equal(await getModels().EventAttendance.countDocuments({ eventId: event._id }), 0);
});

test('an arbitrary string cannot stand in for a QR credential', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(admin.user);
  const { agent } = await login('STU001');

  // No token, and only an event id: refused.
  assert.equal((await send(agent, 'post', '/api/attendance/scan/', {
    eventId: event._id, identifier: 'not-a-qr-code', method: 'qr', location: atVenue(),
  })).status, 400);

  // Shaped like a credential but signed with the wrong secret: refused by the
  // hash lookup, which is unchanged.
  const forged = await send(agent, 'post', '/api/attendance/scan/', {
    token: `${QR_PREFIX}:${event._id}:${'A'.repeat(43)}`,
    method: 'qr',
    location: atVenue(),
  });
  assert.equal(forged.status, 400, JSON.stringify(forged.body));
  assert.match(forged.body.scan, /invalid or expired/i);

  assert.equal(await getModels().EventAttendance.countDocuments({ eventId: event._id }), 0);
});
test('a valid QR credential still works, and a rotated one stops working', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(admin.user);
  const adminSession = await login('ADM001');

  const issued = await send(adminSession.agent, 'get', `/api/admin/events/${event._id}/qr/`);
  assert.equal(issued.status, 200);
  const first = issued.body.token;

  const student = await login('STU001');
  const ok = await send(student.agent, 'post', '/api/attendance/scan/', {
    token: first, method: 'qr', location: atVenue(),
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  // Rotation replaces the credential; the old one must stop working.
  const rotated = await send(adminSession.agent, 'post', `/api/admin/events/${event._id}/qr/`);
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.body.token, first);

  await createUser({ username: 'STU002', role: 'student' });
  const second = await login('STU002');
  const stale = await send(second.agent, 'post', '/api/attendance/scan/', {
    token: first, method: 'qr', location: atVenue(),
  });
  assert.equal(stale.status, 400, 'a revoked credential must be refused');
  assert.match(stale.body.scan, /invalid or expired/i);
});

test('a non-QR event still checks in by the attendee own identifier', async () => {
  const admin = await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student', card: 'RFID-STU001' });
  const event = await createEvent(admin.user, { attendanceMethod: 'rfid' });
  const { agent } = await login('STU001');

  // Legitimate identifier method: still works, so the QR hardening did not
  // break the non-QR path.
  const mine = await send(agent, 'post', '/api/attendance/scan/', {
    eventId: event._id, identifier: 'RFID-STU001', method: 'rfid', location: atVenue(),
  });
  assert.equal(mine.status, 201, JSON.stringify(mine.body));

  // And it still refuses somebody else's identifier.
  const stranger = await send(agent, 'post', '/api/attendance/scan/', {
    eventId: event._id, identifier: 'RFID-SOMEONE-ELSE', method: 'rfid', location: atVenue(),
  });
  assert.equal(stranger.status, 403, 'an identifier belonging to someone else must be refused');
});

test('QR issuance is refused while the approval-gated index is missing', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const owner = await createUser({ username: 'FAC001', role: 'faculty' });
  const event = await createEvent(owner.user);
  const admin = await login('ADM001');

  // The gate is proven by the REAL index check, so the index is dropped rather
  // than a flag being flipped.
  assert.equal(await isQrIndexReady(), true, 'the suite initialises the index explicitly');
  await getModels().AttendanceCode.collection.dropIndex('unique_active_code_per_event');
  __setQrIndexVerified(false);
  try {
    assert.equal(await isQrIndexReady(), false);
    const refused = await send(admin.agent, 'get', `/api/admin/events/${event._id}/qr/`);
    assert.equal(refused.status, 503, JSON.stringify(refused.body));
    assert.match(refused.body.detail, /not enabled on this server/i);

    const rotate = await send(admin.agent, 'post', `/api/admin/events/${event._id}/qr/`);
    assert.equal(rotate.status, 503, 'rotation must be gated too');
  } finally {
    // Put the environment back the way the approved rollout step would. The
    // rollout must be able to RESTORE the index without dropping anything.
    await getModels().AttendanceCode.createIndexes();
    assert.equal(await isQrIndexReady(), true, 're-running the rollout must restore it');
    __setQrIndexVerified(true);
  }
});