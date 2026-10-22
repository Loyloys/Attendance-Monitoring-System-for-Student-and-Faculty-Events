import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cameraFailureKind,
  cameraFailureMessage,
  evaluateFixQuality,
  geolocationErrorMessage,
  runWithValidatedLocation,
  scanRequiresLocation,
  scannerPauseLabel,
} from '../src/utils/eventQr.ts';
import type { AttendanceMethod, AttendanceSession } from '../src/types/eventAttendance.ts';
import {
  attendanceResultPresentation,
  attendanceScanFailureMessage,
  continueScannerAfterLocation,
  locationAccessPresentation,
  qrScannerAvailability,
  shouldShowLocationGate,
  submitPreviewedQr,
  startTrackingFromRecordedAttendance,
} from '../src/utils/attendanceScannerFlow.ts';

test('scanner pause labels distinguish location, processing, and deliberate pause', () => {
  assert.match(scannerPauseLabel('location'), /location required/i);
  assert.match(scannerPauseLabel('processing'), /verifying with server/i);
  assert.match(scannerPauseLabel('manual'), /scanner paused/i);
});

test('QR camera flow does not depend on an eligible-event list and preflights before location or check-in', async () => {
  const availability = qrScannerAvailability(0);
  assert.equal(availability.canOpen, true, 'QR scanning remains available with no eligible events');
  assert.equal(availability.hasEligibleEvent, false);
  assert.equal(shouldShowLocationGate(false, true, false), false, 'unknown QR targets do not trigger location before decode');

  const order: string[] = [];
  const preview = {
    eventId: 'event-1',
    eventName: 'Verified event',
    method: 'qr' as const,
    eligible: true,
    reason: null,
    locationRequired: true,
    requiredAttendanceMinutes: null,
  };
  order.push('preview');
  const result = await submitPreviewedQr(
    preview,
    async () => {
      order.push('location');
      return { latitude: 14.6, longitude: 121, accuracy: 10, capturedAt: new Date().toISOString() };
    },
    { maxAccuracyMeters: 100, maxAgeSeconds: 120 },
    async fix => {
      assert.ok(fix);
      order.push('check-in');
      return 'server-confirmed';
    },
  );
  assert.equal(result, 'server-confirmed');
  assert.deepEqual(order, ['preview', 'location', 'check-in']);
});

test('known location-required event shows a user-triggered location gate before camera startup', async () => {
  const order: string[] = [];
  let locationRequests = 0;
  let cameraStarted = false;
  assert.equal(shouldShowLocationGate(true, false, false), true);

  const allowLocationAndContinue = () => continueScannerAfterLocation(
    async () => {
      locationRequests += 1;
      order.push('location-request');
      return { latitude: 14.6, longitude: 121, accuracy: 10, capturedAt: new Date().toISOString() };
    },
    { maxAccuracyMeters: 100, maxAgeSeconds: 120 },
    () => {
      order.push('camera-start');
      cameraStarted = true;
    },
  );

  assert.equal(locationRequests, 0, 'opening the scanner must not request permission');
  assert.equal(cameraStarted, false);
  await allowLocationAndContinue();
  assert.deepEqual(order, ['location-request', 'camera-start']);
  assert.equal(shouldShowLocationGate(true, true, false), false);
});

test('known-event location failures keep the camera closed and the location gate retryable', async () => {
  let cameraStarts = 0;
  let attempts = 0;
  const continueAfterLocation = () => continueScannerAfterLocation(
    async () => {
      attempts += 1;
      if (attempts === 1) throw new Error(geolocationErrorMessage(1));
      return { latitude: 14.6, longitude: 121, accuracy: 10, capturedAt: new Date().toISOString() };
    },
    { maxAccuracyMeters: 100, maxAgeSeconds: 120 },
    () => { cameraStarts += 1; },
  );
  assert.equal(shouldShowLocationGate(true, false, false), true);
  await assert.rejects(continueAfterLocation(), /permission is blocked/i);
  assert.equal(cameraStarts, 0);
  await continueAfterLocation();
  assert.equal(cameraStarts, 1);
});

test('known-event location unavailable, timeout, stale, and inaccurate fixes block camera startup', async () => {
  const policy = { maxAccuracyMeters: 100, maxAgeSeconds: 120 };
  const invalidFixes = [
    async () => { throw new Error(geolocationErrorMessage(2)); },
    async () => { throw new Error(geolocationErrorMessage(3)); },
    async () => ({ latitude: 14.6, longitude: 121, accuracy: 10, capturedAt: new Date(Date.now() - 180_000).toISOString() }),
    async () => ({ latitude: 14.6, longitude: 121, accuracy: 250, capturedAt: new Date().toISOString() }),
  ];
  for (const requestLocation of invalidFixes) {
    let cameraStarts = 0;
    await assert.rejects(continueScannerAfterLocation(
      requestLocation,
      policy,
      () => { cameraStarts += 1; },
    ));
    assert.equal(cameraStarts, 0);
  }
});

