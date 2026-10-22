import type { PersonalAttendanceRecord } from '../types/eventAttendance';

export function attendancePercentageForRecord(
  record: Pick<PersonalAttendanceRecord, 'requiredAttendanceMinutes' | 'verifiedSeconds' | 'status'>,
): number {
  const required = record.requiredAttendanceMinutes;
  if (typeof required === 'number' && required > 0) {
    return Math.min(100, Math.round(((record.verifiedSeconds ?? 0) / (required * 60)) * 100));
  }
  return record.status === 'absent' ? 0 : 100;
}
