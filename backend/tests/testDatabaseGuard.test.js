import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import {
  APPROVED_TEST_DATABASES,
  UnsafeTestDatabaseError,
  assertSafeTestDatabaseUri,
  requireIsolatedTestDatabaseUri,
} from './support/testDatabaseGuard.js';
import {
  LIVE_MONGO_PORTS,
  RefusedDatabaseTargetError,
  assertIsolatedTestDatabase,
} from '../scripts/support/testDatabaseTarget.js';

/**
 * The backend suite calls `dropDatabase()` on setup AND teardown. These tests
 * prove it refuses to reach that point against the live database, against the
 * E2E fixture database, or against any configuration it was not explicitly
 * given.
 *
 * NONE OF THESE TESTS OPEN A CONNECTION. That is deliberate and is the property
 * being demonstrated: the guard is a pure check over the URI string, so proving
 * it refuses cannot itself touch a database. A test that had to connect to
 * confirm the refusal would be dangerous to run.
 */

/** Asserts the guard throws, and returns the error for message inspection. */
function refuses(uri, { source } = {}) {
  let thrown;
  try {
    assertSafeTestDatabaseUri(uri, source ? { source } : {});
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof UnsafeTestDatabaseError, `expected "${uri}" to be refused`);
  return thrown;
}

describe('test database safety guard', () => {
  describe('refuses the LIVE database', () => {
    test('the live port is refused even with an approved database name', () => {
      assert.match(
        refuses('mongodb://127.0.0.1:27017/university_attendance_test').message,
        /LIVE application's MongoDB/,
      );
    });

    test('the omitted port resolves to the live port and is refused', () => {
      // mongodb:// without a port means 27017 to the driver. Treating that as
      // "unspecified" rather than "live" is the bypass this test closes.
      assert.match(
        refuses('mongodb://127.0.0.1/university_attendance_test').message,
        /LIVE application's MongoDB/,
      );
    });

    test('the live database name is refused even on an isolated port', () => {
      assert.match(
        refuses('mongodb://127.0.0.1:27019/university_attendance').message,
        /LIVE application database/,
      );
    });

    test('a non-local host on the live port is refused too', () => {
      assert.match(
        refuses('mongodb://db.internal:27017/university_attendance_test').message,
        /LIVE application's MongoDB/,
      );
    });
  });

  describe('refuses the E2E fixture database', () => {
    test('the fixture database is refused on the isolated port', () => {
      // This is the case a prefix or `endsWith('_test')` rule would wave
      // through, and dropping it would silently unbreak every later browser run.
      assert.match(
        refuses('mongodb://127.0.0.1:27019/university_attendance_e2e_test').message,
        /E2E FIXTURE database/,
      );
    });

    test('the fixture database is refused on the live port as well', () => {
      refuses('mongodb://127.0.0.1:27017/university_attendance_e2e_test');
    });
  });

  describe('refuses missing or unusable configuration', () => {
    test('an unset variable is refused instead of falling back to a default', () => {
      // The exact regression: the old default sent an unset run to port 27017.
      const error = refuses(undefined);
      assert.match(error.message, /is not set/);
      assert.match(error.message, /NO default/);
    });

    test('an empty or whitespace value is refused', () => {
      refuses('');
      refuses('   ');
    });

    test('a non-string value is refused', () => {
      refuses(27019);
      refuses(null);
    });

    test('a malformed URI is refused', () => {
      refuses('not-a-uri');
    });

    test('an unsupported scheme is refused', () => {
      assert.match(
        refuses('http://127.0.0.1:27019/university_attendance_test').message,
        /unsupported scheme/,
      );
    });

    test('a URI with no database is refused rather than defaulting to "test"', () => {
      assert.match(
        refuses('mongodb://127.0.0.1:27019/').message,
        /names no database/,
      );
    });

    test('an unapproved database name is refused', () => {
      assert.match(
        refuses('mongodb://127.0.0.1:27019/some_other_database').message,
        /not an approved test database/,
      );
    });

    test('the allowlist is exact-match, not a prefix', () => {
      // `university_attendance_e2e_test` and `university_attendance_test_backup`
      // both start with an approved name. Neither may be dropped.
      assert.equal(APPROVED_TEST_DATABASES.has('university_attendance_e2e_test'), false);
      refuses('mongodb://127.0.0.1:27019/university_attendance_test_backup');
    });
  });
});
describe('test database safety guard (accepted cases)', () => {
  describe('accepts only an explicitly approved throwaway database', () => {
    test('an approved database on an isolated port is accepted', () => {
      const parsed = assertSafeTestDatabaseUri(
        'mongodb://127.0.0.1:27019/university_attendance_test',
      );
      assert.deepEqual(parsed, {
        host: '127.0.0.1', port: 27019, database: 'university_attendance_test',
      });
    });

    test('every allowlisted database is accepted on an isolated port', () => {
      for (const database of APPROVED_TEST_DATABASES) {
        assert.equal(
          assertSafeTestDatabaseUri(`mongodb://127.0.0.1:27019/${database}`).database,
          database,
        );
      }
    });

    test('credentials and a query string do not defeat the check', () => {
      const parsed = assertSafeTestDatabaseUri(
        'mongodb://user:pass@127.0.0.1:27019/university_attendance_test?retryWrites=true',
      );
      assert.equal(parsed.database, 'university_attendance_test');
    });
  });

  describe('requireIsolatedTestDatabaseUri reads the environment', () => {
    test('it accepts an approved environment', () => {
      assert.equal(
        requireIsolatedTestDatabaseUri({
          TEST_MONGODB_URI: 'mongodb://127.0.0.1:27019/university_attendance_test',
        }).port,
        27019,
      );
    });

    test('it refuses an environment with no TEST_MONGODB_URI', () => {
      assert.throws(() => requireIsolatedTestDatabaseUri({}), UnsafeTestDatabaseError);
    });

    test('it refuses an environment pointing at the live database', () => {
      assert.throws(
        () => requireIsolatedTestDatabaseUri({
          TEST_MONGODB_URI: 'mongodb://127.0.0.1:27017/university_attendance_test',
        }),
        UnsafeTestDatabaseError,
      );
    });

    test('it refuses an environment pointing at the E2E fixture database', () => {
      assert.throws(
        () => requireIsolatedTestDatabaseUri({
          TEST_MONGODB_URI: 'mongodb://127.0.0.1:27019/university_attendance_e2e_test',
        }),
        UnsafeTestDatabaseError,
      );
    });
  });

  describe('the guard never connects', () => {
    test('an approved URI is accepted with no I/O, even on a dead port', () => {
      // Port 1 is not listening and never will be. If the guard dialled it, this
      // call would hang or raise a connection error. It returns a parsed result
      // synchronously, which is what proves validation is pure string work and
      // happens before anything reaches the network.
      const parsed = assertSafeTestDatabaseUri(
        'mongodb://127.0.0.1:1/university_attendance_test',
      );
      assert.deepEqual(parsed, {
        host: '127.0.0.1', port: 1, database: 'university_attendance_test',
      });
    });

    test('a refusal is also produced with no I/O, even on a dead host', () => {
      // An unresolvable host plus the LIVE database name. The guard must reject
      // it on the NAME, returning instantly; if it tried to resolve or dial the
      // host first it would hang or fail with a network error instead.
      const error = refuses('mongodb://no-such-host.invalid:27019/university_attendance');
      assert.ok(error instanceof UnsafeTestDatabaseError);
      assert.match(error.message, /Refusing to run the backend test suite/);
      assert.match(error.message, /LIVE application database/);
    });
  });
});

