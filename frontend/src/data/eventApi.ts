import type {
  AttendanceConfirmation,
  AttendanceMethod,
  AttendanceQrPreview,
  AttendanceSession,
  AuthUser,
  EventRecord,
  MonitoredEventAttendance,
  MonitoredSession,
  PersonalAttendanceData,
  UserRole,
} from '../types/eventAttendance';
import type { AdminEvent, AdminEventRegistrant, AdminState, AdminUserAccount, AdminUserRegistrationDetail, AdminAttendanceRecord, AttendanceStatus, EvaluationForm } from './adminStore';
import type { LocationFix } from '../utils/eventQr';

export type AdminAuditEntry = {
  id: string;
  action: string;
  detail: string;
  actor: string;
  actorRole: string;
  targetAccountId: string;
  targetName: string;
  eventId: string;
  eventName: string;
  at: string;
};

/**
 * GST006: how usable the current code actually is right now.
 *
 * `not_issued`  nothing has been generated for this event yet
 * `not_yet_open` issued, but the check-in window has not opened (valid: the code
 *               is minted ahead of time and simply is not scannable yet)
 * `usable_now`  scannable at this moment
 * `window_closed` the window has closed
 * `expired` / `revoked` / `not_published` the code can no longer be scanned
 */
export type EventQrUsability =
  | 'not_issued'
  | 'not_yet_open'
  | 'usable_now'
  | 'window_closed'
  | 'expired'
  | 'revoked'
  | 'not_published';

/** Plain wording for each state, so the panel never invents its own verdict. */
export const QR_USABILITY_TEXT: Record<EventQrUsability, string> = {
  not_issued: 'No code has been generated yet.',
  not_yet_open: 'Ready. Scans are accepted once check-in opens.',
  usable_now: 'Scannable now.',
  window_closed: 'Check-in has closed. Scans are refused.',
  expired: 'This code has expired. Generate a new one.',
  revoked: 'This code was replaced. Generate a new one.',
  not_published: 'This event is not published, so scans are refused.',
};

export interface EventQr {
  /** The full scannable payload. Only ever returned to an authorized caller. */
  token: string;
  eventId: string;
  issuedAt: string;
  expiresAt: string;
  checkInOpensAt: string;
  checkInClosesAt: string;
  usability: EventQrUsability;
  /** True only when this response actually minted the code. */
  created?: boolean;
  /** True only for an explicit rotation. */
  rotated?: boolean;
}

/** Status without the token, safe for monitoring views. */
export interface EventQrStatus {
  issued: boolean;
  eventId: string;
  usability: EventQrUsability;
  issuedAt?: string;
  expiresAt?: string;
  checkInOpensAt?: string;
  checkInClosesAt?: string;
}

/**
 * Outcome of the automatic code issuance that follows creating a QR event.
 *
 * It is reported separately from the event itself so a failure cannot lose the
 * event: the administrator is told the event was created and can simply retry the
 * code from its own panel.
 */
export type EventQrIssuance =
  | { ok: true; qr: EventQr }
  | { ok: false; reason: string };

export interface AdminEventCertificateIssuance {
  /** Number of certificates that were present in the database after this request. */
  issued: number;
  /** The certificates matched or created by this issuance request. */
  certificates: Array<{
    eventId: string;
    studentId: string;
    reference: string;
    issuedAt: string;
  }>;
}

/** The admin event-create response: the event fields, plus the issuance outcome. */
export type CalendarSync =
  | { ok: true }
  | { ok: false; reason: string; authorizationUrl?: string };
export type AdminEventCreated = AdminEvent & { qr?: EventQrIssuance; calendar?: CalendarSync };
export type AdminEventUpdated = AdminEvent & { calendar?: CalendarSync };

