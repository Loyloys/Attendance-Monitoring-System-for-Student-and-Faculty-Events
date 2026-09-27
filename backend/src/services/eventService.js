import { randomUUID } from 'node:crypto';
import {
  AttendanceCode,
  Event,
  EventAttendance,
  EventCertificate,
  EventFeedback,
  EventRegistration,
  UserProfile,
} from '../models/index.js';
import { ConflictError, PermissionError, ValidationError } from '../utils/errors.js';
import { nextNumericId } from '../utils/ids.js';
import { randomToken, sha256, stableCaseInsensitive, toLegacyUuid } from '../utils/identifiers.js';
import { QR_PREFIX } from '../utils/domain.js';
import { effectiveEventStatus, eventAllows, isCheckInOpen, isSupervisor, verifyAttendanceLocation } from '../utils/events.js';
import { serializeAdminEvent, serializeEventContext } from './eventSerializer.js';

function normalizeEventId(value) {
  const id = toLegacyUuid(value);
  if (!id) throw new ValidationError({ event: 'Event not found.' }, 'Event not found.');
  return id;
}

export async function availableEventsForUser(user) {
  if (!['student', 'faculty'].includes(user.profile.role)) {
    throw new PermissionError('This action is not available for your role.');
  }
  return Event.find({
    status: 'published',
    $or: [{ audience: 'all' }, { audience: user.profile.role }],
  }).sort({ startsAt: 1, name: 1 }).lean();
}

export async function managedEventsForUser(user) {
  if (user.profile.role !== 'faculty') throw new PermissionError('This action is not available for your role.');
  return Event.find({
    $or: [{ organizerId: user._id }, { supervisors: user._id }],
  }).sort({ startsAt: 1, name: 1 }).lean();
}

export async function getManagedEvent(user, eventId) {
  const id = normalizeEventId(eventId);
  const event = await Event.findOne({
    _id: id,
    $or: [{ organizerId: user._id }, { supervisors: user._id }],
  }).lean();
  if (!event) throw new ValidationError({ event: 'Event not found or not assigned to you.' });
  return event;
}

export async function serializeEventsForUser(events, user, now = new Date()) {
  if (!events.length) return [];
  const ids = events.map((event) => event._id);
  const userId = user._id;
  const [registrations, attendance, feedback, certificates, organizerIds] = await Promise.all([
    EventRegistration.find({ eventId: { $in: ids }, attendeeId: userId }).lean(),
    EventAttendance.find({ eventId: { $in: ids }, attendeeId: userId }).lean(),
    EventFeedback.find({ eventId: { $in: ids }, attendeeId: userId }).lean(),
    EventCertificate.find({ eventId: { $in: ids }, studentId: userId }).lean(),
    UserProfile.find({ userId: { $in: [...new Set(events.map((event) => event.organizerId))] } }).lean(),
  ]);
  const profileByUser = new Map(organizerIds.map((profile) => [String(profile.userId), profile]));
  return events.map((event) => serializeEventContext(event, {
    userRole: user.profile.role,
    registration: registrations.find((item) => item.eventId === event._id) || null,
    attendance: attendance.find((item) => item.eventId === event._id) || null,
    feedbackSubmitted: feedback.some((item) => item.eventId === event._id),
    certificateId: certificates.find((item) => item.eventId === event._id)?._id || null,
    organizerName: profileByUser.get(String(event.organizerId))?.displayName || '',
    isOrganizer: isSupervisor(event, user),
    eventAllows: eventAllows(event, user.profile),
    status: effectiveEventStatus(event, now),
    now,
  }));
}

export async function serializeAdminEvents(events) {
  const profiles = await UserProfile.find({ userId: { $in: events.map((event) => event.organizerId) } }).lean();
  const byUser = new Map(profiles.map((profile) => [String(profile.userId), profile]));
  return events.map((event) => serializeAdminEvent(event, byUser.get(String(event.organizerId))));
}

