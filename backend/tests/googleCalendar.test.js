import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = '259097096931-9nlqjfaeepednjh7r5tlfhogb543sbuq.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_CALENDAR_REDIRECT_URI = 'http://localhost:8000/api/auth/google/calendar/callback/';
delete process.env.GOOGLE_CALENDAR_ID;
process.env.EVENT_QR_ENCRYPTION_KEY = 'test-only-event-qr-encryption-key-0123456789abcdef';

const {
  __calendarPayloadForTest,
  calendarAuthorizationUrl,
  calendarConnectionStatus,
} = await import('../src/services/googleCalendarService.js');
const { calendarLinkReasonForEvent, calendarUrlForEvent, serializeAdminEvent, serializeEventContext } = await import('../src/services/eventSerializer.js');

test('Calendar payload preserves event fields and Manila timezone', () => {
  const payload = __calendarPayloadForTest({
    name: 'Orientation',
    description: 'Bring your ID.',
    startsAt: '2026-11-02T01:00:00.000Z',
    endsAt: '2026-11-02T03:00:00.000Z',
  });

  assert.deepEqual(payload, {
    summary: 'Orientation',
    description: 'Bring your ID.',
    start: { dateTime: '2026-11-02T01:00:00.000Z', timeZone: 'Asia/Manila' },
    end: { dateTime: '2026-11-02T03:00:00.000Z', timeZone: 'Asia/Manila' },
  });
});

test('Calendar authorization uses the configured callback and never includes the client secret', () => {
  const request = { session: {} };
  const url = new URL(calendarAuthorizationUrl(request));

  assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8000/api/auth/google/calendar/callback/');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/calendar.events');
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.match(request.session.googleCalendarState, /^[A-Za-z0-9_-]+$/);
});

test('Calendar status reports configuration gaps without exposing secrets', async () => {
  const status = await calendarConnectionStatus(null);
  assert.equal(status.configured, true);
  assert.equal(status.connected, false);
  assert.deepEqual(status.missing, []);
});

test('Calendar sync defaults to the authorized Admin primary calendar', async () => {
  const { env } = await import('../src/config/env.js');
  assert.equal(env.googleCalendarId, 'primary');
});

test('event serializers expose only a safe Calendar URL for valid synced IDs', () => {
  const event = {
    _id: 'event-1',
    name: 'Orientation',
    description: '',
    startsAt: '2026-11-02T01:00:00.000Z',
    endsAt: '2026-11-02T03:00:00.000Z',
    lateCutoff: '2026-11-02T01:30:00.000Z',
    checkInOpensAt: '2026-11-02T01:00:00.000Z',
    checkInClosesAt: '2026-11-02T03:00:00.000Z',
    venue: 'Test Hall',
    audience: 'all',
    attendanceMethod: 'qr',
    status: 'published',
    registrationRequired: false,
    requiredForAttendance: false,
    googleCalendarEventId: 'calendar-event_123',
    googleCalendarHtmlLink: 'https://calendar.google.com/calendar/event?eid=canonical-event-link',
  };
  const expected = 'https://calendar.google.com/calendar/event?eid=canonical-event-link';
  assert.equal(calendarUrlForEvent(event), expected);
  assert.equal(calendarLinkReasonForEvent(event), null);
  assert.equal(serializeAdminEvent(event, null).calendar_url, expected);
  assert.equal(serializeEventContext(event, {
    userRole: 'student',
    status: 'upcoming',
    eventAllows: true,
    now: new Date('2026-11-01T00:00:00.000Z'),
  }).calendar_url, expected);
  assert.equal(calendarUrlForEvent({ googleCalendarEventId: 'not safe/id' }), null);
  assert.equal(calendarUrlForEvent({ googleCalendarEventId: null }), null);
  assert.equal(calendarUrlForEvent({
    googleCalendarEventId: 'calendar-event_123',
    googleCalendarHtmlLink: 'http://example.test/event',
  }), null);
  assert.equal(calendarLinkReasonForEvent({ googleCalendarEventId: 'calendar-event_123' }), 'permission_unavailable');
  assert.equal(calendarLinkReasonForEvent({}), 'not_synced');
});
