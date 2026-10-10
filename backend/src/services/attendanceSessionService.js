import { AttendanceSession, Event, EventAttendance, EventRegistration, UserProfile } from '../models/index.js';
import { ConflictError, NotFoundError, PermissionError, ValidationError } from '../utils/errors.js';
import { LOCATION_POLICY, QUALIFICATION_REASONS, geofenceFor } from '../utils/domain.js';
import { distanceMeters, eventAllows } from '../utils/events.js';
import { nextNumericId } from '../utils/ids.js';
import {
  LOCATION_STATE,
  MAX_CREDIT_GAP_SECONDS,
  PAUSE_REASON,
  SESSION_STATE,
  deriveSessionState,
  durationOutcome,
  effectiveTrackingMaxAgeSeconds,
  remainingSeconds,
  requiredMinutesFor,
} from '../utils/attendancePolicy.js';
import { resolveScannedEvent } from './eventService.js';

/**
 * GST006: the authoritative attendance-tracking service.
 *
 *  - The server owns the totals: `creditedSeconds` only advances on the SERVER
 *    receipt clock, never on a timestamp the browser supplied.
 *  - An interval is credited only when bounded by two consecutive acceptable
 *    INSIDE observations no more than MAX_CREDIT_GAP_SECONDS apart.
 *  - Outside / inaccurate / stale observations pause and credit nothing, and the
 *    uncertain crossing gap is never credited on re-entry.
 *  - Updates are applied atomically behind an optimistic guard, so duplicate,
 *    delayed and concurrent (multi-tab) deliveries cannot double-count.
 */

/**
 * Cached result of the rollout gate. `false` until the unique index is proven to
 * exist, so tracking is off by default on any freshly started server.
 */
let trackingIndexVerified = false;
let trackingIndexCheckedAt = 0;

/**
 * Validates the fix and classifies inside/outside using the existing policy.
 *
 * TWO age rules are applied, in order, and they are deliberately different:
 *
 *  1. The GENERAL location-age limit (LOCATION_POLICY.maxAgeSeconds, 120 s), which
 *     is the same limit the one-shot scan enforces.
 *  2. The TRACKING freshness limit (effectiveTrackingMaxAgeSeconds(), 30 s), which
 *     is stricter and applies only while someone is being continuously tracked.
 *
 * The second one is not redundant with the first. Under the 120 s general limit a
 * 31/60/119-second-old fix is still "acceptable", yet resending that same fix
 * every 10 s satisfies the 30 s crediting-spacing rule on every call - so without
 * the tracking limit a browser replaying one cached position could accumulate a
 * full attendance without ever standing at the venue. They are kept separate so
 * the general setting can still be relaxed for the one-shot scan (where a delayed
 * request is legitimate) without silently loosening continuous tracking.
 */
export function classifyObservation(event, submitted, now = new Date()) {
  const fence = geofenceFor(event);
  if (!fence) throw new ValidationError({ location: 'This event has no verified venue location configured, so attendance time cannot be counted. Ask an administrator to set the venue coordinates and radius.' });
  const latitude = submitted?.latitude;
  const longitude = submitted?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new ValidationError({ location: 'Your device did not report a usable location.' });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new ValidationError({ location: 'Your device reported an invalid location.' });
  }
  const accuracy = typeof submitted?.accuracy === 'number' && Number.isFinite(submitted.accuracy) ? submitted.accuracy : null;
  if (accuracy !== null && accuracy > LOCATION_POLICY.maxAccuracyMeters) {
    throw new ValidationError({ location: `Your location is not precise enough (±${Math.round(accuracy)} m, needs ±${LOCATION_POLICY.maxAccuracyMeters} m or better). Move away from buildings and try again.` });
  }
  const capturedAt = submitted?.capturedAt;
  const capturedMs = typeof capturedAt === 'string' || typeof capturedAt === 'number' ? new Date(capturedAt).getTime() : NaN;
  if (Number.isNaN(capturedMs)) throw new ValidationError({ location: 'The location reading was not timestamped.' });
  const ageSeconds = Math.abs((now.getTime() - capturedMs) / 1000);
  // Rule 1: the GENERAL location-age limit, shared with the one-shot scan.
  if (ageSeconds > LOCATION_POLICY.maxAgeSeconds) {
    throw new ValidationError({ location: 'That location reading is too old. Allow the app to take a fresh reading and try again.' });
  }
  // Rule 2: the stricter TRACKING freshness limit. A fix inside the general
  // 120 s window can still be refused here, which is the whole point: at a
  // 10 s report interval anything older than 30 s is a replayed reading, not a
  // measurement of where the person is now.
  const trackingMaxAge = effectiveTrackingMaxAgeSeconds();
  if (ageSeconds > trackingMaxAge) {
    throw new ValidationError({
      location: `That location reading is ${Math.round(ageSeconds)} seconds old. Attendance tracking needs a reading taken within the last ${trackingMaxAge} seconds, so it cannot be used. Allow the app to take a fresh reading and try again.`,
    });
  }
  const distance = distanceMeters(latitude, longitude, fence.latitude, fence.longitude);
  const limit = fence.radiusMeters + LOCATION_POLICY.slackMeters;
  return {
    latitude,
    longitude,
    accuracy,
    capturedAt: new Date(capturedMs),
    distanceMeters: Math.round(distance * 10) / 10,
    locationState: distance <= limit ? LOCATION_STATE.INSIDE : LOCATION_STATE.OUTSIDE,
  };
}

