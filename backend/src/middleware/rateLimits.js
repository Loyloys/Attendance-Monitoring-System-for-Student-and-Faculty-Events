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
  limit: Number(process.env.LOGIN_RATE_LIMIT) || Math.max(env.loginFailureLimit * 4, 20),
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
  limit: env.googleAuthRateLimit,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { detail: 'Too many sign-in attempts. Try again shortly.' },
});

export const emailActionLimiter = rateLimit({
  windowMs: 15 * 60_000,
  // Same env-override pattern as loginLimiter: the product default stays strict
  // (5/min in production), while the test suite can raise its own budget.
  limit: Number(process.env.EMAIL_ACTION_RATE_LIMIT) || (env.isProduction ? 5 : 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { detail: 'Too many email verification or password setup attempts. Try again later.' },
});
