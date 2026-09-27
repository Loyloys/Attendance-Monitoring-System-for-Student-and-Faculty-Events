import { LoginAttempt } from '../models/index.js';
import { env } from '../config/env.js';
import { sha256, stableCaseInsensitive } from '../utils/identifiers.js';

const loginKey = (request, identifier) => sha256(`${request.ip || 'unknown'}:${stableCaseInsensitive(identifier)}`);

export async function loginIsLocked(request, identifier) {
  const record = await LoginAttempt.findOne({ key: loginKey(request, identifier) }).lean();
  return Boolean(record?.lockedUntil && record.lockedUntil > new Date());
}

export async function recordLoginFailure(request, identifier) {
  const key = loginKey(request, identifier);
  const now = new Date();
  const cutoff = new Date(now.getTime() - env.loginFailureWindowSeconds * 1_000);
  const existing = await LoginAttempt.findOne({ key });
  if (!existing || existing.windowStartedAt <= cutoff) {
    const reset = { key, failures: 1, windowStartedAt: now, lockedUntil: null, updatedAt: now };
    await LoginAttempt.replaceOne({ key }, reset, { upsert: true });
    return;
  }
  existing.failures += 1;
  existing.updatedAt = now;
  if (existing.failures >= env.loginFailureLimit) {
    existing.lockedUntil = new Date(now.getTime() + env.loginLockSeconds * 1_000);
  }
  await existing.save();
}

export async function clearLoginFailures(request, identifier) {
  await LoginAttempt.deleteOne({ key: loginKey(request, identifier) });
}
