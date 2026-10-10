import crypto from 'node:crypto';

/**
 * AES-256-GCM helper used to store an event QR credential reversibly.
 *
 * A hash alone can VERIFY a token but cannot recover it, so an Administrator
 * could never re-display the current code after a refresh. This module stores
 * the token encrypted at rest instead, while the plain `tokenHash` stays as the
 * fast constant-time lookup path used during a scan.
 *
 * The key comes from the environment only. It is never written to source
 * control, never logged, and never returned by any API.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

let cachedKey = null;

function readKey() {
  const secret = process.env.EVENT_QR_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    const error = new Error('EVENT_QR_ENCRYPTION_KEY is not configured (needs at least 32 characters).');
    error.status = 503;
    error.code = 'event_qr_key_missing';
    throw error;
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

function key() {
  if (!cachedKey) cachedKey = readKey();
  return cachedKey;
}

/** Returns `iv.authTag.ciphertext`, all base64url. */
export function encryptSecret(plain) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map(part => part.toString('base64url')).join('.');
}

/** Reverses encryptSecret. Throws if the ciphertext was tampered with. */
export function decryptSecret(payload) {
  const parts = String(payload).split('.');
  if (parts.length !== 3) throw new Error('Stored credential is malformed.');
  const [iv, authTag, ciphertext] = parts.map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** True when credential storage is configured, so callers can degrade clearly. */
export function isSecretStorageConfigured() {
  return Boolean(process.env.EVENT_QR_ENCRYPTION_KEY && process.env.EVENT_QR_ENCRYPTION_KEY.length >= 32);
}