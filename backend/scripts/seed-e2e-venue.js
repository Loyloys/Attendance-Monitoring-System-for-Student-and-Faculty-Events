/**
 * Adds the isolated instance's saved venue.
 *
 * ISOLATION IS ENFORCED, NOT ASSUMED. Like the other fixture scripts, this
 * refuses to run unless the database name marks it as a test database, so it can
 * never write a venue into the live `university_attendance` database.
 *
 * IDEMPOTENT BY NAME. It upserts on the exact venue name, so re-running updates
 * the one record instead of accumulating duplicates - which is the point of a
 * saved venue: a reusable template, not one row per run.
 *
 * THE COORDINATES ARE APPROXIMATE AND SAY SO. The note travels with the record
 * and is shown wherever the venue is offered, so nobody can read a campus-area
 * point as a surveyed gym, building or room location.
 *
 * This writes ONE venue. It does not touch any event, so no existing event's
 * check-in zone is affected by running it.
 *
 * Usage:
 *   MONGODB_URI=mongodb://127.0.0.1:27019/university_attendance_e2e_test \
 *     node scripts/seed-e2e-venue.js
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { Venue } from '../src/models/index.js';

import { assertIsolatedTestDatabase } from './support/testDatabaseTarget.js';

const { database: databaseName } = (() => {
  try {
    return assertIsolatedTestDatabase(env.mongoUri, 'seed');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();

const VENUE_NAME = 'BukSU Main Campus — campus-area test';
const values = {
  name: VENUE_NAME,
  note: 'Approximate campus-level coordinates for automated testing. Not a surveyed gym, building or room location.',
  latitude: 8.15629,
  longitude: 125.12395,
  radiusMeters: 150,
  // A DEFAULT SUGGESTION only. The event form may change it per event before
  // saving, and editing this venue never touches an existing event.
  defaultRequiredAttendanceMinutes: 2,
  // Marks the record as belonging to the isolated instance.
  isolatedTestRecord: true,
};

await connectDatabase();

const existing = await Venue.findOne({ name: VENUE_NAME });
const venue = existing
  ? await Venue.findOneAndUpdate({ _id: existing._id }, { $set: values }, { new: true }).lean()
  : await Venue.create(values).then((created) => created.toObject());

console.log(`Saved venue ready in "${databaseName}" (${existing ? 'updated' : 'created'}):`);
console.log(`  id       ${venue._id}`);
console.log(`  name     ${venue.name}`);
console.log(`  lat/lon  ${venue.latitude}, ${venue.longitude}`);
console.log(`  radius   ${venue.radiusMeters} m`);
console.log(`  default  ${venue.defaultRequiredAttendanceMinutes} min (a suggestion; per-event editable)`);
console.log(`  note     ${venue.note}`);

await disconnectDatabase();
