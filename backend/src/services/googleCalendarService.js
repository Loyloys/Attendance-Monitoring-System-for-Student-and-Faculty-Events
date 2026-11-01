import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { Event, User } from '../models/index.js';
import { AppError } from '../utils/errors.js';
import { decryptSecret, encryptSecret, isSecretStorageConfigured } from '../utils/secretBox.js';
import { googleCalendarSettingStatus } from './systemSettingsService.js';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3/calendars';
const TIME_ZONE = 'Asia/Manila';

function configurationError() {
  return new AppError(503, 'Google Calendar is not configured on this server yet.');
}

function assertConfigured() {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleCalendarRedirectUri || !isSecretStorageConfigured()) {
    throw configurationError();
  }
  if (env.isProduction && !env.googleCalendarRedirectUri.startsWith('https://')) {
    throw configurationError();
  }
}

function client() {
  assertConfigured();
  return new OAuth2Client(env.googleClientId, env.googleClientSecret, env.googleCalendarRedirectUri);
}

function publicRedirectTarget(status) {
  const base = env.publicAppUrl || 'http://localhost:5173';
  const target = new URL('/admin/settings', base);
  target.searchParams.set('googleCalendar', status);
  return target.toString();
}

export async function calendarConnectionStatus(user) {
  const setting = await googleCalendarSettingStatus();
  const missing = [];
  if (!env.googleClientId) missing.push('GOOGLE_CLIENT_ID');
  if (!env.googleClientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!env.googleCalendarRedirectUri) missing.push('GOOGLE_CALENDAR_REDIRECT_URI');
  if (!isSecretStorageConfigured()) missing.push('EVENT_QR_ENCRYPTION_KEY');
  if (env.isProduction && env.googleCalendarRedirectUri && !env.googleCalendarRedirectUri.startsWith('https://')) {
    missing.push('GOOGLE_CALENDAR_REDIRECT_URI must use HTTPS in production');
  }
  if (missing.length) return { configured: false, connected: false, enabled: setting.enabled, settingAvailable: setting.available, missing };
  return {
    configured: true,
    connected: Boolean(user?.googleCalendarRefreshTokenEncrypted),
    enabled: setting.enabled,
    settingAvailable: setting.available,
    missing: [],
  };
}

export function calendarAuthorizationUrl(request) {
  const oauth = client();
  const state = crypto.randomBytes(32).toString('base64url');
  request.session.googleCalendarState = state;
  return oauth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [CALENDAR_SCOPE],
    state,
  });
}

export async function completeCalendarAuthorization(request, code, state) {
  assertConfigured();
  if (!state || state !== request.session.googleCalendarState) {
    throw new AppError(400, 'The Google Calendar authorization session is invalid or expired.');
  }
  delete request.session.googleCalendarState;
  if (!code) throw new AppError(400, 'Google Calendar authorization was not completed.');
  const user = await User.findById(request.session.userId).select('+googleCalendarRefreshTokenEncrypted');
  if (!user || !user.isActive || user.archivedAt) throw new AppError(401, 'Your Admin session has expired. Sign in again.');
  const { tokens } = await client().getToken(code);
  if (!tokens.refresh_token) throw new AppError(400, 'Google did not provide a Calendar refresh credential. Please authorize Calendar again.');
  user.googleCalendarRefreshTokenEncrypted = encryptSecret(tokens.refresh_token);
  user.googleCalendarConnectedAt = new Date();
  await user.save();
}

async function accessTokenFor(user) {
  const stored = user.googleCalendarRefreshTokenEncrypted;
  if (!stored) return null;
  const oauth = client();
  oauth.setCredentials({ refresh_token: decryptSecret(stored) });
  const token = await oauth.getAccessToken();
  return token?.token || null;
}

function payloadFor(event) {
  return {
    summary: event.name,
    description: event.description || '',
    start: { dateTime: new Date(event.startsAt).toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: new Date(event.endsAt).toISOString(), timeZone: TIME_ZONE },
  };
}

async function calendarRequest(method, url, token, body) {
  const response = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Google Calendar returned HTTP ${response.status}.`);
  return response.json();
}

export async function syncEventToCalendar(event, organizer, request) {
  try {
    const setting = await googleCalendarSettingStatus();
    if (!setting.available) return { ok: false, reason: 'Google Calendar setting is unavailable. Event was saved without synchronization.' };
    if (!setting.enabled) return { ok: false, reason: 'Google Calendar synchronization is disabled by an Admin.' };
    const user = await User.findById(organizer._id).select('+googleCalendarRefreshTokenEncrypted');
    const token = user && await accessTokenFor(user);
    if (!token) {
      let authorizationUrl;
      try {
        authorizationUrl = calendarAuthorizationUrl(request);
      } catch {
        return { ok: false, reason: 'Google Calendar is not configured on this server yet.' };
      }
      return {
        ok: false,
        reason: 'Connect Google Calendar before saving events.',
        authorizationUrl,
      };
    }
    const body = payloadFor(event);
    const calendarApi = `${CALENDAR_API_BASE}/${encodeURIComponent(env.googleCalendarId)}/events`;
    const calendarEvent = event.googleCalendarEventId
      ? await calendarRequest('PATCH', `${calendarApi}/${encodeURIComponent(event.googleCalendarEventId)}`, token, body)
      : await calendarRequest('POST', calendarApi, token, body);
    if (!calendarEvent.id) throw new Error('Google Calendar did not return an event ID.');
    await Event.updateOne(
      { _id: event._id },
      { $set: { googleCalendarEventId: calendarEvent.id, googleCalendarHtmlLink: calendarEvent.htmlLink || null } },
    );
    event.googleCalendarEventId = calendarEvent.id;
    event.googleCalendarHtmlLink = calendarEvent.htmlLink || null;
    return { ok: true };
  } catch (error) {
    if (error instanceof AppError && error.status === 503) {
      return { ok: false, reason: error.message };
    }
    return { ok: false, reason: 'The event was saved, but Google Calendar synchronization failed. Please try again.' };
  }
}

export function calendarConnectionErrorUrl(status) {
  return publicRedirectTarget(status);
}

export function __calendarPayloadForTest(event) {
  return payloadFor(event);
}
