import assert from 'node:assert/strict';
import supertest from 'supertest';

import { assertSafeTestDatabaseUri, requireIsolatedTestDatabaseUri } from './support/testDatabaseGuard.js';

process.env.NODE_ENV = 'test';
// Pinned explicitly rather than inherited. If the shell that launches the suite
// happens to export SECURE_COOKIES=true (which is correct for the HTTPS phone
// instance), the session cookie is marked Secure and supertest's plain-HTTP
// agent never returns it - every write then fails with an opaque
// "CSRF token missing or invalid". The suite must not depend on ambient env.
process.env.SECURE_COOKIES = 'false';
// SAFETY GATE. Validated at MODULE LOAD, before `mongoose` is imported and long
// before anything connects, because `teardown()`/`reset()` call
// `dropDatabase()`. This used to be `process.env.TEST_MONGODB_URI ||
// 'mongodb://127.0.0.1:27017/university_attendance_test'` - a fallback that
// pointed a destructive suite at the LIVE MongoDB whenever the variable was
// unset. There is now NO default: the guard refuses, and it refuses on the
// E2E fixture database as well as the live one.
const isolatedTestDatabase = requireIsolatedTestDatabaseUri();
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-thirty-two-characters';
process.env.TRUSTED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';
process.env.LOGIN_FAILURE_LIMIT = '5';
process.env.LOGIN_FAILURE_WINDOW_SECONDS = '60';
process.env.LOGIN_LOCK_SECONDS = '30';
// The login REQUEST budget is raised for the suite only. It is a separate
// control from the failure lockout above, which stays exactly as strict: a test
// that asserts an account locks out after 5 wrong passwords must still see that
// behaviour, so raising the request cap cannot weaken it.
process.env.LOGIN_RATE_LIMIT = '500';
// The Google endpoints have a deliberately separate request budget. The suite
// exercises far more Google sign-ins in a minute than any real user would, so
// the budget is raised HERE rather than weakened in the product default (60).
process.env.GOOGLE_AUTH_RATE_LIMIT = '2000';
// The email verification / password-setup endpoints have their own budget. The
// signup + verify + setup suites legitimately exercise more than the product
// default (10 per 15 minutes) from a single IP, so the budget is raised HERE
// rather than weakened in the product default.
process.env.EMAIL_ACTION_RATE_LIMIT = '500';
process.env.GOOGLE_CLIENT_ID = '1234567890-test.apps.googleusercontent.com';
// Encrypts stored QR credentials. Test-only value; the real one is an operator
// secret that must never appear in source control.
process.env.EVENT_QR_ENCRYPTION_KEY = 'test-only-event-qr-encryption-key-0123456789abcdef';
process.env.GOOGLE_ALLOWED_ISSUERS = 'accounts.google.com,https://accounts.google.com';
// The suite exercises the private development-testing policy, because that is a
// self-contained policy whose per-account refusals are easy to assert. The
// `open` and approval behaviour is covered separately in the tests that spawn a
// process with an explicit policy. `verifyGoogleCredential` is stubbed per test,
// so the addresses below are fixtures, never real accounts.
process.env.GOOGLE_ACCESS_POLICY = 'development_test';
process.env.GOOGLE_DEV_TEST_EMAILS = [
  'new.user@gmail.com',
  'mine@gmail.com',
  'tester@example.com',
  'fac@cot.edu',
  'stu@cot.edu',
  'shared@cot.edu',
  'blocked@cot.edu',
  'person@gmail.com',
].join(',');

let app;
let mongoose;
let database;
let models;
let ids;
let passwords;
let identifiers;

/**
 * Creates the approval-gated indexes in THIS isolated test database only.
 *
 * The application deliberately never builds these on its own - see
 * INDEX_CREATION_EXCLUDED_MODELS - because doing so would perform the
 * approval-gated rollout implicitly on the live database. The suite still needs
 * the real `unique_user_event_session` and `unique_active_code_per_event`
 * indexes, otherwise the concurrency guarantees it asserts would be resting on a
 * service-level check that a live server does not rely on. Creating them here
 * keeps the rollout gate honest AND keeps these tests honest.
 *
 * This is the "explicitly initialized test environment" the rollout gate
 * requires: nothing creates these implicitly any more.
 */
async function ensureGatedIndexes() {
  await models.AttendanceSession.createIndexes();
  await models.AttendanceCode.createIndexes();
  // AD003.3: isolated-test only. The live rollout stays approval-gated.
  await models.SignupRequest.createIndexes();
}

export const minutes = (value) => value * 60 * 1_000;
export const request = () => supertest(app);
export const agent = () => supertest.agent(app);
export const getModels = () => models;
export const getApp = () => app;

