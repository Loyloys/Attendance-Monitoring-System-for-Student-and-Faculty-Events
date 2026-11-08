import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createUser,
  getModels,
  login,
  reset,
  send,
  setup,
  teardown,
} from './helpers.js';
import { syncEventToCalendar } from '../src/services/googleCalendarService.js';
import { encryptSecret } from '../src/utils/secretBox.js';

before(setup);
after(teardown);
beforeEach(reset);

test('one Admin create action results in one app event and one event in Student and Faculty lists', async () => {
  const { user: adminUser } = await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  await createUser({ username: 'FAC001', role: 'faculty' });

  const { agent: admin } = await login('ADM001');
  const { agent: student } = await login('STU001');
  const { agent: faculty } = await login('FAC001');

  const eventId = randomUUID();
  const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const payload = {
    id: eventId,
    name: 'Campus Tech Summit',
    description: 'Annual technology conference',
    date,
    start: '09:00',
    end: '16:00',
    cutoff: '09:30',
    venue: 'Main Auditorium',
    audience: 'all',
    method: 'qr',
    status: 'published',
    registrationRequired: false,
    requiredForAttendance: false,
  };

  const createResponse = await send(admin, 'post', '/api/admin/events/', payload);
  assert.equal(createResponse.status, 201, JSON.stringify(createResponse.body));
  assert.equal(createResponse.body.id, eventId);

  // Exactly one event record in database
  const matchingEvents = await getModels().Event.find({ name: 'Campus Tech Summit' }).lean();
  assert.equal(matchingEvents.length, 1);
  assert.equal(matchingEvents[0]._id, eventId);

  // Exactly one event in Student list
  const studentEvents = await student.get('/api/events/');
  assert.equal(studentEvents.status, 200);
  const studentMatches = studentEvents.body.filter((ev) => ev.id === eventId);
  assert.equal(studentMatches.length, 1, 'Student should see exactly one event card, not duplicates');

  // Exactly one event in Faculty list
  const facultyEvents = await faculty.get('/api/events/');
  assert.equal(facultyEvents.status, 200);
  const facultyMatches = facultyEvents.body.filter((ev) => ev.id === eventId);
  assert.equal(facultyMatches.length, 1, 'Faculty should see exactly one event card, not duplicates');
});

test('event creation is safe to retry with the same event ID without creating duplicate app events', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });
  await createUser({ username: 'FAC001', role: 'faculty' });

  const { agent: admin } = await login('ADM001');
  const { agent: student } = await login('STU001');
  const { agent: faculty } = await login('FAC001');

  const eventId = randomUUID();
  const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const payload = {
    id: eventId,
    name: 'Hackathon 2026',
    description: '24-hour coding competition',
    date,
    start: '08:00',
    end: '18:00',
    cutoff: '08:45',
    venue: 'Engineering Hall',
    audience: 'all',
    method: 'qr',
    status: 'published',
    registrationRequired: true,
    requiredForAttendance: true,
  };

  // Initial creation
  const firstResponse = await send(admin, 'post', '/api/admin/events/', payload);
  assert.equal(firstResponse.status, 201);
  assert.equal(firstResponse.body.id, eventId);

  // Retry the exact same creation (e.g. network hiccup, client retry, double click)
  const retryResponse = await send(admin, 'post', '/api/admin/events/', payload);
  assert.equal(retryResponse.status, 201);
  assert.equal(retryResponse.body.id, eventId);

  // Verify only ONE event exists in the database
  const matchingEvents = await getModels().Event.find({ name: 'Hackathon 2026' }).lean();
  assert.equal(matchingEvents.length, 1, 'Retry must not create a second event record in the database');
  assert.equal(matchingEvents[0]._id, eventId);

  // Verify only ONE event appears in Student list
  const studentEvents = await student.get('/api/events/');
  assert.equal(studentEvents.status, 200);
  const studentMatches = studentEvents.body.filter((ev) => ev.id === eventId);
  assert.equal(studentMatches.length, 1, 'Student list must contain exactly one event after a retry');

  // Verify only ONE event appears in Faculty list
  const facultyEvents = await faculty.get('/api/events/');
  assert.equal(facultyEvents.status, 200);
  const facultyMatches = facultyEvents.body.filter((ev) => ev.id === eventId);
  assert.equal(facultyMatches.length, 1, 'Faculty list must contain exactly one event after a retry');

  // Verify Admin list also contains exactly one event
  const adminEvents = await admin.get('/api/admin/events/');
  assert.equal(adminEvents.status, 200);
  const adminMatches = adminEvents.body.filter((ev) => ev.id === eventId);
  assert.equal(adminMatches.length, 1, 'Admin list must contain exactly one event after a retry');

  // Preserves registration behavior
  const registerResponse = await send(student, 'post', `/api/events/${eventId}/registrations/`);
  assert.equal(registerResponse.status, 201);
  assert.equal(registerResponse.body.registered, true);

  // Preserves event-edit behavior
  const updateResponse = await send(admin, 'patch', `/api/admin/events/${eventId}/`, { venue: 'Main Lab' });
  assert.equal(updateResponse.status, 200);
  assert.equal(updateResponse.body.venue, 'Main Lab');

  // Preserves archive behavior
  const archiveResponse = await send(admin, 'post', `/api/admin/events/${eventId}/archive/`);
  assert.equal(archiveResponse.status, 200);

  const studentEventsAfterArchive = await student.get('/api/events/');
  assert.equal(studentEventsAfterArchive.body.some((ev) => ev.id === eventId), false, 'Archived event hidden from student list');

  const studentArchivedEvents = await student.get('/api/events/archived/');
  assert.equal(studentArchivedEvents.body.some((ev) => ev.id === eventId), true, 'Archived registered event appears in student archive history');
});

