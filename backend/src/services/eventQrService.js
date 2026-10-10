/**
 * GST006/event QR credential lifecycle.
 *
 * Rules implemented here:
 *  - An ADMIN may manage the QR for any event; FACULTY only for an event they
 *    organize or supervise.
 *  - Issuance is allowed BEFORE the attendance window opens, but a scan is still
 *    refused outside it (that check lives in recordEventAttendance).
 *  - Issuance and retrieval are IDEMPOTENT: asking twice returns the SAME token.
 *    Viewing or exporting never rotates it.
 *  - Rotation is an explicit, separately authorized action.
 *  - Expiry covers the whole event window, so a future event's code cannot
 *    expire before the event it belongs to.
 */
import { AttendanceCode, Event } from '../models/index.js';
import { AppError, PermissionError, ValidationError } from '../utils/errors.js';
import { QR_PREFIX } from '../utils/domain.js';
import { decryptSecret, encryptSecret, isSecretStorageConfigured } from '../utils/secretBox.js';
import { randomToken, sha256 } from '../utils/identifiers.js';
import { nextNumericId } from '../utils/ids.js';

/** Admin manages any event; Faculty only their own assigned events. */
export function assertCanManageQr(event, user) {
  if (user.profile.role === 'admin') return;
  const assigned = String(event.organizerId) === String(user._id)
    || (event.supervisors || []).some((id) => String(id) === String(user._id));
  if (!assigned) {
    throw new PermissionError('Only an administrator or the assigned faculty can manage this event code.');
  }
}

/**
 * Rollout gate for the QR credential indexes.
 *
 * `unique_active_code_per_event` is what makes concurrent issuance converge on a
 * single credential: without it, two simultaneous requests can both pass the
 * "is there an active code?" check and mint two codes that attendees might scan.
 * The service-level check below narrows that window but cannot close it, so the
 * INDEX is the actual guarantee.
 *
 * Because the model is excluded from routine index creation (see
 * INDEX_CREATION_EXCLUDED_MODELS), a normal start will not create it on the live
 * database. Until an operator runs the approved rollout, issuing or rotating a
 * code is refused outright rather than run with a weaker guarantee. Scanning is
 * unaffected: it verifies a credential by hash lookup, which needs no index.
 */
let qrIndexVerified = false;
let qrIndexCheckedAt = 0;

/** True when the unique single-active-code index really exists. */
export async function isQrIndexReady() {
  try {
    const indexes = await AttendanceCode.collection.indexes();
    return indexes.some((index) => index.name === 'unique_active_code_per_event' && index.unique === true);
  } catch {
    return false;
  }
}

async function assertQrIndexReady() {
  if (qrIndexVerified && Date.now() - qrIndexCheckedAt < 60_000) return;
  if (!(await isQrIndexReady())) {
    // An AppError with `details`, not a bare Error: the error handler masks the
    // message of any unrecognised 5xx so internal detail never leaks, and this
    // message is written FOR the operator, so it has to survive that masking.
    // The 503 is still correct - the feature is unavailable, not broken.
    throw new AppError(
      503,
      'Event QR codes are not enabled on this server yet.',
      { event: 'Ask an administrator to complete the event-code rollout (npm run rollout:attendance-indexes).' },
      'event_qr_index_missing',
    );
  }
  qrIndexVerified = true;
  qrIndexCheckedAt = Date.now();
}

/** Test seam: lets the suite declare the index present without a live rollout. */
export function __setQrIndexVerified(value) {
  qrIndexVerified = Boolean(value);
  qrIndexCheckedAt = Date.now();
}

function assertQrEvent(event) {
  if (event.attendanceMethod !== 'qr') {
    throw new ValidationError({ event: 'This event does not use QR check-in.' });
  }
  if (event.status === 'cancelled') {
    throw new ValidationError({ event: 'A cancelled event cannot have an active attendance code.' });
  }
}

/**
 * Expiry is the end of the check-in window, not "one hour from now". A QR for an
 * event next month therefore stays usable for the whole of its own window and
 * cannot silently expire before the event happens.
 */
