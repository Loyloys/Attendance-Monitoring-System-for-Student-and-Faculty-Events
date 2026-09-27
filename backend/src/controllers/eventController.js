import { Event } from '../models/index.js';
import {
  availableEventsForUser,
  createCheckinCode,
  getManagedEvent,
  managedEventsForUser,
  recordEventAttendance,
  registerForEvent,
  serializeAdminEvents,
  serializeEventsForUser,
} from '../services/eventService.js';
import { monitoredAttendance, personalAttendance, submitFeedback } from '../services/attendanceService.js';
import { NotFoundError, PermissionError } from '../utils/errors.js';

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
  const event = await getManagedEvent(request.user, request.params.eventId);
  return response.json(await createCheckinCode(event, request.user));
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
    // GST004: echo the verified fix so the person can see the check happened.
    locationVerified: record.locationLatitude !== null && record.locationLatitude !== undefined,
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
