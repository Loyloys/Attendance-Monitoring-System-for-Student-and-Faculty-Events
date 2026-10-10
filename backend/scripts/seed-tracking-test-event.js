/**
 * Creates a clearly labelled GST006 test event WITH a configured required
 * duration, so the tracking feature can actually be exercised end to end.
 *
 * ISOLATION: this script refuses to run unless it is pointed at a database whose
 * name marks it as a test database AND which is not on the live MongoDB port.
 * It is a hard guard, not a warning, so it can never seed the live
 * `university_attendance` database by accident.
 *
 * Usage:
 *   TEST_MONGODB_URI=mongodb://127.0.0.1:27022/university_attendance_test \
 *     node scripts/seed-tracking-test-event.js
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { AttendanceSession, Event } from '../src/models/index.js';
import { assertIsolatedTestDatabase } from './support/testDatabaseTarget.js';

// Test venue is CONFIGURABLE and must be confirmed by the operator. Nothing is
// assumed: if no coordinates are supplied the script refuses to write, so a
// placeholder venue can never silently become the thing you test against.
const lat = Number(process.env.TEST_VENUE_LATITUDE);
const lon = Number(process.env.TEST_VENUE_LONGITUDE);
const radius = Number(process.env.TEST_VENUE_RADIUS_METERS || 150);
const requiredMinutes = Number(process.env.TEST_REQUIRED_MINUTES || 20);
const venueName = process.env.TEST_VENUE_NAME || '';

if (!Number.isFinite(lat) || !Number.isFinite(lon) || !venueName) {
  console.error('Refusing to seed: no confirmed test location.');
  console.error('Set these first:');
  console.error('  TEST_VENUE_NAME          e.g. the building you will stand in');
  console.error('  TEST_VENUE_LATITUDE       e.g. 14.5995');
  console.error('  TEST_VENUE_LONGITUDE      e.g. 120.9842');
  console.error('  TEST_VENUE_RADIUS_METERS  optional, default 150');
  console.error('  TEST_REQUIRED_MINUTES     optional, default 20');
  process.exit(1);
}
if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
  console.error('Refusing to seed: coordinates are out of range.');
  process.exit(1);
}

const VENUE = { latitude: lat, longitude: lon };
console.log(`Confirmed test venue: ${venueName} @ ${lat},${lon} (radius ${radius} m)`);
console.log(`Required duration   : ${requiredMinutes} minutes`);
console.log(`\nTarget (isolated test database): ${env.mongoUri}`);

// Hard isolation guard, BEFORE any connection: name AND port.
const { database: databaseName } = (() => {
  try {
    return assertIsolatedTestDatabase(env.mongoUri, 'seed');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();
console.log(`Target (isolated test database): ${env.mongoUri}`);

await connectDatabase();

const minutesFromNow = (n) => new Date(Date.now() + n * 60_000);

// Upsert by a stable marker so repeated runs update rather than duplicate.
const MARKER = 'GST006-TRACKING-TEST';
const existing = await Event.findOne({ name: MARKER });

const payload = {
  name: MARKER,
  description: 'Isolated test event for live attendance tracking. Not a real event.',
  startsAt: minutesFromNow(-5),
  endsAt: minutesFromNow(120),
  checkInOpensAt: minutesFromNow(-5),
  checkInClosesAt: minutesFromNow(120),
  lateCutoff: minutesFromNow(10),
  venue: `${venueName} (isolated test)`,
  audience: 'all',
  status: 'published',
  registrationRequired: false,
  attendanceMethod: 'qr',
  venueLatitude: VENUE.latitude,
  venueLongitude: VENUE.longitude,
  venueRadiusMeters: radius,
  locationVerificationRequired: true,
  // The Administrator-configured requirement this feature depends on.
  requiredAttendanceMinutes: requiredMinutes,
};

const event = existing
  ? await Event.findByIdAndUpdate(existing._id, { $set: payload }, { new: true })
  : await Event.create(payload);

console.log(`\nEvent ready: ${event.name}`);
console.log(`  id                  : ${event._id}`);
console.log(`  venue               : ${event.venue} @ ${VENUE.latitude},${VENUE.longitude}`);
console.log(`  radius              : ${event.venueRadiusMeters} m`);
console.log(`  required minutes    : ${event.requiredAttendanceMinutes}`);
console.log(`  check-in window open: ${event.checkInOpensAt.toISOString()}`);
console.log(`  event ends          : ${event.endsAt.toISOString()}`);
console.log(`  tracking sessions   : ${await AttendanceSession.countDocuments({ eventId: event._id })}`);

console.log('\nTo scan, open this event and generate its QR as the assigned organizer.');
await disconnectDatabase();