import { connectDatabase, disconnectDatabase, ensureDatabaseIndexes } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { Event, EventAttendance, EventCertificate, EventRegistration, User, UserProfile } from '../src/models/index.js';
import { createDjangoPassword } from '../src/utils/passwords.js';
import { stableCaseInsensitive } from '../src/utils/identifiers.js';
import { nextNumericId } from '../src/utils/ids.js';

export const demoEventIds = [
  'd1111111-1111-4111-8111-111111111111',
  'd2222222-2222-4222-8222-222222222222',
  'd3333333-3333-4333-8333-333333333333',
  'd4444444-4444-4444-8444-444444444444',
];

export async function account({ username, name, role, email, department, password, card = null }) {
  const existing = await User.findOne({ accountIdNormalized: stableCaseInsensitive(username) });
  if (existing) {
    console.log(`Keeping existing account ${username}; its password and migrated profile were not changed.`);
    return existing;
  }
  const user = await User.create({
    accountId: username,
    accountIdNormalized: stableCaseInsensitive(username),
    username,
    usernameNormalized: stableCaseInsensitive(username),
    passwordHash: createDjangoPassword(password),
    email,
    emailNormalized: email.toLowerCase(),
    isActive: true,
    isStaff: role === 'admin',
    isSuperuser: false,
    dateJoined: new Date(),
    dataSource: 'demo',
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

export async function upsertDemoEvent(id, values) {
  return Event.findOneAndUpdate(
    { _id: id },
    { $set: { ...values, dataSource: 'demo' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function seed() {
  await connectDatabase();
  await ensureDatabaseIndexes();
  const now = Date.now();
  const student = await account({ username: 'DEMO_STU001', name: 'Demo Student', role: 'student', email: 'demo.student@cot.edu', department: 'Information Technology', password: env.demoPasswords.student, card: 'RFID-DEMO-STU001' });
  const second = await account({ username: 'DEMO_STU002', name: 'Demo Student Two', role: 'student', email: 'demo.student2@cot.edu', department: 'Information Technology', password: env.demoPasswords.student, card: 'BARCODE-DEMO-STU002' });
  const faculty = await account({ username: 'DEMO_FAC001', name: 'Demo Faculty', role: 'faculty', email: 'demo.faculty@cot.edu', department: 'College of Technologies', password: env.demoPasswords.faculty, card: 'RFID-DEMO-FAC001' });
  const otherFaculty = await account({ username: 'DEMO_FAC002', name: 'Demo Faculty Two', role: 'faculty', email: 'demo.faculty2@cot.edu', department: 'College of Technologies', password: env.demoPasswords.faculty, card: 'RFID-DEMO-FAC002' });
  await account({ username: 'DEMO_ADM001', name: 'Demo Administrator', role: 'admin', email: 'demo.admin@cot.edu', department: 'Administration', password: env.demoPasswords.admin });

  const common = { description: 'Separate development data for the event-attendance workflow.', status: 'published', organizerId: faculty._id, audience: 'all', registrationRequired: false, registrationDeadline: null };
  const ongoing = await upsertDemoEvent(demoEventIds[0], { ...common, name: 'Demo Technology Innovation Summit', startsAt: new Date(now - 3_600_000), endsAt: new Date(now + 10_800_000), venue: 'Innovation Hall', checkInOpensAt: new Date(now - 1_800_000), checkInClosesAt: new Date(now + 7_200_000), lateCutoff: new Date(now + 900_000), attendanceMethod: 'qr' });
  const upcoming = await upsertDemoEvent(demoEventIds[1], { ...common, name: 'Demo Student Developers Meetup', audience: 'student', registrationRequired: true, registrationDeadline: new Date(now + 64_800_000), startsAt: new Date(now + 86_400_000), endsAt: new Date(now + 97_200_000), checkInOpensAt: new Date(now + 85_500_000), checkInClosesAt: new Date(now + 97_200_000), lateCutoff: new Date(now + 86_700_000), attendanceMethod: 'barcode' });
  const completed = await upsertDemoEvent(demoEventIds[2], { ...common, name: 'Demo Faculty Research Colloquium', startsAt: new Date(now - 172_800_000), endsAt: new Date(now - 162_000_000), venue: 'COT Conference Room', checkInOpensAt: new Date(now - 173_700_000), checkInClosesAt: new Date(now - 162_000_000), lateCutoff: new Date(now - 171_900_000), attendanceMethod: 'rfid' });
  await upsertDemoEvent(demoEventIds[3], { ...common, name: 'Demo Unauthorized Faculty Briefing', organizerId: otherFaculty._id, audience: 'faculty', startsAt: new Date(now + 172_800_000), endsAt: new Date(now + 180_000_000), venue: 'Board Room', checkInOpensAt: new Date(now + 171_900_000), checkInClosesAt: new Date(now + 180_000_000), lateCutoff: new Date(now + 173_700_000), attendanceMethod: 'qr' });
  ongoing.supervisors = [faculty._id];
  await ongoing.save();

  await EventRegistration.updateOne(
    { eventId: upcoming._id, attendeeId: student._id },
    { $setOnInsert: { _id: await nextNumericId('eventRegistration'), status: 'registered', registeredAt: new Date() } },
    { upsert: true },
  );
  for (const [attendee, status, recordedAt] of [[student, 'present', completed.startsAt], [second, 'late', completed.lateCutoff], [faculty, 'present', completed.startsAt]]) {
    await EventAttendance.updateOne(
      { eventId: completed._id, attendeeId: attendee._id },
      { $setOnInsert: { _id: await nextNumericId('eventAttendance'), status, method: 'rfid', recordedAt, source: 'Scan' } },
      { upsert: true },
    );
  }
  await EventCertificate.updateOne(
    { eventId: completed._id, studentId: student._id },
    { $setOnInsert: { _id: await nextNumericId('eventCertificate'), issuedById: faculty._id, reference: `DEMO-COT-EVT-${student.accountId}`, message: 'Awarded for participation and contribution.', issuedAt: new Date() } },
    { upsert: true },
  );
  console.log('Demo event-attendance data is ready (separate from migrated records).');
  console.log(`Student: DEMO_STU001 / ${env.demoPasswords.student}`);
  console.log(`Faculty: DEMO_FAC001 / ${env.demoPasswords.faculty}`);
  console.log(`Administrator: DEMO_ADM001 / ${env.demoPasswords.admin}`);
}

seed().then(disconnectDatabase).catch(async (error) => { console.error('Demo seed failed:', error); await disconnectDatabase().catch(() => {}); process.exit(1); });