export async function createCheckinCode(event, facultyUser) {
  if (!isSupervisor(event, facultyUser)) throw new PermissionError('Only assigned faculty can generate this event code.');
  if (event.attendanceMethod !== 'qr') throw new ValidationError({ event: 'This event does not use QR check-in.' });
  if (!isCheckInOpen(event)) throw new ValidationError({ event: 'The event check-in window is not open.' });

  const now = new Date();
  const expiresAt = new Date(Math.min(event.checkInClosesAt.getTime(), now.getTime() + 60 * 60 * 1_000));
  await AttendanceCode.updateMany({ eventId: event._id, active: true }, { $set: { active: false } });
  const token = randomToken();
  await AttendanceCode.create({
    _id: await nextNumericId('attendanceCode'),
    eventId: event._id,
    createdById: facultyUser._id,
    tokenHash: sha256(token),
    expiresAt,
    active: true,
    createdAt: now,
  });
  return { token: `${QR_PREFIX}:${event._id}:${token}`, expiresAt: expiresAt.toISOString() };
}

function identifierMatchesUser(user, identifier) {
  if (typeof identifier !== 'string' || !identifier.trim()) return false;
  const supplied = stableCaseInsensitive(identifier);
  return [user.username, user.email, user.profile.cardIdentifier]
    .filter(Boolean)
    .some((value) => stableCaseInsensitive(value) === supplied);
}

async function resolveScannedEvent(rawToken, eventId, user) {
  if (rawToken) {
    const parts = typeof rawToken === 'string' ? rawToken.trim().split(':') : [];
    const scannedId = parts.length === 3 && parts[0] === QR_PREFIX ? normalizeEventId(parts[1]) : null;
    if (!scannedId || !parts[2]) throw new ValidationError({ scan: 'Invalid event QR code.' });
    const event = await Event.findOne({
      _id: scannedId,
      status: 'published',
      $or: [{ audience: 'all' }, { audience: user.profile.role }],
    }).lean();
    if (!event) throw new ValidationError({ scan: 'This event is not available to your account.' });
    const code = await AttendanceCode.findOne({
      eventId: event._id,
      tokenHash: sha256(parts[2]),
      active: true,
      expiresAt: { $gt: new Date() },
    }).lean();
    if (!code) throw new ValidationError({ scan: 'This event QR code is invalid or expired.' });
    return event;
  }

  if (!eventId) throw new ValidationError({ event: 'Select the event being scanned.' });
  const event = await Event.findOne({
    _id: normalizeEventId(eventId),
    status: 'published',
    $or: [{ audience: 'all' }, { audience: user.profile.role }],
  }).lean();
  if (!event) throw new ValidationError({ event: 'Event not found or not available to your account.' });
  return event;
}

export async function recordEventAttendance(user, { token, eventId, identifier, method, location }) {
  if (!['student', 'faculty'].includes(user.profile.role)) throw new PermissionError('This action is not available for your role.');
  if (!['qr', 'barcode', 'rfid'].includes(method)) {
    throw new ValidationError({ method: 'Choose a supported event attendance method.' });
  }
  const event = await resolveScannedEvent(token, eventId, user);
  if (event.attendanceMethod !== method) throw new ValidationError({ method: 'This scan method is not enabled for the event.' });
  if (!eventAllows(event, user.profile)) throw new PermissionError('You are not allowed to attend this event.');
  if (!isCheckInOpen(event)) throw new ValidationError({ scan: 'The event check-in window is closed.' });
  if (method !== 'qr' && !identifierMatchesUser(user, identifier)) {
    throw new PermissionError('The scanned ID does not belong to your account.');
  }
  if (event.registrationRequired && user.profile.role === 'student') {
    const registration = await EventRegistration.findOne({ eventId: event._id, attendeeId: user._id, status: 'registered' }).lean();
    if (!registration) throw new ValidationError({ registration: 'Register for this event before checking in.' });
  }

  // Location is verified BEFORE anything is written, so a failed check can never
  // leave a successful attendance record behind.
  const needsLocation = event.locationVerificationRequired !== false;
  const verified = needsLocation ? verifyAttendanceLocation(event, location) : null;

  const now = new Date();
  try {
    return await EventAttendance.create({
      _id: await nextNumericId('eventAttendance'),
      eventId: event._id,
      attendeeId: user._id,
      status: now > event.lateCutoff ? 'late' : 'present',
      method,
      recordedAt: now,
      source: 'Scan',
      ...(verified
        ? {
          locationLatitude: verified.latitude,
          locationLongitude: verified.longitude,
          locationAccuracyMeters: verified.accuracy,
          locationCapturedAt: new Date(verified.capturedAt),
          locationDistanceMeters: verified.distanceMeters,
        }
        : {}),
    });
  } catch (error) {
    if (error.code === 11000) throw new ConflictError('Attendance is already recorded for this event.');
    throw error;
  }
}

