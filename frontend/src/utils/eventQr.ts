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
/**
 * Does this scanned code belong to the event the scanner is scoped to?
 *
 * A scoped scanner ("Scan attendance for this event") must not become a way to
 * record attendance for the WRONG event. The token itself carries the event id
 * (`COT-EVENT:<eventId>:<token>`), so a QR belonging to another event is
 * detected here and refused, rather than being sent on and silently applied.
 *
 * Two rules, deliberately different:
 *
 *  - An unscoped scanner (no preselected event, the general path) accepts any
 *    event's QR, because the QR identifies the event and the server checks the
 *    token against THAT event. Its behaviour is unchanged.
 *  - A scoped scanner additionally requires the QR's event id to be the
 *    preselected one. Without this, presenting any valid QR would record against
 *    whichever event happened to be preselected - the opposite of what a
 *    card-level button promises.
 *
 * Only well-formed QR payloads are matched here. A non-QR value (a card or ID
 * for RFID/barcode events) is unaffected, and an UNPARSEABLE value returns
 * "no mismatch", because the server - not this helper - decides whether a token
 * is a valid credential. This guard only refuses a QR that positively belongs to
 * a different event; it never authorises anything on its own.
 */
export function scanMatchesEvent(rawValue: string, selectedEventId?: string): { ok: boolean; reason?: string } {
  if (!selectedEventId) return { ok: true };
  const details = parseEventQr(rawValue);
  if (!details) return { ok: true };
  if (details.eventId === selectedEventId) return { ok: true };
  return {
    ok: false,
    reason: 'That QR code belongs to a different event. Scan the code shown for this event.',
  };
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
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return 'This browser cannot report a location. Try a current version of Chrome, Edge, or Safari.';
  }
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'This page is not on a secure (HTTPS) connection, so the browser blocks location access. Open the app over HTTPS, then try again.';
  }
  return null;
}

/**
 * The location-quality limits the SERVER is actually enforcing.
 *
 * Read from `/api/health/` rather than hard-coded here, so an operator who
 * tightens `LOCATION_MAX_ACCURACY_METERS` does not end up with a second,
 * contradictory threshold in the browser. Defaults mirror the server's own
 * documented fallbacks and are only used if the health read has not landed yet.
 */
export interface LocationQualityPolicy {
  maxAccuracyMeters: number;
  maxAgeSeconds: number;
}

export const FALLBACK_LOCATION_QUALITY: LocationQualityPolicy = {
  maxAccuracyMeters: 100,
  maxAgeSeconds: 120,
};

/**
 * Is this fix good enough to use?
 *
 * THE SAME RULES THE SERVER APPLIES, not a looser local invention. A fix is
 * refused when the device reports it is less accurate than the published
 * maximum, or when it is older than the published maximum age - the two reasons
 * `LOCATION_POLICY` exists. Reusing the published numbers is the whole point: a
 * configuration step that accepted a fix the server would later refuse would
 * only push the problem to check-in time.
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
  if (fix.accuracy > policy.maxAccuracyMeters) {
    return {
      acceptable: false,
      reason: `That reading is only accurate to about ${Math.round(fix.accuracy)} m, and this system requires ${policy.maxAccuracyMeters} m or better. `
        + 'Move somewhere with a clearer view of the sky, or turn on high-accuracy location, then try again. You can still type the coordinates in by hand.',
    };
  }
  const ageSeconds = (Date.now() - Date.parse(fix.capturedAt)) / 1000;
  if (Number.isFinite(ageSeconds) && ageSeconds > policy.maxAgeSeconds) {
    return {
      acceptable: false,
      reason: `That reading is about ${Math.round(ageSeconds)} seconds old, and this system only accepts readings under ${policy.maxAgeSeconds} seconds. Try again.`,
    };
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