export function serializeSession(session, event, now = new Date()) {
  const derived = deriveSessionState(session, event, now);
  const required = requiredMinutesFor(event);
  const credited = session.creditedSeconds || 0;
  return {
    id: session._id,
    eventId: session.eventId,
    eventName: event.name,
    state: derived.state,
    locationState: session.locationState,
    // The server-held value. The browser may animate an estimate; only this counts.
    creditedSeconds: credited,
    creditedMinutes: Math.floor(credited / 60),
    creditedSecondsRemainder: credited % 60,
    requiredMinutes: required,
    remainingSeconds: remainingSeconds(session, required),
    durationOutcome: durationOutcome(session, required),
    // Arrival is independent and is never rewritten by duration.
    arrival: session.arrival,
    pauseReason: derived.reason,
    derivedState: derived.derived,
    startedAt: new Date(session.startedAt).toISOString(),
    checkedOutAt: session.checkedOutAt ? new Date(session.checkedOutAt).toISOString() : null,
    endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
    lastVerifiedAt: session.lastReceivedAt ? new Date(session.lastReceivedAt).toISOString() : null,
    lastDistanceMeters: session.lastDistanceMeters ?? null,
    lastAccuracyMeters: session.lastAccuracyMeters ?? null,
    eventStartsAt: new Date(event.startsAt).toISOString(),
    eventEndsAt: new Date(event.endsAt).toISOString(),
    lastLatitude: session.lastLatitude ?? null,
    lastLongitude: session.lastLongitude ?? null,
  };
}
async function assertTrackableEvent(user, event) {
  if (!['student', 'faculty'].includes(user.profile.role)) throw new PermissionError('This action is not available for your role.');
  if (!eventAllows(event, user.profile)) throw new PermissionError('You are not allowed to attend this event.');
  if (event.registrationRequired && user.profile.role === 'student') {
    const registration = await EventRegistration.findOne({ eventId: event._id, attendeeId: user._id, status: 'registered' }).lean();
    if (!registration) throw new ValidationError({ registration: 'Register for this event before checking in.' });
  }
}

/**
 * GST008: mirrors the tracking session onto the attendee's attendance record.
 *
 * THE SERVER IS THE ONLY AUTHORITY. Every value written here is copied from the
 * session the server already owns (`creditedSeconds`, `arrival`, `locationState`,
 * `lastReceivedAt`) or derived from the event's configured requirement. Verified
 * time is NEVER recomputed from elapsed wall-clock time, a browser counter, or how
 * long a page has been open.
 *
 * THINGS IT DELIBERATELY DOES NOT DO:
 *
 *  - It does not touch a record whose event requires no duration. `qualification`
 *    stays null there, so every established non-tracking behaviour and report is
 *    untouched.
 *  - It does not overwrite a MANUAL OVERRIDE. An administrator's explicit
 *    decision outranks the automatic rule, and stays visible afterwards.
 *  - It does not rewrite `status`. Check-in and qualification are separate: the
 *    recorded check-in must survive a later disqualification.
 *  - It never promotes a LATE arrival to `present`. Meeting the duration
 *    qualifies the attendance; it does not un-arrive the person.
 *
 * @param {object} session the (possibly re-read) tracking session
 * @param {object} event
 * @param {Date} now
 * @param {{ ended?: boolean }} options `ended` finalizes an insufficient record
 */
