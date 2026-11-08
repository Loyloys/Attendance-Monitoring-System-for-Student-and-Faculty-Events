import {
  addAttendance,
  adminState,
  archiveAdminUser,
  approveSignupRequest,
  correctAttendance,
  createAdminUser,
  deleteAdminUser,
  deleteAttendance,
  deleteForm,
  listAuditLog,
  listSignupRequests,
  rejectSignupRequest,
  resendUserPasswordSetup as resendUserPasswordSetupService,
  restoreArchivedAdminUser,
  saveForm,
  updateAdminUser,
} from '../services/adminService.js';

import {
  listUserEventRegistrations,
} from '../services/adminService.js';

import { archiveLegacyBrowserState } from '../services/legacyBrowserImportService.js';
import { googleOAuthStatus, googleClientIdStatus, setGoogleClientId, setGoogleOAuthStatus, recaptchaStatus, setRecaptchaStatus, recaptchaIsConfigured, mapPickerStatus, setMapPickerStatus, googleCalendarSettingStatus, setGoogleCalendarSettingStatus, pushNotificationsSettingStatus, setPushNotificationsSettingStatus, firebaseWebConfigStatus, setFirebaseWebConfig, resetFirebaseWebConfig } from '../services/systemSettingsService.js';
import { pushNotificationConfiguration } from '../services/pushNotificationService.js';
import { createAnnouncement, listAnnouncements } from '../services/announcementService.js';
import { resendPasswordSetup } from '../services/emailSignupService.js';
import { User } from '../models/index.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import { SignupRequest } from '../models/index.js';

export async function state(request, response) {
  response.json(await adminState());
}

export async function importLegacyBrowserState(request, response) {
  response.status(201).json(await archiveLegacyBrowserState(request.user, request.body.payload));
}

// AD003: who changed whose role, and when.
export async function auditLog(request, response) {
  response.json(await listAuditLog(request.query));
}

export async function createUser(request, response) {
  response.status(201).json(await createAdminUser(request.body, request.user));
}

// AD003.3: email-only pending signup requests (no User exists yet).
export async function signupRequests(request, response) {
  response.json(await listSignupRequests(request.query.status));
}

export async function approveSignup(request, response) {
  response.status(201).json(await approveSignupRequest(request.params.requestId, request.body, request.user));
}

export async function rejectSignup(request, response) {
  response.json(await rejectSignupRequest(request.params.requestId, request.user));
}

export async function googleOAuthSettings(request, response) {
  const [status, clientId] = await Promise.all([googleOAuthStatus(), googleClientIdStatus()]);
  if (!status.available || !clientId.available) {
    response.status(503).json({ detail: 'The persistent Google OAuth setting is unavailable; Google sign-in remains disabled.' });
    return;
  }
  response.json({ ...status, clientId: clientId.clientId });
}

export async function updateGoogleOAuthSettings(request, response) {
  const body = request.body || {};
  if (Object.hasOwn(body, 'clientId')) await setGoogleClientId(body.clientId, request.user);
  response.json(await setGoogleOAuthStatus(body.enabled, request.user));
}

export async function recaptchaSettings(request, response) {
  const status = await recaptchaStatus();
  if (!status.available) {
    response.status(503).json({ detail: 'The persistent reCAPTCHA setting could not be read. Please try again.' });
    return;
  }
  response.json(status);
}

export async function updateRecaptchaSettings(request, response) {
  response.json(await setRecaptchaStatus(request.body.enabled, request.user, request.body.siteKey));
}

export async function mapPickerSettings(request, response) {
  const status = await mapPickerStatus();
  if (!status.available) {
    response.status(503).json({ detail: 'The persistent map picker setting is unavailable; map picker remains disabled.' });
    return;
  }
  response.json(status);
}

export async function updateMapPickerSettings(request, response) {
  response.json(await setMapPickerStatus(request.body.enabled, request.user, request.body.tileProviderApiKey));
}

export async function googleCalendarSettings(request, response) {
  const status = await googleCalendarSettingStatus();
  if (!status.available) {
    response.status(503).json({ detail: 'The persistent Google Calendar setting is unavailable; Calendar remains disabled.' });
    return;
  }
  response.json(status);
}

export async function updateGoogleCalendarSettings(request, response) {
  response.json(await setGoogleCalendarSettingStatus(request.body.enabled, request.user));
}

