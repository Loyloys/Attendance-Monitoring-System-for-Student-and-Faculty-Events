import {
  requireAdminSettingsChangeGrant,
  requireAdminSettingsPin,
} from '../services/adminSettingsAccessService.js';

export function requireAdminSettingsAccess(request, response, next) {
  try {
    requireAdminSettingsPin(request);
    next();
  } catch (error) {
    next(error);
  }
}

export function requireAdminSettingsChange(request, response, next) {
  try {
    requireAdminSettingsChangeGrant(request);
    next();
  } catch (error) {
    next(error);
  }
}
