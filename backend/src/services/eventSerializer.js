import { geofenceFor } from '../utils/domain.js';
import { manilaDate, manilaTime } from '../utils/eventTimeZone.js';

/**
 * ISO-8601 text for a stored timestamp, or null when there is none.
 *
 * WHY THIS RETURNS null INSTEAD OF THROWING.
 * `new Date(undefined)` is an Invalid Date, and `.toISOString()` on one throws
 * `RangeError: Invalid time value`. Inside a LIST serializer that is far worse
 * than a bad cell: `adminState()` builds every event in one `.map()`, so a
 * single record with a missing timestamp rejects the whole request and answers
 * 500 to every administrator screen at once - dashboard, users, events,
 * attendance, reports and feedback - while the one bad event stays invisible
 * and unfixable from the UI. A missing timestamp is reported as the honest
 * "unknown" (null) so the rest of the workspace still loads and the
 * administrator can see and correct the record that caused it.
 *
 * `value === ''` is rejected explicitly because `new Date('')` is also invalid.
 */
function iso(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * These two are STRING-returning by contract, not by convenience.
 *
 * The admin workspace sorts with `b.date.localeCompare(a.date)` and feeds these
 * straight into `<input type="date">`/`<input type="time">` values, so a null
 * here would throw in the browser's sort. An absent value therefore becomes the
 * empty string, which still sorts and still renders as a blank field, instead
 * of crashing the list. `startsAt`, `endsAt` and `lateCutoff` are all
 * `required: true` on the model, so this is defence in depth for records that
 * reached the collection by some route other than the model.
 *
 * Both are derived from `iso()` rather than re-parsing, so a value is formatted
 * the same way wherever it appears.
 */
/**
 * `YYYY-MM-DD` / `HH:MM` in ASIA/MANILA, the zone the administrator types in.
 *
 * These used to slice the UTC ISO string. That is what made the eight-hour bug
 * invisible: `parseLocalDateTime` stored the typed Manila wall-clock as though
 * it were UTC, and this sliced that same wrong instant back out, so the form
 * showed the administrator exactly what they typed while the stored event was
 * eight hours late for every attendee reading it in their own zone.
 *
 * Formatting in the same zone the input is parsed in is what makes the form
 * round-trip. The Student card renders `starts_at` itself, so it now reads a
 * correct instant and shows the same wall-clock the administrator entered.
 *
 * Both are STRING-returning by contract, not by convenience. The admin workspace
 * sorts with `b.date.localeCompare(a.date)` and feeds these straight into
 * `<input type="date">`/`<input type="time">` values, so a null here would throw
 * in the browser's sort. An absent value therefore becomes the empty string,
 * which still sorts and still renders as a blank field. `startsAt`, `endsAt` and
 * `lateCutoff` are all `required: true` on the model, so this is defence in
 * depth for records that reached the collection by another route.
 *
 * Both derive from `iso()` rather than re-parsing, so a value is formatted the
 * same way wherever it appears.
 */
function localDate(value) {
  const isoValue = iso(value);
  return isoValue ? manilaDate(new Date(isoValue)) : '';
}

function localTime(value) {
  const isoValue = iso(value);
  return isoValue ? manilaTime(new Date(isoValue)) : '';
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

  /*
   * WHY REGISTRATION IS OR IS NOT AVAILABLE, decided ONCE, here.
   *
   * The Student card used to render the Register button only when
   * `registration_required && can_register`, so whenever registration was
   * required but NOT currently possible the action was simply INVISIBLE while
   * the card still said "Registration required". For an event that had already
   * started that is a dead end: the badge demands registration, scanning then
   * answers "Register for this event before checking in.", and there is no
   * control anywhere on the screen that could ever satisfy it.
   *
   * The reason is published instead of being re-derived in the browser, so the
   * card states the server's actual rule rather than a second, drifting copy of
   * it. `null` means registration is required and available right now.
   */
  let registrationUnavailableReason = null;
  if (event.registrationRequired && context.userRole === 'student' && registration?.status !== 'registered') {
    if (status !== 'upcoming') {
      registrationUnavailableReason = 'Registration closed - this event has already started.';
    } else if (event.registrationDeadline && now > event.registrationDeadline) {
      registrationUnavailableReason = 'Registration closed - the deadline for this event has passed.';
    }
  }

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
    // `null` when registration is open, otherwise the sentence the card must show
    // INSTEAD of silently hiding the Register action.
    registration_unavailable_reason: registrationUnavailableReason,
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
    // GST002: the event's total length, in whole minutes, so the UI never has to
    // recompute it from two timestamps and risk a timezone mismatch.
    // THIS IS THE EVENT LENGTH, NOT THE ATTENDANCE REQUIREMENT. The two are
    // unrelated numbers that are easy to conflate: an event can run 2 h 5 m and
    // require only 2 minutes of verified attendance. The card that once labelled
    // this value "Required duration" was displaying the event's length under the
    // requirement's name, which is exactly how a 2-minute requirement came to
    // read as "2h 5m". Keep the two separately named wherever they are rendered.
    duration_minutes: Math.max(0, Math.round((new Date(event.endsAt) - new Date(event.startsAt)) / 60_000)),
    // GST006: the administrator-configured MINIMUM verified attendance, in whole
    // minutes - the number a student must actually stay for. Sent to students so
    // the card can state the real requirement instead of leaving them to infer it
    // from the schedule. Null means "not configured", which is a genuine state
    // (no administrator has set one) and is never replaced with the event length
    // or any other invented duration.
    required_attendance_minutes: Number.isFinite(event.requiredAttendanceMinutes)
      ? event.requiredAttendanceMinutes
      : null,
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
    // Published under its OWN name. This previously read
    // `requiredForAttendance: event.registrationRequired`, which is how the
    // editor came to believe the registration flag WAS the percentage flag.
    registrationRequired: event.registrationRequired,
    // Published so the edit form can repopulate the deadline it saved. Without
    // it, create -> save -> reopen silently blanks the deadline the
    // administrator typed.
    registrationDeadline: event.registrationDeadline ? iso(event.registrationDeadline) : null,
    requiredForAttendance: event.requiredForAttendance === true,
    // GST006: null when unconfigured, so the editor can show an untouched event.
    requiredAttendanceMinutes: event.requiredAttendanceMinutes ?? null,
    venueLatitude: event.venueLatitude ?? undefined,
    venueLongitude: event.venueLongitude ?? undefined,
    venueRadiusMeters: event.venueRadiusMeters ?? undefined,
    locationVerificationRequired: event.locationVerificationRequired !== false,
    createdAt: iso(event.createdAt),
    organizerId: event.organizerId ? String(event.organizerId) : undefined,
  };
}