async function syncAttendanceQualification(session, event, now, { ended = false } = {}) {
  const required = requiredMinutesFor(event);
  if (!required) return; // no duration requirement: nothing about this event changes.

  const credited = session.creditedSeconds || 0;
  const met = credited >= required * 60;

  // Qualification preserves lateness. A person who arrived after the cut-off is
  // qualified as 'late', never silently promoted to 'present'.
  const qualified = session.arrival === 'late' ? 'late' : 'present';

  const update = {
    $set: {
      verifiedSeconds: credited,
      requiredAttendanceMinutes: required,
      locationState: session.locationState ?? null,
      lastLocationAt: session.lastReceivedAt ? new Date(session.lastReceivedAt) : null,
    },
  };

  if (ended) {
    // The event is over. Enough time or not, the record stops being pending.
    // A session the student never came back to is finalized the same way, because
    // this runs from the server's own finalization rather than from a heartbeat.
    update.$set.qualification = met ? qualified : 'absent';
    update.$set.qualificationReason = met ? null : QUALIFICATION_REASONS.DURATION_NOT_MET;
    update.$set.trackingState = 'ended';
  } else {
    update.$set.qualification = met ? qualified : 'pending';
    update.$set.qualificationReason = met ? null : QUALIFICATION_REASONS.DURATION_IN_PROGRESS;
    update.$set.trackingState = session.state === SESSION_STATE.COMPLETED
      ? 'ended'
      : (session.state === SESSION_STATE.PAUSED ? 'paused' : 'tracking');
  }

  // `manualOverride: false` in the FILTER, not the update: it is the guard. An
  // administrator's decision is never overwritten by this automatic rule.
  await EventAttendance.updateOne(
    { eventId: event._id, attendeeId: session.userId, manualOverride: { $ne: true } },
    update,
  );
}

/**
 * GST008: an EXPLICIT checkout finalizes the attendance record.
 *
 * APPROVED POLICY. An explicit checkout before the required duration was served
 * finalizes the attendance as ABSENT, with the reason
 * "Checked out before required attendance duration was met."
 *
 * This was deliberately left undecided earlier: leaving early and never arriving
 * are different facts, and inventing an absence would assert something nobody
 * established. That ambiguity is now resolved by policy, so the checkout branch
 * resolves the record exactly as the event-end branch does, and a person who
 * chose to leave without serving the required time is not counted as attended.
 *
 * WHAT IT STILL DOES NOT DO:
 *
 *  - It is NOT logout, closing the browser, or losing location. None of those
 *    reach this function. They already stop crediting by silence alone, and they
 *    leave the record PENDING until the event ends, because the attendee may
 *    still come back. Only the explicit "Check out" button, and event end,
 *    finalize.
 *  - It does NOT erase the check-in. `status` and `recordedAt` are untouched, so
 *    the record of the person having arrived survives an absence.
 *  - It does NOT reset credited time. `verifiedSeconds` is copied from the
 *    session's own total, so however long they actually stayed is still shown.
 *  - It does NOT rewrite a MANUAL OVERRIDE - the filter below skips those rows,
 *    so an administrator's decision always outranks this rule.
 *
 * @param {object} session the session just closed
 * @param {object} event
 * @param {Date} now
 */
