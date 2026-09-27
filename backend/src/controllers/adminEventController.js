import { Event } from '../models/index.js';
import { cancelEvent, createEvent, serializeAdminEvents, updateEvent } from '../services/eventService.js';
import { NotFoundError } from '../utils/errors.js';

export async function list(request, response) {
  if (request.method === 'GET') {
    return response.json(await serializeAdminEvents(await Event.find().sort({ startsAt: -1, name: 1 }).lean()));
  }
  const event = await createEvent(request.body, request.user);
  return response.status(201).json((await serializeAdminEvents([event.toObject()]))[0]);
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