function expiryFor(event, now) {
  return new Date(Math.max(event.checkInClosesAt.getTime(), now.getTime() + 60 * 60 * 1_000));
}

function usabilityOf(event, record, now) {
  if (record.active === false) return 'revoked';
  if (new Date(record.expiresAt) <= now) return 'expired';
  if (event.status !== 'published') return 'not_published';
  if (now < event.checkInOpensAt) return 'not_yet_open';
  if (now > event.checkInClosesAt) return 'window_closed';
  return 'usable_now';
}

function describe(event, record, token, now) {
  return {
    token: `${QR_PREFIX}:${event._id}:${token}`,
    eventId: event._id,
    issuedAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    checkInOpensAt: new Date(event.checkInOpensAt).toISOString(),
    checkInClosesAt: new Date(event.checkInClosesAt).toISOString(),
    usability: usabilityOf(event, record, now),
  };
}

async function insertCode(event, actor, token, now) {
  return AttendanceCode.create({
    _id: await nextNumericId('attendanceCode'),
    eventId: event._id,
    createdById: actor._id,
    tokenHash: sha256(token),
    tokenEncrypted: encryptSecret(token),
    expiresAt: expiryFor(event, now),
    active: true,
    createdAt: now,
  });
}

/**
 * Returns the CURRENT credential, issuing one only if none exists.
 * Idempotent: calling this twice returns the identical token.
 */
export async function getOrIssueEventQr(event, actor, now = new Date()) {
  assertCanManageQr(event, actor);
  assertQrEvent(event);
  if (!isSecretStorageConfigured()) {
    throw new ValidationError({ event: 'Event code storage is not configured on this server.' });
  }
  await assertQrIndexReady();

  const existing = await AttendanceCode.findOne({ eventId: event._id, active: true }).lean();
  if (existing) {
    return { ...describe(event, existing, decryptSecret(existing.tokenEncrypted), now), created: false };
  }

  const token = randomToken();
  try {
    const record = await insertCode(event, actor, token, now);
    return { ...describe(event, record.toObject(), token, now), created: true };
  } catch (error) {
    // Lost a concurrent issuance race: the winner's code is the one to show.
    if (error.code === 11000) {
      const winner = await AttendanceCode.findOne({ eventId: event._id, active: true }).lean();
      if (winner) return { ...describe(event, winner, decryptSecret(winner.tokenEncrypted), now), created: false };
    }
    throw error;
  }
}

/** Explicit rotation. The previous credential stops working immediately. */
export async function rotateEventQr(event, actor, now = new Date()) {
  assertCanManageQr(event, actor);
  assertQrEvent(event);
  if (!isSecretStorageConfigured()) {
    throw new ValidationError({ event: 'Event code storage is not configured on this server.' });
  }
  await assertQrIndexReady();
  await AttendanceCode.updateMany({ eventId: event._id, active: true }, { $set: { active: false } });
  const token = randomToken();
  const record = await insertCode(event, actor, token, now);
  return { ...describe(event, record.toObject(), token, now), created: true, rotated: true };
}

/**
 * Used when creating an event. A failure here must NOT fail the event save, so
 * the caller receives the reason and can offer a retry instead.
 */
export async function autoIssueQrForNewEvent(event, actor, now = new Date()) {
  try {
    return { ok: true, qr: await getOrIssueEventQr(event, actor, now) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'The event code could not be issued.' };
  }
}

/** Monitoring/status view. Never exposes the token. */
export async function eventQrStatus(event, now = new Date()) {
  const record = await AttendanceCode.findOne({ eventId: event._id, active: true }).lean();
  if (!record) return { issued: false, usability: 'not_issued', eventId: event._id };
  return {
    issued: true,
    eventId: event._id,
    usability: usabilityOf(event, record, now),
    issuedAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    checkInOpensAt: new Date(event.checkInOpensAt).toISOString(),
    checkInClosesAt: new Date(event.checkInClosesAt).toISOString(),
  };
}