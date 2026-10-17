export const ROLES = Object.freeze({
  STUDENT: 'student',
  FACULTY: 'faculty',
  ADMIN: 'admin',
});

/**
 * The department/program values a NEW account may choose on the Google signup
 * profile-completion form. The server re-validates every submission against
 * this list (see completeGoogleProfile), so it is the single source of truth -
 * the frontend dropdown mirrors it for convenience only.
 *
 * DELIBERATELY NARROW: this list gates new signup submissions only. Existing
 * profiles carry legacy values ("Information Technology", "BSIT", "COT", ...)
 * that must keep working untouched, so neither the admin account-editing API
 * nor signup approval checks against this list, and no record is rewritten.
 */
export const DEPARTMENTS = Object.freeze(['IT', 'BSEMC', 'BSFT', 'BSAT', 'BSET']);

/**
 * The pending role an account request gets from the applicant's VERIFIED Google
 * email domain. The match is exact and case-insensitive on the whole domain:
 * "@student.buksu.edu.ph.evil.example" or "@notstudent.buksu.edu.ph" never
 * match. An address on any other domain gets NO inferred role, and the
 * administrator must then assign one explicitly during approval.
 */
export const PENDING_ROLE_BY_EMAIL_DOMAIN = Object.freeze({
  'student.buksu.edu.ph': ROLES.STUDENT,
  'faculty.buksu.edu.ph': ROLES.FACULTY,
});

/**
 * Infers the pending role for a verified email address, or '' when its domain
 * is not one of the exact matches above. Only ever called with the email claim
 * Google has already verified - never with browser input.
 */
export function pendingRoleForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const separator = normalized.lastIndexOf('@');
  const domain = separator === -1 ? '' : normalized.slice(separator + 1);
  return PENDING_ROLE_BY_EMAIL_DOMAIN[domain] || '';
}

export const EVENT_AUDIENCES = Object.freeze(['all', 'student', 'faculty']);
export const EVENT_STATUSES = Object.freeze(['published', 'cancelled']);
export const ATTENDANCE_METHODS = Object.freeze(['qr', 'barcode', 'rfid']);
export const ATTENDANCE_STATUSES = Object.freeze(['present', 'late', 'absent']);

/**
 * DURATION-BASED QUALIFICATION, kept SEPARATE from `status` on purpose.
 *
 * `status` is the immediate outcome of the scan itself and is deliberately left
 * exactly as it was, so every event without a duration requirement keeps its
 * established behaviour untouched. For an event that DOES require verified
 * in-zone minutes, the scan is only a check-in: the attendee is not qualified
 * until the server has credited the required time.
 *
 * A SEPARATE FIELD rather than an extra `status` value on purpose. Adding
 * `pending` to ATTENDANCE_STATUSES would make one column mean two things - "has
 * this person attended?" and "have they served the required time yet?" - and any
 * report that counts `present` would silently start counting people who had not
 * arrived at all. The reason an attendee is unqualified lives in
 * `qualificationReason`, never in an ambiguous status word.
 */
export const ATTENDANCE_QUALIFICATIONS = Object.freeze(['pending', 'present', 'late', 'absent']);

/** Why an attendance record is not (yet) qualified. Explains, never replaces. */
export const QUALIFICATION_REASONS = Object.freeze({
  DURATION_NOT_MET: 'Required attendance duration not met.',
  DURATION_IN_PROGRESS: 'Required in-zone time has not been served yet.',
  CHECKOUT_BEFORE_DURATION_MET: 'Checked out before required attendance duration was met.',
  MANUAL_OVERRIDE: 'Set by an administrator.',
});

export const REGISTRATION_STATUSES = Object.freeze(['registered', 'cancelled']);
export const QR_PREFIX = 'COT-EVENT';

/**
 * Geofence policy, read from the environment. These are deliberately explicit
 * rather than hard-coded so an institution can tighten or relax them without a
 * code change, and so a missing setting is *reported* instead of silently
 * defaulting to "accept anything".
 */
export const LOCATION_POLICY = Object.freeze({
  /** Reported accuracy (metres) worse than this is refused as a poor fix. */
  maxAccuracyMeters: Number(process.env.LOCATION_MAX_ACCURACY_METERS || 100),
  /** A fix older than this is refused as stale, so replayed coordinates fail. */
  maxAgeSeconds: Number(process.env.LOCATION_MAX_AGE_SECONDS || 120),
  /** Optional cap on how far outside the fence a scan may be. */
  slackMeters: Number(process.env.LOCATION_FENCE_SLACK_METERS || 25),
});

/** An event is geofenced only when it has a complete centre and a positive radius. */
export function geofenceFor(event) {
  const latitude = event?.venueLatitude;
  const longitude = event?.venueLongitude;
  const radiusMeters = event?.venueRadiusMeters;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || typeof radiusMeters !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(radiusMeters)) return null;
  if (radiusMeters <= 0) return null;
  return { latitude, longitude, radiusMeters };
}