export async function setup() {
  database = await import('../src/config/database.js');
  ({ mongoose } = await import('mongoose'));
  models = await import('../src/models/index.js');
  ids = await import('../src/utils/ids.js');
  passwords = await import('../src/utils/passwords.js');
  identifiers = await import('../src/utils/identifiers.js');
  const { createApp } = await import('../src/app.js');
  await database.connectDatabase();
  await database.ensureDatabaseIndexes();
  await ensureGatedIndexes();
  app = await createApp();
}

/**
 * Re-validates immediately before dropping, not just at module load.
 *
 * The load-time gate is the main control; this is the backstop for the case
 * where something reassigns `process.env.MONGODB_URI` or the connection's
 * database between setup and teardown. `dropDatabase()` is irreversible, so the
 * check is repeated at the point of destruction rather than trusted from
 * earlier.
 */
async function dropTestDatabase() {
  const before = mongoose.connection.name;
  const approved = assertSafeTestDatabaseUri(
    `mongodb://127.0.0.1:${isolatedTestDatabase.port}/${before}`,
  );
  assert.equal(
    approved.database,
    isolatedTestDatabase.database,
    `refusing to drop "${before}": the connected database is not the approved test database`,
  );
  await mongoose.connection.dropDatabase();
}

export async function teardown() {
  await dropTestDatabase();
  await app?.locals.sessionClient?.close();
  await database?.disconnectDatabase();
}

export async function reset() {
  await dropTestDatabase();
  await database.ensureDatabaseIndexes();
  await ensureGatedIndexes();
  await models.SystemSetting.findByIdAndUpdate(
    'google_oauth_enabled',
    { $set: { value: true } },
    { upsert: true },
  );
}

export async function csrfToken(agent) {
  const response = await agent.get('/api/auth/csrf/');
  assert.equal(response.status, 200);
  return response.body.csrfToken;
}

export async function login(identifier = 'STU001', password = 'test-pass-123') {
  const agent = supertest.agent(app);
  const token = await csrfToken(agent);
  const response = await agent
    .post('/api/auth/login/')
    .set('X-CSRFToken', token)
    .send({ identifier, password });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return { agent, user: response.body };
}

export async function send(agent, method, path, body) {
  const token = await csrfToken(agent);
  const operation = agent[method](path).set('X-CSRFToken', token);
  if (body !== undefined) operation.send(body);
  return operation;
}

export async function createUser({ username, role, name = username, email, card = null, password = 'test-pass-123' }) {
  const user = await models.User.create({
    accountId: username,
    accountIdNormalized: identifiers.stableCaseInsensitive(username),
    username,
    usernameNormalized: identifiers.stableCaseInsensitive(username),
    passwordHash: passwords.createDjangoPassword(password, 1_000),
    email: email || `${username.toLowerCase()}@cot.edu`,
    emailNormalized: (email || `${username.toLowerCase()}@cot.edu`).toLowerCase(),
    isActive: true,
    isStaff: role === 'admin',
    dateJoined: new Date(),
  });
  const profile = await models.UserProfile.create({
    userId: user._id,
    role,
    displayName: name,
    department: 'COT',
    phone: '',
    cardIdentifier: card,
    ...(card ? { cardIdentifierNormalized: identifiers.stableCaseInsensitive(card) } : {}),
  });
  return { user, profile };
}

// A geofence centred on the sample venue, used by GST004 tests and by the scan
// tests so they keep exercising the code path they were written for.
export const VENUE = { latitude: 14.5995, longitude: 120.9842, radiusMeters: 150 };

/** A location fix that sits inside the fence and is fresh. */
export const atVenue = (overrides = {}) => ({
  latitude: VENUE.latitude,
  longitude: VENUE.longitude,
  accuracy: 12,
  capturedAt: new Date().toISOString(),
  ...overrides,
});

export async function createEvent(organizer, overrides = {}) {
  const now = Date.now();
  return models.Event.create({
    name: `Event ${organizer.username}`,
    description: 'Integration test event',
    startsAt: new Date(now - minutes(60)),
    endsAt: new Date(now + minutes(120)),
    checkInOpensAt: new Date(now - minutes(30)),
    checkInClosesAt: new Date(now + minutes(60)),
    lateCutoff: new Date(now + minutes(15)),
    venue: 'Innovation Hall',
    audience: 'all',
    organizerId: organizer._id,
    supervisors: [],
    status: 'published',
    registrationRequired: false,
    attendanceMethod: 'qr',
    venueLatitude: VENUE.latitude,
    venueLongitude: VENUE.longitude,
    venueRadiusMeters: VENUE.radiusMeters,
    ...overrides,
  });
}

export const nextId = (name) => ids.nextNumericId(name);