test('location gate remains visible for a scanned event requiring location', () => {
  assert.equal(shouldShowLocationGate(false, true, true), true);
});

test('location access panel stays available and offers a fresh reading after permission was granted', () => {
  const beforeRequest = locationAccessPresentation({
    requiresLocation: false,
    locationReady: true,
    hasFreshReading: false,
    loading: false,
  });
  assert.equal(beforeRequest.visible, true);
  assert.equal(beforeRequest.actionLabel, 'Get current location');

  const afterRequest = locationAccessPresentation({
    requiresLocation: false,
    locationReady: true,
    hasFreshReading: true,
    loading: false,
  });
  assert.equal(afterRequest.visible, true);
  assert.equal(afterRequest.actionLabel, 'Refresh location');

  const requiredEvent = locationAccessPresentation({
    requiresLocation: true,
    locationReady: false,
    hasFreshReading: false,
    loading: false,
  });
  assert.equal(requiredEvent.title, 'Location access is needed first');
  assert.equal(requiredEvent.actionLabel, 'Allow location and continue');
});

test('ineligible QR preview never requests location or permits check-in', async () => {
  let locationRequests = 0;
  const preview = {
    eventId: 'event-closed',
    eventName: 'Closed event',
    method: 'qr' as const,
    eligible: false,
    reason: 'The check-in window for this event is closed.',
    locationRequired: true,
    requiredAttendanceMinutes: null,
  };
  let submitted = false;
  await assert.rejects(submitPreviewedQr(
    preview,
    async () => {
      locationRequests += 1;
      throw new Error('must not request');
    },
    { maxAccuracyMeters: 100, maxAgeSeconds: 120 },
    async () => { submitted = true; },
  ), /check-in window.*closed/i);
  assert.equal(locationRequests, 0);
  assert.equal(submitted, false);
});

test('QR location permission, unavailable, stale, and inaccurate fixes block submission', async () => {
  const preview = {
    eventId: 'event-1',
    eventName: 'Verified event',
    method: 'qr' as const,
    eligible: true,
    reason: null,
    locationRequired: true,
    requiredAttendanceMinutes: null,
  };
  const policy = { maxAccuracyMeters: 100, maxAgeSeconds: 120 };
  for (const rejectedLocation of [
    async () => { throw new Error('Location permission is blocked.'); },
    async () => { throw new Error('Your location is unavailable.'); },
    async () => ({ latitude: 14.6, longitude: 121, accuracy: 10, capturedAt: new Date(Date.now() - 180_000).toISOString() }),
    async () => ({ latitude: 14.6, longitude: 121, accuracy: 250, capturedAt: new Date().toISOString() }),
  ]) {
    let submitted = false;
    await assert.rejects(submitPreviewedQr(preview, rejectedLocation, policy, async () => { submitted = true; }));
    assert.equal(submitted, false);
  }
});

test('attendance result uses server-confirmed fields and does not promote pending qualification', () => {
  const lateResult = attendanceResultPresentation({
    attendanceId: 12,
    eventId: 'evt-12',
    eventName: 'Testing dris paniran',
    eventDate: '2026-10-05T00:00:00.000Z',
    eventTime: '17:25 - 18:00',
    status: 'late',
    method: 'qr',
    recordedAt: '2026-10-05T09:30:00.000Z',
    locationVerified: true,
    locationAccuracyMeters: 10,
    locationDistanceMeters: 0,
    message: 'Your event attendance was recorded successfully.',
  });
  assert.equal(lateResult.title, 'Attendance recorded');
  assert.equal(lateResult.eventName, 'Testing dris paniran');
  assert.equal(lateResult.status, 'LATE');
  assert.equal(lateResult.method, 'QR');
  assert.match(lateResult.location ?? '', /±10 m/);
  assert.match(lateResult.location ?? '', /0 m from centre/);
  assert.equal(lateResult.message, 'Your event attendance was recorded successfully.');

  const pending = attendanceResultPresentation({
    attendanceId: 13,
    eventId: 'evt-13',
    eventName: 'Duration event',
    eventDate: '2026-10-05T00:00:00.000Z',
    eventTime: '17:25 - 18:00',
    status: 'pending',
    method: 'qr',
    recordedAt: '2026-10-05T09:30:00.000Z',
    requiredAttendanceMinutes: 10,
    locationVerified: false,
    message: 'Your event attendance was recorded successfully.',
  });
  assert.equal(pending.title, 'Check-in recorded');
  assert.equal(pending.status, 'PENDING');
  assert.match(pending.message, /server must confirm Present or Late/i);
  assert.equal(pending.location, null);
});

