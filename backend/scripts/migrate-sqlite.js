import fs from 'node:fs';
import { connectDatabase, disconnectDatabase, ensureDatabaseIndexes } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import {
  AttendanceCode,
  Event,
  EventAttendance,
  EventCertificate,
  EventFeedback,
  EventRegistration,
  MigrationRun,
  User,
  UserProfile,
} from '../src/models/index.js';
import { seedCounter } from '../src/utils/ids.js';
import { stableCaseInsensitive, toLegacyUuid } from '../src/utils/identifiers.js';
import { backupSqlite, openSqlite, selectRows, sha256File, sourceSummary, sqliteDate } from './sqliteSource.js';

const userIdMap = new Map();
const eventIdMap = new Map();

const requiredUser = (key, label) => {
  const userId = userIdMap.get(Number(key));
  if (!userId) throw new Error(`Missing ${label} relationship for legacy user id ${key}.`);
  return userId;
};

const requiredEvent = (key) => {
  const eventId = toLegacyUuid(key);
  if (!eventId || !eventIdMap.has(eventId)) throw new Error(`Missing event relationship for legacy id ${key}.`);
  return eventId;
};

async function migrateUsersAndProfiles(database) {
  const users = selectRows(database, 'auth_user', 'id');
  for (const row of users) {
    const values = {
      legacyId: row.id,
      accountId: row.username,
      accountIdNormalized: stableCaseInsensitive(row.username),
      username: row.username,
      usernameNormalized: stableCaseInsensitive(row.username),
      passwordHash: row.password,
      firstName: row.first_name || '',
      lastName: row.last_name || '',
      email: row.email || '',
      emailNormalized: stableCaseInsensitive(row.email),
      isActive: Boolean(row.is_active),
      isStaff: Boolean(row.is_staff),
      isSuperuser: Boolean(row.is_superuser),
      lastLogin: sqliteDate(row.last_login),
      dateJoined: sqliteDate(row.date_joined) || new Date(),
      dataSource: 'migration',
    };
    const user = await User.findOneAndUpdate({ legacyId: row.id }, { $set: values }, { upsert: true, new: true, setDefaultsOnInsert: true });
    userIdMap.set(Number(row.id), user._id);
  }

  const profiles = selectRows(database, 'events_userprofile', 'id');
  for (const row of profiles) {
    const userId = requiredUser(row.user_id, 'profile');
    const card = row.card_identifier || null;
    await UserProfile.findOneAndUpdate({ legacyId: row.id }, {
      $set: {
        legacyId: row.id,
        userId,
        role: row.role,
        displayName: row.display_name,
        phone: row.phone || '',
        department: row.department || '',
        cardIdentifier: card,
        ...(card ? { cardIdentifierNormalized: stableCaseInsensitive(card) } : {}),
      },
      ...(card ? {} : { $unset: { cardIdentifierNormalized: '' } }),
    }, { upsert: true, setDefaultsOnInsert: true });
  }
}

async function migrateEvents(database) {
  const supervisorRows = selectRows(database, 'events_event_supervisors', 'id');
  const supervisorsByEvent = new Map();
  for (const row of supervisorRows) {
    const key = toLegacyUuid(row.event_id);
    const list = supervisorsByEvent.get(key) || [];
    list.push(requiredUser(row.user_id, 'supervisor'));
    supervisorsByEvent.set(key, list);
  }

  const events = selectRows(database, 'events_event', 'created_at');
  for (const row of events) {
    const eventId = toLegacyUuid(row.id);
    if (!eventId) throw new Error(`Invalid event UUID in SQLite: ${row.id}`);
    const values = {
      name: row.name,
      description: row.description || '',
      startsAt: sqliteDate(row.starts_at),
      endsAt: sqliteDate(row.ends_at),
      venue: row.venue,
      audience: row.audience,
      organizerId: requiredUser(row.organizer_id, 'event organizer'),
      supervisors: supervisorsByEvent.get(eventId) || [],
      status: row.status,
      registrationRequired: Boolean(row.registration_required),
      registrationDeadline: sqliteDate(row.registration_deadline),
      checkInOpensAt: sqliteDate(row.check_in_opens_at),
      checkInClosesAt: sqliteDate(row.check_in_closes_at),
      lateCutoff: sqliteDate(row.late_cutoff),
      attendanceMethod: row.attendance_method,
      createdAt: sqliteDate(row.created_at) || new Date(),
      dataSource: 'migration',
    };
    await Event.findOneAndUpdate({ _id: eventId }, { $set: values }, { upsert: true, setDefaultsOnInsert: true });
    eventIdMap.set(eventId, eventId);
  }
}