test('retrying Admin event create without client ID within recent window prevents duplicate event', async () => {
  await createUser({ username: 'ADM001', role: 'admin' });
  await createUser({ username: 'STU001', role: 'student' });

  const { agent: admin } = await login('ADM001');
  const { agent: student } = await login('STU001');

  const date = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const payload = {
    name: 'Rapid Double Submit Event',
    description: 'Testing accidental double submission without ID',
    date,
    start: '10:00',
    end: '11:00',
    cutoff: '10:15',
    venue: 'Room 101',
    audience: 'student',
    method: 'qr',
    status: 'published',
    registrationRequired: false,
    requiredForAttendance: false,
  };

  const first = await send(admin, 'post', '/api/admin/events/', payload);
  assert.equal(first.status, 201);

  const second = await send(admin, 'post', '/api/admin/events/', payload);
  assert.equal(second.status, 201);
  assert.equal(second.body.id, first.body.id, 'Second submission should reuse the created event');

  const allMatching = await getModels().Event.find({ name: 'Rapid Double Submit Event' }).lean();
  assert.equal(allMatching.length, 1, 'Database must contain only 1 event record');

  const studentList = await student.get('/api/events/');
  const matches = studentList.body.filter((ev) => ev.name === 'Rapid Double Submit Event');
  assert.equal(matches.length, 1, 'Student list must show exactly 1 event');
});

test('Google Calendar sync does not create duplicate Calendar entries after a retry', async () => {
  const { user: adminUser } = await createUser({ username: 'ADM001', role: 'admin' });
  // Connect Google Calendar for adminUser
  await getModels().User.updateOne(
    { _id: adminUser._id },
    {
      $set: {
        googleCalendarRefreshTokenEncrypted: encryptSecret('test-refresh-token'),
        googleCalendarConnectedAt: new Date(),
      },
    },
  );

  const event = await getModels().Event.create({
    name: 'Calendar Sync Test Event',
    description: 'Testing calendar idempotency on retry',
    startsAt: new Date(Date.now() + 3600_000),
    endsAt: new Date(Date.now() + 7200_000),
    checkInOpensAt: new Date(Date.now() + 1800_000),
    checkInClosesAt: new Date(Date.now() + 7200_000),
    lateCutoff: new Date(Date.now() + 4200_000),
    venue: 'Sync Hall',
    audience: 'all',
    organizerId: adminUser._id,
    supervisors: [],
    status: 'published',
    attendanceMethod: 'qr',
  });

  const calendarCalls = { post: 0, patch: 0 };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (String(url).includes('/calendar/v3/calendars/')) {
      if (method === 'POST') {
        calendarCalls.post += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'gcal_calendar_event_12345', htmlLink: 'https://calendar.google.com/calendar/event?eid=gcal_12345' }),
        };
      }
      if (method === 'PATCH') {
        calendarCalls.patch += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'gcal_calendar_event_12345', htmlLink: 'https://calendar.google.com/calendar/event?eid=gcal_12345' }),
        };
      }
    }
    return originalFetch(url, options);
  };

  try {
    const mockRequest = { session: {} };

    // Initial sync
    const firstSync = await syncEventToCalendar(event, adminUser, mockRequest);
    assert.equal(firstSync.ok, true);
    assert.equal(calendarCalls.post, 1, 'Initial sync must call POST to create Calendar entry');
    assert.equal(calendarCalls.patch, 0);

    // Verify stored event in DB received googleCalendarEventId
    const storedAfterFirst = await getModels().Event.findById(event._id).lean();
    assert.equal(storedAfterFirst.googleCalendarEventId, 'gcal_calendar_event_12345');

    // Simulate retry of the event sync (e.g. admin retries event creation/edit)
    const retrySync = await syncEventToCalendar(event, adminUser, mockRequest);
    assert.equal(retrySync.ok, true);
    assert.equal(calendarCalls.post, 1, 'Retry must NOT call POST again');
    assert.equal(calendarCalls.patch, 1, 'Retry must call PATCH to update the existing Calendar entry');

    // Calendar event ID remains stable
    const storedAfterRetry = await getModels().Event.findById(event._id).lean();
    assert.equal(storedAfterRetry.googleCalendarEventId, 'gcal_calendar_event_12345');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
