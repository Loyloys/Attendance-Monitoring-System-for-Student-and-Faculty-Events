/**
 * The single isolation guard shared by every script that WRITES OR DELETES in a
 * test database.
 *
 * WHY ONE MODULE. This rule was copy-pasted into five scripts and a PowerShell
 * launcher, and every copy checked the database NAME only. A name check alone is
 * not sufficient: the LIVE database name is refused, but a URI like
 * `mongodb://127.0.0.1:27017/university_attendance_e2e_test` satisfies every name
 * rule while still pointing at the LIVE mongod. The script would then create or
 * delete records inside the live server's data directory. Refusing the live PORT
 * closes that, and doing it once here is the only way to keep it closed.
 *
 * WHAT IS REFUSED:
 *   - a database whose name does not mark it as a test database;
 *   - the live database by name;
 *   - the live MongoDB port (27017), including an omitted port, which the driver
 *     resolves to 27017.
 *
 * Pure string work: it throws before any connection is opened, so proving it
 * refuses can never itself touch a database.
 */

/** The port the LIVE application's MongoDB listens on. */
export const LIVE_MONGO_PORTS = new Set([27017]);

/** The driver's default port, reached by writing no port at all. */
const DRIVER_DEFAULT_PORT = 27017;

export const LIVE_DATABASE = 'university_attendance';

/** A database name must mark itself as a test database. */
const IS_TEST_DATABASE_NAME = /(^|[_-])test([_-]|$)/i;

export class RefusedDatabaseTargetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RefusedDatabaseTargetError';
  }
}

/**
 * Validates a MongoDB URI for destructive or provisioning work and returns its
 * `{ host, port, database }` parts. Throws BEFORE anything connects.
 *
 * @param {string} uri     the connection string to check
 * @param {string} [label] what the caller is doing, for a useful error
 */
export function assertIsolatedTestDatabase(uri, label = 'use this database') {
  if (typeof uri !== 'string' || uri.trim() === '') {
    throw new RefusedDatabaseTargetError(
      `Refusing to ${label}: no MongoDB URI was supplied.`,
    );
  }

  let parsed;
  try {
    parsed = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'mongodb://'));
  } catch {
    throw new RefusedDatabaseTargetError(
      `Refusing to ${label}: "${uri}" is not a valid MongoDB URI.`,
    );
  }

  // An omitted port means the driver default, which IS the live port.
  const port = parsed.port === '' ? DRIVER_DEFAULT_PORT : Number(parsed.port);
  if (!Number.isInteger(port)) {
    throw new RefusedDatabaseTargetError(
      `Refusing to ${label}: "${parsed.port}" is not a valid port.`,
    );
  }
  if (LIVE_MONGO_PORTS.has(port)) {
    throw new RefusedDatabaseTargetError(
      `Refusing to ${label}: port ${port} is the LIVE application's MongoDB. `
      + 'A test script may only write to an isolated instance.',
    );
  }

  const database = decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
  if (database === '') {
    throw new RefusedDatabaseTargetError(
      `Refusing to ${label}: no database was named in "${uri}".`,
    );
  }
  if (database === LIVE_DATABASE) {
    throw new RefusedDatabaseTargetError(
      `Refusing to ${label}: "${database}" is the LIVE database.`,
    );
  }
  if (!IS_TEST_DATABASE_NAME.test(database)) {
    throw new RefusedDatabaseTargetError(
      `Refusing to ${label}: target database is "${database}", `
      + 'which is not marked as a test database.',
    );
  }

  return { host: parsed.hostname, port, database };
}
