import { RevokedIdentifier, User, UserProfile } from '../models/index.js';
import { verifyDjangoPassword } from '../utils/passwords.js';
import { stableCaseInsensitive } from '../utils/identifiers.js';
import { ValidationError } from '../utils/errors.js';
import { clearLoginFailures, loginIsLocked, recordLoginFailure } from './loginThrottle.js';
import { serializeAuthUser } from './userSerializer.js';

export async function authenticate(request, body) {
  const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : body.identifier;
  const password = body.password;
  if (typeof identifier !== 'string' || typeof password !== 'string') {
    throw new ValidationError({
      ...(typeof identifier !== 'string' ? { identifier: 'A string value is required.' } : {}),
      ...(typeof password !== 'string' ? { password: 'A string value is required.' } : {}),
    });
  }
  if (identifier.length < 3 || identifier.length > 150) throw new ValidationError({ identifier: 'Enter a valid ID or username.' });
  if (password.length > 1024) throw new ValidationError({ password: 'Password is too long.' });
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
    ],
  }).select('+passwordHash').limit(2);
  const user = matches[0];
  // Google-only accounts have no password hash at all. Treat the missing hash as a
  // failed attempt rather than crashing, and report the same generic error so the
  // response never reveals which accounts exist.
  const hasPassword = typeof user?.passwordHash === 'string' && user.passwordHash.length > 0;
  if (revoked || matches.length > 1 || !user || !user.isActive || !hasPassword || !verifyDjangoPassword(password, user.passwordHash)) {
    await recordLoginFailure(request, identifier);
    throw new ValidationError({ detail: 'The ID/username or password is incorrect.' });
  }
  const profile = await UserProfile.findOne({ userId: user._id });
  if (!profile) {
    await recordLoginFailure(request, identifier);
    throw new ValidationError({ detail: 'The ID/username or password is incorrect.' });
  }
  await clearLoginFailures(request, identifier);
  user.lastLogin = new Date();
  await user.save();
  return { ...user.toObject(), profile: profile.toObject() };
}

export async function updateProfile(user, data) {
  const protectedFields = ['role', 'username', 'id', 'department', 'card_identifier'];
  const supplied = protectedFields.filter((field) => Object.hasOwn(data, field));
  if (supplied.length) {
    throw new ValidationError({ detail: 'Role, ID, department, and card assignments are administrator-managed.' });
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

  if (Object.hasOwn(updates, 'email')) {
    await User.updateOne({ _id: user._id }, { $set: { email: updates.email, emailNormalized: updates.email } });
  }
  if (updates.profile) await UserProfile.updateOne({ userId: user._id }, { $set: updates.profile });
  const updatedUser = await User.findById(user._id).lean();
  const updatedProfile = await UserProfile.findOne({ userId: user._id }).lean();
  return { ...updatedUser, profile: updatedProfile };
}
