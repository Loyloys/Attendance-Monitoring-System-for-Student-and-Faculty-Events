import type {
  AttendanceConfirmation,
  AttendanceMethod,
  AuthUser,
  EventRecord,
  MonitoredEventAttendance,
  PersonalAttendanceData,
  UserRole,
} from '../types/eventAttendance';
import type { AdminEvent } from './adminStore';

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

function readCookie(name: string) {
  return document.cookie.split(';').map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))?.split('=').slice(1).join('=') || null;
}

function syncCsrfCookie() {
  const cookieToken = readCookie('csrftoken');
  if (cookieToken) csrfToken = cookieToken;
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

async function ensureCsrfToken() {
  syncCsrfCookie();
  if (csrfToken) return csrfToken;
  const response = await fetch(`${API_ROOT}/auth/csrf/`, { credentials: 'include' });
  const payload = await response.json() as { csrfToken?: string };
  if (!response.ok || !payload.csrfToken) {
    throw new ApiError('Unable to initialize a secure session.', response.status, payload);
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

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    headers.set('X-CSRFToken', await ensureCsrfToken());
  }
  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers, credentials: 'include' });
  syncCsrfCookie();
  const payload = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  if (!response.ok) {
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
    await requestJson<void>('/auth/logout/', { method: 'POST' });
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
  scan(input: { token?: string; eventId?: string; identifier?: string; method: AttendanceMethod }) {
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


