import crypto from 'node:crypto';
import { EmailActionToken, SignupRequest, User } from '../models/index.js';
import { createDjangoPassword } from '../utils/passwords.js';
import { pendingRoleForEmail } from '../utils/domain.js';
import { stableCaseInsensitive } from '../utils/identifiers.js';
import { AppError, AuthenticationError, ConflictError, ValidationError } from '../utils/errors.js';
import { applicationUrl, emailDeliveryStatus, sendActionEmail } from './emailService.js';

const VERIFY_TTL_MS = 30 * 60 * 1000;
const PASSWORD_SETUP_TTL_MS = 60 * 60 * 1000;
const tokenHash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const tokenValue = () => crypto.randomBytes(32).toString('base64url');
const genericMessage = 'If this address can be used, an email with the next step will arrive shortly.';

function normalizeEmail(value) {
  if (typeof value !== 'string') throw new ValidationError({ email: 'Enter a valid email address.' });
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ValidationError({ email: 'Enter a valid email address.' });
  }
  return { email, normalized: stableCaseInsensitive(email) };
}

function ensureEmailConfigured() {
  const status = emailDeliveryStatus();
  if (!status.configured) {
    throw new AppError(
      503,
      `Email verification is unavailable. Configure ${status.missing.join(', ')} in the backend environment, then retry.`,
    );
  }
}

async function issueToken({ purpose, emailNormalized, signupRequestId = null, userId = null, expiresIn }) {
  const value = tokenValue();
  const _id = tokenHash(value);
  await EmailActionToken.create({
    _id,
    purpose,
    emailNormalized,
    signupRequestId,
    userId,
    expiresAt: new Date(Date.now() + expiresIn),
  });
  return { value, _id };
}

export async function requestEmailSignup(emailValue) {
  ensureEmailConfigured();
  const { email, normalized } = normalizeEmail(emailValue);
  const alreadyHasAccount = await User.exists({ emailNormalized: normalized });
  const hasPendingSignup = await SignupRequest.exists({ googleEmailNormalized: normalized, status: 'pending' });
  if (!alreadyHasAccount && !hasPendingSignup) {
    const token = await issueToken({
      purpose: 'verify-signup-email',
      emailNormalized: normalized,
      expiresIn: VERIFY_TTL_MS,
    });
    try {
      const link = applicationUrl(`/verify-email?token=${encodeURIComponent(token.value)}`);
      await sendActionEmail({
        to: email,
        subject: 'Verify your University Attendance email',
        text: `Verify your email address to submit an account request. This link expires in 30 minutes and can be used once:\n\n${link}\n\nIf you did not request this, ignore this email.`,
      });
    } catch (error) {
      await EmailActionToken.deleteOne({ _id: token._id });
      throw error;
    }
  }
  return { message: genericMessage };
}

export async function verifySignupEmail(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 256) {
    throw new AuthenticationError('This verification link is invalid or expired. Request a new one.');
  }
  const now = new Date();
  const token = await EmailActionToken.findOneAndUpdate(
    { _id: tokenHash(rawToken), purpose: 'verify-signup-email', consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
    { new: true },
  );
  if (!token) throw new AuthenticationError('This verification link is invalid, expired, or already used. Request a new one.');

  if (await User.exists({ emailNormalized: token.emailNormalized })) {
    return { status: 'received', message: 'If the verified address is eligible, its request is available for administrator review.' };
  }
  const existingRequest = await SignupRequest.findOne({
    googleEmailNormalized: token.emailNormalized,
    status: 'pending',
  });
  if (!existingRequest) {
    const email = token.emailNormalized;
    const pendingRole = pendingRoleForEmail(email);
    try {
      await SignupRequest.create({
        provider: 'email',
        googleSub: null,
        googleEmail: email,
        googleEmailNormalized: token.emailNormalized,
        emailVerifiedAt: now,
        pendingRole,
        status: 'pending',
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      if (!await SignupRequest.exists({ googleEmailNormalized: token.emailNormalized, status: 'pending' })) throw error;
    }
  }
  return { status: 'received', message: 'Your verified signup request is awaiting administrator review. No account or session has been created.' };
}

export async function sendPasswordSetupLink(user, signupRequestId = null) {
  ensureEmailConfigured();
  const emailNormalized = user.emailNormalized;
  const token = await issueToken({
    purpose: 'set-application-password',
    emailNormalized,
    signupRequestId,
    userId: user._id,
    expiresIn: PASSWORD_SETUP_TTL_MS,
  });
  try {
    const link = applicationUrl(`/set-password?token=${encodeURIComponent(token.value)}`);
    await sendActionEmail({
      to: user.email,
      subject: 'Set your University Attendance application password',
      text: `Your account has been approved. Set an application password using this single-use link within one hour:\n\n${link}\n\nThis is not your Google password. If you did not request this, contact an administrator.`,
    });
  } catch (error) {
    await EmailActionToken.deleteOne({ _id: token._id });
    throw error;
  }
}

export async function setApplicationPassword(rawToken, passwordValue) {
  if (typeof rawToken !== 'string' || rawToken.length < 32 || rawToken.length > 256) {
    throw new AuthenticationError('This password setup link is invalid or expired. Ask an administrator to resend it.');
  }
  if (typeof passwordValue !== 'string' || passwordValue.length < 10 || passwordValue.length > 256) {
    throw new ValidationError({ password: 'Use a password between 10 and 256 characters.' });
  }
  const now = new Date();
  const token = await EmailActionToken.findOneAndUpdate(
    { _id: tokenHash(rawToken), purpose: 'set-application-password', consumedAt: null, expiresAt: { $gt: now } },
    { $set: { consumedAt: now } },
    { new: true },
  );
  if (!token) throw new AuthenticationError('This password setup link is invalid, expired, or already used. Ask an administrator to resend it.');

  const user = await User.findOne({
    _id: token.userId,
    emailNormalized: token.emailNormalized,
    approvalStatus: 'approved',
    isActive: true,
    archivedAt: null,
  }).select('+passwordHash');
  if (!user) throw new ConflictError('This account is not currently eligible to set a password. Contact an administrator.');
  user.passwordHash = createDjangoPassword(passwordValue);
  user.authProviders = [...new Set([...(user.authProviders || []), 'password'])];
  await user.save();
  return { status: 'password_set', message: 'Your application password is set. You can now sign in with your ID and password.' };
}

export async function resendPasswordSetup(user, signupRequestId = null) {
  if (!user || user.approvalStatus !== 'approved' || user.archivedAt || !user.isActive) {
    throw new ConflictError('Only active, approved accounts can receive a password setup link.');
  }
  if (user.passwordHash) throw new ConflictError('This account already has an application password.');
  await sendPasswordSetupLink(user, signupRequestId);
  return { status: 'sent' };
}

export async function requestPasswordSetup(emailValue) {
  ensureEmailConfigured();
  const { normalized } = normalizeEmail(emailValue);
  const user = await User.findOne({
    emailNormalized: normalized,
    approvalStatus: 'approved',
    isActive: true,
    archivedAt: null,
  }).select('+passwordHash');

  // Keep the response identical for unknown, pending, and already-configured
  // accounts so this endpoint cannot be used to enumerate users.
  if (user && !user.passwordHash) await sendPasswordSetupLink(user);
  return { message: genericMessage };
}

export function emailSignupStatus() {
  return emailDeliveryStatus();
}