export type AdminEventRequest = {
  id?: string;
  name: string;
  description: string;
  date: string;
  start: string;
  end: string;
  venue: string;
  audience: 'all' | 'student' | 'faculty' | 'it' | 'bsemc' | 'bsft' | 'bsat' | 'bset';
  method: 'qr' | 'barcode' | 'rfid';
  cutoff: string;
  status: 'published' | 'cancelled';
  /**
   * Whether students must REGISTER before checking in. Sent and received under
   * its own name; it used to be conflated with `requiredForAttendance` below,
   * which made a "counts toward a percentage" checkbox decide registration.
   */
  registrationRequired: boolean;
  /** Optional registration deadline. `null`/absent means no deadline is set. */
  registrationDeadline?: string | null;
  /** Whether this event counts toward a person's attendance percentage. */
  requiredForAttendance: boolean;
  /** GST006: required in-zone minutes. Null means "not configured yet". */
  requiredAttendanceMinutes?: number | null;
  /** GST004: optional venue geofence. All three or none. */
  venueLatitude?: number;
  venueLongitude?: number;
  venueRadiusMeters?: number;
  geofenceType?: 'circle' | 'polygon';
  geofencePolygon?: { latitude: number; longitude: number }[];
};

/**
 * A saved venue: a reusable geofence template an Administrator can apply while
 * scheduling an event.
 *
 * The snake_case payload matches the rest of this file's admin surfaces, and
 * `default_required_attendance_minutes` is named "default" throughout so no
 * caller can mistake it for a value the server enforces on an existing event.
 * It is only ever a starting value for the form field.
 */
export type SavedVenue = {
  id: string;
  name: string;
  /** Free text, shown next to the venue so approximate coordinates stay labelled as such. */
  note: string;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  default_required_attendance_minutes: number | null;
  isolated_test_record: boolean;
  created_at: string;
};

export type SavedVenueRequest = {
  name: string;
  note?: string;
  latitude?: number | null;
  longitude?: number | null;
  radiusMeters?: number | null;
  defaultRequiredAttendanceMinutes?: number | null;
  isolatedTestRecord?: boolean;
};

const API_ROOT = '/api';
let csrfToken: string | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly payload?: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export type GooglePrefill = { name: string; email: string; picture: string };

/** A pending/approved/rejected signup request, as the admin review screen sees it. */
export type AdminSignupRequest = {
  id: string;
  provider: 'google' | 'email';
  emailVerified: boolean;
  googleEmail: string;
  accountId: string;
  name: string;
  department: string;
  phone: string;
  // Role inferred from the verified email domain ('' when none matched).
  pendingRole: 'student' | 'faculty' | '';
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string | null;
  reviewedAt: string | null;
};
export type EnvironmentInfo = {
  environment: string;
  /** Text the server asks us to show on every screen. Empty on the normal app. */
  deploymentLabel: string;
  /** The CSRF cookie name THIS instance issues, which a parallel instance may rename. */
  csrfCookieName: string;
};

/** Used before (or instead of) a successful fetch, so behaviour stays predictable. */
const UNKNOWN: EnvironmentInfo = {
  environment: 'unknown',
  // A missing backend must never look like the normal app. Say so out loud.
  deploymentLabel: 'Environment unknown - the backend could not be reached.',
  csrfCookieName: 'csrftoken',
};

let current: EnvironmentInfo | null = null;
let pending: Promise<EnvironmentInfo> | null = null;

/**
 * The environment banner and the CSRF cookie name both come from the server,
 * because both are properties of the backend instance the proxy happens to be
 * pointing at. Fetched once and cached for the life of the page.
 */
export function loadEnvironment(): Promise<EnvironmentInfo> {
  if (current) return Promise.resolve(current);
  if (pending) return pending;
  pending = fetch('/api/health/', { credentials: 'include' })
    .then((response) => (response.ok ? response.json() : Promise.reject(new Error('unreachable'))))
    .then((payload: Partial<EnvironmentInfo>) => {
      current = {
        environment: payload.environment || 'unknown',
        deploymentLabel: typeof payload.deploymentLabel === 'string' ? payload.deploymentLabel : '',
        csrfCookieName: payload.csrfCookieName || 'csrftoken',
      };
      return current;
    })
    .catch(() => {
      current = UNKNOWN;
      return current;
    });
  return pending;
}

/** Synchronous view, for code paths that cannot await (cookie reads, render). */
export function environmentSnapshot(): EnvironmentInfo {
  return current ?? UNKNOWN;
}

export type GoogleAuthResult =
  | { status: 'signed_in'; user: AuthUser }
  | { status: 'profile_incomplete'; prefill: GooglePrefill }
  | { status: 'signup_pending'; message: string };
