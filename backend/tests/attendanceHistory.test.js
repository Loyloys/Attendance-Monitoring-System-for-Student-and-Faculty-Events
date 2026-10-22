import assert from 'node:assert/strict';
import test from 'node:test';
import { personalRecordStatus } from '../src/services/attendanceService.js';

test('personal history shows server qualification instead of an unqualified check-in status', () => {
  assert.equal(personalRecordStatus({ status: 'present', qualification: 'pending' }), 'pending');
  assert.equal(personalRecordStatus({ status: 'present', qualification: 'late' }), 'late');
  assert.equal(personalRecordStatus({ status: 'present', qualification: null }), 'present');
});
