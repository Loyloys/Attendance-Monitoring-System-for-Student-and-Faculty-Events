/**
 * READ-ONLY probe: how many events the STUDENT sees as "open", which is what
 * `restoreSession` iterates sequentially before the tracker can render.
 * Creates nothing, changes nothing.
 */
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { env } from '../src/config/env.js';
import { Event, User } from '../src/models/index.js';
import { stableCaseInsensitive } from '../src/utils/identifiers.js';
import { assertIsolatedTestDatabase } from './support/testDatabaseTarget.js';

assertIsolatedTestDatabase(env.mongoUri, 'probe');
await connectDatabase();

const events = await Event.find({}).sort({ startsAt: 1 }).lean();
const owned = events.filter((e) => /^E2E-/.test(e.name));
console.log(`TOTAL events: ${events.length}`);
console.log(`test-owned (E2E-*) leftovers: ${owned.length}`);
for (const e of owned) {
  console.log(`   "${e.name}" status=${e.status} endsAt=${e.endsAt?.toISOString?.()}`);
}
const now = new Date();
console.log(`now = ${now.toISOString()}`);
const notEnded = events.filter((e) => e.endsAt && e.endsAt > now);
console.log(`events whose window has NOT ended: ${notEnded.length}`);

await disconnectDatabase();
