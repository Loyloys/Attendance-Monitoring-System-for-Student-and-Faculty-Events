export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface LocationValidation {
  accepted: boolean;
  reason: string;
  checkedAt: string;
  distanceMeters?: number;
  accuracyMeters?: number;
  location?: GeoPoint;
}

export interface GeofenceConfig {
  center: GeoPoint;
  radiusMeters: number;
  accuracyLimitMeters?: number;
}

const EARTH_RADIUS_METERS = 6_371_000;

function distanceBetween(first: GeoPoint, second: GeoPoint): number {
  const latitudeDelta = ((second.latitude - first.latitude) * Math.PI) / 180;
  const longitudeDelta = ((second.longitude - first.longitude) * Math.PI) / 180;
  const firstLatitude = (first.latitude * Math.PI) / 180;
  const secondLatitude = (second.latitude * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.sin(longitudeDelta / 2) ** 2 * Math.cos(firstLatitude) * Math.cos(secondLatitude);

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

function result(
  accepted: boolean,
  reason: string,
  details: Omit<LocationValidation, 'accepted' | 'reason'>,
): LocationValidation {
  return { accepted, reason, ...details };
}

export function validateCurrentLocation(config: GeofenceConfig): Promise<LocationValidation> {
  const checkedAt = new Date().toISOString();
  const accuracyLimitMeters = config.accuracyLimitMeters ?? 100;

  if (!navigator.geolocation) {
    return Promise.resolve(result(false, 'Location services are not supported by this browser.', { checkedAt }));
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        };
        const accuracyMeters = position.coords.accuracy;
        const distanceMeters = distanceBetween(config.center, location);

        if (accuracyMeters > accuracyLimitMeters) {
          resolve(result(false, `GPS accuracy is too low (${Math.round(accuracyMeters)}m). Move to an area with a stronger signal and try again.`, {
            checkedAt,
            accuracyMeters,
            distanceMeters,
            location,
          }));
          return;
        }

        if (distanceMeters > config.radiusMeters) {
          resolve(result(false, `Scan rejected: you are ${Math.round(distanceMeters)}m from the approved event location.`, {
            checkedAt,
            accuracyMeters,
            distanceMeters,
            location,
          }));
          return;
        }

        resolve(result(true, 'Location verified.', {
          checkedAt,
          accuracyMeters,
          distanceMeters,
          location,
        }));
      },
      (error) => {
        const reason = error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access to record attendance.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'Your device location is unavailable. Enable location services and try again.'
            : 'Location lookup timed out. Move to an area with a stronger signal and try again.';
        resolve(result(false, reason, { checkedAt }));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}
