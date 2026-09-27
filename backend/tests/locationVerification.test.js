// GST004 - location verification before QR attendance.
//
// These tests drive the real HTTP endpoint against the real geofence logic. No
// stub is used, so they prove the server actually refuses a scan rather than
// trusting anything the browser sends.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { atVenue, createEvent, createUser, getModels, login, reset, send, setup, teardown, VENUE } from './helpers.js';

before(setup);
after(teardown);
beforeEach(reset);

/** Creates a faculty organizer, a student, a geofenced event, and a live code. */
async function scenario(overrides = {}) {
  const faculty = await createUser({ username: 'FAC001', role: 'faculty' });
  const student = await createUser({ username: 'STU001', role: 'student' });
  const event = await createEvent(faculty.user, overrides);
  const { agent: facultyAgent } = await login('FAC001');
  const code = await send(facultyAgent, 'post', `/api/events/${event._id}/check-in-code/`);
  assert.equal(code.status, 200);
  const { agent: studentAgent } = await login('STU001');
  return { event, student, code: code.body.token, studentAgent };
}

const scanWith = (agent, token, location) =>
  send(agent, 'post', '/api/attendance/scan/', { token, method: 'qr', location });

test('a scan inside the venue fence is recorded and stores the location fix', async () => {
  const { event, student, code, studentAgent } = await scenario();

  const response = await scanWith(studentAgent, code, atVenue());
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.locationVerified, true);

  // The fix is associated with that specific scan, so it can be audited later.
  const record = await getModels().EventAttendance.findOne({ eventId: event._id, attendeeId: student.user._id }).lean();
  assert.equal(record.locationLatitude, VENUE.latitude);
  assert.equal(record.locationLongitude, VENUE.longitude);
  assert.equal(record.locationAccuracyMeters, 12);
  assert.ok(record.locationCapturedAt instanceof Date);
});

test('a scan outside the fence is refused and records no attendance', async () => {
  const { event, student, code, studentAgent } = await scenario();

  // ~11 km away: far outside a 150 m venue.
  const response = await scanWith(studentAgent, code, atVenue({ latitude: 14.7 }));
  assert.equal(response.status, 400, JSON.stringify(response.body));
  assert.match(response.body.location, /outside the 150 m check-in zone/);

  // The critical guarantee: a refused scan leaves nothing behind.
  assert.equal(await getModels().EventAttendance.countDocuments({ eventId: event._id, attendeeId: student.user._id }), 0);
});

test('a missing or denied location is refused with an actionable message', async () => {
  const { event, student, code, studentAgent } = await scenario();

  const missing = await scanWith(studentAgent, code, undefined);
  assert.equal(missing.status, 400);
  assert.match(missing.body.location, /Turn on location services/);
  assert.equal(await getModels().EventAttendance.countDocuments({ eventId: event._id, attendeeId: student.user._id }), 0);
});

test('a stale or low-accuracy fix is refused', async () => {
  const { event, student, code, studentAgent } = await scenario();

  const stale = await scanWith(studentAgent, code, atVenue({ capturedAt: new Date(Date.now() - 15 * 60_000).toISOString() }));
  assert.equal(stale.status, 400);
  assert.match(stale.body.location, /too old/);

  const inaccurate = await scanWith(studentAgent, code, atVenue({ accuracy: 2_000 }));
  assert.equal(inaccurate.status, 400);
  assert.match(inaccurate.body.location, /not precise enough/);

  assert.equal(await getModels().EventAttendance.countDocuments({ eventId: event._id, attendeeId: student.user._id }), 0);
});

test('an event without a geofence reports missing configuration instead of accepting', async () => {
  // Explicitly no venue coordinates: this is a configuration fault and must be
  // named, not silently treated as "no restriction".
  const { event, student, code, studentAgent } = await scenario({
    venueLatitude: null,
    venueLongitude: null,
    venueRadiusMeters: null,
  });

  const response = await scanWith(studentAgent, code, atVenue());
  assert.equal(response.status, 400, JSON.stringify(response.body));
  assert.match(response.body.location, /no verified venue location configured/);
  assert.equal(await getModels().EventAttendance.countDocuments({ eventId: event._id, attendeeId: student.user._id }), 0);
});

test('an out-of-range coordinate is refused rather than trusted', async () => {
  const { code, studentAgent } = await scenario();
  const response = await scanWith(studentAgent, code, atVenue({ latitude: 999 }));
  assert.equal(response.status, 400);
  assert.match(response.body.location, /invalid location/i);
});

test('registration is still enforced before location is considered', async () => {
  // Guards the ordering: an unregistered student must be told to register, not
  // told their location is wrong.
  const { code, studentAgent } = await scenario({ registrationRequired: true });
  const response = await scanWith(studentAgent, code, atVenue());
  assert.equal(response.status, 400, JSON.stringify(response.body));
  assert.match(response.body.registration, /Register for this event/);
});

test('an administrator can set a geofence and a half-configured one is rejected', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  const { agent } = await login('ADM001');
  const base = {
    name: 'Geofenced Orientation',
    date: '2026-03-01',
    start: '08:00',
    end: '10:00',
    cutoff: '08:30',
    venue: 'Innovation Hall',
    audience: 'all',
    method: 'qr',
    status: 'published',
    requiredForAttendance: false,
  };

  const created = await send(agent, 'post', '/api/admin/events/', {
    ...base, venueLatitude: 14.5995, venueLongitude: 120.9842, venueRadiusMeters: 150,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const stored = await getModels().Event.findById(created.body.id).lean();
  assert.equal(stored.venueRadiusMeters, 150);

  // A radius with no centre would disable verification by accident, so it is refused.
  const partial = await send(agent, 'post', '/api/admin/events/', { ...base, venueRadiusMeters: 150 });
  assert.equal(partial.status, 400, JSON.stringify(partial.body));
  assert.match(partial.body.venue, /latitude, longitude and radius together/);

  const badRadius = await send(agent, 'post', '/api/admin/events/', {
    ...base, venueLatitude: 14.5995, venueLongitude: 120.9842, venueRadiusMeters: 0,
  });
  assert.equal(badRadius.status, 400);
});

