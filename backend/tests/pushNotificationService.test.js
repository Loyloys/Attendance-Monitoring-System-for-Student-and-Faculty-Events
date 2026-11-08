import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
process.env.FCM_TOKEN_ENCRYPTION_KEY = '';

const { SystemSetting } = await import('../src/models/index.js');
const { pushNotificationStatus, registerPushDevice } = await import('../src/services/pushNotificationService.js');
const {
  PUSH_NOTIFICATIONS_SETTING,
  pushNotificationsSettingStatus,
  setPushNotificationsSettingStatus,
} = await import('../src/services/systemSettingsService.js');

test('push notifications report unconfigured and disabled without Firebase credentials', async () => {
  const originalFindById = SystemSetting.findById;
  SystemSetting.findById = () => ({ lean: async () => null });
  try {
    assert.deepEqual(await pushNotificationStatus(), { configured: false, enabled: false, available: true });
  } finally {
    SystemSetting.findById = originalFindById;
  }
});

test('push notification setting is disabled by default and persists administrator changes', async () => {
  const originalFindById = SystemSetting.findById;
  const originalFindByIdAndUpdate = SystemSetting.findByIdAndUpdate;
  let savedSetting = null;
  SystemSetting.findById = id => ({
    lean: async () => (id === PUSH_NOTIFICATIONS_SETTING ? savedSetting : null),
  });
  SystemSetting.findByIdAndUpdate = async (id, update) => {
    assert.equal(id, PUSH_NOTIFICATIONS_SETTING);
    savedSetting = { value: update.$set.value };
  };
  try {
    assert.deepEqual(await pushNotificationsSettingStatus(), { enabled: false, available: true });
    assert.deepEqual(await setPushNotificationsSettingStatus(true, { _id: 'admin-id' }), { enabled: true, available: true });
    assert.deepEqual(await setPushNotificationsSettingStatus(false, { _id: 'admin-id' }), { enabled: false, available: true });
  } finally {
    SystemSetting.findById = originalFindById;
    SystemSetting.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
});

test('push token registration refuses when FCM is not configured', async () => {
  const originalFindById = SystemSetting.findById;
  SystemSetting.findById = () => ({ lean: async () => null });
  try {
    await assert.rejects(
      registerPushDevice('user-id', 'a-valid-looking-browser-token-1234567890'),
      error => error.status === 503 && /not configured/.test(error.message),
    );
  } finally {
    SystemSetting.findById = originalFindById;
  }
});