test('failed check-in exposes its safe reason without creating a success presentation', () => {
  assert.equal(
    attendanceScanFailureMessage(new Error('The event check-in window is closed.')),
    'The event check-in window is closed.',
  );
  assert.match(attendanceScanFailureMessage('unexpected failure'), /could not be recorded/i);
});

test('tracking start requires a fresh fix and sends only the recorded attendance id', async () => {
  const confirmation = { attendanceId: 71, method: 'qr' as const };
  let starts = 0;
  const startSession = async (values: { attendanceId: number; method: AttendanceMethod; location: { latitude: number; longitude: number; accuracy: number; capturedAt: string } }): Promise<AttendanceSession> => {
    starts += 1;
    assert.equal(values.attendanceId, 71);
    assert.equal(values.method, 'qr');
    assert.deepEqual(Object.keys(values).sort(), ['attendanceId', 'location', 'method']);
    return {
      id: 'session-1',
      eventId: 'event-1',
      eventName: 'Test event',
      state: 'tracking',
      locationState: 'inside',
      creditedSeconds: 0,
      creditedMinutes: 0,
      creditedSecondsRemainder: 0,
      requiredMinutes: 10,
      remainingSeconds: 600,
      durationOutcome: 'in_progress',
      arrival: 'on_time',
      pauseReason: null,
      derivedState: false,
      startedAt: new Date().toISOString(),
      checkedOutAt: null,
      endedAt: null,
      lastVerifiedAt: new Date().toISOString(),
      lastDistanceMeters: 0,
      lastAccuracyMeters: 10,
      eventStartsAt: new Date().toISOString(),
      eventEndsAt: new Date(Date.now() + 60_000).toISOString(),
    };
  };

  await assert.rejects(startTrackingFromRecordedAttendance(
    confirmation,
    async () => ({
      latitude: 14.6,
      longitude: 121,
      accuracy: 10,
      capturedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    }),
    startSession,
  ), /seconds old|under .* seconds/i);
  assert.equal(starts, 0, 'invalid fixes must not submit tracking');

  await startTrackingFromRecordedAttendance(
    confirmation,
    async () => ({
      latitude: 14.6,
      longitude: 121,
      accuracy: 10,
      capturedAt: new Date().toISOString(),
    }),
    startSession,
  );
  assert.equal(starts, 1, 'a tracking retry starts tracking only and never re-submits check-in');
});

test('a server-rejected stale tracking fix leaves the recorded check-in result intact', async () => {
  const result = {
    attendanceId: 72,
    eventId: 'event-2',
    eventName: 'Required duration event',
    eventDate: '2026-10-05T00:00:00.000Z',
    eventTime: '17:25 - 18:00',
    status: 'pending' as const,
    method: 'qr' as const,
    recordedAt: '2026-10-05T09:30:00.000Z',
    requiredAttendanceMinutes: 10,
    locationVerified: true,
    message: 'Your event attendance was recorded successfully.',
  };
  const presentation = attendanceResultPresentation(result);
  await assert.rejects(startTrackingFromRecordedAttendance(
    result,
    async () => ({
      latitude: 14.6,
      longitude: 121,
      accuracy: 10,
      capturedAt: new Date().toISOString(),
    }),
    async () => {
      throw new Error('That location reading is 70 seconds old. Attendance tracking needs a reading taken within the last 30 seconds.');
    },
  ), /70 seconds old/i);
  assert.equal(presentation.status, 'PENDING');
  assert.equal(presentation.title, 'Check-in recorded');
  assert.equal(presentation.location, 'Verified at venue');
});

test('camera permission denial is distinguished from unavailable hardware', () => {
  const denied = cameraFailureKind({ name: 'NotAllowedError' });
  const unavailable = cameraFailureKind({ name: 'NotFoundError' });

  assert.equal(denied, 'permission-denied');
  assert.match(cameraFailureMessage(denied), /permission was denied/i);
  assert.equal(unavailable, 'unavailable');
  assert.match(cameraFailureMessage(unavailable), /camera is unavailable/i);
});

