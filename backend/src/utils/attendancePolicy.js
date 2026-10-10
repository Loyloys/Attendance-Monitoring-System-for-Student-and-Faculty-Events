/**
 * GST006 attendance-timing policy.
 *
 * Every value here is a deliberate, documented rule rather than a constant that
 * happens to sit in the code. They are read from the environment so an
 * institution can tighten them without a code change, and a missing value falls
 * back to the documented default instead of becoming "unbounded".
 *
 * The crediting rule, stated once so the service and the UI cannot disagree:
 *   Time is credited only for an interval bounded by TWO CONSECUTIVE ACCEPTABLE
 *   INSIDE observations that are no more than MAX_CREDIT_GAP_SECONDS apart.
 *   Anything else (outside, inaccurate, missing, stale, or a longer gap) earns
 *   nothing. The uncertain crossing interval is deliberately never credited.
 */

import { LOCATION_POLICY } from './domain.js';

/** Seconds of credited attendance that satisfy an event's required duration. */
export function requiredMinutesFor(event) {
  const value = event?.requiredAttendanceMinutes;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/** How often the browser is expected to report while tracking. */
export const REPORT_INTERVAL_MS = Number(process.env.ATTENDANCE_REPORT_INTERVAL_MS || 10_000);

/**
 * No acceptable observation for this long means the session is treated as
 * PAUSED on read, even if the browser never sends another update (phone locked,
 * tab suspended, network lost).
 */
export const STALE_TIMEOUT_SECONDS = Number(process.env.ATTENDANCE_STALE_TIMEOUT_SECONDS || 30);

/**
 * The longest gap between two Inside observations that may still be credited.
 * A larger gap means the crossing happened somewhere unknown, so it is not
 * credited.
 */
export const MAX_CREDIT_GAP_SECONDS = Number(process.env.ATTENDANCE_MAX_CREDIT_GAP_SECONDS || 30);

/**
 * LIVE TRACKING freshness, in seconds. Deliberately SEPARATE from
 * LOCATION_POLICY.maxAgeSeconds (the general location-age setting, 120 s).
 *
 * These are two different questions and must not be collapsed into one number:
 *
 *   LOCATION_POLICY.maxAgeSeconds (120 s)  how old may a fix be at all. It
 *     guards the ONE-SHOT scan, where the browser fixes a position, scans, and
 *     the request may be delayed in transit or the page may sit idle first.
 *
 *   TRACKING_MAX_OBSERVATION_AGE_SECONDS (30 s)  how old a fix may be while a
 *     person is being CONTINUOUSLY tracked. Tracking samples every 10 s, so an
 *     observation older than about three samples means the browser is replaying
 *     a cached position rather than measuring where the person is now. Under the
 *     120 s general limit such a replay is still "acceptable", and resending it
 *     every 10 s satisfies MAX_CREDIT_GAP_SECONDS on every single call - which
 *     is precisely how a phone that never left the sofa could accumulate a
 *     full attendance. The stricter 30 s window closes that hole.
 *
 * This value only ever tightens the general setting. If an operator configures a
 * tracking window WIDER than the general limit, the general limit still wins -
 * `effectiveTrackingMaxAgeSeconds()` below returns the smaller of the two - so a
 * misconfiguration can never loosen what the general policy already refuses.
 */
export const TRACKING_MAX_OBSERVATION_AGE_SECONDS = Number(process.env.ATTENDANCE_MAX_OBSERVATION_AGE_SECONDS || 30);

/** The age limit actually applied to a tracking observation, in seconds. */
export function effectiveTrackingMaxAgeSeconds() {
  return Math.min(TRACKING_MAX_OBSERVATION_AGE_SECONDS, LOCATION_POLICY.maxAgeSeconds);
}

export const SESSION_STATE = Object.freeze({ TRACKING: 'tracking', PAUSED: 'paused', COMPLETED: 'completed' });
export const LOCATION_STATE = Object.freeze({ INSIDE: 'inside', OUTSIDE: 'outside', UNKNOWN: 'unknown' });

export const PAUSE_REASON = Object.freeze({
  OUTSIDE: 'outside_venue',
  STALE: 'location_stale',
  UNKNOWN: 'location_unavailable',
  INACCURATE: 'location_inaccurate',
  EVENT_ENDED: 'event_ended',
  CHECKED_OUT: 'checked_out',
  DURATION_MET: 'required_duration_met',
});

/**
 * Derives the EFFECTIVE state on read.
 *
 * A session is only really tracking while a fresh acceptable observation exists
 * and the event is still running. Deriving this here - rather than trusting a
 * stored flag - means a browser that stopped reporting cannot keep crediting.
 */
export function deriveSessionState(session, event, now = new Date()) {
  if (session.state === SESSION_STATE.COMPLETED) return { state: SESSION_STATE.COMPLETED, reason: session.completionReason, derived: false };
  if (now >= event.endsAt) return { state: SESSION_STATE.COMPLETED, reason: PAUSE_REASON.EVENT_ENDED, derived: true };
  if (session.state === SESSION_STATE.PAUSED) return { state: SESSION_STATE.PAUSED, reason: session.pauseReason, derived: false };
  if (!session.lastReceivedAt) return { state: SESSION_STATE.PAUSED, reason: PAUSE_REASON.UNKNOWN, derived: true };
  const silentSeconds = (now.getTime() - new Date(session.lastReceivedAt).getTime()) / 1000;
  if (silentSeconds > STALE_TIMEOUT_SECONDS) return { state: SESSION_STATE.PAUSED, reason: PAUSE_REASON.STALE, derived: true };
  return { state: SESSION_STATE.TRACKING, reason: null, derived: false };
}

/** Remaining seconds toward the required duration, never negative. */
export function remainingSeconds(session, requiredMinutes) {
  if (!requiredMinutes) return null;
  return Math.max(0, requiredMinutes * 60 - session.creditedSeconds);
}

export function durationOutcome(session, requiredMinutes) {
  if (!requiredMinutes) return 'unconfigured';
  if (session.creditedSeconds >= requiredMinutes * 60) return 'met';
  if (session.state === SESSION_STATE.COMPLETED) return 'incomplete';
  return 'in_progress';
}