import { SystemSetting } from '../models/index.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { encryptSecret, isSecretStorageConfigured } from '../utils/secretBox.js';

export const GOOGLE_OAUTH_SETTING = 'google_oauth_enabled';
export const GOOGLE_CLIENT_ID_SETTING = 'google_client_id';
export const RECAPTCHA_SETTING = 'recaptcha_enabled';
export const RECAPTCHA_SITE_KEY_SETTING = 'recaptcha_site_key';
export const MAP_PICKER_SETTING = 'map_picker_enabled';
export const MAP_TILE_PROVIDER_KEY_SETTING = 'map_tile_provider_api_key';
export const GOOGLE_CALENDAR_SETTING = 'google_calendar_enabled';
export const PUSH_NOTIFICATIONS_SETTING = 'push_notifications_enabled';
export const FIREBASE_WEB_CONFIG_SETTING = 'firebase_web_config';

const FIREBASE_WEB_CONFIG_FIELDS = Object.freeze([
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
  'vapidKey',
]);

export async function googleOAuthStatus() {
  try {
    const setting = await SystemSetting.findById(GOOGLE_OAUTH_SETTING).lean();
    return { enabled: setting?.value === true, available: true };
  } catch (error) {
    console.error('Could not read the persisted Google OAuth setting:', error?.name || 'unknown error');
    return { enabled: false, available: false };
  }
}

export async function googleClientIdStatus() {
  try {
    const setting = await SystemSetting.findById(GOOGLE_CLIENT_ID_SETTING).lean();
    const clientId = typeof setting?.value === 'string' && setting.value.trim()
      ? setting.value.trim()
      : env.googleClientId;
    return { clientId, available: true };
  } catch (error) {
    console.error('Could not read the persisted Google client ID:', error?.name || 'unknown error');
    return { clientId: '', available: false };
  }
}

function validateGoogleClientId(clientId) {
  if (typeof clientId !== 'string') {
    throw new AppError(400, 'A Google client ID string is required.');
  }
  const value = clientId.trim();
  if (value && !/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value)) {
    throw new AppError(400, 'Enter a valid Google OAuth web client ID.');
  }
  return value;
}

