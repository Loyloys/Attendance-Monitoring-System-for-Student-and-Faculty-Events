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
 * Is device geolocation available at all on this origin?
 *
 * A browser only exposes a usable `navigator.geolocation` in a SECURE CONTEXT
 * (HTTPS, or `localhost`). On plain HTTP elsewhere the object exists but every
 * call fails, so the caller needs to be able to say why BEFORE asking, rather
 * than reporting a confusing permission error for something that is really an
 * insecure-origin problem.
 */
export function geolocationUnavailableReason(): string | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'This page is not on a secure (HTTPS) connection, so the browser blocks location access. Open the app over HTTPS, then try again.';
  }
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'This browser cannot report a location. Try a current version of Chrome, Edge, or Safari.';
  }
  return null;
}

export function geolocationErrorMessage(code: number): string {
  if (code === 1) {
    return "Location permission is blocked. Open your browser's site settings, allow location for this site, then try again.";
  }
  if (code === 2) {
    return 'Your location is unavailable. Turn on your device location services, then try again.';
  }
  return 'Taking a location reading took too long. Move to an open area and try again.';
}

export function cameraFailureKind(error: unknown): 'permission-denied' | 'unavailable' {
  const name = typeof DOMException !== 'undefined' && error instanceof DOMException
    ? error.name
    : error && typeof error === 'object' && 'name' in error
      ? String(error.name)
      : '';
  return ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(name)
    ? 'permission-denied'
    : 'unavailable';
}

export function cameraFailureMessage(kind: 'permission-denied' | 'unavailable'): string {
  return kind === 'permission-denied'
    ? "Camera permission was denied. Allow camera access in your browser's site settings, then resume scanning. You can also use manual fallback."
    : 'Camera is unavailable or another app is using it. Close that app, check this device, or use manual fallback.';
}

export function scannerPauseLabel(reason: 'location' | 'processing' | 'manual'): string {
  if (reason === 'location') return 'Location required before scanning';
  if (reason === 'processing') return 'QR detected · verifying with server';
  return 'Scanner paused';
}

export function scanRequiresLocation({
  isQrInput,
  qrEventKnown,
  qrEventRequiresLocation,
  qrEventRequiresDuration,
  selectedEventKnown,
  selectedEventRequiresLocation,
  selectedEventRequiresDuration,
}: {
  isQrInput: boolean;
  qrEventKnown: boolean;
  qrEventRequiresLocation?: boolean;
  qrEventRequiresDuration?: number | null;
  selectedEventKnown?: boolean;
  selectedEventRequiresLocation?: boolean;
  selectedEventRequiresDuration?: number | null;
}): boolean {
  if (isQrInput) {
    return qrEventKnown && (qrEventRequiresLocation !== false || (qrEventRequiresDuration ?? 0) > 0);
  }
  return Boolean(selectedEventKnown)
    && (selectedEventRequiresLocation !== false || (selectedEventRequiresDuration ?? 0) > 0);
}

export async function runWithValidatedLocation<T>({
  requiresLocation,
  requestLocation,
  action,
  policy,
}: {
  requiresLocation: boolean;
  requestLocation: () => Promise<LocationFix>;
  action: (fix: LocationFix | null) => T | Promise<T>;
  policy?: LocationQualityPolicy;
}): Promise<T> {
  if (!requiresLocation) {
    return action(null);
  }

  const fix = await requestLocation();
  const quality = evaluateFixQuality(fix, policy);
  if (!quality.acceptable) {
    throw new Error(quality.reason ?? 'Your location could not be verified.');
  }

  return action(fix);
}

/**
 * The location-quality limits the SERVER is actually enforcing.
 *
 * Read from `/api/health/` rather than hard-coded here, so an operator who
 * The browser uses the server's freshness limit and leaves reported accuracy
 * informational. The server independently decides whether coordinates are
 * inside the event geofence.
 */
export interface LocationQualityPolicy {
  /** Kept optional for compatibility with older health responses. */
  maxAccuracyMeters?: number;
  maxAgeSeconds: number;
}

export const FALLBACK_LOCATION_QUALITY: LocationQualityPolicy = {
  maxAgeSeconds: 120,
};

/**
 * Is this fix good enough to use?
 *
 * A fix is refused only when coordinates are invalid, accuracy is missing or
 * invalid, or the reading is outside the freshness window. Reported accuracy
 * is shown to the user but is not a client-side acceptance cutoff; the server
 * decides the event geofence result.
 *
 * Age is measured against the fix's OWN timestamp, so a slow request does not
 * make a fresh reading look stale.
 */
export function evaluateFixQuality(
  fix: LocationFix,
  policy: LocationQualityPolicy = FALLBACK_LOCATION_QUALITY,
): { acceptable: boolean; reason?: string } {
  if (!Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) {
    return { acceptable: false, reason: 'That reading had no usable coordinates. Try again.' };
  }
  // 0 is a REAL coordinate (the equator / prime meridian) and must survive.
  if (Math.abs(fix.latitude) > 90 || Math.abs(fix.longitude) > 180) {
    return { acceptable: false, reason: 'That reading reported coordinates outside the valid range. Try again.' };
  }
  if (!Number.isFinite(fix.accuracy)) {
    return { acceptable: false, reason: 'Your device did not report how accurate that reading is, so it cannot be used safely. Try again.' };
  }
  if (fix.accuracy < 0) {
    return { acceptable: false, reason: 'Your device reported invalid location accuracy. Try again.' };
  }
  const capturedAt = Date.parse(fix.capturedAt);
  if (!Number.isFinite(capturedAt)) {
    return { acceptable: false, reason: 'That location reading has an invalid timestamp. Try again.' };
  }
  const ageSeconds = (Date.now() - capturedAt) / 1000;
  if (ageSeconds > policy.maxAgeSeconds) {
    return {
      acceptable: false,
      reason: `That reading is about ${Math.round(ageSeconds)} seconds old, and this system only accepts readings under ${policy.maxAgeSeconds} seconds. Try again.`,
    };
  }
  if (ageSeconds < -policy.maxAgeSeconds) {
    return { acceptable: false, reason: 'That location reading has an invalid timestamp. Try again.' };
  }
  return { acceptable: true };
}

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
export function captureLocation(options: {
  timeoutMs?: number;
  onUpdate?: (fix: LocationFix) => void;
} = {}): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    const unavailable = geolocationUnavailableReason();
    if (unavailable) {
      reject(new Error(unavailable));
      return;
    }

    const timeoutMs = options.timeoutMs ?? 30_000;
    let bestFix: LocationFix | null = null;
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let watchId: number | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      callback();
    };
    const accept = (position: GeolocationPosition) => {
      const fix = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
        };
      if (!bestFix || (Number.isFinite(fix.accuracy) && fix.accuracy < bestFix.accuracy)) {
        bestFix = fix;
        options.onUpdate?.(fix);
      }
    };
    const fail = (error: GeolocationPositionError) => {
      if (error.code === 1) {
        finish(() => reject(new Error(geolocationErrorMessage(error.code))));
        return;
      }
      if (bestFix) return;
      finish(() => reject(new Error(geolocationErrorMessage(error.code))));
    };
    try {
      watchId = navigator.geolocation.watchPosition(
        accept,
        fail,
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      );
      if (settled) {
        navigator.geolocation.clearWatch(watchId);
        return;
      }
      timeoutId = setTimeout(() => {
        if (bestFix) finish(() => resolve(bestFix as LocationFix));
        else finish(() => reject(new Error(geolocationErrorMessage(3))));
      }, timeoutMs);
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error('Your location could not be read.')));
    }
  });
}
