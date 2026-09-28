export const QR_PREFIX = 'COT-EVENT';

export function isEventQr(value: string): boolean {
  return value.trim().startsWith(`${QR_PREFIX}:`);
}

export interface EventQrDetails {
  eventId: string;
  token: string;
}

export function parseEventQr(value: string): EventQrDetails | null {
  const parts = value.trim().split(':');
  if (parts.length !== 3 || parts[0] !== QR_PREFIX || !parts[1] || !parts[2]) return null;
  return { eventId: parts[1], token: parts[2] };
}

export function validateEventQr(value: string): { valid: boolean; reason?: string; details?: EventQrDetails } {
  const details = parseEventQr(value);
  return details
    ? { valid: true, details }
    : { valid: false, reason: 'Invalid event QR code.' };
}

/**
 * A location fix captured by the browser and sent with an attendance scan.
 * The server re-validates all of it; the browser is never trusted to decide
 * whether someone is on campus.
 */
export interface LocationFix {
  latitude: number;
  longitude: number;
  /** Reported accuracy in metres. */
  accuracy: number;
  /** ISO-8601 timestamp of when the fix was taken. */
  capturedAt: string;
}

/**
 * Requests a fresh position.
 *
 * A website cannot switch on phone GPS or grant browser permission by itself, so
 * a denial is reported as an instruction the person can act on rather than a
 * silent failure. `maximumAge: 0` forces a new reading instead of reusing a
 * cached one, because the server also rejects stale fixes.
 */
export function captureLocation(options: { timeoutMs?: number } = {}): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('This browser cannot report your location, so attendance cannot be verified. Try a current version of Chrome, Edge, or Safari.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          reject(new Error("Location permission is blocked. Open your browser's site settings, allow location for this site, then try again."));
          return;
        }
        if (error.code === error.POSITION_UNAVAILABLE) {
          reject(new Error('Your location is unavailable. Turn on your device location services, then try again.'));
          return;
        }
        reject(new Error('Taking a location reading took too long. Move to an open area and try again.'));
      },
      { enableHighAccuracy: true, timeout: options.timeoutMs ?? 15_000, maximumAge: 0 },
    );
  });
}
