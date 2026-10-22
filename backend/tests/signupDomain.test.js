import test from 'node:test';
import assert from 'node:assert/strict';
import { accountIdForVerifiedInstitutionalEmail, pendingRoleForEmail } from '../src/utils/domain.js';

test('signup role inference uses exact case-insensitive institutional domains only', () => {
  assert.equal(pendingRoleForEmail('Person@STUDENT.BUKSU.EDU.PH'), 'student');
  assert.equal(pendingRoleForEmail('Person@faculty.buksu.edu.ph'), 'faculty');
  assert.equal(pendingRoleForEmail('person@student.buksu.edu.ph.attacker.example'), '');
  assert.equal(pendingRoleForEmail('person@notstudent.buksu.edu.ph'), '');
  assert.equal(pendingRoleForEmail('admin@buksu.edu.ph'), '');
});

test('account ID prefill requires verified exact institutional email format', () => {
  assert.equal(accountIdForVerifiedInstitutionalEmail('2401105160@student.buksu.edu.ph', true), '2401105160');
  assert.equal(accountIdForVerifiedInstitutionalEmail('2401105161@faculty.buksu.edu.ph', true), '2401105161');
  assert.equal(accountIdForVerifiedInstitutionalEmail('2401105162@student.buksu.edu.ph', false), '');
  assert.equal(accountIdForVerifiedInstitutionalEmail('2401105163@other.example', true), '');
  assert.equal(accountIdForVerifiedInstitutionalEmail('id-2401105164@student.buksu.edu.ph', true), '');
  assert.equal(accountIdForVerifiedInstitutionalEmail('240110516@student.buksu.edu.ph', true), '');
  assert.equal(accountIdForVerifiedInstitutionalEmail('2401105165@student.buksu.edu.ph.attacker.example', true), '');
});
