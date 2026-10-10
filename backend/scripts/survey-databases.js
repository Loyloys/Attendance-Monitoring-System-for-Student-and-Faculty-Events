/**
 * READ-ONLY survey of what databases actually exist and how many documents each
 * collection holds. Used to confirm the state of live data before proposing any
 * transition. Performs only `listDatabases` / `listCollections` / `countDocuments`.
 *
 * Usage: npm run survey:databases
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
  const client = new MongoClient(env.mongoUri);
  await client.connect();
  try {
    const { databases } = await client.db().admin().listDatabases();
    console.log(`Databases visible to this server:`);
    for (const info of databases) {
      const database = client.db(info.name);
      const collections = await database.listCollections({}, { nameOnly: true }).toArray();
      const counts = [];
      for (const entry of collections.sort((a, b) => a.name.localeCompare(b.name))) {
        // eslint-disable-next-line no-await-in-loop
        const total = await database.collection(entry.name).countDocuments({});
        counts.push(`${entry.name}=${total}`);
      }
      console.log(`  ${info.name} (${info.sizeOnDisk} bytes): ${counts.length ? counts.join(', ') : 'no collections'}`);
    }
    const target = client.db(databaseNameFrom(env.mongoUri));
    const pending = await target.collection('users').countDocuments({ approvalStatus: 'pending' });
    const rejected = await target.collection('users').countDocuments({ approvalStatus: 'rejected' });
    console.log(`\nTarget database "${databaseNameFrom(env.mongoUri)}": pending=${pending}, rejected=${rejected}`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Survey failed:', error.message);
  process.exit(1);
});