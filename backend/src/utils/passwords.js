import crypto from 'node:crypto';

const DEFAULT_ITERATIONS = 1_000_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export function verifyDjangoPassword(password, encoded) {
  if (typeof password !== 'string' || typeof encoded !== 'string') return false;
  const [algorithm, iterationText, saltText, hashText] = encoded.split('$');
  if (algorithm !== 'pbkdf2_sha256' || !iterationText || !saltText || !hashText) return false;

  const iterations = Number(iterationText);
  if (!Number.isInteger(iterations) || iterations < 1) return false;

  try {
    const expected = Buffer.from(hashText, 'base64');
    const actual = crypto.pbkdf2Sync(password, Buffer.from(saltText, 'base64'), iterations, expected.length || KEY_LENGTH, DIGEST);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createDjangoPassword(password, iterations = DEFAULT_ITERATIONS) {
  if (typeof password !== 'string' || !password) throw new TypeError('A non-empty password is required.');
  const salt = crypto.randomBytes(12);
  const hash = crypto.pbkdf2Sync(password, salt, iterations, KEY_LENGTH, DIGEST);
  return `pbkdf2_sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
