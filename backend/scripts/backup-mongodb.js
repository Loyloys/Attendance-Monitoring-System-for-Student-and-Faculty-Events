/**
 * Backs up every collection in the configured MongoDB database to Extended JSON.
 *
 * Extended JSON preserves BSON types, so the dump can be restored without losing
 * dates, decimals or binary values. Intended to be run BEFORE any migration or
 * schema change, so there is always a known-good copy to roll back to.
 *
 * Usage: npm run backup
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mongo from 'mongodb';

const { MongoClient } = mongo;
// This driver version exposes Extended JSON through the BSON namespace.
const { EJSON } = mongo.BSON;
import { env } from '../src/config/env.js';

const label = process.argv[2] ? `-${process.argv[2].replace(/[^a-zA-Z0-9._-]/g, '_')}` : '';

function timestamp() {
  return new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z');
}

async function main() {
  const client = new MongoClient(env.mongoUri);
  await client.connect();
  try {
    const databaseName = new URL(env.mongoUri.replace('mongodb+srv://', 'mongodb://')).pathname.replace(/^\//, '') || 'university_attendance';
    const database = client.db(databaseName);
    const collections = (await database.listCollections({}, { nameOnly: true }).toArray())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('system.'))
      .sort();

    const stamp = timestamp();
    const target = path.join(env.migrationBackupDir, `mongodb${label}.${stamp}`);
    fs.mkdirSync(target, { recursive: true });

    const manifest = { database: databaseName, createdAt: new Date().toISOString(), collections: {} };
    for (const name of collections) {
      const documents = await database.collection(name).find({}).toArray();
      const file = path.join(target, `${name}.json`);
      fs.writeFileSync(file, EJSON.stringify(documents, null, 2, { relaxed: false }));
      manifest.collections[name] = {
        documents: documents.length,
        bytes: fs.statSync(file).size,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
      };
    }

    const manifestPath = path.join(target, 'manifest.json');
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`Backup written to: ${target}`);
    console.table(Object.fromEntries(Object.entries(manifest.collections).map(([name, info]) => [name, info.documents])));
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Backup failed:', error);
  process.exit(1);
});
