import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { sendActionEmail } from './emailService.js';
import { AppError, PermissionError, ValidationError } from '../utils/errors.js';

const PIN_SESSION_MINUTES = 15;
const CODE_TTL_MINUTES = 10;
const CHANGE_GRANT_MINUTES = 2;
const MAX_CODE_ATTEMPTS = 5;
const PURPOSES = new Set(['settings_change', 'pin_reset']);

let pin = env.superuserPin;
let email = env.superuserEmail;
let sendEmail = sendActionEmail;

const pinFingerprint = (value) => crypto.createHash('sha256').update(value).digest('hex');
const sameValue = (left, right) => crypto.timingSafeEqual(
  crypto.createHash('sha256').update(left).digest(),
  crypto.createHash('sha256').update(right).digest(),
);

function requirePinConfigured() {
  if (!pin) throw new AppError(503, 'Admin settings access is not configured. Set SU_PIN in the backend environment.');
  if (pin.length < 6) throw new AppError(503, 'SU_PIN must contain at least 6 characters.');
}

function requireEmailConfigured() {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError(503, 'Admin settings email verification is not configured. Set SU_EMAIL in the backend environment.');
  }
}

export async function verifyAdminSettingsPin(request, suppliedPin) {
  requirePinConfigured();
  if (typeof suppliedPin !== 'string' || suppliedPin.length > 256 || !sameValue(suppliedPin.trim(), pin)) {
    throw new ValidationError({ pin: 'The admin settings PIN is incorrect.' }, 'The admin settings PIN is incorrect.');
  }
  request.session.adminSettingsPinFingerprint = pinFingerprint(pin);
  request.session.adminSettingsPinVerifiedAt = Date.now();
}

export function requireAdminSettingsPin(request) {
  requirePinConfigured();
  const verifiedAt = request.session?.adminSettingsPinVerifiedAt;
  const fingerprint = request.session?.adminSettingsPinFingerprint;
  if (
    !Number.isFinite(verifiedAt)
    || Date.now() - verifiedAt > PIN_SESSION_MINUTES * 60_000
    || fingerprint !== pinFingerprint(pin)
  ) {
    delete request.session.adminSettingsPinVerifiedAt;
    delete request.session.adminSettingsPinFingerprint;
    delete request.session.adminSettingsEmailChallenge;
    throw new PermissionError('Enter the admin settings PIN to continue.', undefined, 'admin_settings_pin_required');
  }
  request.session.adminSettingsPinVerifiedAt = Date.now();
}

function challengeHash(request, purpose, code) {
  return crypto.createHmac('sha256', env.sessionSecret)
    .update(`${request.sessionID}:${purpose}:${code}`)
    .digest('hex');
}

export async function sendAdminSettingsEmailCode(request, purpose) {
  if (!PURPOSES.has(purpose)) throw new ValidationError({ purpose: 'Select a valid verification purpose.' });
  if (purpose === 'settings_change') requireAdminSettingsPin(request);
  requireEmailConfigured();

  const code = String(crypto.randomInt(100_000, 1_000_000));
  await sendEmail({
    to: email,
    subject: purpose === 'pin_reset' ? 'Admin settings PIN reset verification' : 'Admin settings change verification',
    text: `Your verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes. If you did not request this, ignore this email.`,
  });
  request.session.adminSettingsEmailChallenge = {
    purpose,
    codeHash: challengeHash(request, purpose, code),
    expiresAt: Date.now() + CODE_TTL_MINUTES * 60_000,
    attempts: 0,
  };
}

export function verifyAdminSettingsEmailCode(request, purpose, suppliedCode) {
  const challenge = request.session?.adminSettingsEmailChallenge;
  if (
    !PURPOSES.has(purpose)
    || !challenge
    || challenge.purpose !== purpose
    || !Number.isFinite(challenge.expiresAt)
    || Date.now() > challenge.expiresAt
  ) {
    delete request.session.adminSettingsEmailChallenge;
    throw new ValidationError(
      { emailCode: 'The verification code expired or was not requested. Request a new code.' },
      'The verification code expired or was not requested. Request a new code.',
    );
  }

  if (typeof suppliedCode !== 'string' || suppliedCode.length > 32
    || !sameValue(challengeHash(request, purpose, suppliedCode.trim()), challenge.codeHash)) {
    challenge.attempts += 1;
    if (challenge.attempts >= MAX_CODE_ATTEMPTS) delete request.session.adminSettingsEmailChallenge;
    throw new ValidationError(
      { emailCode: 'The verification code is incorrect or expired.' },
      'The verification code is incorrect or expired.',
    );
  }

  delete request.session.adminSettingsEmailChallenge;
  if (purpose === 'settings_change') {
    request.session.adminSettingsChangeGrantUntil = Date.now() + CHANGE_GRANT_MINUTES * 60_000;
  } else {
    delete request.session.adminSettingsPinVerifiedAt;
    delete request.session.adminSettingsPinFingerprint;
    delete request.session.adminSettingsChangeGrantUntil;
  }
}

export function requireAdminSettingsChangeGrant(request) {
  requireAdminSettingsPin(request);
  const expiresAt = request.session?.adminSettingsChangeGrantUntil;
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) {
    delete request.session.adminSettingsChangeGrantUntil;
    throw new PermissionError('Request and verify an email code before changing this setting.', undefined, 'admin_settings_email_code_required');
  }
  delete request.session.adminSettingsChangeGrantUntil;
}

export function __setAdminSettingsAccessForTests(config) {
  pin = config.pin ?? env.superuserPin;
  email = config.email ?? env.superuserEmail;
  sendEmail = config.sendEmail ?? sendActionEmail;
}
