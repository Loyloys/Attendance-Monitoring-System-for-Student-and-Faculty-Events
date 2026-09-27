import { env } from '../config/env.js';

export function originGuard(request, response, next) {
  const origin = request.get('origin');
  if (origin && !env.trustedOrigins.includes(origin)) {
    return response.status(403).json({ detail: 'CSRF Failed: Origin is not trusted.' });
  }
  return next();
}

export function securityHeaders(request, response, next) {
  response.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  return next();
}
