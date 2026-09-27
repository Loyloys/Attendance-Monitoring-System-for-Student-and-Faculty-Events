import crypto from 'node:crypto';
import { LegacyBrowserSnapshot } from '../models/index.js';
import { ValidationError } from '../utils/errors.js';

const REDACTED_KEYS = new Set(['password', 'passwordHash', 'password_hash']);

function redactCredentials(value) {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !REDACTED_KEYS.has(key))
      .map(([key, nested]) => [key, redactCredentials(nested)]),
  );
}

export async function archiveLegacyBrowserState(user, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError({ payload: 'Legacy administrator data must be a JSON object.' });
  }
  const redactedPayload = redactCredentials(payload);
  const serialized = JSON.stringify(redactedPayload);
  if (Buffer.byteLength(serialized) > 1_000_000) {
    throw new ValidationError({ payload: 'Legacy administrator data exceeds the 1 MB import limit.' });
  }
  const sourceKey = 'cot-admin-requirements-v1';
  const payloadSha256 = crypto.createHash('sha256').update(serialized).digest('hex');
  const existing = await LegacyBrowserSnapshot.findOne({ sourceKey, payloadSha256 }).lean();
  if (existing) return { archived: true, duplicate: true, credentialsRemoved: true, archivedAt: existing.archivedAt };
  try {
    const snapshot = await LegacyBrowserSnapshot.create({
      sourceKey,
      payload: redactedPayload,
      payloadSha256,
      userId: user._id,
    });
    return { archived: true, duplicate: false, credentialsRemoved: true, archivedAt: snapshot.archivedAt };
  } catch (error) {
    if (error.code !== 11000) throw error;
    const concurrent = await LegacyBrowserSnapshot.findOne({ sourceKey, payloadSha256 }).lean();
    if (!concurrent) throw error;
    return { archived: true, duplicate: true, credentialsRemoved: true, archivedAt: concurrent.archivedAt };
  }
}

