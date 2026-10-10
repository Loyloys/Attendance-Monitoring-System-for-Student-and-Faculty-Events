/**
 * ONE-TIME BACKFILL: give `requiredForAttendance` the value the percentage
 * feature has actually been using.
 *
 * WHY. `requiredForAttendance` had no field of its own: the administrator write
 * contract wrote the "Required for percentage" checkbox straight into
 * `registrationRequired`, and the read contract published `registrationRequired`
 * back under the name `requiredForAttendance`. The percentage in User
 * management has therefore been driven by `registrationRequired` all along.
 * Now that the two fields are separate, an event that predates the change has no
 * `requiredForAttendance` value and would read as `false`, silently changing
 * every existing percentage.
 *
 * Copying the current `registrationRequired` into `requiredForAttendance` makes
 * the new field start from exactly the number the screen already shows. It does
 * NOT touch `registrationRequired`, `registrationDeadline`, registrations,
 * attendance or any other field. It is IDEMPOTENT: only events without the field
 * are matched, so a second run reports nothing to do.
 *
 * IT IS SAFE TO RUN AND SAFE TO SKIP. Skipped, existing percentages drop to 0
 * until an administrator re-ticks the box - visible and correctable, but a
 * change. Run, they are preserved exactly.
 *
 * ISOLATION. Refuses any database that is not a test database, and the live
 * MongoDB port, BEFORE connecting. Applying it to the live instance is a
 * separate, deliberate, reviewed operation - this script will refuse to do it.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { Event } from '../src/models/index.js';
import { assertIsolatedTestDatabase } from './support/testDatabaseTarget.js';

const { database } = assertIsolatedTestDatabase(env.mongoUri, 'backfill the percentage flag');
console.log(`Target test database: ${database}`);
await connectDatabase();

// `{ $exists: false }` is what makes this idempotent AND safe after a partial run.
const pending = await Event.find({ requiredForAttendance: { $exists: false } })
  .select('_id name registrationRequired').lean();
console.log(`events without the field: ${pending.length}`);

if (pending.length === 0) {
  console.log('Nothing to backfill.');
} else {
  // An AGGREGATION PIPELINE update, not a plain `$set` document. `$ifNull` is an
  // aggregation expression: written as a plain update it would be stored as a
  // literal nested object instead of a boolean, and every event would end up with
  // a broken value.
  const result = await Event.updateMany(
    { requiredForAttendance: { $exists: false } },
    [{ $set: { requiredForAttendance: { $ifNull: ['$registrationRequired', false] } } }],
  );
  console.log(`backfilled ${result.modifiedCount} event(s)`);
  for (const event of pending.slice(0, 20)) {
    console.log(`   "${event.name}": registrationRequired=${Boolean(event.registrationRequired)} -> requiredForAttendance=${Boolean(event.registrationRequired)}`);
  }
  if (pending.length > 20) console.log(`   ...and ${pending.length - 20} more`);
}

const all = await Event.find({}).select('name registrationRequired requiredForAttendance').lean();
const differing = all.filter((e) => Boolean(e.requiredForAttendance) !== Boolean(e.registrationRequired));
console.log(`post-check: ${differing.length} event(s) where the two flags differ (expected only where an administrator has since set them apart).`);
for (const e of differing.slice(0, 10)) console.log(`   "${e.name}" registrationRequired=${Boolean(e.registrationRequired)} requiredForAttendance=${Boolean(e.requiredForAttendance)}`);

await disconnectDatabase();
