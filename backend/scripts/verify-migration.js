import fs from 'node:fs';
import { connectDatabase, disconnectDatabase, ensureDatabaseIndexes } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import {
  AttendanceCode, Counter, Event, EventAttendance, EventCertificate, EventFeedback,
  EventRegistration, User, UserProfile,
} from '../src/models/index.js';
import { toLegacyUuid } from '../src/utils/identifiers.js';
import { openSqlite, selectRows, sourceSummary } from './sqliteSource.js';

const idSet = (database, table) => selectRows(database, table, 'id').map((row) => Number(row.id));

async function verify() {
  await connectDatabase();
  await ensureDatabaseIndexes();
  if (!fs.existsSync(env.sqliteSource)) throw new Error(`SQLite source not found: ${env.sqliteSource}`);
  const database = await openSqlite();
  const source = sourceSummary(database);
  const legacy = {
    users: idSet(database, 'auth_user'),
    profiles: idSet(database, 'events_userprofile'),
    events: selectRows(database, 'events_event').map((row) => toLegacyUuid(row.id)),
    registrations: idSet(database, 'events_eventregistration'),
    attendance: idSet(database, 'events_eventattendance'),
    feedback: idSet(database, 'events_eventfeedback'),
    certificates: idSet(database, 'events_eventcertificate'),
    codes: idSet(database, 'events_attendancecode'),
  };
  const counts = {
    auth_user: await User.countDocuments({ legacyId: { $in: legacy.users } }),
    events_userprofile: await UserProfile.countDocuments({ legacyId: { $in: legacy.profiles } }),
    events_event: await Event.countDocuments({ _id: { $in: legacy.events } }),
    events_eventregistration: await EventRegistration.countDocuments({ _id: { $in: legacy.registrations } }),
    events_eventattendance: await EventAttendance.countDocuments({ _id: { $in: legacy.attendance } }),
    events_eventfeedback: await EventFeedback.countDocuments({ _id: { $in: legacy.feedback } }),
    events_eventcertificate: await EventCertificate.countDocuments({ _id: { $in: legacy.certificates } }),
    events_attendancecode: await AttendanceCode.countDocuments({ _id: { $in: legacy.codes } }),
  };
  for (const [table, count] of Object.entries(counts)) {
    if (count !== source[table]) throw new Error(`Count mismatch for ${table}: expected ${source[table]}, found ${count}.`);
  }

  const users = await User.find().select('_id passwordHash').lean();
  const events = await Event.find().select('_id organizerId supervisors').lean();
  const userIds = new Set(users.map((user) => String(user._id)));
  const eventIds = new Set(events.map((event) => event._id));
  const checks = [
    [User, '_id', userIds], [UserProfile, 'userId', userIds], [Event, 'organizerId', userIds],
    [EventRegistration, 'eventId', eventIds], [EventAttendance, 'eventId', eventIds],
    [EventFeedback, 'eventId', eventIds], [EventCertificate, 'eventId', eventIds], [AttendanceCode, 'eventId', eventIds],
    [EventRegistration, 'attendeeId', userIds], [EventAttendance, 'attendeeId', userIds], [EventFeedback, 'attendeeId', userIds],
    [EventCertificate, 'studentId', userIds], [EventCertificate, 'issuedById', userIds], [AttendanceCode, 'createdById', userIds],
  ];
  for (const [Model, field, values] of checks) {
    const invalid = await Model.countDocuments({ [field]: { $nin: [...values] } });
    if (invalid) throw new Error(`${Model.modelName}.${field} has ${invalid} unresolved relationships.`);
  }
  const invalidHashes = users.filter((user) => !user.passwordHash?.startsWith('pbkdf2_sha256$'));
  if (invalidHashes.length) throw new Error(`${invalidHashes.length} user password hashes are not Django PBKDF2 hashes.`);
  const supervisors = events.flatMap((event) => event.supervisors || []);
  if (supervisors.some((id) => !userIds.has(String(id)))) throw new Error('One or more supervisor relationships are unresolved.');

  const counters = await Counter.find().lean();
  console.log('Migration verification passed.');
  console.table(counts);
  console.table(counters.map((counter) => ({ name: counter._id, sequence: counter.sequence })));
  database.close();
}

verify()
  .then(disconnectDatabase)
  .catch(async (error) => {
    console.error('Migration verification failed:', error);
    await disconnectDatabase().catch(() => {});
    process.exit(1);
  });
