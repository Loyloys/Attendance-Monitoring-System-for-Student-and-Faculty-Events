// @vitest-environment jsdom
//
// Focused tests for the admin event form's "Use my current location" action:
// coordinate autofill and the location failure paths. The component calls the
// app's existing `captureLocation` helper, which is stubbed here so the tests
// run deterministically in jsdom without a real device or backend.

import '@testing-library/jest-dom/vitest';

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UseMyLocation from '../src/components/admin/UseMyLocation';
import { captureLocation, geolocationUnavailableReason, type LocationFix } from '../src/utils/eventQr';

/** Controllable stand-in for the module-level `captureLocation`. */
let captureLocationStub: ((location: LocationFix) => Promise<LocationFix>) | null = null;

/** The guard the component honours before asking the browser for a fix. */
let unavailableReason = '';
const setUnavailableReason = (reason: string) => { unavailableReason = reason; };

vi.mock('../src/utils/eventQr', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/utils/eventQr')>();
  const real = original.captureLocation;
  return {
    ...original,
    captureLocation: vi.fn().mockImplementation(async (options: unknown) => {
      if (captureLocationStub) return captureLocationStub(options as Parameters<typeof real>[0]);
      return real(options as Parameters<typeof real>[0]);
    }),
    geolocationUnavailableReason: vi.fn(() => unavailableReason),
  };
});

const defaultPolicy = { maxAccuracyMeters: 100, maxAgeSeconds: 120 };

const detected = (latitude: number, longitude: number, accuracy = 25) => ({
  latitude,
  longitude,
  accuracy,
  capturedAt: new Date().toISOString(),
});

describe('Admin event form "Use my current location"', () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('fills venue latitude/longitude when the detected location is applied', async () => {
    const onApply = vi.fn();
    const fix = detected(14.6, 121.0, 25);
    captureLocationStub = () => Promise.resolve(fix);

    render(<UseMyLocation policy={defaultPolicy} onApply={onApply} />);
    try {
      await act(async () => { await Promise.resolve(); });

      act(() => { screen.getByTestId('use-my-location-button').click(); });
      expect(captureLocation).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('use-my-location-loading')).toBeInTheDocument();

      await screen.findByTestId('detected-latitude');
      expect(screen.getByTestId('use-my-location-review')).toBeInTheDocument();
      expect(screen.getByTestId('detected-latitude')).toHaveTextContent('14.6');
      expect(screen.getByTestId('detected-longitude')).toHaveTextContent('121');

      act(() => { screen.getByTestId('apply-detected-location').click(); });
      expect(onApply).toHaveBeenCalledTimes(1);
      expect(onApply).toHaveBeenCalledWith(fix);

      expect(screen.queryByTestId('use-my-location-review')).not.toBeInTheDocument();
      expect(screen.getByTestId('use-my-location-button')).toHaveTextContent('Use my current location');
    } finally {
      render(null);
    }
  });

  it('shows an error without filling the form when the reading is outside the accepted age window', async () => {
    const old = new Date(Date.now() - 300_000).toISOString();
    captureLocationStub = () =>
      Promise.resolve({ latitude: 14.6, longitude: 121.0, accuracy: 40, capturedAt: old });
    render(<UseMyLocation policy={defaultPolicy} onApply={() => {}} />);
    try {
      await act(async () => { await Promise.resolve(); });
      act(() => { screen.getByTestId('use-my-location-button').click(); });
      await screen.findByTestId('use-my-location-error');
      expect(screen.getByTestId('use-my-location-error')).toBeInTheDocument();
      expect(screen.getByTestId('use-my-location-error')).toHaveTextContent('about 300 seconds');
    } finally { render(null); }
  });

  it('shows an error when the location request rejects', async () => {
    captureLocationStub = () =>
      Promise.reject(new Error('Location permission is blocked. Open your browser\'s site settings, allow location for this site, then try again.'));
    render(<UseMyLocation policy={defaultPolicy} onApply={() => {}} />);
    try {
      await act(async () => { await Promise.resolve(); });
      act(() => { screen.getByTestId('use-my-location-button').click(); });
      await screen.findByTestId('use-my-location-error');
      expect(screen.getByTestId('use-my-location-error')).toHaveTextContent('permission is blocked');
    } finally { render(null); }
  });

  it('shows an error when the browser cannot provide a location and never requests a fix', async () => {
    setUnavailableReason('This page is not on a secure (HTTPS) connection, so the browser blocks location access. Open the app over HTTPS, then try again.');
    geolocationUnavailableReason.mockReturnValue(unavailableReason);
    render(<UseMyLocation policy={defaultPolicy} onApply={() => {}} />);
    try {
      act(() => { screen.getByTestId('use-my-location-button').click(); });
      await screen.findByTestId('use-my-location-error');
      expect(screen.getByTestId('use-my-location-error')).toHaveTextContent('secure (HTTPS)');
      expect(captureLocation).not.toHaveBeenCalled();
    } finally { render(null); }
  });
});