async function syncCheckoutQualification(session, event, now) {
  const required = requiredMinutesFor(event);
  if (!required) return; // no duration requirement: established behaviour only.
  const met = (session.creditedSeconds || 0) >= required * 60;
  await EventAttendance.updateOne(
    { eventId: event._id, attendeeId: session.userId, manualOverride: { $ne: true } },
    {
      $set: {
        // Credited time is PRESERVED, never reset by leaving.
        verifiedSeconds: session.creditedSeconds || 0,
        requiredAttendanceMinutes: required,
        locationState: session.locationState ?? null,
        lastLocationAt: session.lastReceivedAt ? new Date(session.lastReceivedAt) : null,
        trackingState: 'ended',
        ...(met
          ? {
            // Meeting the requirement first means later leaving cannot demote it.
            qualification: session.arrival === 'late' ? 'late' : 'present',
            qualificationReason: null,
          }
          : {
            qualification: 'absent',
            qualificationReason: QUALIFICATION_REASONS.CHECKOUT_BEFORE_DURATION_MET,
          }),
      },
    },
  );
}

/** Mirrors the session into the existing EventAttendance row so reports still work. */
async function writeAttendanceRow(user, event, now, observation) {
  try {
    await EventAttendance.create({
      _id: await nextNumericId('eventAttendance'),
      eventId: event._id,
      attendeeId: user._id,
      status: now > event.lateCutoff ? 'late' : 'present',
      method: event.attendanceMethod,
      recordedAt: now,
      source: 'Scan',
      locationLatitude: observation.latitude,
      locationLongitude: observation.longitude,
      locationAccuracyMeters: observation.accuracy,
      locationCapturedAt: observation.capturedAt,
      locationDistanceMeters: observation.distanceMeters,
    });
  } catch (error) {
    if (error.code !== 11000) throw error; // a concurrent scan already wrote it
  }
}

/**
 * GST006 rollout gate.
 *
 * Correctness of the single-session rule rests on the UNIQUE INDEX, not on a
 * find-then-create check in this file: two tabs can both pass such a check, so it
 * is only ever an optimisation for the happy path. The atomic guarantee comes
 * from `unique_user_event_session`, which the application must NOT create
 * implicitly (see INDEX_CREATION_EXCLUDED_MODELS).
 *
 * Until that index is created by the approved rollout step, tracking is refused
 * outright rather than run with a weaker guarantee. This is what keeps the
 * existing, working one-shot attendance scan usable while tracking is disabled.
 */
export async function isTrackingIndexReady() {
  try {
    const indexes = await AttendanceSession.collection.indexes();
    return indexes.some((index) => index.name === 'unique_user_event_session' && index.unique === true);
  } catch {
    return false;
  }
}

async function assertTrackingEnabledAsync() {
  if (trackingIndexVerified && trackingIndexCheckedAt && Date.now() - trackingIndexCheckedAt < 60_000) return;
  if (!(await isTrackingIndexReady())) {
    const error = new Error('Attendance tracking is not enabled on this server yet. Ask an administrator to complete the attendance-tracking rollout.');
    error.status = 503;
    error.code = 'attendance_tracking_disabled';
    throw error;
  }
  trackingIndexVerified = true;
  trackingIndexCheckedAt = Date.now();
}

/** Test seam: lets the suite declare the index present without a live rollout. */
export function __setTrackingIndexVerified(value) {
  trackingIndexVerified = Boolean(value);
  trackingIndexCheckedAt = Date.now();
}

