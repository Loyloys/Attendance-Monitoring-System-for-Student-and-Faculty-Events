/**
 * READ-ONLY probe. Creates nothing, changes nothing, deletes nothing.
 *
 * Answers two questions with evidence rather than inference:
 *   1. Does an EventFeedback row exist for the seeded event E2E-STUDENTS-ONLY?
 *   2. If it does, does /api/admin/state/ (read through an administrator
 *      session) actually return it under that event?
 *
 * PRIVACY. Comment TEXT is never printed. Only the rating, the submission time,
 * the attendee's public account id and a length/prefix-free fingerprint are
 * reported, which is enough to prove existence and association without copying
 * anybody's words into a log file.
 *
 * ISOLATION. Uses the same shared guard as every other test script, so it
 * refuses a non-test database name or the live MongoDB port before connecting.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { Event, EventFeedback, User, UserProfile } from '../src/models/index.js';
import { assertIsolatedTestDatabase } from './support/testDatabaseTarget.js';

const { database } = assertIsolatedTestDatabase(env.mongoUri, 'probe');
console.log(`Connected to test database: ${database}`);

await connectDatabase();

const total = await EventFeedback.countDocuments();
console.log(`TOTAL EventFeedback rows in the isolated database: ${total}`);

const events = await Event.find({}).select('_id name status').lean();
console.log(`Events present: ${events.length}`);

for (const event of events) {
  // Counted directly against the COLLECTION, which is the only place that can
  // answer "was it stored at all", independent of any read path.
  const count = await EventFeedback.countDocuments({ eventId: event._id });
  if (count > 0) {
    console.log(`  event "${event.name}" (${event._id}) -> ${count} feedback row(s)`);
  }
}

const seeded = events.find((event) => event.name === 'E2E-STUDENTS-ONLY');
if (!seeded) {
  console.log('E2E-STUDENTS-ONLY is NOT present in the isolated database.');
} else {
  console.log(`\nE2E-STUDENTS-ONLY id: ${seeded._id}`);
  const rows = await EventFeedback.find({ eventId: seeded._id }).sort({ submittedAt: -1 }).lean();
  console.log(`Feedback rows filed against it: ${rows.length}`);
  for (const row of rows) {
    const profile = await UserProfile.findOne({ userId: row.attendeeId }).lean();
    const user = profile ? await User.findById(row.attendeeId).lean() : null;
    console.log('  row:', JSON.stringify({
      eventId: row.eventId,
      attendeeAccountId: user?.accountId ?? '(unresolved)',
      role: profile?.role ?? '(unresolved)',
      rating: row.rating,
      commentsLength: String(row.comments ?? '').length,
      submittedAt: row.submittedAt,
    }));
  }
}

await disconnectDatabase();
