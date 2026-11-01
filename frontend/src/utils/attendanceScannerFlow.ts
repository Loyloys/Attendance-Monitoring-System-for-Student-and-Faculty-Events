import type { AttendanceConfirmation, AttendanceMethod, AttendanceQrPreview, AttendanceSession } from '../types/eventAttendance';
import { evaluateFixQuality, runWithValidatedLocation, type LocationFix, type LocationQualityPolicy } from './eventQr.ts';

export interface AttendanceResultPresentation {
  title: string;
  message: string;
  qualificationNotice: string | null;
  eventName: string;
  eventDate: string;
  eventTime: string;
  status: string;
  method: string;
  requiredAttendanceMinutes: number | null;
  location: string | null;
}

export function qrScannerAvailability(eligibleEventCount: number): {
  canOpen: true;
  hasEligibleEvent: boolean;
} {
  return { canOpen: true, hasEligibleEvent: eligibleEventCount > 0 };
}

export function shouldShowLocationGate(
  knownEventRequiresLocation: boolean,
  knownEventLocationReady: boolean,
  scannedEventRequiresLocation: boolean,
): boolean {
  return scannedEventRequiresLocation || (knownEventRequiresLocation && !knownEventLocationReady);
}

export function locationAccessPresentation({
  requiresLocation,
  locationReady,
  hasFreshReading,
  loading,
}: {
  requiresLocation: boolean;
  locationReady: boolean;
  hasFreshReading: boolean;
  loading: boolean;
}): { visible: true; title: string; actionLabel: string } {
  return {
    visible: true,
    title: requiresLocation && !locationReady ? 'Location access is needed first' : 'Location access',
    actionLabel: loading
      ? 'Checking location…'
      : requiresLocation && !locationReady
        ? 'Allow location and continue'
        : hasFreshReading
          ? 'Refresh location'
          : 'Get current location',
  };
}

export async function continueScannerAfterLocation(
  requestLocation: () => Promise<LocationFix>,
  policy: LocationQualityPolicy,
  onLocationValidated: (fix: LocationFix) => void,
): Promise<void> {
  await runWithValidatedLocation({
    requiresLocation: true,
    requestLocation,
    policy,
    action: fix => {
      if (fix) onLocationValidated(fix);
    },
  });
}

export function attendanceResultPresentation(
  confirmation: AttendanceConfirmation,
): AttendanceResultPresentation {
  const status = confirmation.status.toUpperCase();
  const isPending = confirmation.status === 'pending';
  const location = confirmation.locationVerified
    ? `Verified at venue${typeof confirmation.locationAccuracyMeters === 'number'
      ? ` (±${Math.round(confirmation.locationAccuracyMeters)} m)`
      : ''}${typeof confirmation.locationDistanceMeters === 'number'
        ? ` · ${Math.round(confirmation.locationDistanceMeters)} m from centre`
        : ''}`
    : null;

  return {
    title: 'Attendance recorded',
    message: 'Your event attendance was recorded successfully.',
    qualificationNotice: isPending
      ? `Qualification is pending ${confirmation.requiredAttendanceMinutes ?? 'the required'} verified in-zone minutes; the server must confirm Present or Late.`
      : null,
    eventName: confirmation.eventName,
    eventDate: confirmation.eventDate,
    eventTime: confirmation.eventTime,
    status,
    method: confirmation.method.toUpperCase(),
    requiredAttendanceMinutes: confirmation.requiredAttendanceMinutes ?? null,
    location,
  };
}

export async function validatePreviewedQrLocation(
  preview: AttendanceQrPreview,
  requestLocation: () => Promise<LocationFix>,
  policy: LocationQualityPolicy,
): Promise<LocationFix | null> {
  if (!preview.eligible) {
    throw new Error(preview.reason || 'This event is not currently eligible for check-in.');
  }
  return runWithValidatedLocation({
    requiresLocation: preview.locationRequired,
    requestLocation,
    policy,
    action: fix => fix,
  });
}

export async function submitPreviewedQr<T>(
  preview: AttendanceQrPreview,
  requestLocation: () => Promise<LocationFix>,
  policy: LocationQualityPolicy,
  submit: (location: LocationFix | null) => Promise<T>,
  onSubmit?: () => void,
): Promise<T> {
  const location = await validatePreviewedQrLocation(preview, requestLocation, policy);
  onSubmit?.();
  return submit(location);
}

export async function startTrackingFromRecordedAttendance(
  confirmation: Pick<AttendanceConfirmation, 'attendanceId' | 'method'>,
  requestLocation: () => Promise<LocationFix>,
  startSession: (values: {
    attendanceId: number;
    method: AttendanceMethod;
    location: LocationFix;
  }) => Promise<AttendanceSession>,
  policy?: LocationQualityPolicy,
): Promise<AttendanceSession> {
  const location = await requestLocation();
  const quality = evaluateFixQuality(location, policy);
  if (!quality.acceptable) {
    throw new Error(quality.reason ?? 'Your location could not be verified.');
  }
  return startSession({
    attendanceId: confirmation.attendanceId,
    method: confirmation.method,
    location,
  });
}

export function attendanceScanFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The event scan could not be recorded.';
}
