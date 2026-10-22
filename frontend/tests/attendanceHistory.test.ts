import assert from 'node:assert/strict';
import test from 'node:test';
import { attendancePercentageForRecord } from '../src/utils/attendanceHistory.ts';

test('duration-based history percentage uses only server-confirmed eligible time', () => {
  assert.equal(attendancePercentageForRecord({
    status: 'pending',
    verifiedSeconds: 300,
    requiredAttendanceMinutes: 10,
  }), 50);
  assert.equal(attendancePercentageForRecord({
    status: 'present',
    verifiedSeconds: 900,
    requiredAttendanceMinutes: 10,
  }), 100);
  assert.equal(attendancePercentageForRecord({
    status: 'absent',
    verifiedSeconds: 0,
    requiredAttendanceMinutes: 10,
  }), 0);
});

test('history without a duration requirement preserves recorded attendance status', () => {
  assert.equal(attendancePercentageForRecord({ status: 'present', verifiedSeconds: 0 }), 100);
  assert.equal(attendancePercentageForRecord({ status: 'late', verifiedSeconds: 0 }), 100);
  assert.equal(attendancePercentageForRecord({ status: 'absent', verifiedSeconds: 0 }), 0);
});
