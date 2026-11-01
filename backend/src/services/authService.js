import { AuditLog, RevokedIdentifier, User, UserProfile } from '../models/index.js';
import { verifyDjangoPassword } from '../utils/passwords.js';
import { stableCaseInsensitive } from '../utils/identifiers.js';
import { AppError, ValidationError } from '../utils/errors.js';
import { clearLoginFailures, loginIsLocked, recordLoginFailure } from './loginThrottle.js';
import { serializeAuthUser } from './userSerializer.js';
import { isApproved } from '../middleware/authentication.js';
import { recaptchaStatus } from './systemSettingsService.js';

export async function authenticate(request, body) {
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : body.identifier;
  const password = body.password;
  const recaptchaToken = typeof body.recaptchaToken === 'string' ? body.recaptchaToken : '';
  if (typeof identifier !== 'string' || typeof password !== 'string') {
    throw new ValidationError({
      ...(typeof identifier !== 'string' ? { identifier: 'A string value is required.' } : {}),
      ...(typeof password !== 'string' ? { password: 'A string value is required.' } : {}),
    });
  }
  if (identifier.length < 3 || identifier.length > 150) throw new ValidationError({ identifier: 'Enter a valid ID or username.' });
  if (password.length > 1024) throw new ValidationError({ password: 'Password is too long.' });

  // reCAPTCHA is enforced only when an Administrator has enabled it in Settings.
  const captchaSetting = await recaptchaStatus();
  if (!captchaSetting.available) {
    throw new AppError(503, 'Could not confirm the reCAPTCHA setting. Please try again.');
  }
  if (captchaSetting.enabled) {
    if (!recaptchaToken) {
      throw new ValidationError({ detail: 'Please complete the reCAPTCHA before signing in.' });
    }
    await verifyRecaptchaToken(recaptchaToken);
  }

  if (await loginIsLocked(request, identifier)) {
    const error = new Error('Too many failed attempts. Try again in 30 seconds.');
    error.status = 429;
    throw error;
  }

  const normalized = stableCaseInsensitive(identifier);
  const revoked = await RevokedIdentifier.exists({ _id: { $regex: `^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:` } });
  const matches = await User.find({
    $or: [
      { usernameNormalized: normalized },
      { accountIdNormalized: normalized },
      { emailNormalized: normalized },
      // The address verified by Google may differ from the contact email on
      // older or linked accounts. It still identifies the same approved User.
      { googleEmailNormalized: normalized },
    ],
  }).select('+passwordHash').limit(2);
  const user = matches[0];
  // Google-only accounts have no password hash at all. Treat the missing hash as a
  // failed attempt rather than crashing, and report the same generic error so the
  // response never reveals which accounts exist.
  const hasPassword = typeof user?.passwordHash === 'string' && user.passwordHash.length > 0;
  const eligible = Boolean(user) && user.isActive && !user.archivedAt && isApproved(user);
  if (
    revoked
    || matches.length > 1
    || !user
    || !user.isActive
    || user.archivedAt
    || !isApproved(user)
    || !hasPassword
    || !verifyDjangoPassword(password, user.passwordHash)
  ) {
    await recordLoginFailure(request, identifier);
    // Approved, active accounts that simply never completed the application
    // password-setup flow get actionable guidance instead of the generic
    // mismatch error. Blocked (pending/rejected/inactive/archived), revoked,
    // ambiguous, or unknown identifiers keep the generic response so the
    // endpoint never discloses which accounts exist.
    // Never accept a Google password or an SMTP App Password here: only the
    // stored Django application-password hash is ever verified above.
    if (eligible && !hasPassword && !revoked && matches.length <= 1) {
      const setupRequired = new ValidationError({
        detail: 'No application password is set for this account. Use Google sign-in, or ask an administrator to send your application password setup link.',
      });
      setupRequired.code = 'password_setup_required';
      throw setupRequired;
    }
    throw new ValidationError({ detail: 'The account identifier or password is incorrect.' });
  }
  const profile = await UserProfile.findOne({ userId: user._id });
  if (!profile) {
    await recordLoginFailure(request, identifier);
    throw new ValidationError({ detail: 'The account identifier or password is incorrect.' });
  }
  await clearLoginFailures(request, identifier);
  user.lastLogin = new Date();
  await user.save();
  return { ...user.toObject(), profile: profile.toObject() };
}

export async function updateProfile(user, data) {
  // GST001.3/GST012: users must not change their own role, approval status,
  // active status, or other protected fields. Reject explicitly (do not silently
  // ignore) so a caller knows the change was refused.
  const protectedFields = [
    'role', 'username', 'id', 'accountId', 'department', 'card_identifier',
    'cardIdentifier', 'approvalStatus', 'isActive', 'isStaff', 'isSuperuser',
    'googleSub', 'authProviders',
  ];
  const supplied = protectedFields.filter((field) => Object.hasOwn(data, field));
  if (supplied.length) {
    throw new ValidationError({ detail: 'Role, ID, department, card, approval and account-status assignments are administrator-managed.' });
  }

  const updates = {};
  if (Object.hasOwn(data, 'name')) {
    if (typeof data.name !== 'string' || !data.name.trim()) throw new ValidationError({ name: 'Name is required.' });
    if (data.name.trim().length > 150) throw new ValidationError({ name: 'Name must not exceed 150 characters.' });
    updates.profile = { displayName: data.name.trim() };
  }
  if (Object.hasOwn(data, 'phone')) {
    if (typeof data.phone !== 'string' || data.phone.trim().length > 40) throw new ValidationError({ phone: 'Phone must not exceed 40 characters.' });
    updates.profile = { ...updates.profile, phone: data.phone.trim() };
  }
  if (Object.hasOwn(data, 'email')) {
    if (typeof data.email !== 'string' || data.email.trim().length > 254) throw new ValidationError({ email: 'Enter a valid email address.' });
    const email = data.email.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError({ email: 'Enter a valid email address.' });
    const duplicate = await User.exists({ emailNormalized: email, _id: { $ne: user._id } });
    if (duplicate) throw new ValidationError({ email: 'This email address is already in use.' });
    updates.email = email;
  }

  const changedFields = [];
  if (Object.hasOwn(updates, 'email')) changedFields.push('email');
  if (updates.profile?.displayName) changedFields.push('name');
  if (Object.hasOwn(updates.profile || {}, 'phone')) changedFields.push('phone');

  if (Object.hasOwn(updates, 'email')) {
    await User.updateOne({ _id: user._id }, { $set: { email: updates.email, emailNormalized: updates.email } });
  }
  if (updates.profile) await UserProfile.updateOne({ userId: user._id }, { $set: updates.profile });
  if (changedFields.length) {
    await AuditLog.create({
      actorId: user._id,
      actorName: user.name || user.username || '',
      action: 'account_updated',
      targetUserId: user._id,
      targetAccountId: user.accountId || user.username || '',
      detail: `Updated profile information (${changedFields.join(', ')})`,
    });
  }
  const updatedUser = await User.findById(user._id).lean();
  const updatedProfile = await UserProfile.findOne({ userId: user._id }).lean();
  return { ...updatedUser, profile: updatedProfile };
}

async function verifyRecaptchaToken(token) {
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  if (!secretKey) throw new ValidationError({ detail: 'reCAPTCHA is not configured on the server.' });

  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `secret=${encodeURIComponent(secretKey)}&response=${encodeURIComponent(token)}`,
  });

  const result = await response.json();
  if (!result.success) {
    throw new ValidationError({ detail: 'reCAPTCHA verification failed. Please try again.' });
  }
}
