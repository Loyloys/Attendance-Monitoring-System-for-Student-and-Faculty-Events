import assert from 'node:assert/strict';
import supertest from 'supertest';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/university_attendance_test';
process.env.SESSION_SECRET = 'test-session-secret-with-at-least-thirty-two-characters';
process.env.TRUSTED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';
process.env.LOGIN_FAILURE_LIMIT = '5';
process.env.LOGIN_FAILURE_WINDOW_SECONDS = '60';
process.env.LOGIN_LOCK_SECONDS = '30';
process.env.GOOGLE_CLIENT_ID = '1234567890-test.apps.googleusercontent.com';
process.env.GOOGLE_ALLOWED_ISSUERS = 'accounts.google.com,https://accounts.google.com';

let app;
let mongoose;
let database;
let models;
let ids;
let passwords;
let identifiers;

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
  app = await createApp();
}

export async function teardown() {
  await mongoose.connection.dropDatabase();
  await app?.locals.sessionClient?.close();
  await database?.disconnectDatabase();
}

export async function reset() {
  await mongoose.connection.dropDatabase();
  await database.ensureDatabaseIndexes();
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