async function migrateDependentRecords(database) {
  const registrations = selectRows(database, 'events_eventregistration', 'id');
  for (const row of registrations) {
    await EventRegistration.findOneAndUpdate({ _id: row.id }, { $set: {
      eventId: requiredEvent(row.event_id),
      attendeeId: requiredUser(row.attendee_id, 'registration attendee'),
      status: row.status,
      registeredAt: sqliteDate(row.registered_at) || new Date(),
    } }, { upsert: true, setDefaultsOnInsert: true });
  }

  const attendance = selectRows(database, 'events_eventattendance', 'id');
  for (const row of attendance) {
    await EventAttendance.findOneAndUpdate({ _id: row.id }, { $set: {
      eventId: requiredEvent(row.event_id),
      attendeeId: requiredUser(row.attendee_id, 'attendance attendee'),
      status: row.status,
      method: row.method,
      recordedAt: sqliteDate(row.recorded_at) || new Date(),
      source: 'Scan',
    } }, { upsert: true, setDefaultsOnInsert: true });
  }

  const feedback = selectRows(database, 'events_eventfeedback', 'id');
  for (const row of feedback) {
    await EventFeedback.findOneAndUpdate({ _id: row.id }, { $set: {
      eventId: requiredEvent(row.event_id),
      attendeeId: requiredUser(row.attendee_id, 'feedback attendee'),
      rating: row.rating,
      comments: row.comments || '',
      submittedAt: sqliteDate(row.submitted_at) || new Date(),
    } }, { upsert: true, setDefaultsOnInsert: true });
  }
}

async function migrateCertificatesAndCodes(database) {
  const certificates = selectRows(database, 'events_eventcertificate', 'id');
  for (const row of certificates) {
    await EventCertificate.findOneAndUpdate({ _id: row.id }, { $set: {
      eventId: requiredEvent(row.event_id),
      studentId: requiredUser(row.student_id, 'certificate student'),
      issuedById: requiredUser(row.issued_by_id, 'certificate issuer'),
      reference: row.reference,
      message: row.message || '',
      issuedAt: sqliteDate(row.issued_at) || new Date(),
    } }, { upsert: true, setDefaultsOnInsert: true });
  }

  const codes = selectRows(database, 'events_attendancecode', 'id');
  for (const row of codes) {
    await AttendanceCode.findOneAndUpdate({ _id: row.id }, { $set: {
      eventId: requiredEvent(row.event_id),
      createdById: requiredUser(row.created_by_id, 'attendance code creator'),
      tokenHash: row.token_hash,
      expiresAt: sqliteDate(row.expires_at),
      active: Boolean(row.active),
      createdAt: sqliteDate(row.created_at) || new Date(),
    } }, { upsert: true, setDefaultsOnInsert: true });
  }

  await Promise.all([
    seedCounter('eventRegistration', Math.max(0, ...selectRows(database, 'events_eventregistration').map((row) => row.id))),
    seedCounter('eventAttendance', Math.max(0, ...selectRows(database, 'events_eventattendance').map((row) => row.id))),
    seedCounter('eventFeedback', Math.max(0, ...selectRows(database, 'events_eventfeedback').map((row) => row.id))),
    seedCounter('eventCertificate', Math.max(0, ...selectRows(database, 'events_eventcertificate').map((row) => row.id))),
    seedCounter('attendanceCode', Math.max(0, ...selectRows(database, 'events_attendancecode').map((row) => row.id))),
  ]);
}

