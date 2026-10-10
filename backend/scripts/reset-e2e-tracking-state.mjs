/**
 * Removes SPECIFIC tracking sessions that a browser run left behind.
 *
 * WHY THIS EXISTS AT ALL. Checking out is not clearing. `checkoutTrackingSession`
 * sets a session to COMPLETED, and `startTrackingSession` then refuses outright
 * for a completed session ("Your attendance session for this event has already
 * finished and cannot be restarted"). So the harness cannot recover a clean
 * slate through the API, and the attendance policy is deliberately left alone -
 * a completed session stays completed, because that is a real rule about real
 * attendance.
 *
 * The fix for the SUITE is that each scanning spec owns a freshly provisioned
 * event, so there is no prior session to collide with. This script exists only
 * to tidy up sessions that earlier runs genuinely orphaned, by explicit id.
 *
 * ISOLATION IS ENFORCED, NOT ASSUMED. Two hard guards, both fatal:
 *   1. the database name must mark it as a test database, and the live database
 *      name is refused by name;
 *   2. every session named on the command line must be verified, from the
 *      STORED record, to belong to one of the seeded throwaway `E2E_*`
 *      accounts. Ownership is proved from the record, never from the caller's
 *      word.
 *
 * SCOPE IS EXACT IDS ONLY. There is no name-pattern search, no `deleteMany`
 * without an exact id filter, and no `dropDatabase` here. Nothing that is not
 * named on the command line is ever touched, so attendance rows, events,
 * GST006-TRACKING-TEST, "works" and every seeded fixture are out of reach by
 * construction.
 *
 * Usage (MONGODB_URI must point at a test database):
 *   node scripts/reset-e2e-tracking-state.mjs --session-id <uuid> [--session-id <uuid> ...]
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { AttendanceSession, User } from '../src/models/index.js';
import { stableCaseInsensitive } from '../src/utils/identifiers.js';
import { assertIsolatedTestDatabase } from './support/testDatabaseTarget.js';

const SEEDED_ACCOUNTS = [
  'E2E_ADM001', 'E2E_STU001', 'E2E_STU002', 'E2E_STU003', 'E2E_STU004',
  'E2E_STU005', 'E2E_STU006', 'E2E_STU007', 'E2E_FAC001', 'E2E_FAC002',
];

function refuse(message) {
  console.error(`Refusing to reset tracking state: ${message}`);
  process.exit(1);
}

const { database: databaseName } = (() => {
  try {
    return assertIsolatedTestDatabase(env.mongoUri, 'reset tracking state');
  } catch (error) {
    refuse(error.message);
  }
})();

// Every value that follows a `--session-id` flag. No patterns are accepted.
const requested = [];
for (let i = 0; i < process.argv.length; i += 1) {
  if (process.argv[i] !== '--session-id') continue;
  const value = String(process.argv[i + 1] ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    refuse(`"--session-id" must be a session UUID; got "${value}".`);
  }
  requested.push(value);
}

if (!requested.length) {
  console.log('No --session-id supplied; nothing to remove.');
  await disconnectDatabase();
  process.exit(0);
}

await connectDatabase();

const ownedUserIds = (
  await User.find(
    { accountIdNormalized: { $in: SEEDED_ACCOUNTS.map(stableCaseInsensitive) } },
    { _id: 1 },
  ).lean()
).map((user) => String(user._id));

// Ownership is read from the stored record for EACH requested id, so a typo can
// never widen the blast radius and a real user's session can never be removed.
const sessions = await AttendanceSession.find({ _id: { $in: requested } }).lean();
const found = new Set(sessions.map((session) => String(session._id)));
const missing = requested.filter((id) => !found.has(id));
if (missing.length) {
  console.log(`Already gone (cleanup is idempotent): ${missing.join(', ')}`);
}

for (const session of sessions) {
  if (!ownedUserIds.includes(String(session.userId))) {
    refuse(
      `session ${session._id} is not owned by a seeded E2E account (userId `
      + `${session.userId}); refusing to remove it.`,
    );
  }
}

// Exact id filter only.
const removed = await AttendanceSession.deleteMany({ _id: { $in: [...found] } });
console.log(`Removed ${removed.deletedCount} test-owned tracking session(s) from "${databaseName}".`);

await disconnectDatabase();
