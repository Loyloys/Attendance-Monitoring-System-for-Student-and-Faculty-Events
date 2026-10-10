/**
 * READ-ONLY probe for one named event in the ISOLATED database.
 * Creates nothing, changes nothing.
 *
 * Reports the stored registration policy, the derived status, and any existing
 * registration rows, so the reported "registration required but no Register
 * button" can be traced to stored data rather than inferred from the screen.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { Event, EventRegistration, User } from '../src/models/index.js';
import { assertIsolatedTestDatabase } from './support/testDatabaseTarget.js';

const name = process.argv[2] || 'rokan fan meet';
assertIsolatedTestDatabase(env.mongoUri, 'probe');
await connectDatabase();

const matches = await Event.find({ name: { $regex: new RegExp(name, 'i') } }).lean();
console.log(`Search "${name}" -> ${matches.length} event(s). now=${new Date().toISOString()}`);

for (const event of matches) {
  console.log('\n=== EVENT ===');
  console.log(JSON.stringify({
    _id: event._id,
    name: event.name,
    status: event.status,
    audience: event.audience,
    registrationRequired: event.registrationRequired,
    registrationDeadline: event.registrationDeadline,
    requiredForAttendance: event.requiredForAttendance,
    attendanceMethod: event.attendanceMethod,
    requiredAttendanceMinutes: event.requiredAttendanceMinutes,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    checkInOpensAt: event.checkInOpensAt,
    checkInClosesAt: event.checkInClosesAt,
    lateCutoff: event.lateCutoff,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  }, null, 2));

  const registrations = await EventRegistration.find({ eventId: event._id }).lean();
  console.log(`registrations: ${registrations.length}`);
  for (const r of registrations) {
    const u = await User.findById(r.attendeeId).lean();
    console.log(`   ${u?.accountId ?? r.attendeeId} status=${r.status} at=${r.registeredAt?.toISOString?.()}`);
  }
}

await disconnectDatabase();
