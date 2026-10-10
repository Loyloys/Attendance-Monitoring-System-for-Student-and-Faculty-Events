import { Event } from '../models/index.js';
import {
  autoIssueQrForNewEvent,
  eventQrStatus,
  getOrIssueEventQr,
  rotateEventQr,
} from '../services/eventQrService.js';
import { cancelEvent, createEvent, serializeAdminEvents, updateEvent } from '../services/eventService.js';
import { NotFoundError } from '../utils/errors.js';

export async function list(request, response) {
  if (request.method === 'GET') {
    return response.json(await serializeAdminEvents(await Event.find().sort({ startsAt: -1, name: 1 }).lean()));
  }
  const event = await createEvent(request.body, request.user);
  // Auto-issue the attendance code. A failure here is reported separately so
  // the event is NOT lost and the administrator can retry just the code.
  const issuance = await autoIssueQrForNewEvent(event, request.user);
  const [serialized] = await serializeAdminEvents([event.toObject()]);
  // The event fields stay at the TOP LEVEL, exactly as every other admin event
  // response has always returned them, and the issuance result is added alongside
  // as `qr`. Wrapping the event under an `event` key would silently break every
  // existing caller (the administrator workspace reads `saved.id`), so the
  // pre-existing response fields are preserved.
  return response.status(201).json({ ...serialized, qr: issuance });
}

/** Retrieve the current credential, issuing one if none exists (idempotent). */
export async function qr(request, response) {
  const event = await Event.findById(request.params.eventId).lean();
  if (!event) throw new NotFoundError('Event not found.');
  if (request.method === 'GET') {
    return response.json(await getOrIssueEventQr(event, request.user));
  }
  // POST is the explicit rotation, and only ever an explicit rotation.
  return response.json(await rotateEventQr(event, request.user));
}

/** Status without exposing the token. */
export async function qrStatus(request, response) {
  const event = await Event.findById(request.params.eventId).lean();
  if (!event) throw new NotFoundError('Event not found.');
  return response.json(await eventQrStatus(event));
}

export async function detail(request, response) {
  let event = await Event.findById(request.params.eventId);
  if (!event) throw new NotFoundError('Event not found.');
  if (request.method === 'PATCH') event = await updateEvent(event._id, request.body);
  return response.json((await serializeAdminEvents([event.toObject()]))[0]);
}

export async function cancel(request, response) {
  const event = await Event.findById(request.params.eventId);
  if (!event) throw new NotFoundError('Event not found.');
  await cancelEvent(event);
  return response.json((await serializeAdminEvents([event.toObject()]))[0]);
}