/**
 * The guard the SEEDING and CLEANUP scripts share.
 *
 * It was previously copy-pasted into six scripts and checked the database NAME
 * only, which meant `mongodb://127.0.0.1:27017/university_attendance_e2e_test`
 * was accepted by all of them - a test-marked database name on the LIVE mongod.
 * These tests pin the port rule that closes that.
 *
 * As above, NONE of these open a connection: the guard is pure string work, so
 * proving it refuses cannot itself touch a database.
 */
describe('script database target guard', () => {
  const scriptRefuses = (uri) => {
    let thrown;
    try {
      assertIsolatedTestDatabase(uri, 'clean up');
    } catch (error) {
      thrown = error;
    }
    assert.ok(thrown instanceof RefusedDatabaseTargetError, `expected "${uri}" to be refused`);
    return thrown;
  };

  test('the live port is refused even when the database name is test-marked', () => {
    // The regression: every name rule passes here, and it is still the LIVE
    // mongod. This is what the six duplicated checks all missed.
    const error = scriptRefuses('mongodb://127.0.0.1:27017/university_attendance_e2e_test');
    assert.match(error.message, /LIVE application's MongoDB/);
  });

  test('an omitted port resolves to the live port and is refused', () => {
    scriptRefuses('mongodb://127.0.0.1/university_attendance_e2e_test');
  });

  test('the live database name is refused on an isolated port', () => {
    scriptRefuses('mongodb://127.0.0.1:27019/university_attendance');
  });

  test('a non-test database name is refused on an isolated port', () => {
    scriptRefuses('mongodb://127.0.0.1:27019/some_other_database');
  });

  test('a missing or malformed URI is refused', () => {
    scriptRefuses(undefined);
    scriptRefuses('');
    scriptRefuses('not-a-uri');
  });

  test('a URI naming no database is refused', () => {
    scriptRefuses('mongodb://127.0.0.1:27019/');
  });

  test('the isolated fixture database is accepted and its port is read', () => {
    assert.deepEqual(
      assertIsolatedTestDatabase('mongodb://127.0.0.1:27019/university_attendance_e2e_test', 'seed'),
      { host: '127.0.0.1', port: 27019, database: 'university_attendance_e2e_test' },
    );
  });

  test('it agrees with the unit-suite guard about which port is live', () => {
    // One definition of "live", shared, so the two guards cannot drift apart.
    assert.deepEqual([...LIVE_MONGO_PORTS], [27017]);
    assert.ok(LIVE_MONGO_PORTS.has(27017));
    assert.ok(!LIVE_MONGO_PORTS.has(27019));
  });

  test('refusal is produced with no I/O, even against a dead host', () => {
    const error = scriptRefuses('mongodb://no-such-host.invalid:27019/university_attendance');
    assert.match(error.message, /LIVE database/);
  });
});
