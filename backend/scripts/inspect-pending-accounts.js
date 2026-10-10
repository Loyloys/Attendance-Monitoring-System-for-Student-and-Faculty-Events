/**
 * READ-ONLY inspection of accounts still awaiting administrator approval.
 *
 * Reports what a narrowly scoped transition would touch, and nothing more. It
 * opens the database in read-only mode and performs no writes at all, so it is
 * safe to run against the live database before deciding whether to migrate.
 *
 * Usage: npm run inspect:pending
 */
import mongo from 'mongodb';
import { env } from '../src/config/env.js';

const { MongoClient } = mongo;

function databaseNameFrom(uri) {
  try {
    return new URL(uri.replace('mongodb+srv://', 'mongodb://')).pathname.replace(/^\//, '') || 'university_attendance';
  } catch {
    return 'university_attendance';
  }
}

async function main() {
  const uri = env.mongoUri;
  const databaseName = databaseNameFrom(uri);
  // Every operation below is a `find`/`countDocuments`, none of which can mutate
  // data. There is deliberately no write, update or delete call in this file.
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const database = client.db(databaseName);
    const collections = (await database.listCollections({}, { nameOnly: true }).toArray())
      .map((entry) => entry.name)
      .sort();
    console.log(`Database: ${databaseName}`);
    console.log(`Collections: ${collections.join(', ')}`);
    const profileCollection = collections.find((name) => name.toLowerCase().includes('profile')) || 'userprofiles';
    console.log(`Profile collection: ${profileCollection}`);
    const users = await database.collection('users').find({ approvalStatus: 'pending' }).toArray();
    const profiles = await database.collection(profileCollection).find({}).toArray();
    // Keyed by `userId`, which is the field that links a profile to its account.
    const profileById = new Map(profiles.map((profile) => [String(profile.userId), profile]));
    const registrations = await database.collection('eventregistrations').find({}).toArray();

    console.log(`Accounts with approvalStatus "pending": ${users.length}`);

    const rows = users.map((user) => {
      const profile = profileById.get(String(user._id));
      const registered = registrations.filter(
        (registration) => String(registration.attendeeId) === String(user._id),
      );
      return {
        accountId: user.accountId,
        name: profile?.displayName || '(no profile)',
        email: user.email || user.googleEmail || '',
        role: profile?.role || '(none)',
        department: profile?.department || '',
        isActive: user.isActive,
        profileCompleted: user.profileCompleted,
        viaGoogle: Boolean(user.googleSub),
        hasPassword: typeof user.passwordHash === 'string' && user.passwordHash.length > 0,
        eventRegistrations: registered.length,
        dateJoined: user.dateJoined ? new Date(user.dateJoined).toISOString() : '',
        googleLinkedAt: user.googleLinkedAt ? new Date(user.googleLinkedAt).toISOString() : '',
      };
    });

    if (rows.length) console.table(rows);

    // A narrower report: the accounts that are genuinely safe to auto-activate.
    const eligible = rows.filter(
      (row) => row.role === 'student'
        && row.isActive === true
        && row.profileCompleted !== false
        && row.name !== '(no profile)'
        && row.department !== '',
    );
    console.log(`\nAuto-activation candidates (student + active + profile complete + department set): ${eligible.length}`);
    for (const row of eligible) console.log(`  - ${row.accountId} (${row.name})`);

    const excluded = rows.filter((row) => !eligible.some((candidate) => candidate.accountId === row.accountId));
    if (excluded.length) {
      console.log('\nNOT eligible (must not be auto-activated):');
      for (const row of excluded) {
        const reasons = [];
        if (row.role !== 'student') reasons.push(`role=${row.role}`);
        if (row.isActive !== true) reasons.push('deactivated');
        if (row.profileCompleted === false) reasons.push('profile incomplete');
        if (row.department === '') reasons.push('no department');
        console.log(`  - ${row.accountId} (${row.name}): ${reasons.join(', ') || 'unknown'}`);
      }
    }

    const rejected = await database.collection('users').countDocuments({ approvalStatus: 'rejected' });
    console.log(`\nAccounts with approvalStatus "rejected" (never auto-reactivated): ${rejected}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Inspection failed:', error.message);
  process.exit(1);
});