/**
 * Restores a backup produced by scripts/backup-mongodb.js.
 *
 * By default each collection in the backup is inserted only where the target
 * collection has no document with the same _id, so an accidental restore cannot
 * overwrite live records. Pass --replace to delete each target collection first.
 *
 * Usage:
 *   npm run restore -- backend/backups/mongodb.<name>.<stamp>
 *   npm run restore -- backend/backups/mongodb.<name>.<stamp> --replace
 */
import fs from 'node:fs';
import path from 'node:path';
import mongo from 'mongodb';

const { MongoClient } = mongo;
// This driver version exposes Extended JSON through the BSON namespace.
const { EJSON } = mongo.BSON;
import { env } from '../src/config/env.js';

async function main() {
  const args = process.argv.slice(2).filter((value) => !value.startsWith('--'));
  const replace = process.argv.includes('--replace');
  const source = args[0];
  if (!source) throw new Error('Usage: npm run restore -- <backup-folder> [--replace]');

  const manifestPath = path.join(source, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`No manifest.json found in ${source}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const client = new MongoClient(env.mongoUri);
  await client.connect();
  try {
    const database = client.db(manifest.database);
    for (const [name, info] of Object.entries(manifest.collections)) {
      const documents = EJSON.parse(fs.readFileSync(path.join(source, `${name}.json`), 'utf8'));
      if (replace) await database.collection(name).deleteMany({});
      const existing = new Set((await database.collection(name).find({}, { projection: { _id: 1 } }).toArray()).map((doc) => String(doc._id)));
      const fresh = replace ? documents : documents.filter((doc) => !existing.has(String(doc._id)));
      if (fresh.length) await database.collection(name).insertMany(fresh, { ordered: false });
      console.log(`${name}: ${info.documents} in backup, ${fresh.length} inserted, ${documents.length - fresh.length} already present`);
    }
    console.log(replace ? 'Restore complete (existing collections replaced).' : 'Restore complete (existing records left untouched).');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Restore failed:', error);
  process.exit(1);
});
