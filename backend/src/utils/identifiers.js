import crypto from 'node:crypto';

export function toLegacyUuid(value) {
  if (typeof value !== 'string') return null;
  const compact = value.replaceAll('-', '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) return null;
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableCaseInsensitive(value) {
  return String(value || '').trim().toLowerCase();
}

export function publicId(value) {
  return value === undefined || value === null ? null : String(value);
}