/**
 * What the server actually enforces, so the card never claims more than is true.
 * `institutional` is the only mode that is school-approved; `development_test`
 * is a local, explicitly-named testing policy and must be labelled as such.
 */
export type GoogleSignInMode = 'unavailable' | 'open' | 'institutional' | 'development_test';
export type GoogleSession = {
  enabled: boolean;
  clientId: string | null;
  nonce: string | null;
  configurationAvailable: boolean;
  clientIdPresent: boolean;
  settingAvailable: boolean;
  settingEnabled: boolean;
  mode?: GoogleSignInMode;
  policy?: string;
  domainRestricted?: boolean;
  developmentTesting?: boolean;
  openRegistration?: boolean;
  schoolApproved?: boolean;
};

export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
};

export type PushNotificationSettings = {
  enabled: boolean;
  available: boolean;
  configured: boolean;
  firebaseWebConfig: FirebaseWebConfig | null;
  firebaseWebConfigConfigured: boolean;
  firebaseWebConfigAvailable?: boolean;
};
export type GoogleConfig = Omit<GoogleSession, 'nonce'>;

function readCookie(name: string) {
  return document.cookie.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))?.split('=').slice(1).join('=') || null;
}

function syncCsrfCookie() {
  // Mirror the cookie exactly instead of only ever overwriting it. On logout the
  // server destroys the session and clears the CSRF cookie, so a token held in
  // this module has to be discarded too. Keeping it made the next sign-in
  // replay a token that no longer matched the new server session, which failed
  // with "CSRF Failed: CSRF token missing or invalid." until the page reloaded.
  // The NAME is read from the server too, because a parallel test instance may
  // issue a differently named cookie on this same origin.
  csrfToken = readCookie(environmentSnapshot().csrfCookieName);
}

function isCsrfFailure(payload: unknown) {
  const detail = payload && typeof payload === 'object'
    ? (payload as { detail?: unknown }).detail
    : undefined;
  return typeof detail === 'string' && detail.startsWith('CSRF Failed');
}

function errorMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'string' && payload.trim()) return payload;
  if (payload && typeof payload === 'object') {
    const messages = Object.values(payload as Record<string, unknown>)
      .flatMap(value => Array.isArray(value) ? value : [value])
      .filter(value => typeof value === 'string' && value.trim());
    if (messages.length) return messages.join(' ');
  }
  return fallback;
}

/**
 * A 502/503/504 with no JSON body almost always means the dev proxy could not
 * reach the backend, so the message names that instead of surfacing a JSON parse
 * error. A 200 that simply lacked a token is a different, server-side fault.
 */
function unreachableBackend(status: number) {
  if (status >= 500) {
    return 'Cannot reach the server. The backend may be stopped or on a different port than the frontend expects. Start it, then try again.';
  }
  return 'Unable to initialize a secure session. Refresh the page and try again.';
}

