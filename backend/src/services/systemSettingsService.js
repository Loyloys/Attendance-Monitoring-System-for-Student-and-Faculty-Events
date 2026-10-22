import { SystemSetting } from '../models/index.js';
import { AppError } from '../utils/errors.js';

export const GOOGLE_OAUTH_SETTING = 'google_oauth_enabled';

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
