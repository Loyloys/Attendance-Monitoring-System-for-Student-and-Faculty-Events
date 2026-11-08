import { Event, EventAttendance, EventRegistration, UserProfile } from '../models/index.js';
import {
  autoIssueQrForNewEvent,
  eventQrStatus,
  getOrIssueEventQr,
  rotateEventQr,
} from '../services/eventQrService.js';
import { archiveEvent, cancelEvent, createEvent, issueEventCertificatesForEvent, restoreEvent, serializeAdminEvents, updateEvent } from '../services/eventService.js';
import { NotFoundError } from '../utils/errors.js';
import { syncEventToCalendar } from '../services/googleCalendarService.js';

export async function listRegistrants(request, response) {
  const eventId = request.params.eventId;
  const event = await Event.findById(eventId).lean();
  if (!event) throw new NotFoundError('Event not found.');
  // `attendeeId` references User; only fields that exist on User are populated.
  // Role, department and display name come from UserProfile (looked up below).
  const registrations = await EventRegistration.find({ eventId }).populate('attendeeId', 'accountId username email firstName lastName').lean();
  const attendeeIds = registrations
    .map((reg) => reg.attendeeId?._id)
    .filter((id) => id != null);
  const profiles = await UserProfile.find({ userId: { $in: attendeeIds } }).lean();
  const profileByUser = new Map(profiles.map((profile) => [String(profile.userId), profile]));
  // Confirmation status comes from EventAttendance: present / late / absent,
  // or null when no attendance record exists. This is deliberately separate
  // from registration status - registering is not attending.
  const attendanceRecords = await EventAttendance.find({ eventId }).lean();
  const attendanceByAttendee = new Map(
    attendanceRecords.map((record) => [String(record.attendeeId), record]),
  );
  return response.json(registrations.map((reg) => {
    const attendee = reg.attendeeId;
    const profile = profileByUser.get(String(attendee?._id || ''));
    const attendance = attendanceByAttendee.get(String(attendee?._id || ''));
    return {
      eventId: reg.eventId,
      eventName: event.name,
      eventDate: event.startsAt ? new Date(event.startsAt).toISOString().slice(0, 10) : null,
      eventStatus: event.status === 'cancelled' ? 'Cancelled' : event.startsAt > new Date() ? 'Approved' : event.endsAt < new Date() ? 'Completed' : 'Ongoing',
      registrationStatus: reg.status,
      registeredAt: reg.registeredAt ? new Date(reg.registeredAt).toISOString() : null,
      attendee: {
        id: attendee?._id || null,
        accountId: attendee?.accountId || null,
        name: profile?.displayName || (attendee?.firstName && attendee?.lastName ? `${attendee.firstName} ${attendee.lastName}` : ''),
        email: attendee?.email || '',
        role: profile?.role || null,
        department: profile?.department || '',
      },
      confirmationStatus: attendance?.status || null,
      checkedInAt: attendance?.recordedAt ? new Date(attendance.recordedAt).toISOString() : null,
    };
  }));
}

export async function list(request, response) {
  if (request.method === 'GET') {
    // AD028: archived events are absent from the Admin active-event list and
    // visible only in the Archive view.
    return response.json(await serializeAdminEvents(await Event.find({ archivedAt: null }).sort({ startsAt: -1, name: 1 }).lean()));
  }
  const event = await createEvent(request.body, request.user);
  const calendar = await syncEventToCalendar(event, request.user, request);
  // Auto-issue the attendance code. A failure here is reported separately so
  // the event is NOT lost and the administrator can retry just the code.
  const issuance = await autoIssueQrForNewEvent(event, request.user);
  const [serialized] = await serializeAdminEvents([event.toObject()]);
  // The event fields stay at the TOP LEVEL, exactly as every other admin event
  // response has always returned them, and the issuance result is added alongside
  // as `qr`. Wrapping the event under an `event` key would silently break every
  // existing caller (the administrator workspace reads `saved.id`), so the
  // pre-existing response fields are preserved.
  return response.status(201).json({ ...serialized, qr: issuance, calendar });
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
  let calendar;
  if (request.method === 'PATCH') {
    event = await updateEvent(event._id, request.body, request.user);
    calendar = await syncEventToCalendar(event, request.user, request);
  }
  return response.json({ ...(await serializeAdminEvents([event.toObject()]))[0], ...(calendar ? { calendar } : {}) });
}

export async function cancel(request, response) {
  const event = await Event.findById(request.params.eventId);
  if (!event) throw new NotFoundError('Event not found.');
  await cancelEvent(event, request.user);
  return response.json((await serializeAdminEvents([event.toObject()]))[0]);
}

export async function archive(request, response) {
  const event = await Event.findById(request.params.eventId);
  if (!event) throw new NotFoundError('Event not found.');
  await archiveEvent(event, request.user);
  return response.json((await serializeAdminEvents([event.toObject()]))[0]);
}

export async function issue(request, response) {
  const event = await Event.findById(request.params.eventId);
  if (!event) throw new NotFoundError('Event not found.');
  const certificates = await issueEventCertificatesForEvent(event._id, request.user._id);
  return response.json({
    issued: certificates.length,
    certificates: certificates.map((certificate) => ({
      eventId: certificate.eventId,
      studentId: certificate.studentId,
      reference: certificate.reference,
      issuedAt: certificate.issuedAt?.toISOString(),
    })),
  });
}

export async function restore(request, response) {
  const event = await Event.findById(request.params.eventId);
  if (!event) throw new NotFoundError('Event not found.');
  await restoreEvent(event, request.user);
  return response.json((await serializeAdminEvents([event.toObject()]))[0]);
}

export async function listArchived(request, response) {
  const events = await Event.find({ archivedAt: { $ne: null } }).sort({ startsAt: -1, name: 1 }).lean();
  return response.json(await serializeAdminEvents(events));
}
