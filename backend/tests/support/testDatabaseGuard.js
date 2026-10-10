/**
 * Refuses to run the test suite against anything but an APPROVED, ISOLATED
 * throwaway database.
 *
 * WHY THIS EXISTS. `tests/helpers.js` calls `mongoose.connection.dropDatabase()`
 * on both setup and teardown. It used to default to
 * `mongodb://127.0.0.1:27017/university_attendance_test` when `TEST_MONGODB_URI`
 * was unset - port 27017 being the LIVE application's MongoDB. So a single
 * forgotten environment variable pointed a destructive suite at the live
 * database, and the only thing that stopped it was the live server happening to
 * be down. "The tests failed to connect" is not a safety control.
 *
 * WHY THE CHECK IS A SEPARATE MODULE. It must be callable and testable WITHOUT
 * a database connection, because the whole point is to refuse before anything
 * connects. It is also imported by `helpers.js` at module load, before any test
 * body runs and long before mongoose dials out.
 *
 * WHAT IS PROTECTED:
 *   - the LIVE database (`university_attendance`) on the live port (27017);
 *   - the E2E FIXTURE database (`university_attendance_e2e_test`), which holds
 *     seeded accounts, venues and 28 events that the browser suite depends on.
 *     `dropDatabase()` on it would silently unbreak every later E2E run.
 */

/** Ports the LIVE application uses. Connecting to any of these is refused. */
export const LIVE_MONGO_PORTS = new Set([27017]);

/**
 * The ONLY databases this suite may create and drop.
 *
 * An exact-match allowlist, not a prefix or pattern. Prefix matching would read
 * `university_attendance_e2e_test` as "a test database" and permit exactly the
 * destructive case this exists to prevent.
 */
export const APPROVED_TEST_DATABASES = new Set([
  'university_attendance_test',
  'university_attendance_unit_test_tmp',
]);

/** Databases that must never be touched, with the reason, for a useful error. */
export const PROTECTED_DATABASES = new Map([
  ['university_attendance', 'the LIVE application database'],
  ['university_attendance_e2e_test', 'the ISOLATED E2E FIXTURE database that the browser suite depends on'],
]);

export class UnsafeTestDatabaseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeTestDatabaseError';
  }
}

const refusal = (reason, detail) => new UnsafeTestDatabaseError(
  `Refusing to run the backend test suite: ${reason}\n`
  + `  ${detail}\n`
  + '  Set TEST_MONGODB_URI to an approved throwaway database on an isolated port, for example:\n'
  + '    $env:TEST_MONGODB_URI = "mongodb://127.0.0.1:27019/university_attendance_test"\n'
  + `  Approved databases: ${[...APPROVED_TEST_DATABASES].join(', ')}\n`
  + `  Refused ports: ${[...LIVE_MONGO_PORTS].join(', ')}`,
);

/**
 * Validates a test database URI and returns its parts. Throws BEFORE any
 * connection is attempted. Returns `{ host, port, database }`.
 *
 * `now` is injectable only so the tests can exercise the "missing configuration"
 * path against a known-empty environment.
 */
export function assertSafeTestDatabaseUri(rawUri, { source = 'TEST_MONGODB_URI' } = {}) {
  if (typeof rawUri !== 'string' || rawUri.trim() === '') {
    throw refusal(
      `${source} is not set.`,
      'There is deliberately NO default: an unset variable previously pointed this '
      + 'destructive suite at the live MongoDB on port 27017.',
    );
  }

  let parsed;
  try {
    parsed = new URL(rawUri);
  } catch {
    throw refusal(`${source} is not a valid MongoDB URI.`, `Received: ${rawUri}`);
  }

  const protocol = parsed.protocol.replace(':', '');
  if (protocol !== 'mongodb' && protocol !== 'mongodb+srv') {
    throw refusal(`${source} uses the unsupported scheme "${protocol}".`, 'Expected mongodb:// or mongodb+srv://.');
  }

  // An omitted port means the driver default, 27017 - which IS the live port.
  // Reading it as "unspecified" rather than "27017" is how this check gets
  // bypassed, so it is resolved explicitly.
  const port = parsed.port === '' ? 27017 : Number(parsed.port);
  if (!Number.isInteger(port)) {
    throw refusal(`${source} has a non-numeric port.`, `Received: ${parsed.port}`);
  }
  if (LIVE_MONGO_PORTS.has(port)) {
    throw refusal(
      `${source} points at port ${port}, which is the LIVE application's MongoDB.`,
      'This suite calls dropDatabase(), so it must never be pointed at the live instance.',
    );
  }

  // Decode, then strip any leading `/`. A path of `/` means "no database given",
  // which the driver would resolve to `test` - not something we approved.
  const database = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  if (database === '') {
    throw refusal(`${source} names no database.`, 'A specific throwaway database must be given.');
  }

  const protectedReason = PROTECTED_DATABASES.get(database);
  if (protectedReason) {
    throw refusal(
      `"${database}" is ${protectedReason}, which this suite must never drop.`,
      'Use a dedicated throwaway database instead.',
    );
  }

  if (!APPROVED_TEST_DATABASES.has(database)) {
    throw refusal(
      `"${database}" is not an approved test database.`,
      `The allowlist is exact-match: ${[...APPROVED_TEST_DATABASES].join(', ')}.`,
    );
  }

  return { host: parsed.hostname, port, database };
}

/**
 * Reads and validates `TEST_MONGODB_URI`. Call this at module load, before
 * mongoose is ever imported or dialled.
 */
export function requireIsolatedTestDatabaseUri(env = process.env) {
  return assertSafeTestDatabaseUri(env.TEST_MONGODB_URI);
}