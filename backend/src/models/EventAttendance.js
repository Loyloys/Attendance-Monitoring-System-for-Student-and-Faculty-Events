import mongoose from 'mongoose';
import {
  ATTENDANCE_METHODS,
  ATTENDANCE_QUALIFICATIONS,
  ATTENDANCE_STATUSES,
} from '../utils/domain.js';

const eventAttendanceSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  eventId: { type: String, ref: 'Event', required: true, index: true },
  attendeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ATTENDANCE_STATUSES, required: true },
  method: { type: String, enum: ATTENDANCE_METHODS, required: true },
  recordedAt: { type: Date, required: true, default: Date.now },
  // Location captured at the moment of this specific scan (GST004). Stored so an
  // attendance record can be audited later. Additive: existing rows keep their
  // original shape, and a scan with no geofence simply leaves these null.
  locationLatitude: { type: Number, default: null, min: -90, max: 90 },
  locationLongitude: { type: Number, default: null, min: -180, max: 180 },
  locationAccuracyMeters: { type: Number, default: null, min: 0 },
  locationCapturedAt: { type: Date, default: null },
  locationDistanceMeters: { type: Number, default: null, min: 0 },
  note: { type: String, default: '', maxlength: 1000 },
  source: { type: String, enum: ['Scan', 'Manual addition', 'Manual correction'], default: 'Scan' },
  correctedAt: { type: Date, default: null },

  // --- Duration-based qualification (GST008) --------------------------------
  //
  // ALL ADDITIVE, ALL OPTIONAL. An existing document simply has no `qualification`
  // and reads exactly as it did before, which is what keeps established
  // behaviour for every event without a duration requirement.
  //
  // Null means "this event asks for no verified duration", which is deliberately
  // NOT the same as 'pending': a non-tracking event is qualified by its scan, and
  // reporting it as pending would misdescribe it.
  //
  // THE TRACKING SNAPSHOT BELOW IS A COPY, NOT A SECOND COUNTER.
  // `creditedSeconds` on the attendance row mirrors the session the server already
  // owns; it is written only from `AttendanceSession.creditedSeconds`. Nothing
  // derives verified time from elapsed wall-clock time, a browser counter, or how
  // long a page has been open.
  qualification: { type: String, enum: ATTENDANCE_QUALIFICATIONS, default: null },
  qualificationReason: { type: String, default: null },
  /** Required verified minutes for this event; null when none is configured. */
  requiredAttendanceMinutes: { type: Number, default: null, min: 1, max: 600 },
  /** Server-owned verified in-zone seconds, mirrored from the tracking session. */
  verifiedSeconds: { type: Number, default: 0, min: 0 },
  /** inside | outside | null - the most recent location verdict. */
  locationState: { type: String, enum: ['inside', 'outside', null], default: null },
  /** When the server last accepted an observation for this attendee. */
  lastLocationAt: { type: Date, default: null },
  /** tracking | paused | ended - mirrors the session state for the admin table. */
  trackingState: { type: String, enum: ['tracking', 'paused', 'ended', null], default: null },
  /**
   * Set when an administrator qualifies or disqualifies a record by hand.
   *
   * Once true, the automatic finalizer NEVER rewrites the qualification. An
   * explicit human decision outranks an automatic one, and the distinction stays
   * visible afterwards instead of being erased by the next event-end sweep.
   */
  manualOverride: { type: Boolean, default: false },
  manualOverrideAt: { type: Date, default: null },
}, { versionKey: false });

eventAttendanceSchema.index({ eventId: 1, attendeeId: 1 }, { unique: true, name: 'unique_event_attendance' });
eventAttendanceSchema.index({ recordedAt: -1 });

export default mongoose.models.EventAttendance || mongoose.model('EventAttendance', eventAttendanceSchema);
