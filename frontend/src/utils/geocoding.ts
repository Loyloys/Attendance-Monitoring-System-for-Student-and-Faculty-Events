/**
 * Place geocoding for the map venue picker.
 *
 * This module is intentionally SEPARATE from Leaflet. Leaflet only renders the
 * map; it does not provide place search. Place search here uses the free
 * OpenStreetMap Nominatim endpoint, which needs no API key but has a usage
 * policy:
 *
 *   - every request must send a descriptive `User-Agent`;
 *   - requests should be limited to about one per second;
 *   - results shown to people must carry OpenStreetMap attribution.
 *
 * Geocoding results are coarse place matches with coordinates, not "verified
 * venues". Choosing a result is an explicit organizer action, and nothing is
 * saved until the organizer saves the event.
 *
 * See frontend/.env.example and frontend/MAP.md for provider and attribution
 * requirements.
 */

export interface GeocodeResult {
  name: string;
  latitude: number;
  longitude: number;
  address?: string;
}

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';

/**
 * Identifies this application to the geocoding provider. Nominatim rejects or
 * rate-limits requests without a descriptive User-Agent. This is a public
 * application identifier, not a secret key.
 */
const USER_AGENT = 'Attendance-Monitoring-App/1.0 (venue-picker; contact: admin@example.local)';

/** Nominatim asks for roughly one request per second; be politely conservative. */
const MIN_REQUEST_INTERVAL_MS = 1100;

let lastRequestTime = 0;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Waits, if needed, so Nominatim is not hammered with back-to-back requests. */
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (now - lastRequestTime));
  if (wait > 0) await sleep(wait);
  lastRequestTime = Date.now();
}

/** Exposed only so tests can run without real 1.1s spacing between calls. */
export function resetRateLimiterForTesting(): void {
  lastRequestTime = 0;
}

/**
 * Geocodes a free-text place query using OpenStreetMap Nominatim.
 *
 * Throws a descriptive error on network failure, invalid responses, and HTTP
 * 429 (rate-limited) so the caller can show a setup/failure state instead of
 * silently failing. Returns an empty array when no place matches.
 */
export async function geocodePlaces(
  query: string,
  { limit = 5 }: { limit?: number } = {}
): Promise<GeocodeResult[]> {
  if (!query.trim()) return [];

  await throttle();
  lastRequestTime = Date.now();

  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('q', query.trim());
  url.searchParams.set('accept-language', 'en');

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new Error(
      error instanceof Error ? `Place search failed: ${error.message}` : 'Place search failed.'
    );
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        'Place search is rate-limited. Please wait a moment and try again.'
      );
    }
    throw new Error(`Place search failed (HTTP ${response.status}).`);
  }

  let data: unknown[];
  try {
    data = (await response.json()) as unknown[];
  } catch {
    throw new Error('Place search returned an invalid response.');
  }

  const results: GeocodeResult[] = [];
  for (const item of data as Record<string, unknown>[]) {
    const latitude = Number(item.lat);
    const longitude = Number(item.lon);
    const name = String(item.display_name ?? item.name ?? '').trim();
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    results.push({
      name,
      latitude,
      longitude,
      address: typeof item.display_name === 'string' ? item.display_name : undefined,
    });
  }
  return results;
}

/** True only for real-world latitude/longitude ranges. */
export function isValidCoordinate(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
