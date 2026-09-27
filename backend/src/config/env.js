import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(sourceDir, '.env') });

const booleanValue = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const numberValue = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nodeEnvironment = process.env.NODE_ENV || 'development';
const sessionSecret = process.env.SESSION_SECRET || 'development-only-change-this-session-secret';

if (nodeEnvironment === 'production' && sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
}

export const env = Object.freeze({
  nodeEnvironment,
  isProduction: nodeEnvironment === 'production',
  port: numberValue(process.env.PORT, 8000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/university_attendance',
  sessionSecret,
  sessionCollection: process.env.SESSION_COLLECTION || 'sessions',
  trustedOrigins: (process.env.TRUSTED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  secureCookies: booleanValue(process.env.SECURE_COOKIES, nodeEnvironment === 'production'),
  loginFailureLimit: numberValue(process.env.LOGIN_FAILURE_LIMIT, 5),
  loginFailureWindowSeconds: numberValue(process.env.LOGIN_FAILURE_WINDOW_SECONDS, 60),
  loginLockSeconds: numberValue(process.env.LOGIN_LOCK_SECONDS, 30),
  sqliteSource: path.resolve(sourceDir, process.env.SQLITE_SOURCE || '../legacy/django/db.sqlite3'),
  migrationBackupDir: path.resolve(sourceDir, process.env.MIGRATION_BACKUP_DIR || './backups'),
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleAllowedIssuers: (process.env.GOOGLE_ALLOWED_ISSUERS || 'accounts.google.com,https://accounts.google.com')
    .split(',')
    .map((issuer) => issuer.trim())
    .filter(Boolean),
  googleClockSkewSeconds: numberValue(process.env.GOOGLE_CLOCK_SKEW_SECONDS, 60),
  // The approved institutional Google Workspace domain(s), exactly as Google's
  // `hd` claim reports them (for example "youruniversity.edu"). This list is
  // enforced server-side against the *verified* `hd` claim, never against an
  // email suffix or anything the browser sends. Leave it empty only while
  // developing; an empty list means any verified Google account is accepted,
  // which is not acceptable for a real deployment.
  googleAllowedHostedDomains: (process.env.GOOGLE_ALLOWED_HOSTED_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean),
  demoPasswords: Object.freeze({
    student: process.env.DEMO_STUDENT_PASSWORD || 'student123',
    faculty: process.env.DEMO_FACULTY_PASSWORD || 'faculty123',
    admin: process.env.DEMO_ADMIN_PASSWORD || 'admin123',
  }),
});
