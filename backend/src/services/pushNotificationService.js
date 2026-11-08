import crypto from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../config/env.js';
import { PushDevice, User, UserProfile } from '../models/index.js';
import { firebaseWebConfigStatus, pushNotificationsSettingStatus } from './systemSettingsService.js';
import { AppError, ValidationError } from '../utils/errors.js';

const TOKEN_ALGORITHM = 'aes-256-gcm';
const TOKEN_IV_BYTES = 12;

function serviceAccount() {
  if (!env.firebaseServiceAccountJson) return null;
  try {
    const credentials = JSON.parse(env.firebaseServiceAccountJson);
    if (!credentials.project_id || !credentials.client_email || !credentials.private_key) return null;
    return credentials;
  } catch (error) {
    console.error('Firebase service-account configuration is invalid:', error?.name || 'unknown error');
    return null;
  }
}

function encryptionKey() {
  if (env.fcmTokenEncryptionKey.length < 32) return null;
  return crypto.createHash('sha256').update(env.fcmTokenEncryptionKey, 'utf8').digest();
}

function messagingClient() {
  const credentials = serviceAccount();
  if (!credentials || !encryptionKey()) return null;
  const existing = getApps().find(app => app.name === 'attendance-fcm');
  const app = existing || initializeApp({
    credential: cert({
      projectId: credentials.project_id,
      clientEmail: credentials.client_email,
      privateKey: credentials.private_key,
    }),
    projectId: credentials.project_id,
  }, 'attendance-fcm');
  return getMessaging(app);
}

export function pushNotificationConfiguration() {
  return { configured: Boolean(serviceAccount() && encryptionKey()) };
}

export async function pushNotificationStatus() {
  const [configuration, setting, webConfig] = await Promise.all([
    Promise.resolve(pushNotificationConfiguration()),
    pushNotificationsSettingStatus(),
    firebaseWebConfigStatus(),
  ]);
  return { ...configuration, ...setting, ...webConfig };
}

function encryptToken(token) {
  const key = encryptionKey();
  if (!key) throw new AppError(503, 'Push notification storage is not configured on this server.');
  const iv = crypto.randomBytes(TOKEN_IV_BYTES);
  const cipher = crypto.createCipheriv(TOKEN_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptToken(payload) {
  const key = encryptionKey();
  if (!key) throw new AppError(503, 'Push notification storage is not configured on this server.');
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Stored push token is malformed.');
  const [iv, authTag, encrypted] = parts.map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv(TOKEN_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function registerPushDevice(userId, rawToken) {
  if (typeof rawToken !== 'string' || rawToken.trim().length < 20 || rawToken.length > 4096) {
    throw new ValidationError({ token: 'A valid browser push token is required.' });
  }
  const status = await pushNotificationStatus();
  if (!status.available) {
    throw new AppError(503, 'Push notification settings are temporarily unavailable.');
  }
  if (!status.configured) {
    throw new AppError(503, 'Push notifications are not configured on this server.');
  }
  if (!status.enabled) {
    throw new AppError(503, 'Push notifications are disabled by the administrator.');
  }
  const token = rawToken.trim();
  await PushDevice.findByIdAndUpdate(
    tokenHash(token),
    { $set: { userId, tokenEncrypted: encryptToken(token), updatedAt: new Date() } },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
  return { registered: true };
}

export async function unregisterPushDevice(userId, rawToken) {
  if (typeof rawToken !== 'string' || rawToken.trim().length < 20 || rawToken.length > 4096) {
    throw new ValidationError({ token: 'A valid browser push token is required.' });
  }
  await PushDevice.deleteOne({ _id: tokenHash(rawToken.trim()), userId });
  return { registered: false };
}

function invalidRegistrationToken(error) {
  return ['messaging/invalid-registration-token', 'messaging/registration-token-not-registered'].includes(error?.code);
}

export async function sendAnnouncementPush(announcement) {
  const status = await pushNotificationStatus();
  if (!status.available) throw new AppError(503, 'Push notification settings are temporarily unavailable.');
  if (!status.configured) return { status: 'not_configured', sent: 0, failed: 0 };
  if (!status.enabled) return { status: 'disabled', sent: 0, failed: 0 };
  const messaging = messagingClient();
  if (!messaging) return { status: 'not_configured', sent: 0, failed: 0 };

  const roles = announcement.audience === 'all' ? ['student', 'faculty'] : [announcement.audience];
  const profiles = await UserProfile.find({ role: { $in: roles } }).select('userId').lean();
  if (!profiles.length) return { status: 'no_recipients', sent: 0, failed: 0 };

  const users = await User.find({
    _id: { $in: profiles.map(profile => profile.userId) },
    isActive: true,
    archivedAt: null,
    approvalStatus: { $nin: ['pending', 'rejected'] },
  }).select('_id').lean();
  const userIds = users.map(user => user._id);
  const devices = await PushDevice.find({ userId: { $in: userIds } }).select('_id tokenEncrypted').lean();
  if (!devices.length) return { status: 'no_subscribers', sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  const invalidIds = [];
  for (let offset = 0; offset < devices.length; offset += 500) {
    const batch = devices.slice(offset, offset + 500);
    const messages = batch.map(device => ({ device, token: decryptToken(device.tokenEncrypted) }));
    try {
      const result = await messaging.sendEachForMulticast({
        tokens: messages.map(item => item.token),
        notification: {
          title: announcement.title,
          body: announcement.message.slice(0, 180),
        },
        data: { url: '/portal?view=announcements' },
      });
      sent += result.successCount;
      failed += result.failureCount;
      result.responses.forEach((response, index) => {
        if (response.error && invalidRegistrationToken(response.error)) invalidIds.push(batch[index]._id);
      });
    } catch (error) {
      failed += batch.length;
      console.error('Firebase push batch failed:', error?.code || error?.name || 'unknown error');
    }
  }

  if (invalidIds.length) await PushDevice.deleteMany({ _id: { $in: invalidIds } });
  return { status: sent ? (failed ? 'partial' : 'sent') : 'failed', sent, failed };
}