export async function startTrackingSession(user, body, now = new Date()) {
  await assertTrackingEnabledAsync();
  const event = await resolveScannedEvent(body?.token, body?.eventId, user);
  // Tracking inherits the QR credential rule: a live session credits attendance
  // time, so it must be exactly as hard to start as the one-shot scan that it
  // mirrors. Keyed on the event's own method, so it cannot be dodged by asking
  // for a different one.
  if (event.attendanceMethod === 'qr' && !body?.token) {
    throw new ValidationError(
      { scan: 'This event checks in with a QR code. Scan the event code, or paste it into the manual box.' },
      'A valid event QR code is required for this event.',
    );
  }
  if (event.attendanceMethod !== (body?.method || 'qr')) {
    throw new ValidationError({ method: 'This scan method is not enabled for the event.' });
  }
  await assertTrackableEvent(user, event);

  const required = requiredMinutesFor(event);
  if (!required) {
    throw new ValidationError({ event: 'Attendance tracking needs configuration. Ask an administrator to set the required attendance duration for this event.' });
  }
  const windowMinutes = Math.floor((event.endsAt.getTime() - event.checkInOpensAt.getTime()) / 60_000);
  if (required > windowMinutes) {
    throw new ValidationError({ event: `The required duration (${required} min) is longer than this event's check-in window (${windowMinutes} min).` });
  }
  if (now < event.checkInOpensAt || now > event.checkInClosesAt) {
    throw new ValidationError({ scan: 'The event check-in window is closed.' });
  }

  const observation = classifyObservation(event, body?.location, now);
  if (observation.locationState !== LOCATION_STATE.INSIDE) {
    throw new ValidationError({ location: 'You are outside the event check-in zone. Move within the venue area and scan again.' });
  }

  const existing = await AttendanceSession.findOne({ userId: user._id, eventId: event._id }).lean();
  if (existing) {
    const derived = deriveSessionState(existing, event, now);
    if (derived.state === SESSION_STATE.COMPLETED) {
      throw new ConflictError('Your attendance session for this event has already finished and cannot be restarted.');
    }
    // Re-scanning resumes the SAME session rather than starting a second one.
    return serializeSession(existing, event, now);
  }

  try {
    const created = await AttendanceSession.create({
      userId: user._id,
      eventId: event._id,
      state: SESSION_STATE.TRACKING,
      locationState: LOCATION_STATE.INSIDE,
      startedAt: now,
      lastObservedAt: observation.capturedAt,
      lastReceivedAt: now,
      lastLatitude: observation.latitude,
      lastLongitude: observation.longitude,
      lastAccuracyMeters: observation.accuracy,
      lastDistanceMeters: observation.distanceMeters,
      creditedSeconds: 0,
      requiredMinutes: required,
      // Arrival is fixed once, here, and never changed afterwards.
      arrival: now > event.lateCutoff ? 'late' : 'on_time',
    });
    await writeAttendanceRow(user, event, now, observation);
    return serializeSession(created, event, now);
  } catch (error) {
    if (error.code === 11000) {
      const winner = await AttendanceSession.findOne({ userId: user._id, eventId: event._id }).lean();
      if (winner) return serializeSession(winner, event, now);
    }
    throw error;
  }
}
export async function updateTrackingSession(user, sessionId, body, now = new Date()) {
  const session = await AttendanceSession.findById(String(sessionId)).lean();
  if (!session) throw new NotFoundError('Attendance session not found.');
  // Ownership: only the owner may update. A user id in the body is never used.
  if (String(session.userId) !== String(user._id)) throw new PermissionError('You can only update your own attendance session.');

  const event = await Event.findById(session.eventId).lean();
  if (!event) throw new NotFoundError('Event not found.');

  // Checked-out is tested BEFORE the derived state, so the client is told plainly
  // to stop reporting rather than quietly receiving a finished session.
  if (session.checkedOut) throw new ConflictError('You have already checked out of this event.');
  const derived = deriveSessionState(session, event, now);
  if (derived.state === SESSION_STATE.COMPLETED) return finalizeSession(session, event, now, derived.reason);

  const observation = classifyObservation(event, body?.location, now);

  // Duplicate and out-of-order deliveries handled BEFORE any crediting.
  if (session.lastObservedAt) {
    const lastMs = new Date(session.lastObservedAt).getTime();
    const incomingMs = observation.capturedAt.getTime();
    if (incomingMs === lastMs) return serializeSession(session, event, now); // idempotent replay
    if (incomingMs < lastMs) throw new ConflictError('An older location update arrived out of order and was ignored.');
  }

  // Credit only an interval bounded by two consecutive INSIDE observations no
  // more than MAX_CREDIT_GAP_SECONDS apart.
  const previousMs = session.lastReceivedAt ? new Date(session.lastReceivedAt).getTime() : null;
  let creditedDelta = 0;
  if (observation.locationState === LOCATION_STATE.INSIDE && session.locationState === LOCATION_STATE.INSIDE && previousMs !== null) {
    const gapMs = now.getTime() - previousMs;
    if (gapMs > 0 && gapMs <= MAX_CREDIT_GAP_SECONDS * 1000) {
      // Clamped to the event window; nothing outside it is ever credited.
      const from = Math.max(previousMs, event.checkInOpensAt.getTime());
      const to = Math.min(now.getTime(), event.endsAt.getTime());
      if (to > from) creditedDelta = Math.round((to - from) / 1000);
    }
  }

  const update = {
    $set: {
      locationState: observation.locationState,
      state: observation.locationState === LOCATION_STATE.OUTSIDE ? SESSION_STATE.PAUSED : SESSION_STATE.TRACKING,
      pauseReason: observation.locationState === LOCATION_STATE.OUTSIDE ? PAUSE_REASON.OUTSIDE : null,
      lastObservedAt: observation.capturedAt,
      lastReceivedAt: now,
      lastLatitude: observation.latitude,
      lastLongitude: observation.longitude,
      lastAccuracyMeters: observation.accuracy,
      lastDistanceMeters: observation.distanceMeters,
    },
  };
  if (creditedDelta > 0) update.$inc = { creditedSeconds: creditedDelta };

  // Optimistic guard on the previous observation time: only the writer that
  // still sees the expected value wins, so two tabs cannot both credit.
  const updated = await AttendanceSession.findOneAndUpdate(
    { _id: session._id, userId: user._id, checkedOut: false, lastObservedAt: session.lastObservedAt ?? null },
    update,
    { new: true },
  ).lean();

  if (!updated) {
    const current = await AttendanceSession.findById(session._id).lean();
    return serializeSession(current, event, now);
  }

  // The required duration is a THRESHOLD, not a cap. Crediting deliberately
  // CONTINUES after it is met, so the record shows how long someone actually
  // stayed. `durationMetAt` is a one-time latch that only drives the UI wording;
  // it must never pause or stop accumulation, and it never rewrites `arrival`.
  const required = requiredMinutesFor(event);
  if (required && updated.creditedSeconds >= required * 60 && !updated.durationMetAt) {
    await AttendanceSession.updateOne({ _id: updated._id, durationMetAt: null }, { $set: { durationMetAt: now } });
    const reread = await AttendanceSession.findById(updated._id).lean();
    // GST008: the threshold has been reached, so the attendance QUALIFIES now.
    // Sync after the latch so the mirrored row sees the credited total.
    await syncAttendanceQualification(reread, event, now);
    return serializeSession(reread, event, now);
  }
  // GST008: keep the attendance row in step with the session on EVERY accepted
  // observation, not only when the threshold is crossed, so the admin table shows
  // live progress rather than a value frozen at check-in.
  await syncAttendanceQualification(updated, event, now);
  return serializeSession(updated, event, now);
}

