/**
 * Applies the operator-confirmed test venue to the ISOLATED test event.
 *
 * ISOLATION IS ENFORCED, NOT ASSUMED. This refuses to write unless the database
 * name marks it as a test database, using the SAME rule as the other seed
 * scripts, so it can never touch the live `university_attendance` database.
 *
 * WHY THIS EXISTS RATHER THAN scripts/seed-tracking-test-event.js
 * That script cannot run: it omits `organizerId`, which the Event model requires,
 * so it always fails validation and creates nothing. Fixing it is a code change
 * outside the scope of "apply the confirmed venue to the test event", so this
 * writes the event directly instead - same field set, plus the organizer the
 * model demands. Nothing in the repository is modified by running it.
 *
 * Usage:
 *   MONGODB_URI=mongodb://127.0.0.1:27019/university_attendance_e2e_test \
 *   TEST_VENUE_LATITUDE=7.71647 TEST_VENUE_LONGITUDE=125.09301 \
 *     node scripts/apply-test-venue.mjs
 */
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';

const uri = process.env.MONGODB_URI || '';
// Hard isolation guard, BEFORE the client connects: name AND port. A name-only
// rule would accept `mongodb://127.0.0.1:27017/university_attendance_e2e_test`,
// which satisfies every name test while still pointing at the LIVE mongod.
const { database: databaseName } = (() => {
  try {
    return assertIsolatedTestDatabase(uri, 'write');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();

const MARKER = 'GST006-TRACKING-TEST';
const lat = Number(process.env.TEST_VENUE_LATITUDE);
const lon = Number(process.env.TEST_VENUE_LONGITUDE);
const radius = Number(process.env.TEST_VENUE_RADIUS_METERS || 150);
const requiredMinutes = Number(process.env.TEST_REQUIRED_MINUTES || 2);
const venueName = process.env.TEST_VENUE_NAME || 'Confirmed test venue';

if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
  console.error('Refusing to write: no valid confirmed venue coordinates.');
  process.exit(1);
}

const minutesFromNow = (n) => new Date(Date.now() + n * 60_000);
const client = new MongoClient(uri);
await client.connect();
const db = client.db();

const organizer = await db.collection('users').findOne({ accountId: process.env.TEST_ORGANIZER || 'E2E_FAC001' });
if (!organizer) {
  console.error('Refusing to write: organizer account not found in this database.');
  await client.close();
  process.exit(1);
}

const existing = await db.collection('events').findOne({ name: MARKER });

const payload = {
  description: 'Isolated test event for live attendance tracking. Not a real event.',
  startsAt: minutesFromNow(-5),
  endsAt: minutesFromNow(120),
  checkInOpensAt: minutesFromNow(-5),
  checkInClosesAt: minutesFromNow(120),
  lateCutoff: minutesFromNow(10),
  venue: `${venueName} (isolated test)`,
  organizerId: organizer._id,
  supervisors: [organizer._id],
  audience: 'all',
  status: 'published',
  registrationRequired: false,
  attendanceMethod: 'qr',
  venueLatitude: lat,
  venueLongitude: lon,
  venueRadiusMeters: radius,
  locationVerificationRequired: true,
  requiredAttendanceMinutes: requiredMinutes,
  dataSource: 'managed',
};

// WHY createdAt IS BACKFILLED RATHER THAN ALWAYS OVERWRITTEN.
// `createdAt` is a MODEL DEFAULT (`createdAt: { default: Date.now }`) and a
// Mongoose default is applied by Mongoose - never by the raw driver. Writing
// this document with `insertOne` therefore omits it, producing a record the
// application itself cannot create. That is not cosmetic: the admin serializer
// formats `createdAt` with `toISOString()`, and an absent one throws
// `RangeError: Invalid time value`, which fails the ENTIRE admin workspace
// (every screen loads one list) and leaves the bad event invisible and
// unfixable from the UI. Any script writing around the model must supply the
// model's defaults.
//
// It is a BACKFILL, so `$set` never slides an existing creation time forward on
// a re-run. `createdAt` records when the event was created; that must stay true
// even though the script deliberately REFRESHES the time windows on each run
// (that is what makes a re-run hours later still meaningful).
const needsCreatedAt = !existing?.createdAt;
if (needsCreatedAt) payload.createdAt = new Date();

// The Event model declares `_id: { type: String, default: () => crypto.randomUUID() }`.
// A raw insertOne that omits `_id` lets MongoDB assign an ObjectId instead, which
// Mongoose then cannot cast back to a String UUID - so EVERY event-scoped route
// (`/api/events/:id/...`, `/api/admin/events/:id/qr/...`) answers "Event not
// found" even though the document exists. The id is therefore supplied explicitly
// here, matching the model. An existing event whose `_id` is an ObjectId is
// re-created with a UUID rather than updated in place, because MongoDB cannot
// rename `_id`; that is only safe because nothing references the marker event yet.
const malformed = existing && typeof existing._id !== 'string';
if (malformed) {
  const dependents = await db.collection('attendancecodes').countDocuments({ eventId: String(existing._id) })
    + await db.collection('attendancesessions').countDocuments({ eventId: String(existing._id) })
    + await db.collection('eventregistrations').countDocuments({ eventId: String(existing._id) })
    + await db.collection('eventattendance').countDocuments({ eventId: String(existing._id) })
    + await db.collection('feedback').countDocuments({ eventId: String(existing._id) });
  if (dependents > 0) {
    console.error(`Refusing to re-key: ${dependents} document(s) reference the malformed event.`);
    await client.close();
    process.exit(1);
  }
  await db.collection('events').deleteOne({ _id: existing._id });
  console.log('Replaced a malformed event whose _id was an ObjectId.');
}

const result = existing && !malformed
  ? await db.collection('events').updateOne({ _id: existing._id }, { $set: payload })
  : await db.collection('events').insertOne({ _id: randomUUID(), name: MARKER, ...payload });

console.log(existing ? 'Updated existing tracking test event.' : 'Created tracking test event.');
console.log(`  database          : ${databaseName}`);
console.log(`  name              : ${MARKER}`);
console.log(`  venue             : ${venueName} (isolated test)`);
console.log(`  latitude          : ${lat}`);
console.log(`  longitude         : ${lon}`);
console.log(`  radius            : ${radius} m`);
console.log(`  required minutes  : ${requiredMinutes}`);
console.log(`  organizer         : ${process.env.TEST_ORGANIZER || 'E2E_FAC001'}`);
await client.close();