export async function registerForEvent(user, eventId) {
  if (user.profile.role !== 'student') throw new PermissionError('This action is not available for your role.');
  const event = await Event.findOne({
    _id: normalizeEventId(eventId),
    status: 'published',
    $or: [{ audience: 'all' }, { audience: 'student' }],
  }).lean();
  if (!event) throw new ValidationError({ event: 'Event not found.' });
  if (!event.registrationRequired) throw new ValidationError({ event: 'This event does not require registration.' });
  if (effectiveEventStatus(event) !== 'upcoming') throw new ValidationError({ event: 'Registration is closed for this event.' });
  if (event.registrationDeadline && new Date() > event.registrationDeadline) {
    throw new ValidationError({ event: 'The registration deadline has passed.' });
  }

  const existing = await EventRegistration.findOne({ eventId: event._id, attendeeId: user._id });
  if (!existing) {
    try {
      await EventRegistration.create({
        _id: await nextNumericId('eventRegistration'),
        eventId: event._id,
        attendeeId: user._id,
        status: 'registered',
        registeredAt: new Date(),
      });
      return { registered: true, created: true, message: 'Registration confirmed.' };
    } catch (error) {
      if (error.code !== 11000) throw error;
      const winner = await EventRegistration.findOne({ eventId: event._id, attendeeId: user._id });
      if (winner?.status === 'registered') {
        return { registered: true, created: false, message: 'You are already registered for this event.' };
      }
    }
  }
  if (existing.status !== 'registered') {
    existing.status = 'registered';
    existing.registeredAt = new Date();
    await existing.save();
    return { registered: true, created: true, message: 'Registration confirmed.' };
  }
  return { registered: true, created: false, message: 'You are already registered for this event.' };
}

function parseLocalDateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time || '')) return null;
  const parsed = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function validateWriteValues(data, current = null, partial = false) {
  const required = ['name', 'date', 'start', 'end', 'cutoff', 'venue', 'audience', 'method', 'status'];
  if (!partial) {
    const missing = required.filter((field) => data[field] === undefined);
    if (missing.length) throw new ValidationError(Object.fromEntries(missing.map((field) => [field, 'This field is required.'])));
  }
  const startsAt = data.date !== undefined || data.start !== undefined
    ? parseLocalDateTime(data.date ?? current.startsAt.toISOString().slice(0, 10), data.start ?? current.startsAt.toISOString().slice(11, 16))
    : current?.startsAt;
  const endsAt = data.date !== undefined || data.end !== undefined
    ? parseLocalDateTime(data.date ?? current.endsAt.toISOString().slice(0, 10), data.end ?? current.endsAt.toISOString().slice(11, 16))
    : current?.endsAt;
  const lateCutoff = data.date !== undefined || data.cutoff !== undefined
    ? parseLocalDateTime(data.date ?? current.lateCutoff.toISOString().slice(0, 10), data.cutoff ?? current.lateCutoff.toISOString().slice(11, 16))
    : current?.lateCutoff;
  if (!startsAt || !endsAt || !lateCutoff) throw new ValidationError({ date: 'Enter a valid date and time.' });
  if (endsAt <= startsAt) throw new ValidationError({ end: 'End time must be later than start time.' });

  const values = {
    name: data.name !== undefined ? String(data.name).trim() : current?.name,
    description: data.description !== undefined ? String(data.description).trim() : current?.description || '',
    venue: data.venue !== undefined ? String(data.venue).trim() : current?.venue,
    audience: data.audience ?? current?.audience ?? 'all',
    status: data.status ?? current?.status ?? 'published',
    attendanceMethod: data.method ?? current?.attendanceMethod ?? 'qr',
    registrationRequired: data.requiredForAttendance ?? current?.registrationRequired ?? false,
    startsAt,
    endsAt,
    lateCutoff,
  };
  if (!values.name || values.name.length > 180) throw new ValidationError({ name: 'Name is required and must not exceed 180 characters.' });
  if (!values.venue || values.venue.length > 180) throw new ValidationError({ venue: 'Venue is required and must not exceed 180 characters.' });
  if (!['all', 'student', 'faculty'].includes(values.audience)) throw new ValidationError({ audience: 'Choose a valid audience.' });
  if (!['published', 'cancelled'].includes(values.status)) throw new ValidationError({ status: 'Choose a valid status.' });
  if (!['qr', 'barcode', 'rfid'].includes(values.attendanceMethod)) throw new ValidationError({ method: 'Choose a valid attendance method.' });
  if (typeof values.registrationRequired !== 'boolean') throw new ValidationError({ requiredForAttendance: 'Choose true or false.' });

  // Geofence: either all three parts are supplied, or none are. A half-set fence
  // would silently disable verification, so it is rejected instead.
  const hasLatitude = data.venueLatitude !== undefined && data.venueLatitude !== null && data.venueLatitude !== '';
  const hasLongitude = data.venueLongitude !== undefined && data.venueLongitude !== null && data.venueLongitude !== '';
  const hasRadius = data.venueRadiusMeters !== undefined && data.venueRadiusMeters !== null && data.venueRadiusMeters !== '';
  const supplied = [hasLatitude, hasLongitude, hasRadius].filter(Boolean).length;

  if (supplied !== 0 && supplied !== 3) {
    throw new ValidationError({
      venue: 'Enter the venue latitude, longitude and radius together, or leave all three blank to disable the check-in zone.',
    });
  }
  if (supplied === 3) {
    const latitude = Number(data.venueLatitude);
    const longitude = Number(data.venueLongitude);
    const radiusMeters = Number(data.venueRadiusMeters);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new ValidationError({ venueLatitude: 'Latitude must be between -90 and 90.' });
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new ValidationError({ venueLongitude: 'Longitude must be between -180 and 180.' });
    if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) throw new ValidationError({ venueRadiusMeters: 'Enter a check-in radius greater than 0 metres.' });
    values.venueLatitude = latitude;
    values.venueLongitude = longitude;
    values.venueRadiusMeters = radiusMeters;
  }

  if (current) {
    if (supplied === 0 && data.venueLatitude === undefined) {
      // Nothing supplied and nothing being cleared: keep the existing fence.
      values.venueLatitude = current.venueLatitude;
      values.venueLongitude = current.venueLongitude;
      values.venueRadiusMeters = current.venueRadiusMeters;
    } else if (supplied === 0) {
      values.venueLatitude = null;
      values.venueLongitude = null;
      values.venueRadiusMeters = null;
    }
  }

  if (data.locationVerificationRequired !== undefined) {
    if (typeof data.locationVerificationRequired !== 'boolean') throw new ValidationError({ locationVerificationRequired: 'Choose true or false.' });
    values.locationVerificationRequired = data.locationVerificationRequired;
  }

  if (!current || data.date !== undefined || data.start !== undefined || data.end !== undefined) {
    values.checkInOpensAt = new Date(startsAt.getTime() - 30 * 60 * 1_000);
    values.checkInClosesAt = endsAt;
  }
  return values;
}

export async function createEvent(data, organizer) {
  const values = validateWriteValues(data);
  const event = new Event({ ...values, _id: randomUUID(), organizerId: organizer._id, dataSource: 'managed' });
  await event.save();
  return event;
}

export async function updateEvent(eventId, data) {
  const id = normalizeEventId(eventId);
  const event = await Event.findById(id);
  if (!event) throw new ValidationError({ event: 'Event not found.' }, 'Event not found.');
  Object.assign(event, validateWriteValues(data, event, true));
  await event.save();
  return event;
}

export function cancelEvent(event) {
  event.status = 'cancelled';
  return event.save();
}
