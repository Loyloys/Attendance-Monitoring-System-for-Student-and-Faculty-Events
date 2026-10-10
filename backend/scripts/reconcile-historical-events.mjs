/**
 * READ-ONLY reconciliation of the historical-event classification.
 *
 * WHAT IT DOES. Loads every event from the ISOLATED fixture database only, read
 * only, and reports the stored instant next to the Manila wall-clock it reads
 * back as.
 *
 * WHY THERE IS NO "BYPASSES THE BUG" COLUMN HERE. An earlier version of this
 * file tried to classify each event by comparing its Manila hour with its UTC
 * hour and calling any delta other than 8 a bypass. That metric is INVALID and
 * is recorded here so nobody repeats it.
 *
 * The Philippines is UTC+8 with no daylight saving, so for EVERY instant -
 * correctly stored or not - the Manila wall-clock minus the UTC wall-clock is
 * exactly 8. Measured on this machine:
 *
 *   stored 17:25Z, which is the BUGGY result of typing 17:25  -> delta = 8
 *   stored 09:25Z, which is the CORRECT result of typing 17:25 -> delta = 8
 *   stored 00:00Z, which is the CORRECT result of typing 08:00 -> delta = 8
 *
 * The metric returns 8 in all three cases, so it separates nothing and would
 * have reported every event identically. A correctly-stored event therefore
 * cannot be recognised from its own timestamp alone.
 *
 * DISTINGUISHING A BUGGY RECORD. The only reliable signal is the ADMIN-SIDE
 * value that was typed, which is not stored in the event document: the form
 * echoed a UTC slice of the wrong instant, so the stored record contains no
 * trace of what the administrator entered. Deciding this for real requires
 * either that external record or a human check, not a heuristic over
 * timestamps. This script therefore reports the facts and stops.
 *
 * IT CHANGES NOTHING. There is no insert, update or delete in this file, and it
 * refuses to run unless MONGODB_URI names a test database on a non-live port.
 *
 * Usage:
 *   MONGODB_URI=mongodb://127.0.0.1:27019/university_attendance_e2e_test \
 *     node scripts/reconcile-historical-events.mjs
 */
import { MongoClient } from 'mongodb';

import { assertIsolatedTestDatabase } from './support/testDatabaseTarget.js';
import { manilaTime } from '../src/utils/eventTimeZone.js';

const uri = process.env.MONGODB_URI || '';
const { database } = assertIsolatedTestDatabase(uri, 'reconcile historical events');

const client = new MongoClient(uri);
await client.connect();

try {
  const events = await client.db(database).collection('events')
    .find({})
    .project({ name: 1, status: 1, startsAt: 1, endsAt: 1, lateCutoff: 1 })
    .toArray();

  const rows = events.map((event) => {
    const start = new Date(event.startsAt);
    const end = new Date(event.endsAt);
    const cutoff = new Date(event.lateCutoff);
    return {
      name: String(event.name),
      status: event.status,
      createdAt: event.createdAt ? new Date(event.createdAt) : null,
      startsAtUtc: start.toISOString(),
      endsAtUtc: end.toISOString(),
      cutoffUtc: cutoff.toISOString(),
      readsBackAsManila: `${manilaTime(start)} - ${manilaTime(end)}`,
      // NOT a bug verdict. See the header: the typed wall-clock was never stored,
      // so this cannot distinguish a buggy record from a correct one.
      note: 'needs the typed admin value to classify',
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  for (const row of rows) {
    console.log(
      row.name.padEnd(44),
      String(row.status).padEnd(10),
      `storedUTC=${row.startsAtUtc.slice(0, 16).replace('T', ' ')}`,
      `readsBackAsManila=${row.readsBackAsManila}`,
    );
  }

  console.log('---');
  console.log(`database                : ${database}`);
  console.log(`total events            : ${rows.length}`);
  console.log('classified buggy/clean  : NOT DETERMINABLE from stored data alone');
  console.log('                         (the typed admin wall-clock was never persisted)');
} finally {
  await client.close();
}
