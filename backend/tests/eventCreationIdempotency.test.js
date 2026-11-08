import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Event } from '../src/models/index.js';
import { createEvent } from '../src/services/eventService.js';
import { syncEventToCalendar } from '../src/services/googleCalendarService.js';
import { User } from '../src/models/index.js';
import * as systemSettingsService from '../src/services/systemSettingsService.js';

test('createEvent: one Admin create action results in one app event with specified ID', async () => {
  const eventId = randomUUID();
  const organizer = { _id: 'admin_user_id', username: 'ADM001' };

  let savedDoc = null;
  const originalFindById = Event.findById;
  const originalFindOne = Event.findOne;

  // Mock Event.findById to return null (new event)
  Event.findById = async () => null;

  // Intercept Event prototype save
  const originalSave = Event.prototype.save;
  Event.prototype.save = async function mockSave() {
    savedDoc = this;
    return this;
  };

  try {
    const data = {
      id: eventId,
      name: 'Single App Event',
      description: 'One create action creates one event',
      date: '2026-11-20',
      start: '09:00',
      end: '11:00',
      cutoff: '09:15',
      venue: 'Main Hall',
      audience: 'all',
      method: 'qr',
      status: 'published',
      registrationRequired: false,
      requiredForAttendance: false,
    };

    const created = await createEvent(data, organizer);
    assert.equal(created._id, eventId);
    assert.equal(created.name, 'Single App Event');
    assert.equal(savedDoc._id, eventId);
  } finally {
    Event.findById = originalFindById;
    Event.findOne = originalFindOne;
    Event.prototype.save = originalSave;
  }
});

test('createEvent: safe to retry with same event ID without creating a second event', async () => {
  const eventId = randomUUID();
  const organizer = { _id: 'admin_user_id', username: 'ADM001' };

  // Simulate an event that was already persisted on the first try
  const existingEvent = new Event({
    _id: eventId,
    name: 'Hackathon Event',
    description: 'Initial creation',
    startsAt: new Date('2026-11-20T01:00:00.000Z'),
    endsAt: new Date('2026-11-20T03:00:00.000Z'),
    checkInOpensAt: new Date('2026-11-20T00:30:00.000Z'),
    checkInClosesAt: new Date('2026-11-20T03:00:00.000Z'),
    lateCutoff: new Date('2026-11-20T01:15:00.000Z'),
    venue: 'Hall A',
    audience: 'all',
    organizerId: organizer._id,
    status: 'published',
    attendanceMethod: 'qr',
    googleCalendarEventId: 'gcal_hackathon_999',
  });

  const originalFindById = Event.findById;
  let saveCount = 0;
  let createdCount = 0;

  Event.findById = async (id) => {
    if (id === eventId) return existingEvent;
    return null;
  };

  const originalSave = Event.prototype.save;
  Event.prototype.save = async function mockSave() {
    saveCount += 1;
    return this;
  };

  try {
    const retryData = {
      id: eventId,
      name: 'Hackathon Event',
      description: 'Retried creation with updated description',
      date: '2026-11-20',
      start: '09:00',
      end: '11:00',
      cutoff: '09:15',
      venue: 'Hall A',
      audience: 'all',
      method: 'qr',
      status: 'published',
      registrationRequired: false,
      requiredForAttendance: false,
    };

    // Call createEvent with the same event ID as retry
    const result = await createEvent(retryData, organizer);

    // Verify it returned the existing event (did not create a second event record)
    assert.equal(result._id, eventId);
    assert.equal(result.description, 'Retried creation with updated description');
    assert.equal(result.googleCalendarEventId, 'gcal_hackathon_999');
    assert.equal(result, existingEvent, 'Must reuse the existing event instance');
  } finally {
    Event.findById = originalFindById;
    Event.prototype.save = originalSave;
  }
});

