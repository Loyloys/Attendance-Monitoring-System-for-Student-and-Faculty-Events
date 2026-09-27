export const ROLES = Object.freeze({
  STUDENT: 'student',
  FACULTY: 'faculty',
  ADMIN: 'admin',
});

export const EVENT_AUDIENCES = Object.freeze(['all', 'student', 'faculty']);
export const EVENT_STATUSES = Object.freeze(['published', 'cancelled']);
export const ATTENDANCE_METHODS = Object.freeze(['qr', 'barcode', 'rfid']);
export const ATTENDANCE_STATUSES = Object.freeze(['present', 'late', 'absent']);
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
