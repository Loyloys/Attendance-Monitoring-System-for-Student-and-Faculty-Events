import { geofenceFor } from '../utils/domain.js';

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function localDate(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function localTime(value) {
  return new Date(value).toISOString().slice(11, 16);
}

export function serializeEventContext(event, context) {
  const {
    registration = null,
    attendance = null,
    feedbackSubmitted = false,
    certificateId = null,
    organizerName = '',
    isOrganizer = false,
  } = context;
  const now = context.now || new Date();
  const status = context.status;
  const registrationStatus = registration?.status === 'registered'
    ? 'registered'
    : event.registrationRequired ? 'required' : 'not_required';
  const registrationOkay = !event.registrationRequired
    || context.userRole !== 'student'
    || registration?.status === 'registered';
  const checkInOpen = event.status === 'published'
    && event.checkInOpensAt <= now
    && now <= event.checkInClosesAt;

  return {
    id: event._id,
    name: event.name,
    description: event.description || '',
    starts_at: iso(event.startsAt),
    ends_at: iso(event.endsAt),
    start_time: iso(event.startsAt),
    end_time: iso(event.endsAt),
    venue: event.venue,
    audience: event.audience,
    organizer_name: organizerName,
    status,
    registration_required: event.registrationRequired,
    registration_deadline: event.registrationDeadline ? iso(event.registrationDeadline) : null,
    registration_status: registrationStatus,
    can_register: context.userRole === 'student'
      && event.registrationRequired
      && status === 'upcoming'
      && (!event.registrationDeadline || now <= event.registrationDeadline)
      && registration?.status !== 'registered',
    attendance_status: attendance?.status || null,
    can_check_in: context.eventAllows
      && checkInOpen
      && registrationOkay
      && !attendance,
    feedback_submitted: Boolean(feedbackSubmitted),
    certificate_id: certificateId === null || certificateId === undefined ? null : String(certificateId),
    check_in_opens_at: iso(event.checkInOpensAt),
    check_in_closes_at: iso(event.checkInClosesAt),
    late_cutoff: iso(event.lateCutoff),
    attendance_method: event.attendanceMethod,
    is_organizer: isOrganizer,
    // GST002: the attendance duration, in whole minutes, so the UI never has to
    // recompute it from two timestamps and risk a timezone mismatch.
    duration_minutes: Math.max(0, Math.round((new Date(event.endsAt) - new Date(event.startsAt)) / 60_000)),
    // GST004: whether the client must capture a location fix before scanning,
    // and whether this event actually has a usable fence configured.
    location_verification_required: event.locationVerificationRequired !== false,
    venue_geofence_configured: Boolean(geofenceFor(event)),
  };
}

export function serializeAdminEvent(event, organizerProfile) {
  const status = event.status === 'cancelled'
    ? 'Cancelled'
    : event.startsAt > new Date() ? 'Approved' : event.endsAt < new Date() ? 'Completed' : 'Ongoing';
  return {
    id: event._id,
    name: event.name,
    description: event.description || '',
    date: localDate(event.startsAt),
    start: localTime(event.startsAt),
    end: localTime(event.endsAt),
    venue: event.venue,
    organizer: organizerProfile?.displayName || 'Unknown user',
    origin: organizerProfile?.role === 'faculty' ? 'Faculty' : 'Admin',
    audience: { all: 'All', student: 'Student', faculty: 'Faculty' }[event.audience],
    department: organizerProfile?.department || '',
    method: { qr: 'QR Code', barcode: 'Barcode', rfid: 'ID range' }[event.attendanceMethod],
    identifierRange: event.audience === 'all' ? 'All active attendees' : `${event.audience[0].toUpperCase()}${event.audience.slice(1)} audience`,
    cutoff: localTime(event.lateCutoff),
    status,
    requiredForAttendance: event.registrationRequired,
    venueLatitude: event.venueLatitude ?? undefined,
    venueLongitude: event.venueLongitude ?? undefined,
    venueRadiusMeters: event.venueRadiusMeters ?? undefined,
    locationVerificationRequired: event.locationVerificationRequired !== false,
    createdAt: iso(event.createdAt),
    organizerId: event.organizerId ? String(event.organizerId) : undefined,
  };
}
