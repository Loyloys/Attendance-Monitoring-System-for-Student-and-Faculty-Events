import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setAdminSettingsAccessForTests,
  requireAdminSettingsChangeGrant,
  requireAdminSettingsPin,
  sendAdminSettingsEmailCode,
  verifyAdminSettingsEmailCode,
  verifyAdminSettingsPin,
} from '../src/services/adminSettingsAccessService.js';

afterEach(() => __setAdminSettingsAccessForTests({}));

function request() {
  return { sessionID: 'test-session', session: {} };
}

test('settings PIN is required, verified in constant time, and has an expiring session grant', async () => {
  __setAdminSettingsAccessForTests({ pin: '123456', email: 'admin@example.test' });
  const req = request();

  assert.throws(() => requireAdminSettingsPin(req), (error) => error.code === 'admin_settings_pin_required');
  await assert.rejects(verifyAdminSettingsPin(req, '654321'), /incorrect/i);
  await verifyAdminSettingsPin(req, '123456');
  assert.doesNotThrow(() => requireAdminSettingsPin(req));

  req.session.adminSettingsPinVerifiedAt -= 16 * 60_000;
  assert.throws(() => requireAdminSettingsPin(req), (error) => error.code === 'admin_settings_pin_required');
});

test('settings change email code grants one change and cannot be reused', async () => {
  let message;
  __setAdminSettingsAccessForTests({
    pin: '123456',
    email: 'admin@example.test',
    sendEmail: async (email) => { message = email; },
  });
  const req = request();
  await verifyAdminSettingsPin(req, '123456');
  await sendAdminSettingsEmailCode(req, 'settings_change');
  assert.equal(message.to, 'admin@example.test');
  const code = message.text.match(/code is (\d{6})/)[1];

  verifyAdminSettingsEmailCode(req, 'settings_change', code);
  assert.doesNotThrow(() => requireAdminSettingsChangeGrant(req));
  assert.throws(() => requireAdminSettingsChangeGrant(req), (error) => error.code === 'admin_settings_email_code_required');
});

test('email code is purpose-bound and expires after five incorrect attempts', async () => {
  let message;
  __setAdminSettingsAccessForTests({
    pin: '123456',
    email: 'admin@example.test',
    sendEmail: async (email) => { message = email; },
  });
  const req = request();
  await sendAdminSettingsEmailCode(req, 'pin_reset');
  const correctCode = message.text.match(/code is (\d{6})/)[1];

  assert.throws(() => verifyAdminSettingsEmailCode(req, 'settings_change', correctCode), /expired or was not requested/i);
  await sendAdminSettingsEmailCode(req, 'pin_reset');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.throws(() => verifyAdminSettingsEmailCode(req, 'pin_reset', '000000'), /incorrect or expired/i);
  }
  assert.throws(() => verifyAdminSettingsEmailCode(req, 'pin_reset', correctCode), /expired or was not requested/i);
});

test('verified PIN reset clears settings access', async () => {
  let message;
  __setAdminSettingsAccessForTests({
    pin: '123456',
    email: 'admin@example.test',
    sendEmail: async (email) => { message = email; },
  });
  const req = request();
  await verifyAdminSettingsPin(req, '123456');
  await sendAdminSettingsEmailCode(req, 'pin_reset');
  verifyAdminSettingsEmailCode(req, 'pin_reset', message.text.match(/code is (\d{6})/)[1]);

  assert.throws(() => requireAdminSettingsPin(req), (error) => error.code === 'admin_settings_pin_required');
});
