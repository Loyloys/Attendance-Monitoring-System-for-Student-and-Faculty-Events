import { authenticate, updateProfile } from '../services/authService.js';
import { serializeAuthUser } from '../services/userSerializer.js';
import {
  authenticateWithGoogle,
  completeGoogleProfile,
  googlePublicConfig,
  linkGoogleIdentity,
  startGoogleSession,
} from '../services/googleAuthService.js';
import { issueCsrfToken, rotateCsrfToken } from '../middleware/csrf.js';
import { ValidationError } from '../utils/errors.js';
import { regenerateSession } from '../utils/session.js';

export function csrf(request, response) {
  response.json({ csrfToken: issueCsrfToken(request, response) });
}

export async function login(request, response) {
  const user = await authenticate(request, request.body);
  await regenerateSession(request);
  request.session.userId = String(user._id);
  rotateCsrfToken(request, response);
  response.json(serializeAuthUser(user));
}

// Public so the sign-in card can show an unavailable state without a CSRF round trip.
export function googleConfig(request, response) {
  response.json(googlePublicConfig());
}

export function googleSession(request, response) {
  response.json(startGoogleSession(request));
}

export async function googleAuthenticate(request, response) {
  const result = await authenticateWithGoogle(request, request.body);
  if (result.status === 'signed_in') {
    rotateCsrfToken(request, response);
    response.json({ status: result.status, user: serializeAuthUser(result.user) });
    return;
  }
  response.json({ status: result.status, prefill: result.prefill });
}

export async function googleCompleteProfile(request, response) {
  const result = await completeGoogleProfile(request, request.body);
  rotateCsrfToken(request, response);
  response.status(201).json({ status: result.status, user: serializeAuthUser(result.user) });
}

export async function googleLink(request, response) {
  const user = await linkGoogleIdentity(request, request.body);
  response.json(serializeAuthUser(user));
}

export function logout(request, response) {
  request.session.destroy(() => {
    response.clearCookie('sessionid', { path: '/' });
    response.clearCookie('csrftoken', { path: '/' });
    response.status(204).end();
  });
}

export function me(request, response) {
  response.json(serializeAuthUser(request.user));
}

export async function profile(request, response) {
  if (request.method === 'GET') return response.json(serializeAuthUser(request.user));
  const updated = await updateProfile(request.user, request.body);
  response.json(serializeAuthUser(updated));
}

export function requireObjectBody(request, response, next) {
  if (!request.is('application/json') || !request.body || typeof request.body !== 'object' || Array.isArray(request.body)) {
    return next(new ValidationError({ detail: 'Request body must be a JSON object.' }));
  }
  return next();
}