async function finalizeSession(session, event, now, reason) {
  await AttendanceSession.updateOne(
    { _id: session._id, state: { $ne: SESSION_STATE.COMPLETED } },
    { $set: { state: SESSION_STATE.COMPLETED, endedAt: now, completionReason: reason, pauseReason: null } },
  );
  const closed = await AttendanceSession.findById(session._id).lean();
  // GST008: event-end / checkout finalization resolves the attendance record even
  // though the student is never heard from again. This runs on the SERVER's own
  // finalization path, so it does not depend on a final heartbeat arriving.
  await syncAttendanceQualification(closed, event, now, { ended: true });
  return serializeSession(closed, event, now);
}

export async function checkoutTrackingSession(user, sessionId, now = new Date()) {
  const session = await AttendanceSession.findById(String(sessionId)).lean();
  if (!session) throw new NotFoundError('Attendance session not found.');
  if (String(session.userId) !== String(user._id)) throw new PermissionError('You can only update your own attendance session.');
  const event = await Event.findById(session.eventId).lean();
  if (!event) throw new NotFoundError('Event not found.');
  if (session.checkedOut) return serializeSession(session, event, now);
  const updated = await AttendanceSession.findOneAndUpdate(
    { _id: session._id, userId: user._id, checkedOut: false },
    { $set: { checkedOut: true, checkedOutAt: now, state: SESSION_STATE.COMPLETED, endedAt: now, completionReason: PAUSE_REASON.CHECKED_OUT, pauseReason: null } },
    { new: true },
  ).lean();
  // GST008: an EXPLICIT checkout is preserved exactly as it was - still final,
  // still terminal, never restarted. It refreshes the mirrored snapshot so the
  // admin table stops showing live progress, and it does NOT fabricate an
  // absence: an early departure leaves the record unqualified for the admin to
  // judge, because leaving early and never arriving are different facts. Only
  // EVENT END finalizes an insufficient record as absent.
  await syncCheckoutQualification(updated, event, now);
  return serializeSession(updated, event, now);
}

