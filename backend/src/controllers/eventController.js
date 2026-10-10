import { Event } from '../models/index.js';
import {
  availableEventsForUser,
  getManagedEvent,
  managedEventsForUser,
  recordEventAttendance,
  registerForEvent,
  serializeAdminEvents,
  serializeEventsForUser,
} from '../services/eventService.js';
import { getOrIssueEventQr, rotateEventQr } from '../services/eventQrService.js';
import { monitoredAttendance, personalAttendance, submitFeedback } from '../services/attendanceService.js';
import {
  checkoutTrackingSession,
  getTrackingSession,
  monitoredSessions,
  startTrackingSession,
  updateTrackingSession,
} from '../services/attendanceSessionService.js';
import { NotFoundError, PermissionError } from '../utils/errors.js';

// GST006/GST007: attendance tracking. The authenticated session identifies the
// person, so no client-supplied user id is ever read.
export async function startSession(request, response) {
  const session = await startTrackingSession(request.user, request.body);
  return response.status(201).json(session);
}

export async function updateSession(request, response) {
  return response.json(await updateTrackingSession(request.user, request.params.sessionId, request.body));
}

export async function checkoutSession(request, response) {
  return response.json(await checkoutTrackingSession(request.user, request.params.sessionId));
}

export async function mySession(request, response) {
  const session = await getTrackingSession(request.user, request.params.eventId);
  return response.json({ session });
}

export async function monitorSessions(request, response) {
  return response.json({ sessions: await monitoredSessions(request.user, request.params.eventId) });
}

export async function listEvents(request, response) {
  if (request.user.profile.role === 'admin') {
    const events = await Event.find().sort({ startsAt: 1, name: 1 }).lean();
    return response.json(await serializeEventsForUser(events, request.user));
  }
  return response.json(await serializeEventsForUser(await availableEventsForUser(request.user), request.user));
}

export async function eventDetail(request, response) {
  const events = request.user.profile.role === 'admin'
    ? await Event.findById(request.params.eventId).lean()
    : (await availableEventsForUser(request.user)).filter((event) => event._id === request.params.eventId);
  const event = Array.isArray(events) ? events[0] : events;
  if (!event) throw new NotFoundError('Event not found.');
  const [result] = await serializeEventsForUser([event], request.user);
  return response.json(result);
}

export async function managedEvents(request, response) {
  return response.json(await serializeEventsForUser(await managedEventsForUser(request.user), request.user));
}

export async function checkinCode(request, response) {
  // GST006: Faculty reach the QR through their own event route, so the event is
  // resolved by ASSIGNMENT here. Authorization itself (admin for any event,
  // faculty only for an assigned one) is decided by the QR service, which is
  // the single place that rule lives.
  const event = request.user.profile.role === 'admin'
    ? await Event.findById(request.params.eventId).lean()
    : await getManagedEvent(request.user, request.params.eventId);
  if (!event) throw new NotFoundError('Event not found.');
  // GET retrieves the current code without rotating it; POST is the explicit,
  // separately authorized rotation.
  const qr = request.method === 'GET'
    ? await getOrIssueEventQr(event, request.user)
    : await rotateEventQr(event, request.user);
  return response.json(qr);
}

export async function scan(request, response) {
  const record = await recordEventAttendance(request.user, request.body);
  const event = await Event.findById(record.eventId).lean();
  return response.status(201).json({
    attendanceId: record._id,
    eventId: event._id,
    eventName: event.name,
    eventDate: new Date(event.startsAt).toISOString(),
    eventTime: `${new Date(event.startsAt).toISOString().slice(11, 16)} - ${new Date(event.endsAt).toISOString().slice(11, 16)}`,
    status: record.status,
    method: record.method,
    recordedAt: new Date(record.recordedAt).toISOString(),
    // GST004: echo the verified fix so the person can see the check happened,
    // including HOW PRECISE it was. A bare "verified" hides the fact that a
    // ±90 m fix and a ±5 m fix are accepted by the same 150 m fence.
    locationVerified: record.locationLatitude !== null && record.locationLatitude !== undefined,
    locationAccuracyMeters: record.locationAccuracyMeters ?? null,
    locationDistanceMeters: record.locationDistanceMeters ?? null,
    message: 'Your event attendance was recorded successfully.',
  });
}

export async function register(request, response) {
  const result = await registerForEvent(request.user, request.params.eventId);
  return response.status(result.created ? 201 : 200).json(result);
}

export async function myAttendance(request, response) {
  return response.json(await personalAttendance(request.user));
}

export async function attendance(request, response) {
  return response.json(await monitoredAttendance(request.user, request.params.eventId));
}

export async function feedback(request, response) {
  const result = await submitFeedback(request.user, request.params.eventId, request.body);
  return response.status(201).json({ id: result._id, message: 'Thank you. Your event feedback was submitted.' });
}
