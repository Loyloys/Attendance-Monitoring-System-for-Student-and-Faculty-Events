import { approvalStatusOf } from '../middleware/authentication.js';

/**
 * Serializes one account for the administrator User Management screen.
 *
 * `eventRegistrationCount` is deliberately separate from everything else here.
 * Having an account, and being signed in, says nothing about whether this person
 * registered for an event; the two are counted independently so the screen can
 * state "Account created - no event registrations" honestly.
 *
 * `attendanceCount` is kept separate again: registering for an event is not
 * attendance, so one never implies the other.
 */
export function serializeAdminUser(user, { eventRegistrationCount = 0, attendanceCount = 0 } = {}) {
  const approval = approvalStatusOf(user);
  return {
    id: user.accountId,
    username: user.username,
    name: user.profile.displayName,
    email: user.email || '',
    contact: user.profile.phone || user.email || '',
    role: { student: 'Student', faculty: 'Faculty', admin: 'Admin' }[user.profile.role],
    department: user.profile.department || '',
    status: user.isActive ? 'Active' : 'Inactive',
    // Only `rejected` (and any historical `pending`) is ever blocked now;
    // registration activates a new Student account immediately.
    approvalStatus: approval,
    signedUpViaGoogle: Boolean(user.googleSub),
    createdAt: new Date(user.dateJoined).toISOString(),
    eventRegistrationCount,
    attendanceCount,
    legacyId: user.legacyId ? String(user.legacyId) : undefined,
  };
}

export function serializeAdminAttendance(record, user, event) {
  // GST008: qualification is exposed SEPARATELY from `status`, so the table can
  // show both without the check-in ever being mistaken for the verdict.
  // `qualification: null` means the event asks for no verified duration, and is
  // deliberately distinct from 'pending'.
  const label = (value) => (value ? value[0].toUpperCase() + value.slice(1) : undefined);
  return {
    id: String(record._id),
    eventId: record.eventId,
    personId: user.accountId,
    name: user.profile.displayName,
    role: user.profile.role === 'faculty' ? 'Faculty' : 'Student',
    department: user.profile.department || '',
    status: record.status[0].toUpperCase() + record.status.slice(1),
    scannedAt: new Date(record.recordedAt).toISOString(),
    source: record.source || 'Scan',
    note: record.note || undefined,
    correctedAt: record.correctedAt ? new Date(record.correctedAt).toISOString() : undefined,
    eventDate: event ? new Date(event.startsAt).toISOString().slice(0, 10) : undefined,

    // --- Duration-based qualification --------------------------------------
    qualification: label(record.qualification),
    qualificationReason: record.qualificationReason || undefined,
    // Server-owned, mirrored from the tracking session. The UI shows this; it
    // never recomputes it from elapsed time.
    verifiedSeconds: typeof record.verifiedSeconds === 'number' ? record.verifiedSeconds : undefined,
    requiredAttendanceMinutes: record.requiredAttendanceMinutes ?? undefined,
    locationState: record.locationState || undefined,
    lastLocationAt: record.lastLocationAt ? new Date(record.lastLocationAt).toISOString() : undefined,
    trackingState: record.trackingState || undefined,
    // Lets the UI show that a human, not the rule, decided this row.
    manualOverride: record.manualOverride === true,
  };
}

/**
 * Serializes one per-event feedback response for the administrator
 * "Feedback & evaluations" screen.
 *
 * WHY THIS EXISTS. A student's "Event feedback" screen posts to
 * `POST /api/events/:id/feedback/`, which writes an `EventFeedback` row. That
 * collection was previously reachable from NO administrator route, so feedback
 * was stored correctly and then invisible - the screen showed an empty
 * "compiled results" panel and the response looked lost.
 *
 * IDENTITY. This is ATTRIBUTED feedback, not anonymous, and deliberately uses
 * exactly the identity surface `serializeEvaluationResponse` already publishes
 * for an evaluation response: the public `accountId`, the profile display name
 * and the role. Nothing new is disclosed - the same three facts are already on
 * the administrator's User Management and Attendance screens, and the same
 * person is already named on the evaluation-response panel beside this one.
 * No anonymity is promised anywhere in the product (the domain rules define
 * feedback as a User-Event-Feedback relationship and the student form promises
 * only that the organizer will read it), so nothing is withheld here either.
 * The internal Mongo `_id` of the person is never published, exactly as in the
 * evaluation-response serializer.
 */
export function serializeEventFeedback(record, user) {
  return {
    id: String(record._id),
    eventId: record.eventId,
    attendeeId: user.accountId,
    attendeeName: user.profile.displayName,
    role: user.profile.role === 'faculty' ? 'Faculty' : 'Student',
    rating: record.rating,
    comments: record.comments || '',
    submittedAt: new Date(record.submittedAt).toISOString(),
  };
}