async function verifyMigration(database, source) {
  const legacyIds = {
    users: idSet(database, 'auth_user'),
    profiles: idSet(database, 'events_userprofile'),
    events: new Set(selectRows(database, 'events_event').map((row) => toLegacyUuid(row.id))),
    registrations: idSet(database, 'events_eventregistration'),
    attendance: idSet(database, 'events_eventattendance'),
    feedback: idSet(database, 'events_eventfeedback'),
    certificates: idSet(database, 'events_eventcertificate'),
    codes: idSet(database, 'events_attendancecode'),
  };
  const actual = {
    auth_user: await User.countDocuments({ legacyId: { $in: [...legacyIds.users] } }),
    events_userprofile: await UserProfile.countDocuments({ legacyId: { $in: [...legacyIds.profiles] } }),
    events_event: await Event.countDocuments({ _id: { $in: [...legacyIds.events] } }),
    events_eventregistration: await EventRegistration.countDocuments({ _id: { $in: [...legacyIds.registrations] } }),
    events_eventattendance: await EventAttendance.countDocuments({ _id: { $in: [...legacyIds.attendance] } }),
    events_eventfeedback: await EventFeedback.countDocuments({ _id: { $in: [...legacyIds.feedback] } }),
    events_eventcertificate: await EventCertificate.countDocuments({ _id: { $in: [...legacyIds.certificates] } }),
    events_attendancecode: await AttendanceCode.countDocuments({ _id: { $in: [...legacyIds.codes] } }),
  };
  for (const [table, count] of Object.entries(actual)) {
    if (count !== source[table]) throw new Error(`Count mismatch for ${table}: expected ${source[table]}, found ${count}.`);
  }

  const [users, events] = await Promise.all([User.find().select('_id').lean(), Event.find().select('_id').lean()]);
  const userIds = new Set(users.map((entry) => String(entry._id)));
  const eventIds = new Set(events.map((entry) => entry._id));
  const relationships = [
    [Event, 'organizerId', userIds], [EventRegistration, 'eventId', eventIds], [EventAttendance, 'eventId', eventIds],
    [EventFeedback, 'eventId', eventIds], [EventCertificate, 'eventId', eventIds], [AttendanceCode, 'eventId', eventIds],
    [EventRegistration, 'attendeeId', userIds], [EventAttendance, 'attendeeId', userIds], [EventFeedback, 'attendeeId', userIds],
    [EventCertificate, 'studentId', userIds], [EventCertificate, 'issuedById', userIds], [AttendanceCode, 'createdById', userIds],
  ];
  for (const [Model, field, values] of relationships) {
    const invalid = await Model.countDocuments({ [field]: { $nin: [...values] } });
    if (invalid) throw new Error(`${Model.modelName}.${field} has ${invalid} unresolved relationships.`);
  }
  return actual;
}

function idSet(database, table) {
  return selectRows(database, table, 'id').map((row) => Number(row.id));
}

async function main() {
  if (!fs.existsSync(env.sqliteSource)) throw new Error(`SQLite source not found: ${env.sqliteSource}`);
  const backupPath = backupSqlite();
  const sourceSha256 = sha256File(env.sqliteSource);
  const stat = fs.statSync(env.sqliteSource);
  const database = await openSqlite();
  const source = sourceSummary(database);
  await connectDatabase();
  await ensureDatabaseIndexes();
  const previousRun = await MigrationRun.findOne({ sourceSha256 }).lean();
  if (previousRun?.status === 'completed') {
    const counts = await verifyMigration(database, source);
    database.close();
    console.log('Migration already completed for this exact SQLite source; no records were overwritten.');
    console.table(counts);
    await disconnectDatabase();
    return;
  }
  await migrateUsersAndProfiles(database);
  await migrateEvents(database);
  await migrateDependentRecords(database);
  await migrateCertificatesAndCodes(database);
  const counts = await verifyMigration(database, source);
  await MigrationRun.findOneAndUpdate(
    { sourceSha256 },
    { $set: { sourcePath: env.sqliteSource, sourceSize: stat.size, sourceModifiedAt: stat.mtime, counts, status: 'completed', completedAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  database.close();
  console.log('Migration completed.');
  console.log(`Backup: ${backupPath}`);
  console.table(counts);
  await disconnectDatabase();
}

main().catch(async (error) => {
  console.error('Migration failed:', error);
  await disconnectDatabase().catch(() => {});
  process.exit(1);
});

