/**
 * Location verification for attendance scans (GST004).
 *
 * A browser cannot be trusted to decide whether someone is on campus, so the
 * browser only *reports* a position and this module decides whether to accept
 * it. Every rejection carries a specific reason so the UI can explain what went
 * wrong instead of showing a generic failure.
 *
 * Note on limits: this is a point-in-time proximity check. It is not tamper
 * proof, it does not prove continuous attendance, and a device can still lie
 * about its position. It raises the cost of remote check-in; it does not
 * eliminate it.
 */
import { LOCATION_POLICY, geofenceFor } from '../utils/domain.js';
import { ValidationError } from '../utils/errors.js';

const EARTH_RADIUS_METERS = 6_371_008.8;

/** Great-circle distance in metres between two WGS-84 points. */
export function distanceMeters(fromLat, fromLon, toLat, toLon) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(toLat - fromLat);
  const dLon = toRadians(toLon - fromLon);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates a submitted fix against the event's geofence and the location
 * policy. Returns the normalised fix to persist, or throws a ValidationError
 * with a `location` field the UI can show verbatim.
 *
 * Throws rather than returning a verdict so the caller cannot accidentally
 * record attendance after a failed check.
 */
export function verifyAttendanceLocation(event, submitted, now = new Date()) {
  const fence = geofenceFor(event);

  // A missing or partly configured fence is a configuration fault, and is
  // reported as such rather than being treated as "no restriction".
  if (!fence) {
    throw new ValidationError(
      { location: 'This event has no verified venue location configured, so attendance cannot be checked in safely. Ask an administrator to set the venue coordinates and radius.' },
      'Location verification is not configured for this event.',
    );
  }

  const latitude = submitted?.latitude;
  const longitude = submitted?.longitude;
  const accuracy = submitted?.accuracy;
  const capturedAt = submitted?.capturedAt;

  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) {
    throw new ValidationError(
      { location: 'Your device did not report a location. Turn on location services, allow this site to use your location, then try again.' },
      'A location fix is required to check in.',
    );
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new ValidationError({ location: 'Your device reported an invalid location. Try again outdoors or near a window.' });
  }

  // Accuracy: a fix that is honest about being imprecise is not usable for a
  // campus-sized fence.
  if (isFiniteNumber(accuracy)) {
    if (accuracy < 0) {
      throw new ValidationError({ location: 'Your device reported an invalid location accuracy. Try again.' });
    }
    if (accuracy > LOCATION_POLICY.maxAccuracyMeters) {
      throw new ValidationError({
        location: `Your location is not precise enough (±${Math.round(accuracy)} m, needs ±${LOCATION_POLICY.maxAccuracyMeters} m or better). Move away from buildings or switch on high-accuracy location, then try again.`,
      });
    }
  }

  // Freshness: an old fix could be replayed, so its age is bounded. The browser
  // sends an ISO-8601 string, so numbers and date strings are both accepted.
  const capturedTimestamp = typeof capturedAt === 'string' || typeof capturedAt === 'number'
    ? new Date(capturedAt).getTime()
    : Number.NaN;
  if (Number.isNaN(capturedTimestamp)) {
    throw new ValidationError({ location: 'The location reading was not timestamped. Try again.' });
  }
  const ageSeconds = (now.getTime() - capturedTimestamp) / 1000;
  if (ageSeconds > LOCATION_POLICY.maxAgeSeconds) {
    throw new ValidationError({
      location: 'That location reading is too old. Allow the app to take a fresh reading and try again.',
    });
  }
  // A fix dated in the future is not a real reading either.
  if (ageSeconds < -LOCATION_POLICY.maxAgeSeconds) {
    throw new ValidationError({ location: 'That location reading has an invalid timestamp. Try again.' });
  }

  const distance = distanceMeters(latitude, longitude, fence.latitude, fence.longitude);
  const limit = fence.radiusMeters + LOCATION_POLICY.slackMeters;

  if (distance > limit) {
    const distanceText = distance >= 1000
      ? `${(distance / 1000).toFixed(1)} km`
      : `${Math.round(distance)} m`;
    throw new ValidationError({
      location: `You appear to be ${distanceText} from the event venue, which is outside the ${fence.radiusMeters} m check-in zone. Move to the venue and try again.`,
    });
  }

  return {
    latitude,
    longitude,
    accuracy: isFiniteNumber(accuracy) ? accuracy : null,
    capturedAt: new Date(capturedAt).toISOString(),
    distanceMeters: Math.round(distance * 10) / 10,
  };
}

export function effectiveEventStatus(event, now = new Date()) {
  if (event.status === 'cancelled') return 'cancelled';
  if (now < event.startsAt) return 'upcoming';
  if (now <= event.endsAt) return 'ongoing';
  return 'completed';
}

export function isCheckInOpen(event, now = new Date()) {
  return event.status === 'published'
    && event.checkInOpensAt <= now
    && now <= event.checkInClosesAt;
}

export function eventAllows(event, profile) {
  return Boolean(profile)
    && ['student', 'faculty'].includes(profile.role)
    && (event.audience === 'all' || event.audience === profile.role);
}

export function isSupervisor(event, user) {
  const userId = String(user?._id || user?.id || '');
  return Boolean(user?.profile?.role === 'faculty'
    && (String(event.organizerId) === userId || (event.supervisors || []).some((id) => String(id) === userId)));
}
