import { authenticate, updateProfile } from '../services/authService.js';
import { env } from '../config/env.js';
import { serializeAuthUser } from '../services/userSerializer.js';
import {
  authenticateWithGoogle,
  completeGoogleProfile,
  googleOAuthAvailability,
  linkGoogleIdentity,
  startGoogleSession,
} from '../services/googleAuthService.js';
import { issueCsrfToken, rotateCsrfToken } from '../middleware/csrf.js';
import { ValidationError } from '../utils/errors.js';
import { regenerateSession } from '../utils/session.js';
import {
  emailSignupStatus,
  requestEmailSignup,
  setApplicationPassword,
  verifySignupEmail,
} from '../services/emailSignupService.js';

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
export async function googleConfig(request, response) {
  response.json(await googleOAuthAvailability());
}

export async function googleSession(request, response) {
  response.json(await startGoogleSession(request));
}

export function emailStatus(request, response) {
  response.json(emailSignupStatus());
}

export async function emailSignup(request, response) {
  response.status(202).json(await requestEmailSignup(request.body.email));
}

export async function emailVerify(request, response) {
  response.json(await verifySignupEmail(request.body.token));
}

export async function passwordSetup(request, response) {
  response.json(await setApplicationPassword(request.body.token, request.body.password));
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
  if (result.status === 'signed_in') {
    rotateCsrfToken(request, response);
    response.json({ status: result.status, user: serializeAuthUser(result.user) });
    return;
  }
  // AD003.3: pending signup request stored; no session, no role, no access.
  response.status(202).json({
    status: result.status,
    message: 'Your signup request is pending administrator approval. You will be notified once it is reviewed.',
  });
}

export async function googleLink(request, response) {
  const user = await linkGoogleIdentity(request, request.body);
  response.json(serializeAuthUser(user));
}

export function logout(request, response) {
  request.session.destroy(() => {
    // Both names come from configuration, so a test instance clears its own
    // cookies and leaves the normal app's session on this browser intact.
    response.clearCookie(env.sessionCookieName, { path: '/' });
    response.clearCookie(env.csrfCookieName, { path: '/' });
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
