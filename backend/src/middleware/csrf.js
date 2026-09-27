import crypto from 'node:crypto';
import { env } from '../config/env.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function setCsrfCookie(response, token) {
  response.cookie('csrftoken', token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: env.secureCookies,
    path: '/',
  });
}

export function issueCsrfToken(request, response) {
  if (!request.session.csrfToken) request.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  setCsrfCookie(response, request.session.csrfToken);
  return request.session.csrfToken;
}

export function rotateCsrfToken(request, response) {
  request.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  setCsrfCookie(response, request.session.csrfToken);
  return request.session.csrfToken;
}

export function csrfProtection(request, response, next) {
  if (SAFE_METHODS.has(request.method)) return next();
  const cookieToken = request.cookies?.csrftoken;
  const headerToken = request.get('x-csrftoken');
  const sessionToken = request.session?.csrfToken;
  if (!cookieToken || !headerToken || !sessionToken || cookieToken !== headerToken || headerToken !== sessionToken) {
    return response.status(403).json({ detail: 'CSRF Failed: CSRF token missing or invalid.' });
  }
  return next();
}