export async function setGoogleClientId(clientId, actor) {
  const value = validateGoogleClientId(clientId);
  try {
    if (value) {
      await SystemSetting.findByIdAndUpdate(
        GOOGLE_CLIENT_ID_SETTING,
        { $set: { value, updatedAt: new Date(), updatedBy: actor?._id || null } },
        { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
      );
    } else {
      await SystemSetting.deleteOne({ _id: GOOGLE_CLIENT_ID_SETTING });
    }
    return googleClientIdStatus();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Could not persist the Google client ID:', error?.name || 'unknown error');
    throw new AppError(503, 'The Google client ID could not be saved.');
  }
}

export async function setGoogleOAuthStatus(enabled, actor) {
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be true or false.');
  try {
    await SystemSetting.findByIdAndUpdate(
      GOOGLE_OAUTH_SETTING,
      { $set: { value: enabled, updatedAt: new Date(), updatedBy: actor?._id || null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return googleOAuthStatus();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Could not persist the Google OAuth setting:', error?.name || 'unknown error');
    throw new AppError(503, 'The Google OAuth setting could not be saved. No setting change was made.');
  }
}

export async function recaptchaStatus() {
  try {
    const [setting, siteKeySetting] = await Promise.all([
      SystemSetting.findById(RECAPTCHA_SETTING).lean(),
      SystemSetting.findById(RECAPTCHA_SITE_KEY_SETTING).lean(),
    ]);
    return {
      enabled: setting?.value === true,
      siteKey: typeof siteKeySetting?.value === 'string' ? siteKeySetting.value : '',
      available: true,
      configured: recaptchaIsConfigured().available,
    };
  } catch (error) {
    console.error('Could not read the persisted reCAPTCHA setting:', error?.name || 'unknown error');
    return { enabled: false, siteKey: '', available: false, configured: false };
  }
}

export async function setRecaptchaStatus(enabled, actor, siteKey) {
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be true or false.');
  if (enabled && typeof siteKey === 'string' && !siteKey.trim()) {
    throw new AppError(400, 'A reCAPTCHA site key is required before enabling reCAPTCHA.');
  }
  if (enabled) {
    const configured = recaptchaIsConfigured();
    if (!configured.available) throw new AppError(400, configured.detail);
  }
  try {
    if (siteKey !== undefined) {
      if (typeof siteKey !== 'string' || siteKey.length > 512) {
        throw new AppError(400, 'A valid reCAPTCHA site key string is required.');
      }
      if (siteKey.trim()) {
        await SystemSetting.findByIdAndUpdate(
          RECAPTCHA_SITE_KEY_SETTING,
          { $set: { value: siteKey.trim(), updatedAt: new Date(), updatedBy: actor?._id || null } },
          { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
        );
      } else {
        await SystemSetting.deleteOne({ _id: RECAPTCHA_SITE_KEY_SETTING });
      }
    }
    await SystemSetting.findByIdAndUpdate(
      RECAPTCHA_SETTING,
      { $set: { value: enabled, updatedAt: new Date(), updatedBy: actor?._id || null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return recaptchaStatus();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Could not persist the reCAPTCHA settings:', error?.name || 'unknown error');
    throw new AppError(503, 'The reCAPTCHA settings could not be saved. Reload settings to confirm the current configuration.');
  }
}

export function recaptchaIsConfigured() {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  if (!secretKey) {
    return { available: false, detail: 'reCAPTCHA is not configured on the server. Set RECAPTCHA_SECRET_KEY before enabling.' };
  }
  return { available: true };
}

export async function mapPickerStatus() {
  try {
    const [setting, keySetting] = await Promise.all([
      SystemSetting.findById(MAP_PICKER_SETTING).lean(),
      SystemSetting.findById(MAP_TILE_PROVIDER_KEY_SETTING).lean(),
    ]);
    return {
      enabled: setting?.value === true,
      tileProviderKeyConfigured: typeof keySetting?.value === 'string' && Boolean(keySetting.value),
      available: true,
    };
  } catch (error) {
    console.error('Could not read the persisted map picker setting:', error?.name || 'unknown error');
    return { enabled: false, tileProviderKeyConfigured: false, available: false };
  }
}

export async function setMapPickerStatus(enabled, actor, tileProviderApiKey) {
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be true or false.');
  if (tileProviderApiKey !== undefined && (typeof tileProviderApiKey !== 'string' || tileProviderApiKey.length > 4096)) {
    throw new AppError(400, 'A valid tile provider API key string is required.');
  }
  try {
    if (tileProviderApiKey !== undefined) {
      const value = tileProviderApiKey.trim();
      if (value) {
        if (!isSecretStorageConfigured()) {
          throw new AppError(503, 'Secure key storage is unavailable. The tile provider API key was not saved.');
        }
        await SystemSetting.findByIdAndUpdate(
          MAP_TILE_PROVIDER_KEY_SETTING,
          { $set: { value: encryptSecret(value), updatedAt: new Date(), updatedBy: actor?._id || null } },
          { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
        );
      } else {
        await SystemSetting.deleteOne({ _id: MAP_TILE_PROVIDER_KEY_SETTING });
      }
    }
    await SystemSetting.findByIdAndUpdate(
      MAP_PICKER_SETTING,
      { $set: { value: enabled, updatedAt: new Date(), updatedBy: actor?._id || null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return mapPickerStatus();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Could not persist the map picker setting:', error?.name || 'unknown error');
    throw new AppError(503, 'The map picker setting could not be saved. No setting change was made.');
  }
}

export async function googleCalendarSettingStatus() {
  try {
    const setting = await SystemSetting.findById(GOOGLE_CALENDAR_SETTING).lean();
    return { enabled: setting?.value !== false, available: true };
  } catch (error) {
    console.error('Could not read the persisted Google Calendar setting:', error?.name || 'unknown error');
    return { enabled: false, available: false };
  }
}

export async function setGoogleCalendarSettingStatus(enabled, actor) {
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be true or false.');
  try {
    await SystemSetting.findByIdAndUpdate(
      GOOGLE_CALENDAR_SETTING,
      { $set: { value: enabled, updatedAt: new Date(), updatedBy: actor?._id || null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return googleCalendarSettingStatus();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Could not persist the Google Calendar setting:', error?.name || 'unknown error');
    throw new AppError(503, 'The Google Calendar setting could not be saved. No setting change was made.');
  }
}

export async function pushNotificationsSettingStatus() {
  try {
    const setting = await SystemSetting.findById(PUSH_NOTIFICATIONS_SETTING).lean();
    return { enabled: setting?.value === true, available: true };
  } catch (error) {
    console.error('Could not read the push notifications setting:', error?.name || 'unknown error');
    return { enabled: false, available: false };
  }
}

export async function setPushNotificationsSettingStatus(enabled, actor) {
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be true or false.');
  try {
    await SystemSetting.findByIdAndUpdate(
      PUSH_NOTIFICATIONS_SETTING,
      { $set: { value: enabled, updatedAt: new Date(), updatedBy: actor?._id || null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return pushNotificationsSettingStatus();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Could not persist the push notifications setting:', error?.name || 'unknown error');
    throw new AppError(503, 'The push notifications setting could not be saved. No setting change was made.');
  }
}

function validateFirebaseWebConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new AppError(400, 'A Firebase web configuration object is required.');
  }
  const unexpectedFields = Object.keys(config).filter(field => !FIREBASE_WEB_CONFIG_FIELDS.includes(field));
  if (unexpectedFields.length) {
    throw new AppError(400, 'Only Firebase web configuration fields are accepted. Server credentials must remain in backend environment variables.');
  }

  const normalized = {};
  for (const field of FIREBASE_WEB_CONFIG_FIELDS) {
    const value = config[field];
    const optional = field === 'authDomain' || field === 'storageBucket';
    if (optional && value === undefined) {
      normalized[field] = '';
      continue;
    }
    if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > 512) {
      throw new AppError(400, `A valid Firebase ${field} value is required.`);
    }
    normalized[field] = value.trim();
  }
  if (!/^AIza[A-Za-z0-9_-]{20,}$/.test(normalized.apiKey)) {
    throw new AppError(400, 'Enter a valid Firebase Web API key.');
  }
  if (!/^[A-Za-z0-9_-]{20,}$/.test(normalized.vapidKey)) {
    throw new AppError(400, 'Enter a valid Firebase VAPID public key.');
  }
  if (!/^[a-z0-9][a-z0-9-]{5,29}$/.test(normalized.projectId)) {
    throw new AppError(400, 'Enter a valid Firebase project ID.');
  }
  if (!/^\d+$/.test(normalized.messagingSenderId)) {
    throw new AppError(400, 'The Firebase messaging sender ID must contain only digits.');
  }
  if ((normalized.authDomain && !/^[A-Za-z0-9.-]+$/.test(normalized.authDomain))
    || (normalized.storageBucket && !/^[A-Za-z0-9.-]+$/.test(normalized.storageBucket))) {
    throw new AppError(400, 'Enter valid Firebase auth domain and storage bucket host names.');
  }
  if (!new RegExp(`^\\d+:${normalized.messagingSenderId}:web:[A-Za-z0-9]+$`).test(normalized.appId)) {
    throw new AppError(400, 'The Firebase app ID must be a web app ID that matches the messaging sender ID.');
  }
  return normalized;
}

export async function firebaseWebConfigStatus() {
  try {
    const setting = await SystemSetting.findById(FIREBASE_WEB_CONFIG_SETTING).lean();
    let firebaseWebConfig = null;
    if (setting?.value && typeof setting.value === 'object' && !Array.isArray(setting.value)) {
      try {
        firebaseWebConfig = validateFirebaseWebConfig(setting.value);
      } catch (error) {
        console.error('Stored Firebase web configuration is invalid:', error?.message || 'unknown error');
        firebaseWebConfig = null;
      }
    }
    return {
      firebaseWebConfig,
      firebaseWebConfigConfigured: Boolean(firebaseWebConfig),
      firebaseWebConfigAvailable: true,
    };
  } catch (error) {
    console.error('Could not read the Firebase web configuration:', error?.name || 'unknown error');
    return {
      firebaseWebConfig: null,
      firebaseWebConfigConfigured: false,
      firebaseWebConfigAvailable: false,
    };
  }
}

export async function setFirebaseWebConfig(config, actor) {
  const firebaseWebConfig = validateFirebaseWebConfig(config);
  try {
    await SystemSetting.findByIdAndUpdate(
      FIREBASE_WEB_CONFIG_SETTING,
      { $set: { value: firebaseWebConfig, updatedAt: new Date(), updatedBy: actor?._id || null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return firebaseWebConfigStatus();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Could not persist the Firebase web configuration:', error?.name || 'unknown error');
    throw new AppError(503, 'The Firebase web configuration could not be saved.');
  }
}

export async function resetFirebaseWebConfig() {
  try {
    await SystemSetting.deleteOne({ _id: FIREBASE_WEB_CONFIG_SETTING });
    return firebaseWebConfigStatus();
  } catch (error) {
    console.error('Could not reset the Firebase web configuration:', error?.name || 'unknown error');
    throw new AppError(503, 'The Firebase web configuration could not be reset.');
  }
}
