import { SystemSetting } from '../models/index.js';
import { AppError } from '../utils/errors.js';

export const GOOGLE_OAUTH_SETTING = 'google_oauth_enabled';
export const RECAPTCHA_SETTING = 'recaptcha_enabled';
export const MAP_PICKER_SETTING = 'map_picker_enabled';
export const GOOGLE_CALENDAR_SETTING = 'google_calendar_enabled';

export async function googleOAuthStatus() {
  try {
    const setting = await SystemSetting.findById(GOOGLE_OAUTH_SETTING).lean();
    return { enabled: setting?.value === true, available: true };
  } catch (error) {
    console.error('Could not read the persisted Google OAuth setting:', error?.name || 'unknown error');
    return { enabled: false, available: false };
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
    const setting = await SystemSetting.findById(RECAPTCHA_SETTING).lean();
    return { enabled: setting?.value === true, available: true, configured: recaptchaIsConfigured().available };
  } catch (error) {
    console.error('Could not read the persisted reCAPTCHA setting:', error?.name || 'unknown error');
    return { enabled: false, available: false, configured: false };
  }
}

export async function setRecaptchaStatus(enabled, actor) {
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be true or false.');
  if (enabled) {
    const configured = recaptchaIsConfigured();
    if (!configured.available) throw new AppError(400, configured.detail);
  }
  try {
    await SystemSetting.findByIdAndUpdate(
      RECAPTCHA_SETTING,
      { $set: { value: enabled, updatedAt: new Date(), updatedBy: actor?._id || null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    );
    return recaptchaStatus();
  } catch (error) {
    if (error instanceof AppError) throw error;
    console.error('Could not persist the reCAPTCHA setting:', error?.name || 'unknown error');
    throw new AppError(503, 'The reCAPTCHA setting could not be saved. No setting change was made.');
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
    const setting = await SystemSetting.findById(MAP_PICKER_SETTING).lean();
    return { enabled: setting?.value === true, available: true };
  } catch (error) {
    console.error('Could not read the persisted map picker setting:', error?.name || 'unknown error');
    return { enabled: false, available: false };
  }
}

export async function setMapPickerStatus(enabled, actor) {
  if (typeof enabled !== 'boolean') throw new AppError(400, 'enabled must be true or false.');
  try {
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
