/**
 * Removes ONE event that a browser spec provisioned for itself.
 *
 * WHY A SCRIPT AND NOT THE API.
 * The admin API deliberately exposes no event-deletion route - an event is
 * cancelled, never destroyed, because its attendance history is real
 * information. So a spec that creates its own event cannot clean that event up
 * through a supported endpoint. This helper exists to do exactly one thing:
 * remove a record THIS PROJECT created for its own automated run, so repeated
 * runs do not accumulate fixtures. It is not a general delete tool.
 *
 * ISOLATION IS ENFORCED, NOT ASSUMED. Two hard guards, both fatal:
 *   1. The target database name must mark it as a test database (the same rule
 *      seed-e2e-fixtures.js and start-e2e.ps1 apply), and the live database name
 *      is refused by name. A typo in MONGODB_URI therefore stops the script
 *      instead of emptying a real database.
 *   2. The record's own name must carry OWNED_NAME_PREFIX. Ownership is proved
 *      from the stored record, not from the caller's word.
 *
 * SCOPE IS AN EXACT ID. Records are removed by `_id` / `eventId` equality only.
 * There is deliberately no name-pattern search, no deleteMany without an exact
 * id filter, and no dropDatabase anywhere in this file: a shared fixture such as
 * E2E-LIVE-OPEN, GST006-TRACKING-TEST or any seeded account can never match.
 *
 * Usage (MONGODB_URI must point at a test database):
 *   node scripts/cleanup-e2e-test-event.mjs --event-id <uuid>
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { assertIsolatedTestDatabase } from './support/testDatabaseTarget.js';
import {
  AttendanceCode,
  AttendanceSession,
  Event,
  EventAttendance,
  EventCertificate,
  EventFeedback,
  EventRegistration,
} from '../src/models/index.js';

// The ONLY name prefixes this script is allowed to remove. Hard-coded rather
// than passed in, because a caller-supplied pattern is how "delete everything
// like X" bugs are born. Adding a spec that owns temporary records means adding
// ITS prefix here deliberately, in review.
//
// Each entry is a prefix this project invented for fixtures it creates itself.
// Nothing that pre-dates this list matches: the older browser-run leftovers are
// named `E2E-BROWSER-CREATED-`, `E2E-BROWSER-NOQR-` and `E2E-RETRY-`, and none
// of those appear below, so records from earlier runs can never be removed by
// accident - not by this script, and not by a spec that owns a new prefix.
const OWNED_NAME_PREFIXES = [
  // frontend/e2e/eventCard.spec.ts - the event-card wording/gating fixtures.
  'E2E-CARD-WORDING-PROBE-',
  // frontend/e2e/01-admin-event-qr.spec.ts and 02-qr-failure-retry.spec.ts -
  // events created through the real admin UI form.
  'E2E-QR-UI-',
  // frontend/e2e/05, 06, 07 and 08 - one freshly provisioned event per scanning
  // test, so no test can inherit another test's tracking session.
  'E2E-SCAN-',
  // frontend/e2e/11-event-timezone.spec.ts - events created to prove the
  // Asia/Manila wall-clock round-trip, including the midnight-boundary cases.
  'E2E-TZ-',
  // frontend/e2e/12-admin-attendance-qualification.spec.ts - events created to
  // prove a duration-required attendee reads as Pending in the admin table.
  'E2E-QUAL-',
  // frontend/e2e/13-admin-feedback-visibility.spec.ts - the event a student
  // submits feedback for inside that spec. It is owned rather than shared so the
  // spec can never add to, or clear, feedback on a seeded event such as
  // E2E-STUDENTS-ONLY, whose rows belong to whoever really submitted them.
  'E2E-FEEDBACK-',
  // frontend/e2e/14-registration-policy.spec.ts - events created to prove the
  // registration policy is a setting of its own, distinct from the percentage
  // flag, and that a Student is told why registration is closed rather than
  // being shown a badge with no way to act on it.
  'E2E-REG-',
];

function refuse(message) {
  console.error(`Refusing to clean up: ${message}`);
  process.exit(1);
}

// Shared guard: refuses the live database by NAME and by PORT before connecting.
try {
  assertIsolatedTestDatabase(env.mongoUri, 'clean up');
} catch (error) {
  refuse(error.message);
}

function optionValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : String(process.argv[index + 1] ?? '');
}

const eventId = optionValue('--event-id');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) {
  refuse(`"--event-id" must be a single event UUID; got "${eventId}".`);
}

await connectDatabase();

// Ownership is read from the stored record. A caller cannot claim a record it
// does not own by naming it.
const event = await Event.findById(eventId).lean();
if (!event) {
  // Already gone: cleanup must be idempotent, because afterEach may run after a
  // run that was interrupted between the write and its own teardown.
  console.log(`No event ${eventId}; nothing to clean up.`);
  await disconnectDatabase();
  process.exit(0);
}
if (!OWNED_NAME_PREFIXES.some((prefix) => String(event.name).startsWith(prefix))) {
  refuse(
    `event ${eventId} is named "${event.name}", which is not test-owned `
    + `(expected one of: ${OWNED_NAME_PREFIXES.join(', ')}).`,
  );
}

// Only children of THIS event id are touched, by exact equality.
const removed = {
  attendanceCodes: (await AttendanceCode.deleteMany({ eventId })).deletedCount,
  attendanceSessions: (await AttendanceSession.deleteMany({ eventId })).deletedCount,
  registrations: (await EventRegistration.deleteMany({ eventId })).deletedCount,
  attendances: (await EventAttendance.deleteMany({ eventId })).deletedCount,
  feedback: (await EventFeedback.deleteMany({ eventId })).deletedCount,
  certificates: (await EventCertificate.deleteMany({ eventId })).deletedCount,
};
await Event.deleteOne({ _id: eventId });

console.log(`Removed test-owned event ${eventId} ("${event.name}") and its children: ${JSON.stringify(removed)}`);
await disconnectDatabase();