export async function getTrackingSession(user, eventId, now = new Date()) {
  const session = await AttendanceSession.findOne({ userId: user._id, eventId: String(eventId) }).lean();
  if (!session) return null;
  const event = await Event.findById(eventId).lean();
  if (!event) throw new NotFoundError('Event not found.');
  // A stale session reads as paused even if the browser never reports again.
  const derived = deriveSessionState(session, event, now);
  if (derived.derived && derived.state === SESSION_STATE.COMPLETED && session.state !== SESSION_STATE.COMPLETED) {
    return finalizeSession(session, event, now, derived.reason);
  }
  return serializeSession(session, event, now);
}

/**
 * Server-side sweep: a closed browser can never leave a session crediting.
 *
 * GST008: this now routes through `finalizeSession` instead of updating the
 * session state inline. That matters because finalizing the SESSION is not the
 * whole job: the attendee's attendance record must also be resolved, or a
 * duration-required record would sit at `pending` for ever once the student
 * stopped reporting. The event is over, the opportunity is gone, and nobody is
 * coming back - so an insufficient record becomes `absent` with its reason.
 *
 * IT IS STILL THE SAME EXISTING MECHANISM, NOT A SECOND ONE. The decision of
 * "this session has ended" is unchanged (`now >= event.endsAt`), the guarded
 * update is unchanged, and `finalizeSession` is the same function a student's
 * own late heartbeat would reach. Going through it only adds the attendance
 * resolution that was previously missing, so a session's fate is identical
 * whichever route notices first.
 *
 * A merely PAUSED or silent session is untouched: someone who stepped outside
 * the zone or closed the tab may still come back, and must not be marked absent
 * for it. Only a genuinely ended event finalizes.
 *
 * Safe to run repeatedly - the update is guarded on the session not already
 * completed, and the attendance sync skips manual overrides.
 */
export async function finalizeExpiredSessions(now = new Date()) {
  const open = await AttendanceSession.find({ state: { $ne: SESSION_STATE.COMPLETED } }).lean();
  const finished = [];
  for (const session of open) {
    const event = await Event.findById(session.eventId).lean();
    if (!event || now >= event.endsAt) {
      // `finalizeSession` sets the state AND syncs the attendance record. The
      // guard inside it means a session someone else already closed is skipped.
      if (event) {
        await finalizeSession(session, event, now, PAUSE_REASON.EVENT_ENDED);
      } else {
        await AttendanceSession.updateOne(
          { _id: session._id, state: { $ne: SESSION_STATE.COMPLETED } },
          { $set: { state: SESSION_STATE.COMPLETED, endedAt: now, completionReason: PAUSE_REASON.EVENT_ENDED, pauseReason: null } },
        );
      }
      finished.push(session._id);
    }
  }
  return finished;
}

/** GST007 monitoring. Faculty stay limited to their assigned/supervised events. */
export async function monitoredSessions(user, eventId, now = new Date()) {
  await finalizeExpiredSessions(now);
  const event = await Event.findById(eventId).lean();
  if (!event) throw new NotFoundError('Event not found.');
  if (user.profile.role !== 'admin') {
    const assigned = String(event.organizerId) === String(user._id)
      || (event.supervisors || []).some((id) => String(id) === String(user._id));
    if (!assigned) throw new PermissionError('You are not assigned to this event.');
  }
  const sessions = await AttendanceSession.find({ eventId: event._id }).lean();
  const profiles = await UserProfile.find({ userId: { $in: sessions.map((s) => s.userId) } }).lean();
  const byUser = new Map(profiles.map((p) => [String(p.userId), p]));
  return sessions.map((session) => ({
    ...serializeSession(session, event, now),
    name: byUser.get(String(session.userId))?.displayName || 'Unknown user',
    role: byUser.get(String(session.userId))?.role || 'student',
  }));
}
