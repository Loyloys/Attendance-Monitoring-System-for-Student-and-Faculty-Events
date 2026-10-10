/**
 * GST004 saved venues: reusable geofence templates an administrator can pick
 * when creating an event.
 *
 * THE ONE INVARIANT THIS FILE EXISTS TO PROTECT: an EVENT IS A SNAPSHOT.
 * Selecting a saved venue copies its numbers into the event; the event then
 * stores its own `venueLatitude` / `venueLongitude` / `venueRadiusMeters`, and
 * holds NO reference back to the saved venue. That is why editing or deleting a
 * saved venue cannot move the check-in zone of an event that already used it -
 * attendance already recorded against those coordinates stays meaningful.
 *
 * This is why there is deliberately no `venueId` on Event and no cascade here.
 * Adding one would create exactly the silent-update hazard this avoids.
 */
import { Venue } from '../models/index.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';

const numberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
};

function validateVenue(data, current = null) {
  const name = data.name !== undefined ? String(data.name).trim() : current?.name;
  if (!name || name.length > 180) throw new ValidationError({ name: 'Enter a venue name of at most 180 characters.' });

  const latitude = data.latitude !== undefined ? numberOrNull(data.latitude) : current?.latitude;
  const longitude = data.longitude !== undefined ? numberOrNull(data.longitude) : current?.longitude;
  const radiusMeters = data.radiusMeters !== undefined ? numberOrNull(data.radiusMeters) : current?.radiusMeters;

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new ValidationError({ latitude: 'Latitude must be a number between -90 and 90.' });
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new ValidationError({ longitude: 'Longitude must be a number between -180 and 180.' });
  }
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    throw new ValidationError({ radiusMeters: 'Enter a check-in radius greater than 0 metres.' });
  }

  let defaultRequiredAttendanceMinutes = current?.defaultRequiredAttendanceMinutes ?? null;
  if (data.defaultRequiredAttendanceMinutes !== undefined) {
    const parsed = numberOrNull(data.defaultRequiredAttendanceMinutes);
    if (parsed === null) {
      defaultRequiredAttendanceMinutes = null;
    } else if (!Number.isFinite(parsed) || parsed < 1 || parsed > 1440) {
      throw new ValidationError({
        defaultRequiredAttendanceMinutes: 'Enter the default required attendance in whole minutes (1-1440), or leave it blank.',
      });
    } else {
      defaultRequiredAttendanceMinutes = Math.round(parsed);
    }
  }

  return {
    name,
    note: data.note !== undefined ? String(data.note).trim().slice(0, 70_000) : current?.note ?? '',
    latitude,
    longitude,
    radiusMeters,
    defaultRequiredAttendanceMinutes,
    // Preserved on update so a venue created as isolated-only is not silently
    // promoted into a live-looking record by an ordinary edit.
    isolatedTestRecord: data.isolatedTestRecord !== undefined
      ? Boolean(data.isolatedTestRecord)
      : current?.isolatedTestRecord ?? false,
  };
}

export function serializeVenue(venue) {
  return {
    id: venue._id,
    name: venue.name,
    note: venue.note ?? '',
    latitude: venue.latitude,
    longitude: venue.longitude,
    radiusMeters: venue.radiusMeters,
    // Named `default...` all the way through so no caller can mistake it for an
    // enforced value on the event.
    default_required_attendance_minutes: venue.defaultRequiredAttendanceMinutes ?? null,
    isolated_test_record: Boolean(venue.isolatedTestRecord),
    created_at: venue.createdAt,
  };
}

export async function listVenues() {
  return (await Venue.find().sort({ name: 1 }).lean()).map(serializeVenue);
}

export async function createVenue(data) {
  return serializeVenue(await Venue.create(validateVenue(data)));
}

export async function updateVenue(venueId, data) {
  const venue = await Venue.findById(venueId);
  if (!venue) throw new NotFoundError('Saved venue not found.');
  Object.assign(venue, validateVenue(data, venue));
  await venue.save();
  return serializeVenue(venue);
}

export async function removeVenue(venueId) {
  const venue = await Venue.findByIdAndDelete(venueId);
  if (!venue) throw new NotFoundError('Saved venue not found.');
  return serializeVenue(venue);
}