async function ensureCsrfToken() {
  // Learn the CSRF cookie NAME this backend uses before reading the jar, so a
  // renamed test-instance cookie is picked up instead of the default.
  await loadEnvironment();
  syncCsrfCookie();
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_ROOT}/auth/csrf/`, { credentials: 'include' });
  // The body is parsed defensively. A proxy error, a dropped connection or a
  // backend that is not running yet all answer with an empty or non-JSON body,
  // and `response.json()` throws "Unexpected end of JSON input" on those. That
  // raw parser message is meaningless to the person signing in, so it is caught
  // here and replaced with something that names the real problem.
  const payload = await response.json().catch(() => undefined) as { csrfToken?: string } | undefined;
  if (!response.ok || !payload?.csrfToken) {
    throw new ApiError(
      unreachableBackend(response.status),
      response.status || 503,
      payload,
    );
  }
  csrfToken = payload.csrfToken;
  return csrfToken;
}

function requestErrorMessage(path: string, status: number) {
  if (status !== 403) return 'The request could not be completed.';
  if (path === '/auth/login/') {
    return 'Secure sign-in was blocked. Refresh the frontend page shown by the launcher and try again.';
  }
  return 'You are not allowed to perform this action.';
}

async function requestJson<T>(path: string, init: RequestInit = {}, allowCsrfRetry = true): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (unsafe) {
    headers.set('X-CSRFToken', await ensureCsrfToken());
  }
  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers, credentials: 'include' });
  syncCsrfCookie();
  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
    if (unsafe && allowCsrfRetry && response.status === 403 && isCsrfFailure(payload)) {
      // The cached token and the server session drifted apart (sign-out, an
      // expired session, or a restarted backend). Drop the token, collect a
      // fresh one, and replay this request exactly once.
      csrfToken = null;
      await fetch(`${API_ROOT}/auth/csrf/`, { credentials: 'include' }).catch(() => undefined);
      syncCsrfCookie();
      if (csrfToken) return requestJson<T>(path, init, false);
    }
    throw new ApiError(
      errorMessage(payload, requestErrorMessage(path, response.status)),
      response.status,
      payload,
    );
  }
  return payload as T;
}

async function download(path: string, filename: string) {
  const response = await fetch(`${API_ROOT}${path}`, { credentials: 'include' });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    throw new ApiError(errorMessage(payload, 'The PDF could not be generated.'), response.status, payload);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const eventApi = {
  async login(identifier: string, password: string, recaptchaToken?: string) {
    return requestJson<AuthUser>('/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, recaptchaToken }),
    });
  },
  session() {
    return requestJson<AuthUser>('/auth/me/');
  },
  async logout() {
    try {
      await requestJson<void>('/auth/logout/', { method: 'POST' });
    } finally {
      // The server destroys the session and clears the csrftoken cookie, so the
      // cached copy of that token is dead. Forget it so the next sign-in asks
      // the server for a new one.
      csrfToken = null;
    }
  },
  googleConfig() {
    return requestJson<GoogleConfig>('/auth/google/config/');
  },
  async googleSession() {
    return requestJson<GoogleSession>('/auth/google/session/', { method: 'POST', body: '{}' });
  },
  emailDeliveryStatus() {
    return requestJson<{ configured: boolean; missing: string[] }>('/auth/email/status/');
  },
  async requestEmailSignup(email: string) {
    return requestJson<{ message: string }>('/auth/email/signup/', { method: 'POST', body: JSON.stringify({ email }) });
  },
  async verifyEmailSignup(token: string) {
    return requestJson<{ status: string; message: string }>('/auth/email/verify/', { method: 'POST', body: JSON.stringify({ token }) });
  },
  async setApplicationPassword(token: string, password: string) {
    return requestJson<{ status: string; message: string }>('/auth/password/setup/', { method: 'POST', body: JSON.stringify({ token, password }) });
  },
  async requestPasswordSetup(email: string) {
    return requestJson<{ message: string }>('/auth/password/request-setup/', { method: 'POST', body: JSON.stringify({ email }) });
  },
  async googleAuthenticate(credential: string, selectedRole?: string) {
    return requestJson<GoogleAuthResult>('/auth/google/', {
      method: 'POST',
      body: JSON.stringify({ credential, selectedRole }),
    });
  },
  async completeGoogleProfile() {
    // Email-only account request: the server takes everything it stores from
    // the verified Google identity, so the browser deliberately sends nothing.
    return requestJson<{ status: 'signed_in' | 'signup_pending'; user?: AuthUser; message?: string }>('/auth/google/complete-profile/', {
      method: 'POST',
      body: '{}',
    });
  },
  /**
   * AD003.3 admin review of email-only signup requests. Approval creates the
   * User with the administrator-assigned account ID, department (one of the
   * fixed five) and role; rejection never creates one.
   */
  adminSignupRequests(status: 'pending' | 'approved' | 'rejected' = 'pending') {
    return requestJson<AdminSignupRequest[]>(`/admin/signup-requests/?status=${status}`);
  },
  async approveSignupRequest(id: string, values: { accountId: string; department: string; role?: string }) {
    return requestJson<{ id: string; passwordSetup?: 'sent' | 'failed' | 'pending' }>(`/admin/signup-requests/${encodeURIComponent(id)}/approve/`, {
      method: 'POST',
      body: JSON.stringify(values),
    });
  },
  async rejectSignupRequest(id: string) {
    return requestJson<{ id: string; status: string }>(`/admin/signup-requests/${encodeURIComponent(id)}/reject/`, {
      method: 'POST',
      body: '{}',
    });
  },
  async resendSignupPasswordSetup(id: string) {
    return requestJson<{ status: string }>(`/admin/signup-requests/${encodeURIComponent(id)}/password-setup/`, {
      method: 'POST',
      body: '{}',
    });
  },
  // Resend for any approved account (not only a signup request row).
  async resendUserPasswordSetup(accountId: string) {
    return requestJson<{ status: string }>(`/admin/users/${encodeURIComponent(accountId)}/password-setup/`, {
      method: 'POST',
      body: '{}',
    });
  },
  async verifyAdminSettingsPin(pin: string) {
    return requestJson<{ verified: boolean }>('/admin/settings/access/verify-pin/', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },
  async sendAdminSettingsEmailCode(purpose: 'settings_change' | 'pin_reset') {
    return requestJson<{ sent: boolean }>('/admin/settings/access/send-code/', {
      method: 'POST',
      body: JSON.stringify({ purpose }),
    });
  },
  async verifyAdminSettingsEmailCode(purpose: 'settings_change' | 'pin_reset', emailCode: string) {
    return requestJson<{ verified: boolean; detail?: string }>('/admin/settings/access/verify-code/', {
      method: 'POST',
      body: JSON.stringify({ purpose, emailCode }),
    });
  },
  googleOAuthSettings() {
    return requestJson<{ enabled: boolean; available: boolean; clientId: string }>('/admin/settings/google-oauth/');
  },
  async updateGoogleOAuthSettings(enabled: boolean, clientId?: string) {
    return requestJson<{ enabled: boolean; available: boolean }>('/admin/settings/google-oauth/', {
      method: 'PUT',
      body: JSON.stringify({ enabled, ...(clientId === undefined ? {} : { clientId }) }),
    });
  },
  async recaptchaSettings() {
    return requestJson<{ enabled: boolean; available: boolean; configured: boolean; siteKey?: string }>('/admin/settings/recaptcha/');
  },
  async updateRecaptchaSettings(enabled: boolean, siteKey?: string) {
    return requestJson<{ enabled: boolean; available: boolean }>('/admin/settings/recaptcha/', {
      method: 'PUT',
      body: JSON.stringify({ enabled, ...(siteKey === undefined ? {} : { siteKey }) }),
    });
  },
  async mapPickerSettings() {
    return requestJson<{ enabled: boolean; available: boolean; tileProviderKeyConfigured: boolean }>('/admin/settings/map-picker/');
  },
  async googleCalendarStatus() {
    return requestJson<{ configured: boolean; connected: boolean; enabled: boolean; settingAvailable: boolean; missing: string[] }>('/auth/google/calendar/status/');
  },
  async googleCalendarSettings() {
    return requestJson<{ enabled: boolean; available: boolean }>('/admin/settings/google-calendar/');
  },
  async updateGoogleCalendarSettings(enabled: boolean) {
    return requestJson<{ enabled: boolean; available: boolean }>('/admin/settings/google-calendar/', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  },
  googleCalendarAuthorizeUrl() {
    return `${API_ROOT}/auth/google/calendar/authorize/`;
  },
  async updateMapPickerSettings(enabled: boolean, tileProviderApiKey?: string) {
    return requestJson<{ enabled: boolean; available: boolean; tileProviderKeyConfigured: boolean }>('/admin/settings/map-picker/', {
      method: 'PUT',
      body: JSON.stringify({ enabled, ...(tileProviderApiKey === undefined ? {} : { tileProviderApiKey }) }),
    });
  },
  pushNotificationSettings() {
    return requestJson<PushNotificationSettings>('/admin/settings/push-notifications/');
  },
  async updatePushNotificationSettings(enabled: boolean) {
    return requestJson<PushNotificationSettings>('/admin/settings/push-notifications/', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  },
  async saveFirebaseWebConfig(firebaseWebConfig: FirebaseWebConfig) {
    return requestJson<PushNotificationSettings>('/admin/settings/push-notifications/', {
      method: 'PUT',
      body: JSON.stringify({ firebaseWebConfig }),
    });
  },
  async resetFirebaseWebConfig() {
    return requestJson<PushNotificationSettings>('/admin/settings/push-notifications/', {
      method: 'PUT',
      body: JSON.stringify({ resetFirebaseWebConfig: true }),
    });
  },
  pushNotificationStatus() {
    return requestJson<PushNotificationSettings>('/notifications/status/');
  },
  async registerPushDevice(token: string) {
    return requestJson<{ registered: boolean }>('/notifications/devices/', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },
  async unregisterPushDevice(token: string) {
    return requestJson<{ registered: boolean }>('/notifications/devices/', {
      method: 'DELETE',
      body: JSON.stringify({ token }),
    });
  },
  adminAnnouncements() {
    return requestJson<Announcement[]>('/admin/announcements/');
  },
  async createAdminAnnouncement(values: Pick<Announcement, 'title' | 'message' | 'audience'>) {
    return requestJson<Announcement>('/admin/announcements/', { method: 'POST', body: JSON.stringify(values) });
  },
  announcements() {
    return requestJson<Announcement[]>('/announcements/');
  },
  async linkGoogle(credential: string) {
    return requestJson<AuthUser>('/auth/google/link/', {
      method: 'POST',
      body: JSON.stringify({ credential }),
    });
  },
  async updateProfile(values: { name: string; email: string; phone: string }) {
    return requestJson<AuthUser>('/profile/', {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  },
  events() {
    return requestJson<EventRecord[]>('/events/');
  },
  adminEvents() {
    return requestJson<AdminEvent[]>('/admin/events/');
  },
  async createAdminEvent(values: AdminEventRequest) {
    return requestJson<AdminEventCreated>('/admin/events/', {
      method: 'POST',
      body: JSON.stringify(values),
    });
  },
  async updateAdminEvent(id: string, values: Partial<AdminEventRequest>) {
    return requestJson<AdminEventUpdated>(`/admin/events/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  },
  async cancelAdminEvent(id: string) {
    return requestJson<AdminEvent>(`/admin/events/${id}/cancel/`, {
      method: 'POST',
    });
  },
  async archiveAdminEvent(id: string) {
    return requestJson<AdminEvent>(`/admin/events/${encodeURIComponent(id)}/archive/`, {
      method: 'POST',
    });
  },
  async restoreAdminEvent(id: string) {
    return requestJson<AdminEvent>(`/admin/events/${encodeURIComponent(id)}/restore/`, {
      method: 'POST',
    });
  },
  async adminArchivedEvents() {
    return requestJson<AdminEvent[]>(`/admin/archive/`);
  },
  /**
   * Saved venues are read for the create/edit event form only. Applying one is
   * a pure front-end copy into the form fields - the event stores its own
   * numbers, so later edits to a saved venue never reach an existing event.
   */
  savedVenues() {
    return requestJson<SavedVenue[]>('/admin/venues/');
  },
  createSavedVenue(values: SavedVenueRequest) {
    return requestJson<SavedVenue>('/admin/venues/', {
      method: 'POST',
      body: JSON.stringify(values),
    });
  },
  /**
   * The server's published freshness and geofence policy. Reported device
   * accuracy is informational; acceptance is decided by the event geofence.
   */
  health() {
    return requestJson<{
      status: string;
      deploymentLabel?: string;
      locationPolicy?: { maxAccuracyMeters: number; maxAgeSeconds: number; slackMeters: number };
    }>('/health/');
  },
  async importLegacyBrowserState(payload: AdminState) {
    return requestJson<{ archived: boolean; duplicate: boolean; credentialsRemoved: boolean; archivedAt: string }>('/admin/import-legacy-browser/', {
      method: 'POST',
      body: JSON.stringify({ payload }),
    });
  },
  adminState() {
    return requestJson<AdminState>('/admin/state/');
  },
  async createAdminUser(values: Omit<AdminUserAccount, 'createdAt' | 'status' | 'approvalStatus' | 'signedUpViaGoogle'>) {
    return requestJson<AdminUserAccount>('/admin/users/', {
      method: 'POST',
      body: JSON.stringify({ ...values, password: values.passwordHash }),
    });
  },
  async updateAdminUser(id: string, values: Partial<Omit<AdminUserAccount, 'status' | 'approvalStatus'>> & { password?: string }) {
    return requestJson<AdminUserAccount>(`/admin/users/${encodeURIComponent(id)}/`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  },
  async deleteAdminUser(id: string) {
    await requestJson<void>(`/admin/users/${encodeURIComponent(id)}/`, { method: 'DELETE' });
  },
  archiveAdminUser(id: string) {
    return requestJson<AdminUserAccount>(`/admin/users/${encodeURIComponent(id)}/archive/`, { method: 'POST' });
  },
  restoreAdminUser(id: string) {
    return requestJson<AdminUserAccount>(`/admin/users/${encodeURIComponent(id)}/restore/`, { method: 'POST' });
  },
  /** Per-user event registrations. Administrator-only on the server. */
  adminUserRegistrations(id: string) {
    return requestJson<AdminUserRegistrationDetail>(`/admin/users/${encodeURIComponent(id)}/registrations/`);
  },

  // ---- GST006 attendance tracking -------------------------------------------
  // The session is server-owned: the browser sends observations and renders what
  // comes back. It never accumulates time locally.

  /** Starts (or resumes) tracking after a verified scan. */
  startAttendanceSession(values: { attendanceId?: number; token?: string; eventId?: string; method?: string; location?: LocationFix }) {
    return requestJson<AttendanceSession>('/attendance/session/', { method: 'POST', body: JSON.stringify(values) });
  },
  /** Sends one location observation; the server decides what to credit. */
  updateAttendanceSession(id: string, location: LocationFix) {
    return requestJson<AttendanceSession>(`/attendance/session/${encodeURIComponent(id)}/`, { method: 'PATCH', body: JSON.stringify({ location }) });
  },
  /** Explicit, final checkout. The session cannot be restarted. */
  checkoutAttendanceSession(id: string) {
    return requestJson<AttendanceSession>(`/attendance/session/${encodeURIComponent(id)}/checkout/`, { method: 'POST' });
  },
  /** Restores the session after a refresh or reconnect. Null when none exists. */
  myAttendanceSession(eventId: string) {
    return requestJson<{ session: AttendanceSession | null }>(`/attendance/session/event/${encodeURIComponent(eventId)}/`);
  },
  /** Administrator / assigned-Faculty monitoring. */
  monitoredAttendanceSessions(eventId: string) {
    return requestJson<{ sessions: MonitoredSession[] }>(`/attendance/sessions/event/${encodeURIComponent(eventId)}/`);
  },
  async createAdminAttendance(values: Pick<AdminAttendanceRecord, 'eventId' | 'personId' | 'status'> & { note?: string }) {
    return requestJson<AdminAttendanceRecord>('/admin/attendance/', {
      method: 'POST',
      body: JSON.stringify(values),
    });
  },
  async updateAdminAttendance(id: string, values: { status: AttendanceStatus; note?: string }) {
    return requestJson<AdminAttendanceRecord>(`/admin/attendance/${encodeURIComponent(id)}/`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  },
  async deleteAdminAttendance(id: string) {
    await requestJson<void>(`/admin/attendance/${encodeURIComponent(id)}/`, { method: 'DELETE' });
  },
  async saveAdminForm(values: Omit<EvaluationForm, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
    return requestJson<EvaluationForm>('/admin/forms/', {
      method: 'POST',
      body: JSON.stringify(values),
    });
  },
  async deleteAdminForm(id: string) {
    await requestJson<void>(`/admin/forms/${encodeURIComponent(id)}/`, { method: 'DELETE' });
  },
  managedEvents() {
    return requestJson<EventRecord[]>('/events/managed/');
  },
  /** GST016: archived events the signed-in student/faculty member registered for or attended. Read-only. */
  async myArchivedEvents() {
    return requestJson<EventRecord[]>('/events/archived/');
  },

  async register(eventId: string) {
    return requestJson<{ registered: boolean; created: boolean; message: string }>(
      `/events/${eventId}/registrations/`,
      { method: 'POST' },
    );
  },
  async cancelRegistration(eventId: string) {
    return requestJson<{ registered: boolean; cancelled: boolean; message: string }>(
      `/events/${eventId}/registrations/`,
      { method: 'DELETE' },
    );
  },
  /**
   * GST006 event QR credential.
   *
   * `usability` is the server's own verdict, so the panel never has to re-derive
   * "is this scannable yet?" from two timestamps and risk disagreeing with the
   * rule that actually refuses a scan.
   */
  adminEventQr(eventId: string) {
    return requestJson<EventQr>(`/admin/events/${encodeURIComponent(eventId)}/qr/`);
  },
  /**
   * Explicit rotation. The previous code stops working immediately, so this is
   * deliberately NOT what viewing or exporting a PNG/PDF does.
   */
  regenerateAdminEventQr(eventId: string) {
    return requestJson<EventQr>(`/admin/events/${encodeURIComponent(eventId)}/qr/`, { method: 'POST' });
  },
  adminEventQrStatus(eventId: string) {
    return requestJson<EventQrStatus>(`/admin/events/${encodeURIComponent(eventId)}/qr/status/`);
  },
  async createCheckInCode(eventId: string) {
    return requestJson<{ token: string; expiresAt: string }>(
      `/events/${eventId}/check-in-code/`,
      { method: 'POST' },
    );
  },
  /**
   * GST006: reads the CURRENT code for an assigned event without rotating it.
   */
  eventCheckInCode(eventId: string) {
    return requestJson<EventQr>(`/events/${encodeURIComponent(eventId)}/check-in-code/`);
  },
  scan(input: {
    token?: string;
    eventId?: string;
    identifier?: string;
    method: AttendanceMethod;
    /** GST004: a fresh fix taken at scan time. The server re-validates it. */
    location?: LocationFix;
  }) {
    return requestJson<AttendanceConfirmation>('/attendance/scan/', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },
  previewAttendance(token: string) {
    return requestJson<AttendanceQrPreview>('/attendance/scan/preview/', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },
  myAttendance() {
    return requestJson<PersonalAttendanceData>('/attendance/me/');
  },
  eventAttendance(eventId: string) {
    return requestJson<MonitoredEventAttendance>(`/events/${eventId}/attendance/`);
  },
  async feedback(eventId: string, rating: number, comments: string) {
    return requestJson<{ id: number; message: string }>(`/events/${eventId}/feedback/`, {
      method: 'POST',
      body: JSON.stringify({ rating, comments }),
    });
  },
  downloadMyAttendance() {
    return download('/reports/me.pdf', 'personal-event-attendance.pdf');
  },
  downloadEventAttendance(eventId: string) {
    return download(`/reports/events/${eventId}.pdf`, 'event-attendance-report.pdf');
  },
  async issueEventCertificates(eventId: string) {
    return requestJson<AdminEventCertificateIssuance>(
      `/admin/events/${encodeURIComponent(eventId)}/certificates/`,
      { method: 'POST' },
    );
  },
  /**
   * AD024: Registrants for an event, with registration and confirmation status.
   * Administrator-only on the server.
   */
  adminAuditLog(options: { limit?: number; search?: string; action?: string; actorRole?: string } = {}) {
    const params = new URLSearchParams();
    params.set('limit', String(options.limit ?? 100));
    if (options.search) params.set('search', options.search);
    if (options.action) params.set('action', options.action);
    if (options.actorRole) params.set('actorRole', options.actorRole);
    return requestJson<AdminAuditEntry[]>(`/admin/audit-log/?${params.toString()}`);
  },
  adminEventRegistrants(eventId: string) {
    return requestJson<AdminEventRegistrant[]>(`/admin/events/${encodeURIComponent(eventId)}/registrants/`);
  },

  downloadCertificate(certificateId: string) {
    return download(`/certificates/${certificateId}/download/`, 'event-participation-certificate.pdf');
  },

};

export type Announcement = {
  id: string;
  title: string;
  message: string;
  audience: 'all' | 'student' | 'faculty';
  createdByName: string;
  createdAt: string;
  notificationDelivery?: {
    status: 'not_configured' | 'no_recipients' | 'no_subscribers' | 'sent' | 'partial' | 'failed';
    sent: number;
    failed: number;
  };
};

export const roleLabel: Record<UserRole, string> = {
  student: 'Student',
  faculty: 'Faculty',
  admin: 'Administrator',
};
