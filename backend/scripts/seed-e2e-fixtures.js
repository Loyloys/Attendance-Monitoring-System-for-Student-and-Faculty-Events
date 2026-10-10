/**
 * Fixtures for the ISOLATED browser (Playwright) test instance.
 *
 * Creates the accounts and events the browser specs need, in a database whose
 * name marks it as a test database.
 *
 * ISOLATION: this script refuses to run unless it is pointed at a database whose
 * name marks it as a test database. It is a hard guard, not a warning, so it can
 * never seed the live `university_attendance` database by accident. It also never
 * creates the `attendancesessions` collection or its indexes: the tracking rollout
 * gate is deliberately left exactly as a normal start leaves it, so the browser
 * specs exercise the same gated state the live app is in today.
 *
 * Usage:
 *   MONGODB_URI=mongodb://127.0.0.1:27019/university_attendance_e2e_test \
 *     node scripts/seed-e2e-fixtures.js
 */
import { connectDatabase, disconnectDatabase, ensureDatabaseIndexes } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { Event, EventAttendance, User, UserProfile, AttendanceCode, AttendanceSession } from '../src/models/index.js';
import { createDjangoPassword } from '../src/utils/passwords.js';
import { stableCaseInsensitive } from '../src/utils/identifiers.js';

export const E2E_PASSWORD = 'e2e-pass-123';

// Fixed test venue, so the geofence has something definite to test against. The
// browser specs inject a matching simulated fix.
export const E2E_VENUE = { latitude: 14.5995, longitude: 120.9842, radiusMeters: 150 };

import { assertIsolatedTestDatabase } from './support/testDatabaseTarget.js';