test('createEvent: safe to retry without client ID within recent window without creating a duplicate', async () => {
  const validObjectId = '507f1f77bcf86cd799439011';
  const organizer = { _id: validObjectId, username: 'ADM001' };
  const existingEvent = new Event({
    _id: randomUUID(),
    name: 'Rapid Submit Workshop',
    startsAt: new Date('2026-11-20T01:00:00.000Z'),
    endsAt: new Date('2026-11-20T03:00:00.000Z'),
    checkInOpensAt: new Date('2026-11-20T00:30:00.000Z'),
    checkInClosesAt: new Date('2026-11-20T03:00:00.000Z'),
    lateCutoff: new Date('2026-11-20T01:15:00.000Z'),
    venue: 'Room 202',
    audience: 'all',
    organizerId: organizer._id,
    status: 'published',
    attendanceMethod: 'qr',
  });

  const originalFindOne = Event.findOne;
  Event.findOne = async () => existingEvent;

  try {
    const data = {
      name: 'Rapid Submit Workshop',
      description: 'Second submit within debounce window',
      date: '2026-11-20',
      start: '09:00',
      end: '11:00',
      cutoff: '09:15',
      venue: 'Room 202',
      audience: 'all',
      method: 'qr',
      status: 'published',
      registrationRequired: false,
      requiredForAttendance: false,
    };

    const result = await createEvent(data, organizer);
    assert.equal(result._id, existingEvent._id);
    assert.equal(result, existingEvent, 'Returns the existing event rather than creating a duplicate');
  } finally {
    Event.findOne = originalFindOne;
  }
});

test('Google Calendar sync: initial create calls POST; retry calls PATCH and prevents duplicate Calendar entries', async () => {
  const validObjectId = '507f1f77bcf86cd799439011';
  const adminUser = { _id: validObjectId, googleCalendarRefreshTokenEncrypted: 'enc_token' };
  const event = new Event({
    _id: randomUUID(),
    name: 'Orientation 2026',
    startsAt: new Date('2026-11-20T01:00:00.000Z'),
    endsAt: new Date('2026-11-20T03:00:00.000Z'),
    checkInOpensAt: new Date('2026-11-20T00:30:00.000Z'),
    checkInClosesAt: new Date('2026-11-20T03:00:00.000Z'),
    lateCutoff: new Date('2026-11-20T01:15:00.000Z'),
    venue: 'Auditorium',
    audience: 'all',
    organizerId: adminUser._id,
    status: 'published',
    attendanceMethod: 'qr',
    googleCalendarEventId: null,
  });

  const originalFindById = User.findById;
  User.findById = () => ({
    select: () => ({
      _id: adminUser._id,
      googleCalendarRefreshTokenEncrypted: 'enc_token',
    }),
  });

  // Mock settings: enabled
  const originalSettingFindById = systemSettingsService.SystemSetting.findById;
  systemSettingsService.SystemSetting.findById = () => ({
    lean: async () => ({ value: true }),
  });

  const originalUpdateOne = Event.updateOne;
  Event.updateOne = async (query, update) => {
    if (update.$set?.googleCalendarEventId) {
      event.googleCalendarEventId = update.$set.googleCalendarEventId;
      event.googleCalendarHtmlLink = update.$set.googleCalendarHtmlLink;
    }
    return { modifiedCount: 1 };
  };

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
          json: async () => ({ id: 'gcal_unique_id_12345', htmlLink: 'https://calendar.google.com/event?eid=123' }),
        };
      }
      if (method === 'PATCH') {
        calendarCalls.patch += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: 'gcal_unique_id_12345', htmlLink: 'https://calendar.google.com/event?eid=123' }),
        };
      }
    }
    // Token endpoint or other
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'mock_token', token_type: 'Bearer' }),
    };
  };

  try {
    // 1. Initial create sync: event has no googleCalendarEventId
    assert.equal(event.googleCalendarEventId, null);
    const firstSync = await syncEventToCalendar(event, adminUser, { session: {} });
    assert.equal(firstSync.ok, true);
    assert.equal(calendarCalls.post, 1, 'First create sync must call POST');
    assert.equal(calendarCalls.patch, 0, 'First create sync must not call PATCH');
    assert.equal(event.googleCalendarEventId, 'gcal_unique_id_12345');

    // 2. Retry sync: event already has googleCalendarEventId
    const retrySync = await syncEventToCalendar(event, adminUser, { session: {} });
    assert.equal(retrySync.ok, true);
    assert.equal(calendarCalls.post, 1, 'Retry must NOT call POST again (no duplicate event on Calendar)');
    assert.equal(calendarCalls.patch, 1, 'Retry must call PATCH to update the existing Calendar entry');
    assert.equal(event.googleCalendarEventId, 'gcal_unique_id_12345');
  } finally {
    User.findById = originalFindById;
    systemSettingsService.SystemSetting.findById = originalSettingFindById;
    Event.updateOne = originalUpdateOne;
    globalThis.fetch = originalFetch;
  }
});
