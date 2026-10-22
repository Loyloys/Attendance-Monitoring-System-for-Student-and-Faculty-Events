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
import { sha256, stableCaseInsensitive, toLegacyUuid } from '../utils/identifiers.js';
import { EVENT_AUDIENCES, QR_PREFIX, QUALIFICATION_REASONS } from '../utils/domain.js';
import { requiredMinutesFor } from '../utils/attendancePolicy.js';
import { manilaWallClockToInstant } from '../utils/eventTimeZone.js';
import { effectiveEventStatus, eventAllows, isCheckInOpen, isSupervisor, verifyAttendanceLocation } from '../utils/events.js';
import { polygonValidationError } from '../utils/geofence.js';
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
    archivedAt: null,
    $or: [{ audience: 'all' }, { audience: user.profile.role }, { audience: String(user.profile.department || '').toLowerCase() }],
  }).sort({ startsAt: 1, name: 1 }).lean();
}

export async function managedEventsForUser(user) {
  if (user.profile.role !== 'faculty') throw new PermissionError('This action is not available for your role.');
  return Event.find({
    // An archived event is withdrawn from the faculty's working list as well.
    // Its attendance and registration records are untouched, so it still
    // appears in the faculty's own history and reports.
    archivedAt: null,
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

/**
 * True when a scanned RFID/barcode identifier belongs to the signed-in person.
 * Only ever called for non-QR methods; a QR scan identifies the EVENT, not the
 * attendee, so it must not be able to check in somebody else on their behalf.
 */
function identifierMatchesUser(user, identifier) {
  if (typeof identifier !== 'string' || !identifier.trim()) return false;
  const supplied = stableCaseInsensitive(identifier);
  return [user.username, user.email, user.profile.cardIdentifier]
    .filter(Boolean)
    .some((value) => stableCaseInsensitive(value) === supplied);
}

/**
 * Resolves WHICH EVENT a check-in refers to, and - for QR events - proves that
 * the caller actually presented a server-issued credential.
 *
 * The `method` argument is load-bearing. Without it, an event id alone was
 * enough to check in to a QR event, because `attendancecodes` was only ever
 * consulted when a token was supplied. A QR event now REQUIRES a token: there is
 * nothing else that ties a request to the organiser's code, and the whole point
 * of rotating that code is to be able to invalidate it.
 */
export async function resolveScannedEvent(rawToken, eventId, user) {
  if (rawToken) {
    const parts = typeof rawToken === 'string' ? rawToken.trim().split(':') : [];
    const scannedId = parts.length === 3 && parts[0] === QR_PREFIX ? normalizeEventId(parts[1]) : null;
    if (!scannedId || !parts[2]) throw new ValidationError({ scan: 'Invalid event QR code.' });
    const event = await Event.findOne({
      _id: scannedId,
      status: 'published',
      $or: [{ audience: 'all' }, { audience: user.profile.role }, { audience: String(user.profile.department || '').toLowerCase() }],
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

  // No credential was presented. The event can still be resolved by id for the
  // identifier-based methods (barcode / RFID), where the attendee picks the event
  // and the identifier proves who they are. Whether that is acceptable is
  // decided by the caller, which knows the EVENT's real method.
  if (!eventId) throw new ValidationError({ event: 'Select the event being scanned.' });
  const event = await Event.findOne({
    _id: normalizeEventId(eventId),
    status: 'published',
    $or: [{ audience: 'all' }, { audience: user.profile.role }, { audience: String(user.profile.department || '').toLowerCase() }],
  }).lean();
  if (!event) throw new ValidationError({ event: 'Event not found or not available to your account.' });
  return event;
}

/**
 * Read-only QR preflight used to identify an event and decide whether the
 * attendee should be asked for location before the check-in request. This is
 * advisory UI data only; recordEventAttendance repeats every authoritative
 * eligibility, credential, registration, duplicate, and location check.
 */
export async function previewEventAttendance(user, rawToken, now = new Date()) {
  if (!['student', 'faculty'].includes(user.profile.role)) {
    throw new PermissionError('This action is not available for your role.');
  }
  const parts = typeof rawToken === 'string' ? rawToken.trim().split(':') : [];
  const eventId = parts.length === 3 && parts[0] === QR_PREFIX && parts[1]
    ? normalizeEventId(parts[1])
    : null;
  if (!eventId || !parts[2]) {
    throw new ValidationError({ scan: 'Invalid event QR code. Scan a current event check-in code.' });
  }

  const event = await Event.findById(eventId).lean();
  const audienceAllowed = event && (
    event.audience === 'all'
    || event.audience === user.profile.role
    || event.audience === String(user.profile.department || '').toLowerCase()
  );
  if (!event || !audienceAllowed) {
    throw new ValidationError({ scan: 'This event is not available to your account.' });
  }

  const code = await AttendanceCode.findOne({
    eventId: event._id,
    tokenHash: sha256(parts[2]),
    active: true,
  }).lean();
  if (!code) {
    throw new ValidationError({ scan: 'This event QR code is invalid, expired, or has been replaced.' });
  }

  const locationRequired = event.locationVerificationRequired !== false;
  const requiredAttendanceMinutes = requiredMinutesFor(event) || null;
  let reason = null;
  if (event.status !== 'published') {
    reason = 'This event is not open for attendance.';
  } else if (new Date(code.expiresAt) <= now) {
    reason = 'This event check-in code has expired. Ask the organizer for the current code.';
  } else if (!isCheckInOpen(event, now)) {
    reason = now < event.checkInOpensAt
      ? 'Check-in for this event has not opened yet.'
      : 'The check-in window for this event is closed.';
  } else if (event.registrationRequired && user.profile.role === 'student') {
    const registration = await EventRegistration.findOne({
      eventId: event._id,
      attendeeId: user._id,
      status: 'registered',
    }).lean();
    if (!registration) reason = 'Register for this event before checking in.';
  }

  if (!reason) {
    const attendance = await EventAttendance.findOne({
      eventId: event._id,
      attendeeId: user._id,
    }).lean();
    if (attendance) reason = 'Your attendance for this event has already been recorded.';
  }

  return {
    eventId: event._id,
    eventName: event.name,
    method: event.attendanceMethod,
    eligible: !reason && event.attendanceMethod === 'qr',
    reason: reason || (event.attendanceMethod !== 'qr' ? 'This event does not accept QR check-in.' : null),
    locationRequired,
    requiredAttendanceMinutes,
  };
}

export async function recordEventAttendance(user, { token, eventId, identifier, method, location }) {
  if (!['student', 'faculty'].includes(user.profile.role)) throw new PermissionError('This action is not available for your role.');
  if (!['qr', 'barcode', 'rfid'].includes(method)) {
    throw new ValidationError({ method: 'Choose a supported event attendance method.' });
  }
  // The event-id branch of resolveScannedEvent is a lookup, not a credential.
  // For a QR event a real, server-issued code is mandatory: the event id, an
  // arbitrary identifier, or a caller-chosen method must never stand in for it.
  // Keyed on the EVENT's own method, so the message is accurate and a
  // method-spoofing request cannot dodge the check.
  const event = await resolveScannedEvent(token, eventId, user);
  if (event.attendanceMethod === 'qr' && !token) {
    throw new ValidationError(
      { scan: 'This event checks in with a QR code. Scan the event code, or paste it into the manual box.' },
      'A valid event QR code is required for this event.',
    );
  }
  if (event.attendanceMethod !== method) throw new ValidationError({ method: 'This scan method is not enabled for the event.' });
  if (!eventAllows(event, user.profile)) throw new PermissionError('You are not allowed to attend this event.');
  if (!isCheckInOpen(event)) throw new ValidationError({ scan: 'The event check-in window is closed.' });
  // Ownership of the presented identifier. Unreachable for QR now (that path
  // requires a validated credential), and unchanged for barcode/RFID, where the
  // identifier must belong to the signed-in person.
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
  // GST008: A SCAN ALONE MUST NOT QUALIFY A DURATION-REQUIRED ATTENDEE.
  //
  // This used to write `status: late|present` unconditionally, so the very act
  // of scanning marked the attendee as having attended, however little verified
  // time they then served. For an event that asks for verified in-zone minutes
  // that is the whole question, so the scan now records PENDING and the
  // qualification is decided later by the server, from credited seconds only.
  //
  // An event with NO duration requirement keeps `qualification: null` and its
  // established `status` untouched, so nothing about its reporting changes.
  const required = requiredMinutesFor(event);
  const arrival = now > event.lateCutoff ? 'late' : 'present';
  try {
    return await EventAttendance.create({
      _id: await nextNumericId('eventAttendance'),
      eventId: event._id,
      attendeeId: user._id,
      status: arrival,
      method,
      recordedAt: now,
      source: 'Scan',
      ...(required
        ? {
          qualification: 'pending',
          qualificationReason: QUALIFICATION_REASONS.DURATION_IN_PROGRESS,
          requiredAttendanceMinutes: required,
          verifiedSeconds: 0,
        }
        : {}),
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
    $or: [{ audience: 'all' }, { audience: 'student' }, { audience: String(user.profile.department || '').toLowerCase() }],
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

/**
 * Reads an administrator's wall-clock date and time AS ASIA/MANILA and returns
 * the UTC instant to store.
 *
 * The `Z` this used to append is the whole bug: it told the Date constructor
 * that Philippine local time was UTC, so "5:25 PM" was stored as 17:25Z instead
 * of 09:25Z - eight hours late for every attendee. See utils/eventTimeZone.js.
 */
function parseLocalDateTime(date, time) {
  return manilaWallClockToInstant(date, time);
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
    geofenceType: data.geofenceType ?? current?.geofenceType ?? 'circle',
    audience: data.audience ?? current?.audience ?? 'all',
    status: data.status ?? current?.status ?? 'published',
    attendanceMethod: data.method ?? current?.attendanceMethod ?? 'qr',
    // TWO INDEPENDENT QUESTIONS, TWO INDEPENDENT FIELDS.
    //
    // These used to be one value: `requiredForAttendance` (the "Required for
    // percentage" checkbox) was written straight into `registrationRequired`.
    // One checkbox labelled "counts toward a percentage" therefore decided
    // whether every Student had to register before scanning, and because that
    // checkbox defaulted to ON, every administrator-created event silently
    // demanded registration nobody had asked for.
    //
    // Both default to FALSE on create. Neither is ever inferred from the other,
    // so an administrator opts in to each one deliberately.
    registrationRequired: data.registrationRequired ?? current?.registrationRequired ?? false,
    requiredForAttendance: data.requiredForAttendance ?? current?.requiredForAttendance ?? false,
    // Only supplied when the administrator sends it. Absent means "leave the
    // existing deadline alone", so editing an event's title cannot silently
    // close or reopen registration.
    ...(data.registrationDeadline !== undefined
      ? { registrationDeadline: data.registrationDeadline === null || data.registrationDeadline === '' ? null : new Date(data.registrationDeadline) }
      : {}),
    startsAt,
    endsAt,
    lateCutoff,
  };
  if (!values.name || values.name.length > 180) throw new ValidationError({ name: 'Name is required and must not exceed 180 characters.' });
  if (!values.venue || values.venue.length > 180) throw new ValidationError({ venue: 'Venue is required and must not exceed 180 characters.' });
  if (!EVENT_AUDIENCES.includes(values.audience)) throw new ValidationError({ audience: 'Choose a valid audience.' });
  if (!['published', 'cancelled'].includes(values.status)) throw new ValidationError({ status: 'Choose a valid status.' });
  if (!['qr', 'barcode', 'rfid'].includes(values.attendanceMethod)) throw new ValidationError({ method: 'Choose a valid attendance method.' });
  // Each boolean is validated under its OWN name. This used to report a bad
  // `registrationRequired` as a problem with `requiredForAttendance`, which sent
  // an administrator to fix the wrong checkbox.
  if (typeof values.registrationRequired !== 'boolean') throw new ValidationError({ registrationRequired: 'Choose true or false.' });
  if (typeof values.requiredForAttendance !== 'boolean') throw new ValidationError({ requiredForAttendance: 'Choose true or false.' });

  if (!['circle', 'polygon'].includes(values.geofenceType)) {
    throw new ValidationError({ geofenceType: 'Choose a circular or polygon attendance boundary.' });
  }
  if (values.geofenceType === 'polygon') {
    const polygon = data.geofencePolygon !== undefined ? data.geofencePolygon : current?.geofencePolygon;
    const error = polygonValidationError(polygon);
    if (error) throw new ValidationError({ geofencePolygon: error });
    const hasLatitude = data.venueLatitude !== undefined
      ? data.venueLatitude !== null && data.venueLatitude !== ''
      : current?.venueLatitude != null;
    const hasLongitude = data.venueLongitude !== undefined
      ? data.venueLongitude !== null && data.venueLongitude !== ''
      : current?.venueLongitude != null;
    if (!hasLatitude || !hasLongitude) {
      throw new ValidationError({ venue: 'Select a saved venue or a verified map result before configuring the polygon fence.' });
    }
    const latitude = Number(data.venueLatitude ?? current.venueLatitude);
    const longitude = Number(data.venueLongitude ?? current.venueLongitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new ValidationError({ venueLatitude: 'Select a venue with a valid latitude.' });
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new ValidationError({ venueLongitude: 'Select a venue with a valid longitude.' });
    values.venueLatitude = latitude;
    values.venueLongitude = longitude;
    values.venueRadiusMeters = null;
    values.geofencePolygon = polygon.map((point) => ({ latitude: Number(point.latitude), longitude: Number(point.longitude) }));
  } else {
    values.geofencePolygon = [];
  }

  // Circle: either all three parts are supplied, or none are. A half-set fence
  // would silently disable verification, so it is rejected instead.
  const hasLatitude = data.venueLatitude !== undefined && data.venueLatitude !== null && data.venueLatitude !== '';
  const hasLongitude = data.venueLongitude !== undefined && data.venueLongitude !== null && data.venueLongitude !== '';
  const hasRadius = data.venueRadiusMeters !== undefined && data.venueRadiusMeters !== null && data.venueRadiusMeters !== '';
  const supplied = [hasLatitude, hasLongitude, hasRadius].filter(Boolean).length;

  if (values.geofenceType === 'circle' && supplied !== 0 && supplied !== 3) {
    throw new ValidationError({
      venue: 'Enter the venue latitude, longitude and radius together, or leave all three blank to disable the check-in zone.',
    });
  }
  if (values.geofenceType === 'circle' && supplied === 3) {
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

  if (current && values.geofenceType === 'circle') {
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

  // GST006: the required in-zone attendance duration is administrator-set.
  // It is never derived from the event length, and an omitted value leaves the
  // stored requirement untouched, so existing events are never given a duration.
  if (data.requiredAttendanceMinutes !== undefined) {
    if (data.requiredAttendanceMinutes === null || data.requiredAttendanceMinutes === '') {
      values.requiredAttendanceMinutes = null;
    } else {
      const minutes = Number(data.requiredAttendanceMinutes);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
        throw new ValidationError({ requiredAttendanceMinutes: 'Enter the required attendance duration in whole minutes (1-1440).' });
      }
      // Validated against the window the event actually offers.
      const windowMinutes = Math.floor((endsAt.getTime() - startsAt.getTime()) / 60_000);
      if (minutes > windowMinutes) {
        throw new ValidationError({ requiredAttendanceMinutes: `The required duration (${Math.round(minutes)} min) cannot exceed this event's length (${windowMinutes} min).` });
      }
      values.requiredAttendanceMinutes = Math.round(minutes);
    }
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

/**
 * Cancel an event.
 *
 * Scoped to the `status` field for the same reason as `archiveEvent`: a full
 * `save()` re-validates every path, so a legacy record missing an unrelated
 * required field could not be cancelled either.
 */
export async function cancelEvent(event) {
  await Event.updateOne({ _id: event._id }, { $set: { status: 'cancelled' } });
  event.status = 'cancelled';
  return event;
}

/**
 * Archive an event. This removes it from the student/faculty listings while
 * keeping attendance, registration and report data intact for administrators.
 * Only an administrator reaches this (the route enforces the role).
 *
 * WHY THIS WRITES ONLY THE ARCHIVE FIELDS INSTEAD OF SAVING THE DOCUMENT.
 *
 * `event.save()` re-validates the WHOLE document against the schema. A record
 * that predates the current schema - or that a seeding/migration route wrote
 * while a required path was missing - then fails validation on a field the
 * archive action never touches, and the administrator is told the event could
 * not be archived even though nothing about archiving was wrong.
 *
 * That is not hypothetical: the demo seed wrote "Demo Student Developers
 * Meetup" without a `venue`, so archiving it answered 400
 * `{ "venue": "Path 'venue' is required." }` while the archive fields were
 * perfectly valid. The same trap applied to cancelling such an event.
 *
 * The archive state is therefore written as a scoped update of the two fields
 * it owns. Nothing else about the event is rewritten, and an unrelated legacy
 * data gap can never block the administrator from archiving or restoring.
 */
export async function archiveEvent(event, archivedBy) {
  if (event.archivedAt) throw new ValidationError({ event: 'This event is already archived.' });
  const archivedAt = new Date();
  const archivedById = archivedBy && archivedBy._id ? String(archivedBy._id) : null;
  await Event.updateOne({ _id: event._id }, { $set: { archivedAt, archivedBy: archivedById } });
  event.archivedAt = archivedAt;
  event.archivedBy = archivedById;
  return event;
}

/**
 * Restore an archived event back to the student/faculty listings.
 *
 * The mirror of `archiveEvent`, and scoped the same way for the same reason.
 */
export async function restoreEvent(event) {
  if (!event.archivedAt) throw new ValidationError({ event: 'This event is not archived.' });
  await Event.updateOne({ _id: event._id }, { $set: { archivedAt: null, archivedBy: null } });
  event.archivedAt = null;
  event.archivedBy = null;
  return event;
}