// Hard isolation guard, BEFORE any connection is opened. Name AND port: the live
// mongod is on 27017, and a name-only rule would happily target it.
const { database: databaseName } = (() => {
  try {
    return assertIsolatedTestDatabase(env.mongoUri, 'seed');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
})();

const minutes = (value) => value * 60_000;
const minutesFromNow = (value) => new Date(Date.now() + value * 60_000);

async function account({ username, name, role, email, department, card = null }) {
  const existing = await User.findOne({ accountIdNormalized: stableCaseInsensitive(username) });
  if (existing) return existing;
  const user = await User.create({
    accountId: username,
    accountIdNormalized: stableCaseInsensitive(username),
    username,
    usernameNormalized: stableCaseInsensitive(username),
    passwordHash: createDjangoPassword(E2E_PASSWORD),
    email,
    emailNormalized: email.toLowerCase(),
    isActive: true,
    isStaff: role === 'admin',
    isSuperuser: false,
    dateJoined: new Date(),
    dataSource: 'managed',
  });
  await UserProfile.create({
    userId: user._id,
    role,
    displayName: name,
    department,
    phone: '',
    cardIdentifier: card,
    ...(card ? { cardIdentifierNormalized: stableCaseInsensitive(card) } : {}),
  });
  return user;
}

/**
 * Every event's window is derived from now, so a run never depends on a date
 * that was correct when the fixture was written.
 *
 * Re-seeding REFRESHES those windows on an event that already exists. It has to:
 * the window is the one field that goes stale as the clock moves, and simply
 * returning the stored event left `E2E-LIVE-OPEN` closed and
 * `E2E-WINDOW-CLOSED`'s already-issued credential expired on any run started
 * more than a few hours after the first seed. The specs then failed for a
 * reason that had nothing to do with the behaviour under test.
 *
 * The document is updated in place rather than recreated, so the event id, and
 * therefore the credential and any attendance already recorded against it,
 * survive a re-seed.
 */
async function event(organizer, { name, audience = 'all', overrides = {} }) {
  const values = {
    name,
    description: `ISOLATED E2E TEST EVENT: ${name}. Not a real event.`,
    startsAt: minutesFromNow(-60),
    endsAt: minutesFromNow(180),
    checkInOpensAt: minutesFromNow(-60),
    checkInClosesAt: minutesFromNow(180),
    lateCutoff: minutesFromNow(180),
    venue: 'E2E Test Hall',
    audience,
    organizerId: organizer._id,
    supervisors: [],
    status: 'published',
    registrationRequired: false,
    attendanceMethod: 'qr',
    venueLatitude: E2E_VENUE.latitude,
    venueLongitude: E2E_VENUE.longitude,
    venueRadiusMeters: E2E_VENUE.radiusMeters,
    locationVerificationRequired: true,
    dataSource: 'managed',
    ...overrides,
  };
  const existing = await Event.findOne({ name });
  if (existing) {
    await Event.updateOne({ _id: existing._id }, { $set: values });
    return Event.findById(existing._id).lean();
  }
  return Event.create(values);
}

export async function seed() {
  await connectDatabase();
  await ensureDatabaseIndexes();
  // The approval-gated collections are excluded from routine index creation, so
  // a test environment must initialise them explicitly - this is the exact
  // operation the approved rollout script performs on a live database.
  // (npm run rollout:attendance-indexes -- --confirm)
  await AttendanceCode.createIndexes();
  await AttendanceSession.createIndexes();

  const admin = await account({
    username: 'E2E_ADM001', name: 'E2E Administrator', role: 'admin',
    email: 'e2e.admin@cot.edu', department: 'College of Technologies',
  });
  const student = await account({
    username: 'E2E_STU001', name: 'E2E Student One', role: 'student',
    email: 'e2e.student1@cot.edu', department: 'Information Technology', card: 'RFID-E2E-STU001',
  });
  const outsider = await account({
    username: 'E2E_STU002', name: 'E2E Student Two', role: 'student',
    email: 'e2e.student2@cot.edu', department: 'Information Technology', card: 'RFID-E2E-STU002',
  });
  // One dedicated student per SCANNING spec. A successful check-in starts a
  // live tracking session, and an active session holds a position watch; a second
  // scan by the same person then competes with that watch and the geolocation
  // read times out. Distinct accounts keep every scan spec independent instead
  // of leaving ordering to decide whether a spec passes.
  const scannerStudents = {};
  for (const n of [3, 4, 5, 6, 7]) {
    scannerStudents[`stu${n}`] = await account({
      username: `E2E_STU00${n}`, name: `E2E Student ${n}`, role: 'student',
      email: `e2e.student${n}@cot.edu`, department: 'Information Technology',
      card: `RFID-E2E-STU00${n}`,
    });
  }
  const faculty = await account({
    username: 'E2E_FAC001', name: 'E2E Faculty One', role: 'faculty',
    email: 'e2e.faculty1@cot.edu', department: 'College of Technologies',
  });
  const otherFaculty = await account({
    username: 'E2E_FAC002', name: 'E2E Faculty Two', role: 'faculty',
    email: 'e2e.faculty2@cot.edu', department: 'College of Technologies',
  });

  // The main live event. FAC001 supervises it; FAC002 is deliberately NOT
  // assigned, which is exactly what the unauthorized-QR-management spec needs.
  const live = await event(admin, { name: 'E2E-LIVE-OPEN' });
  await Event.updateOne(
    { _id: live._id },
    { $set: { supervisors: [faculty._id], requiredAttendanceMinutes: 20 } },
  );

  // Audience rules: everyone / students only / faculty only.
  const studentsOnly = await event(admin, { name: 'E2E-STUDENTS-ONLY', audience: 'student' });
  const facultyOnly = await event(admin, { name: 'E2E-FACULTY-ONLY', audience: 'faculty' });

  // Timing rules: a window that has not opened, and one that has already closed.
  const notYetOpen = await event(admin, {
    name: 'E2E-FUTURE-WINDOW',
    overrides: {
      startsAt: minutesFromNow(60 * 24 * 7),
      endsAt: minutesFromNow(60 * 24 * 7 + 120),
      checkInOpensAt: minutesFromNow(60 * 24 * 7 - 30),
      checkInClosesAt: minutesFromNow(60 * 24 * 7 + 120),
      lateCutoff: minutesFromNow(60 * 24 * 7 + 15),
      requiredAttendanceMinutes: null,
    },
  });
  const windowClosed = await event(admin, {
    name: 'E2E-WINDOW-CLOSED',
    overrides: {
      startsAt: new Date(Date.now() - minutes(300)),
      endsAt: new Date(Date.now() - minutes(180)),
      checkInOpensAt: new Date(Date.now() - minutes(300)),
      checkInClosesAt: new Date(Date.now() - minutes(200)),
      lateCutoff: new Date(Date.now() - minutes(240)),
      requiredAttendanceMinutes: null,
    },
  });
  const cancelled = await event(admin, {
    name: 'E2E-CANCELLED',
    overrides: { status: 'cancelled', requiredAttendanceMinutes: null },
  });
  // No geofence at all, so the "not configured" refusal is reachable.
  const noFence = await event(admin, {
    name: 'E2E-NO-GEOFENCE',
    overrides: {
      venueLatitude: null, venueLongitude: null, venueRadiusMeters: null,
      requiredAttendanceMinutes: null,
    },
  });

  // Retire any credential left behind by an EARLIER run.
  //
  // A credential's expiry is `max(checkInClosesAt, issuedAt + 1h)`, so on a
  // re-seed the stored code for a past-window event is already expired. The
  // administrator read is deliberately idempotent and returns the ACTIVE code
  // rather than minting a new one, so a stale code would keep being handed out
  // and every scan of it would be refused as "invalid or expired" instead of for
  // the reason the spec is actually about. Retiring it lets the next read issue a
  // current credential, which is exactly the recovery path the UI already
  // provides. Only the seeded test events are touched, in this isolated
  // database, and no document is deleted.
  const seeded = [live, studentsOnly, facultyOnly, notYetOpen, windowClosed, cancelled, noFence];
  const retired = await AttendanceCode.updateMany(
    { eventId: { $in: seeded.map(value => value._id) }, active: true },
    { $set: { active: false } },
  );
  if (retired.modifiedCount) {
    console.log(`Retired ${retired.modifiedCount} credential(s) left by an earlier run.`);
  }

  // Clear attendance and TRACKING SESSIONS recorded for the seeded accounts.
  //
  // `resetAttendance` in the browser helpers already clears attendance rows
  // between specs, but it has no way to reach a tracking session, so one left by
  // an earlier run survived. The Portal then RESTORES that session on the
  // attendee's next visit and its position watch competes with the new scan's
  // location read, so the scan never reached the server - while "Live attendance
  // tracking" was already on screen and satisfied the success assertion. Seeding
  // from this known-good baseline is what makes a re-run reproducible.
  const seededAccounts = await User.find({
    accountIdNormalized: { $in: ['E2E_ADM001', 'E2E_STU001', 'E2E_STU002', 'E2E_FAC001', 'E2E_FAC002'].map(stableCaseInsensitive).concat(
      [3, 4, 5, 6, 7].map(n => stableCaseInsensitive(`E2E_STU00${n}`)),
    ) },
  }).select('_id').lean();
  const seededUserIds = seededAccounts.map(value => value._id);
  const clearedAttendance = await EventAttendance.deleteMany({ attendeeId: { $in: seededUserIds } });
  const clearedSessions = await AttendanceSession.deleteMany({ userId: { $in: seededUserIds } });
  if (clearedAttendance.deletedCount || clearedSessions.deletedCount) {
    console.log(
      `Cleared ${clearedAttendance.deletedCount} attendance row(s) and `
      + `${clearedSessions.deletedCount} tracking session(s) left by an earlier run.`,
    );
  }

  console.log(`Seeded isolated test database: ${databaseName}`);
  console.log(`All seeded account passwords: ${E2E_PASSWORD}`);
  console.log('Accounts');
  console.log(`  admin     : ${admin.username}`);
  console.log(`  student   : ${student.username}`);
  console.log(`  student2  : ${outsider.username}`);
  console.log(`  faculty   : ${faculty.username}  (supervisor of ${live.name})`);
  console.log(`  faculty2  : ${otherFaculty.username}  (deliberately NOT assigned)`);
  console.log('Events');
  for (const [label, value] of Object.entries({
    live, studentsOnly, facultyOnly, notYetOpen, windowClosed, cancelled, noFence,
  })) {
    console.log(`  ${label.padEnd(13)} ${value._id}  ${value.name}`);
  }
  return { admin, student, outsider, faculty, otherFaculty, live, noFence };
}

// Only seed when executed directly, so a spec can import `seed()` if it needs to.
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/seed-e2e-fixtures.js')) {
  await seed();
  await disconnectDatabase();
}
