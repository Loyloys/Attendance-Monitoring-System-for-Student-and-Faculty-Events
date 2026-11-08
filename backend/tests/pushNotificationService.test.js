import assert from 'node:assert/strict';
import test from 'node:test';

process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '';
process.env.FCM_TOKEN_ENCRYPTION_KEY = '';

const { SystemSetting } = await import('../src/models/index.js');
const { pushNotificationStatus, registerPushDevice } = await import('../src/services/pushNotificationService.js');
const {
  FIREBASE_WEB_CONFIG_SETTING,
  PUSH_NOTIFICATIONS_SETTING,
  firebaseWebConfigStatus,
  pushNotificationsSettingStatus,
  resetFirebaseWebConfig,
  setFirebaseWebConfig,
  setPushNotificationsSettingStatus,
} = await import('../src/services/systemSettingsService.js');

test('push notifications report unconfigured and disabled without Firebase credentials', async () => {
  const originalFindById = SystemSetting.findById;
  SystemSetting.findById = () => ({ lean: async () => null });
  try {
    assert.deepEqual(await pushNotificationStatus(), {
      configured: false,
      enabled: false,
      available: true,
      firebaseWebConfig: null,
      firebaseWebConfigConfigured: false,
      firebaseWebConfigAvailable: true,
    });
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

test('Firebase public web configuration validates, persists, and resets without accepting server credentials', async () => {
  const originalFindById = SystemSetting.findById;
  const originalFindByIdAndUpdate = SystemSetting.findByIdAndUpdate;
  const originalDeleteOne = SystemSetting.deleteOne;
  let savedConfig = null;
  SystemSetting.findById = id => ({
    lean: async () => (id === FIREBASE_WEB_CONFIG_SETTING ? { value: savedConfig } : null),
  });
  SystemSetting.findByIdAndUpdate = async (id, update) => {
    assert.equal(id, FIREBASE_WEB_CONFIG_SETTING);
    savedConfig = update.$set.value;
  };
  SystemSetting.deleteOne = async ({ _id }) => {
    assert.equal(_id, FIREBASE_WEB_CONFIG_SETTING);
    savedConfig = null;
  };
  const config = {
    apiKey: 'AIzaSyTestFirebaseWebApiKey000000000',
    authDomain: 'attendance-test.firebaseapp.com',
    projectId: 'attendance-test',
    storageBucket: 'attendance-test.firebasestorage.app',
    messagingSenderId: '696332399690',
    appId: '1:696332399690:web:ccd6602a07a1978b4422b3',
    vapidKey: 'BFDmIchOfLp8j3oZ6drOef3so9oilBl8N8gMlHTdtizj9GTT9e8BMHuBy_mMpg8b2NtwisdIsFJZ6nNZW-aaNVQ',
  };
  try {
    assert.deepEqual(await firebaseWebConfigStatus(), {
      firebaseWebConfig: null,
      firebaseWebConfigConfigured: false,
      firebaseWebConfigAvailable: true,
    });
    assert.deepEqual(await setFirebaseWebConfig(config, { _id: 'admin-id' }), {
      firebaseWebConfig: config,
      firebaseWebConfigConfigured: true,
      firebaseWebConfigAvailable: true,
    });
    await assert.rejects(
      setFirebaseWebConfig({ ...config, private_key: 'never-store-private-keys-here' }, { _id: 'admin-id' }),
      error => error.status === 400 && /Only Firebase web configuration fields/.test(error.message),
    );
    await assert.rejects(
      setFirebaseWebConfig({ ...config, appId: '1:123:web:abcd' }, { _id: 'admin-id' }),
      error => error.status === 400 && /matches the messaging sender ID/.test(error.message),
    );
    assert.deepEqual(await resetFirebaseWebConfig(), {
      firebaseWebConfig: null,
      firebaseWebConfigConfigured: false,
      firebaseWebConfigAvailable: true,
    });
  } finally {
    SystemSetting.findById = originalFindById;
    SystemSetting.findByIdAndUpdate = originalFindByIdAndUpdate;
    SystemSetting.deleteOne = originalDeleteOne;
  }
});
