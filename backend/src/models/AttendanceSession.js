import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * GST006: one attendance-tracking session per (user, event).
 *
 * The server owns the totals: `creditedSeconds` is only ever advanced by the
 * update path in attendanceSessionService, using SERVER receipt timestamps.
 *
 * Only the minimum location evidence needed to justify a credited interval is
 * kept - the last accepted fix and when the server received it. A full movement
 * history is deliberately NOT stored, so there is no detailed trail to leak.
 */
const attendanceSessionSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: () => crypto.randomUUID() },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  eventId: { type: String, ref: 'Event', required: true, index: true },

  /** tracking | paused | completed - derived on read, persisted for reporting. */
  state: { type: String, enum: ['tracking', 'paused', 'completed'], default: 'tracking', required: true },
  /** inside | outside | unknown - where the last acceptable observation put them. */
  locationState: { type: String, enum: ['inside', 'outside', 'unknown'], default: 'unknown', required: true },

  startedAt: { type: Date, required: true, default: Date.now },
  checkedOutAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },

  // Client observation time of the last ACCEPTED update, used to reject
  // duplicate and out-of-order deliveries. Compared before crediting.
  lastObservedAt: { type: Date, default: null },
  // Server receipt time of the last accepted update. Credited intervals are
  // computed from this, never from a clock the browser controls.
  lastReceivedAt: { type: Date, default: null },

  // Minimum location evidence only.
  lastLatitude: { type: Number, default: null },
  lastLongitude: { type: Number, default: null },
  lastAccuracyMeters: { type: Number, default: null },
  lastDistanceMeters: { type: Number, default: null },

  creditedSeconds: { type: Number, default: 0 },
  requiredMinutes: { type: Number, default: null },
  /** on_time | late - the ARRIVAL classification. Never rewritten by duration. */
  arrival: { type: String, enum: ['on_time', 'late'], default: 'on_time' },

  pauseReason: { type: String, default: null },
  completionReason: { type: String, default: null },
  /** True once the user has checked out; a checkout is final, never restarted. */
  checkedOut: { type: Boolean, default: false },
  // Set when the session stops crediting because the required duration was met.
  durationMetAt: { type: Date, default: null },
}, { versionKey: false });

// Single-session policy: the same person cannot hold two live sessions for the
// same event, which is also what stops two tabs from double-crediting.
attendanceSessionSchema.index({ userId: 1, eventId: 1 }, { unique: true, name: 'unique_user_event_session' });
attendanceSessionSchema.index({ eventId: 1, state: 1 });

export default mongoose.models.AttendanceSession || mongoose.model('AttendanceSession', attendanceSessionSchema);