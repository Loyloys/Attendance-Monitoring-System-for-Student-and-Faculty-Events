import type {
  AttendanceConfirmation,
  AttendanceMethod,
  AuthUser,
  EventRecord,
  MonitoredEventAttendance,
  PersonalAttendanceData,
  UserRole,
} from '../types/eventAttendance';
import type { AdminEvent, AdminState, AdminUserAccount, AdminAttendanceRecord, AttendanceStatus, EvaluationForm } from './adminStore';
import type { LocationFix } from '../utils/eventQr';

export type AdminEventRequest = {
  name: string;
  description: string;
  date: string;
  start: string;
  end: string;
  venue: string;
  audience: 'all' | 'student' | 'faculty';
  method: 'qr' | 'barcode' | 'rfid';
  cutoff: string;
  status: 'published' | 'cancelled';
  requiredForAttendance: boolean;
  /** GST004: optional venue geofence. All three or none. */
  venueLatitude?: number;
  venueLongitude?: number;
  venueRadiusMeters?: number;
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
export type GoogleAuthResult =
  | { status: 'signed_in'; user: AuthUser }
  | { status: 'profile_incomplete'; prefill: GooglePrefill };
export type GoogleSession = { enabled: boolean; clientId: string | null; nonce: string | null; domainRestricted?: boolean };
export type GoogleConfig = { enabled: boolean; clientId: string | null; domainRestricted?: boolean };

function readCookie(name: string) {
  return document.cookie.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))?.split('=').slice(1).join('=') || null;
}

function syncCsrfCookie() {
  // Mirror the cookie exactly instead of only ever overwriting it. On logout the
  // server destroys the session and clears the csrftoken cookie, so a token held
  // in this module has to be discarded too. Keeping it made the next sign-in
  // replay a token that no longer matched the new server session, which failed
  // with "CSRF Failed: CSRF token missing or invalid." until the page reloaded.
  csrfToken = readCookie('csrftoken');
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
  async login(identifier: string, password: string) {
    return requestJson<AuthUser>('/auth/login/', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
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
  async googleAuthenticate(credential: string, selectedRole?: string) {
    return requestJson<GoogleAuthResult>('/auth/google/', {
      method: 'POST',
      body: JSON.stringify({ credential, selectedRole }),
    });
  },
  async completeGoogleProfile(values: { accountId: string; department: string; name: string; phone: string }) {
    return requestJson<{ status: 'signed_in'; user: AuthUser }>('/auth/google/complete-profile/', {
      method: 'POST',
      body: JSON.stringify(values),
    });
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
    return requestJson<AdminEvent>('/admin/events/', {
      method: 'POST',
      body: JSON.stringify(values),
    });
  },
  async updateAdminEvent(id: string, values: Partial<AdminEventRequest>) {
    return requestJson<AdminEvent>(`/admin/events/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  },
  async cancelAdminEvent(id: string) {
    return requestJson<AdminEvent>(`/admin/events/${id}/cancel/`, {
      method: 'POST',
    });
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
  async createAdminUser(values: Omit<AdminUserAccount, 'createdAt' | 'status'> & { status?: 'Active' | 'Inactive' }) {
    return requestJson<AdminUserAccount>('/admin/users/', {
      method: 'POST',
      body: JSON.stringify({ ...values, password: values.passwordHash }),
    });
  },
  async updateAdminUser(id: string, values: Partial<AdminUserAccount> & { password?: string }) {
    return requestJson<AdminUserAccount>(`/admin/users/${encodeURIComponent(id)}/`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  },
  async deleteAdminUser(id: string) {
    await requestJson<void>(`/admin/users/${encodeURIComponent(id)}/`, { method: 'DELETE' });
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
  async register(eventId: string) {
    return requestJson<{ registered: boolean; created: boolean; message: string }>(
      `/events/${eventId}/registrations/`,
      { method: 'POST' },
    );
  },
  async createCheckInCode(eventId: string) {
    return requestJson<{ token: string; expiresAt: string }>(
      `/events/${eventId}/check-in-code/`,
      { method: 'POST' },
    );
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
  downloadCertificate(certificateId: string) {
    return download(`/certificates/${certificateId}/download/`, 'event-participation-certificate.pdf');
  },
};

export const roleLabel: Record<UserRole, string> = {
  student: 'Student',
  faculty: 'Faculty',
  admin: 'Administrator',
};