export async function pushNotificationsSettings(request, response) {
  const [status, webConfig] = await Promise.all([
    pushNotificationsSettingStatus(),
    firebaseWebConfigStatus(),
  ]);
  if (!status.available) {
    response.status(503).json({ detail: 'The persistent push notifications setting is unavailable.' });
    return;
  }
  if (!webConfig.firebaseWebConfigAvailable) {
    response.status(503).json({ detail: 'The Firebase web configuration is temporarily unavailable.' });
    return;
  }
  response.json({ ...status, ...webConfig, configured: pushNotificationConfiguration().configured });
}

export async function updatePushNotificationsSettings(request, response) {
  const body = request.body || {};
  if (Object.hasOwn(body, 'firebaseWebConfig')) {
    const [webConfig, status] = await Promise.all([
      setFirebaseWebConfig(body.firebaseWebConfig, request.user),
      pushNotificationsSettingStatus(),
    ]);
    response.json({ ...status, ...webConfig, configured: pushNotificationConfiguration().configured });
    return;
  }
  if (body.resetFirebaseWebConfig === true) {
    const [webConfig, status] = await Promise.all([
      resetFirebaseWebConfig(),
      pushNotificationsSettingStatus(),
    ]);
    response.json({ ...status, ...webConfig, configured: pushNotificationConfiguration().configured });
    return;
  }
  if (body.enabled === true && !pushNotificationConfiguration().configured) {
    throw new AppError(400, 'Configure Firebase credentials and the token encryption key before enabling push notifications.');
  }
  const webConfig = await firebaseWebConfigStatus();
  if (!webConfig.firebaseWebConfigAvailable) {
    response.status(503).json({ detail: 'The Firebase web configuration is temporarily unavailable.' });
    return;
  }
  const status = await setPushNotificationsSettingStatus(body.enabled, request.user);
  response.json({ ...status, ...webConfig, configured: pushNotificationConfiguration().configured });
}

export async function adminAnnouncements(request, response) {
  response.json(await listAnnouncements('admin'));
}

export async function createAdminAnnouncement(request, response) {
  response.status(201).json(await createAnnouncement(request.body, request.user));
}

export async function userAnnouncements(request, response) {
  response.json(await listAnnouncements(request.user.profile?.role));
}

export async function resendSignupPasswordSetup(request, response) {
  const signup = await SignupRequest.findById(request.params.requestId).lean();
  if (!signup || signup.status !== 'approved') throw new NotFoundError('Approved signup request not found.');
  const user = await User.findOne({ emailNormalized: signup.googleEmailNormalized }).select('+passwordHash');
  if (!user) throw new NotFoundError('Approved signup account not found.');
  response.json(await resendPasswordSetup(user, signup._id));
}

// Authorized Admin resend for any approved account that never completed setup
// (for example it missed the approval email). Reuses the same eligibility rule.
export async function resendUserPasswordSetupLink(request, response) {
  response.json(await resendUserPasswordSetupService(request.params.accountId, request.user));
}

// Per-user event registrations. Kept separate from the user list so an
// administrator can inspect one person's registrations, and their attendance for
// those events, as two independent facts. Administrator-only, via adminRoutes.
export async function userRegistrations(request, response) {
  response.json(await listUserEventRegistrations(request.params.accountId));
}

export async function updateUser(request, response) {
  response.json(await updateAdminUser(request.params.accountId, request.body, request.user));
}

export async function deleteUser(request, response) {
  await deleteAdminUser(request.params.accountId, request.user);
  response.status(204).end();
}

export async function archiveUser(request, response) {
  response.json(await archiveAdminUser(request.params.accountId, request.user));
}

export async function restoreUser(request, response) {
  response.json(await restoreArchivedAdminUser(request.params.accountId, request.user));
}

export async function createAttendance(request, response) {
  response.status(201).json(await addAttendance(request.body, request.user));
}

export async function updateAttendance(request, response) {
  response.json(await correctAttendance(request.params.recordId, request.body, request.user));
}

export async function removeAttendance(request, response) {
  await deleteAttendance(request.params.recordId);
  response.status(204).end();
}

export async function createOrUpdateForm(request, response) {
  const result = await saveForm(request.body);
  response.status(request.body.id ? 200 : 201).json(result);
}

export async function removeForm(request, response) {
  await deleteForm(request.params.formId);
  response.status(204).end();
}
