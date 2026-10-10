/**
 * EXPLICIT, APPROVAL-GATED ROLLOUT STEP for the indexes that a routine start is
 * forbidden from creating (see INDEX_CREATION_EXCLUDED_MODELS in config/database.js):
 *
 *   - `attendancesessions`  `unique_user_event_session`   (GST006 live tracking)
 *   - `attendancecodes`     `unique_active_code_per_event` (one live QR credential
 *                                                           per event)
 *
 * This is the ONLY thing that creates them. It is deliberately NOT wired into
 * `npm start`, because Mongoose would otherwise build them on the live database
 * the next time the normal backend is restarted.
 *
 * DO NOT RUN without: a fresh verified backup, and explicit approval to change
 * the live database. It creates indexes only; it never rewrites existing
 * documents, never backfills `requiredAttendanceMinutes` on events, and never
 * deletes data. In particular it uses `createIndexes()` and NEVER `syncIndexes()`,
 * because `syncIndexes()` DROPS indexes that are not in the schema - which would
 * remove a pre-existing unique index rather than reconcile it.
 *
 * Idempotent: running it twice is a no-op, and an index that already exists (for
 * example one created by an earlier rollout) is left exactly as it is.
 *
 * Usage:  npm run rollout:attendance-indexes -- --confirm
 */
import { connectDatabase, disconnectDatabase, INDEX_CREATION_EXCLUDED_MODELS } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { AttendanceCode, AttendanceSession } from '../src/models/index.js';

const confirmed = process.argv.includes('--confirm');
if (!confirmed) {
  console.error('Refusing to run: pass --confirm to acknowledge this changes the live database.');
  console.error(`Target: ${env.mongoUri}`);
  process.exit(1);
}

console.log(`Target database: ${env.mongoUri}`);
console.log('This will create any missing indexes on the approval-gated collections.');
console.log('No existing index is dropped and no document is modified.');

// Guard against a rollout script that drifts away from the exclusion list: if a
// model becomes approval-gated and is missing here, the operator would believe
// the rollout was complete when it was not.
const targets = { AttendanceSession, AttendanceCode };
for (const name of Object.keys(targets)) {
  if (!INDEX_CREATION_EXCLUDED_MODELS.includes(name)) {
    console.error(`Refusing to run: ${name} is no longer on INDEX_CREATION_EXCLUDED_MODELS.`);
    console.error('A normal start would build its indexes, so the rollout step is unnecessary for it.');
    process.exit(1);
  }
}
for (const name of INDEX_CREATION_EXCLUDED_MODELS) {
  if (!targets[name]) {
    console.error(`Refusing to run: ${name} is approval-gated but this script does not create its indexes.`);
    process.exit(1);
  }
}

await connectDatabase();
for (const [name, model] of Object.entries(targets)) {
  // createIndexes() (not init()) because autoCreate is disabled on connect.
  await model.createIndexes();
}
for (const name of Object.keys(targets)) {
  const indexes = await targets[name].collection.indexes();
  const documents = await targets[name].collection.countDocuments();
  console.log(`\nIndexes now present on ${targets[name].collection.collectionName}:`);
  for (const index of indexes) {
    console.log(`  ${index.name}  keys=${JSON.stringify(index.key)}  unique=${index.unique === true}`);
  }
  console.log(`  documents: ${documents}`);
  if (name === 'AttendanceCode') {
    console.log('  NOTE: any pre-existing unique index is preserved; nothing was dropped.');
  }
}
await disconnectDatabase();