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

const loginFailureLimit = numberValue(process.env.LOGIN_FAILURE_LIMIT, 5);
// Google sign-in gets its own request budget, configurable so a test run can
// raise it. The default is unchanged and still derived from the password
// failure limit, because the two flows have genuinely different risk profiles.
const googleAuthRateLimit = numberValue(process.env.GOOGLE_AUTH_RATE_LIMIT, Math.max(loginFailureLimit * 12, 60));

if (nodeEnvironment === 'production' && sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
}

// Private development testing of Google sign-in. This exists so a named handful
// of developer-owned accounts can exercise the popup flow before the school
// confirms its Workspace domain. It is deliberately hard to turn on by accident.
const GOOGLE_POLICIES = Object.freeze(['off', 'open', 'institutional', 'development_test']);
export const GOOGLE_POLICY_DEVELOPMENT_TEST = 'development_test';

const requestedPolicy = String(process.env.GOOGLE_ACCESS_POLICY || '').trim().toLowerCase();
if (requestedPolicy && !GOOGLE_POLICIES.includes(requestedPolicy)) {
  throw new Error(
    `GOOGLE_ACCESS_POLICY must be one of: ${GOOGLE_POLICIES.join(', ')}. Received "${requestedPolicy}".`,
  );
}
const googleAccessPolicy = requestedPolicy || 'off';

const devTestEmails = Object.freeze(
  (process.env.GOOGLE_DEV_TEST_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
);

if (googleAccessPolicy === GOOGLE_POLICY_DEVELOPMENT_TEST && nodeEnvironment === 'production') {
  throw new Error(
    'GOOGLE_ACCESS_POLICY=development_test is a local development tool and must never be used in '
    + 'production. Set GOOGLE_ACCESS_POLICY to "institutional" or "off" instead.',
  );
}

const institutionalDomains = (process.env.GOOGLE_ALLOWED_HOSTED_DOMAINS || '')
  .split(',')
  .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
  .filter(Boolean);

if (googleAccessPolicy === 'institutional' && !institutionalDomains.length) {
  // Selecting the institutional policy with no domain list would otherwise
  // behave exactly like "open", which is the precise mistake this enum exists
  // to prevent. Fail loudly at boot instead.
  throw new Error(
    'GOOGLE_ACCESS_POLICY=institutional requires GOOGLE_ALLOWED_HOSTED_DOMAINS to list at least one domain.',
  );
}

export const env = Object.freeze({
  nodeEnvironment,
  isProduction: nodeEnvironment === 'production',
  port: numberValue(process.env.PORT, 8000),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/university_attendance',
  sessionSecret,
  sessionCollection: process.env.SESSION_COLLECTION || 'sessions',
  // Cookie names are configurable so a second instance of this server (for
  // example a private Google test instance on another port and database) cannot
  // overwrite the normal app's cookies in the same browser. Same origin, so the
  // browser would otherwise send one instance's session to the other.
  sessionCookieName: process.env.SESSION_COOKIE_NAME || 'sessionid',
  csrfCookieName: process.env.CSRF_COOKIE_NAME || 'csrftoken',
  // A short banner the frontend shows on every screen, so nobody can mistake a
  // test instance for the real one. Empty on the normal app, which shows nothing.
  deploymentLabel: (process.env.DEPLOYMENT_LABEL || '').trim(),
  trustedOrigins: (process.env.TRUSTED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  secureCookies: booleanValue(process.env.SECURE_COOKIES, nodeEnvironment === 'production'),
  loginFailureLimit: loginFailureLimit,
  googleAuthRateLimit,
  loginFailureWindowSeconds: numberValue(process.env.LOGIN_FAILURE_WINDOW_SECONDS, 60),
  loginLockSeconds: numberValue(process.env.LOGIN_LOCK_SECONDS, 30),
  sqliteSource: path.resolve(sourceDir, process.env.SQLITE_SOURCE || '../legacy/django/db.sqlite3'),
  migrationBackupDir: path.resolve(sourceDir, process.env.MIGRATION_BACKUP_DIR || './backups'),
  googleClientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleClientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  googleCalendarRedirectUri: (
    process.env.GOOGLE_CALENDAR_REDIRECT_URI
    || (nodeEnvironment === 'production' ? '' : 'http://localhost:8000/api/auth/google/calendar/callback/')
  ).trim(),
  googleCalendarId: (process.env.GOOGLE_CALENDAR_ID || 'primary').trim(),
  googleAllowedIssuers: (process.env.GOOGLE_ALLOWED_ISSUERS || 'accounts.google.com,https://accounts.google.com')
    .split(',')
    .map((issuer) => issuer.trim())
    .filter(Boolean),
  googleClockSkewSeconds: numberValue(process.env.GOOGLE_CLOCK_SKEW_SECONDS, 60),
  // The Google access policy is an EXPLICIT, deliberate choice. It is never
  // inferred from whether a domain list happens to be empty.
  //
  //   off              Google sign-in is unavailable. The default.
  //   open             any valid, verified Google account may register. Identity
  //                    is proven by Google; eligibility is still decided by an
  //                    administrator, never by the login itself.
  //   institutional    only accounts whose verified `hd` claim is on the list.
  //   development_test only the explicitly listed private test accounts.
  googleAccessPolicy: googleAccessPolicy,
  // The approved institutional Google Workspace domain(s), exactly as Google's
  // `hd` claim reports them (for example "youruniversity.edu"). This list is
  // enforced server-side against the *verified* `hd` claim, never against an
  // email suffix or anything the browser sends. Used only by the
  // `institutional` policy; it does not restrict anything by itself.
  googleAllowedHostedDomains: institutionalDomains,
  // Private development testing. Only meaningful under the `development_test`
  // policy, and refused outright in production.
  googleDevTestMode: googleAccessPolicy === GOOGLE_POLICY_DEVELOPMENT_TEST,
  // Exact Google account addresses allowed to use the private test mode.
  // Compared case-insensitively after trimming (the application's own
  // normalization), never by suffix or domain, so `alice@example.com` cannot be
  // matched by `notalice@example.com` or by `alice@example.com.evil.test`.
  googleDevTestEmails: devTestEmails,
  // Whether the school has actually authorised this deployment. This is a
  // SEPARATE fact from the technical configuration above, and it is deliberately
  // not derived from the policy or the domain list: a working configuration says
  // nothing about whether the school approved wider deployment. It stays false
  // until someone confirms that approval in writing.
  googleSchoolApproved: booleanValue(process.env.GOOGLE_SCHOOL_APPROVED, false),
  smtpHost: (process.env.SMTP_HOST || '').trim(),
  smtpPort: numberValue(process.env.SMTP_PORT, 0),
  smtpSecure: booleanValue(process.env.SMTP_SECURE, false),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: (process.env.SMTP_FROM || '').trim(),
  publicAppUrl: (process.env.PUBLIC_APP_URL || '').trim(),
  superuserPin: (process.env.SU_PIN || '').trim(),
  superuserEmail: (process.env.SU_EMAIL || '').trim(),
  firebaseServiceAccountJson: (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim(),
  fcmTokenEncryptionKey: (process.env.FCM_TOKEN_ENCRYPTION_KEY || '').trim(),
  demoPasswords: Object.freeze({
    student: process.env.DEMO_STUDENT_PASSWORD || 'student123',
    faculty: process.env.DEMO_FACULTY_PASSWORD || 'faculty123',
    admin: process.env.DEMO_ADMIN_PASSWORD || 'admin123',
  }),
});