test('location errors give distinct guidance for permission, unavailable fixes, and timeout', () => {
  assert.match(geolocationErrorMessage(1), /permission is blocked/i);
  assert.match(geolocationErrorMessage(2), /location is unavailable/i);
  assert.match(geolocationErrorMessage(3), /took too long/i);
});

test('location validation completes before check-in submission after QR preview', async () => {
  const steps: string[] = [];
  await runWithValidatedLocation({
    requiresLocation: true,
    requestLocation: async () => {
      steps.push('location-request');
      return {
        latitude: 14.6,
        longitude: 121,
        accuracy: 12,
        capturedAt: new Date().toISOString(),
      };
    },
    action: () => { steps.push('check-in-submit'); },
  });

  assert.deepEqual(steps, ['location-request', 'check-in-submit']);
});

test('QR check-in submission stays blocked for location errors and invalid fixes', async () => {
  const stale = {
    latitude: 14.6,
    longitude: 121,
    accuracy: 12,
    capturedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  };
  const inaccurate = {
    latitude: 14.6,
    longitude: 121,
    accuracy: 5_000,
    capturedAt: new Date().toISOString(),
  };
  const failures: Array<() => Promise<{
    latitude: number; longitude: number; accuracy: number; capturedAt: string;
  }>> = [
    async () => { throw new Error(geolocationErrorMessage(1)); },
    async () => { throw new Error(geolocationErrorMessage(2)); },
    async () => { throw new Error(geolocationErrorMessage(3)); },
    async () => stale,
    async () => inaccurate,
    async () => ({ ...stale, capturedAt: 'not-a-timestamp' }),
  ];

  for (const requestLocation of failures) {
    const actions: string[] = [];
    await assert.rejects(runWithValidatedLocation({
      requiresLocation: true,
      requestLocation,
      action: () => { actions.push('qr-submit'); },
    }));
    assert.deepEqual(actions, [], 'invalid location must not submit QR attendance');
  }
});

test('retry after a location error validates a new fix before check-in submission', async () => {
  const steps: string[] = [];
  let attempts = 0;
  await assert.rejects(runWithValidatedLocation({
    requiresLocation: true,
    requestLocation: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error(geolocationErrorMessage(1));
      steps.push('fresh-location');
      return {
        latitude: 14.6,
        longitude: 121,
        accuracy: 10,
        capturedAt: new Date().toISOString(),
      };
    },
    action: () => { steps.push('check-in-submit'); },
  }));
  assert.deepEqual(steps, []);

  await runWithValidatedLocation({
    requiresLocation: true,
    requestLocation: async () => {
      steps.push('retry-location');
      return {
        latitude: 14.6,
        longitude: 121,
        accuracy: 10,
        capturedAt: new Date().toISOString(),
      };
    },
    action: () => { steps.push('check-in-submit'); },
  });
  assert.deepEqual(steps, ['retry-location', 'check-in-submit']);
});

test('an event that does not require location preserves QR check-in without requesting location', async () => {
  let requestedLocation = false;
  let startedCamera = false;
  const result = await submitPreviewedQr(
    {
      eventId: 'event-2',
      eventName: 'No location event',
      method: 'qr',
      eligible: true,
      reason: null,
      locationRequired: false,
      requiredAttendanceMinutes: null,
    },
    async () => {
      requestedLocation = true;
      throw new Error('Location must not be requested.');
    },
    { maxAccuracyMeters: 100, maxAgeSeconds: 120 },
    async fix => { startedCamera = fix === null; return 'recorded'; },
  );
  assert.equal(requestedLocation, false);
  assert.equal(startedCamera, true);
  assert.equal(result, 'recorded');
});

test('manual card location still follows the selected event policy', () => {
  assert.equal(scanRequiresLocation({
    isQrInput: false,
    qrEventKnown: false,
    selectedEventKnown: true,
    selectedEventRequiresLocation: true,
  }), true);
  assert.equal(scanRequiresLocation({
    isQrInput: false,
    qrEventKnown: false,
    selectedEventKnown: false,
    selectedEventRequiresLocation: true,
  }), false);
});

test('location quality rejects malformed timestamps, old fixes, and poor accuracy', () => {
  assert.equal(evaluateFixQuality({
    latitude: 14.6,
    longitude: 121,
    accuracy: 10,
    capturedAt: 'invalid',
  }).acceptable, false);
  assert.equal(evaluateFixQuality({
    latitude: 14.6,
    longitude: 121,
    accuracy: 10,
    capturedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
  }).acceptable, false);
  assert.equal(evaluateFixQuality({
    latitude: 14.6,
    longitude: 121,
    accuracy: 5_000,
    capturedAt: new Date().toISOString(),
  }).acceptable, false);
});
