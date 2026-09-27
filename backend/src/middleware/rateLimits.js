import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.isProduction ? 300 : 2_000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { detail: 'Too many requests. Try again shortly.' },
});

export const loginLimiter = rateLimit({
  windowMs: env.loginFailureWindowSeconds * 1_000,
  limit: Math.max(env.loginFailureLimit * 4, 20),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { detail: 'Too many login attempts. Try again shortly.' },
});

// Google endpoints get their own budget instead of sharing the password one. A
// verified credential cannot be brute forced the way a password can, and a single
// sign-in makes several calls here, so a shared campus IP would otherwise lock
// everyone out of Google sign-in long before it slowed down a real attack.
export const googleAuthLimiter = rateLimit({
  windowMs: env.loginFailureWindowSeconds * 1_000,
  limit: Math.max(env.loginFailureLimit * 12, 60),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { detail: 'Too many sign-in attempts. Try again shortly.' },
});
