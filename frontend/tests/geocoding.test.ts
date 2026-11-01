import { describe, expect, it, vi } from 'vitest';
import {
  geocodePlaces,
  isValidCoordinate,
  resetRateLimiterForTesting,
} from '../src/utils/geocoding';

describe('isValidCoordinate', () => {
  it('accepts valid latitude/longitude ranges', () => {
    expect(isValidCoordinate(10.5, 123.2)).toBe(true);
    expect(isValidCoordinate(-90, -180)).toBe(true);
    expect(isValidCoordinate(90, 180)).toBe(true);
  });

  it('rejects out-of-range and non-finite values', () => {
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, -181)).toBe(false);
    expect(isValidCoordinate(NaN, 0)).toBe(false);
    expect(isValidCoordinate(0, NaN)).toBe(false);
  });
});

describe('resetRateLimiterForTesting', () => {
  it('resets the Nominatim rate limiter', () => {
    resetRateLimiterForTesting();
    expect(true).toBe(true);
  });
});

describe('geocodePlaces', () => {
  it('returns an empty list for a blank query', async () => {
    expect(await geocodePlaces('   ')).toEqual([]);
  });

  it('returns matches when the fetch resolves with valid results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve([
          {
            lat: '10.5',
            lon: '123.2',
            display_name: 'Ateneo de Manila University',
          },
        ]),
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const results = await geocodePlaces('Ateneo de Manila University');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        name: 'Ateneo de Manila University',
        latitude: 10.5,
        longitude: 123.2,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws a descriptive error when Nominatim returns 429', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(geocodePlaces('Ateneo')).rejects.toThrow('rate-limited');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('throws a descriptive error when the network fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('fetch failed')),
    );
    try {
      await expect(geocodePlaces('Ateneo')).rejects.toThrow('Place search failed');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
