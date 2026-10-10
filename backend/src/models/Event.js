import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { ATTENDANCE_METHODS, EVENT_AUDIENCES, EVENT_STATUSES } from '../utils/domain.js';

const eventSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: () => crypto.randomUUID() },
  name: { type: String, required: true, maxlength: 180 },
  description: { type: String, default: '', maxlength: 70_000 },
  startsAt: { type: Date, required: true, index: true },
  endsAt: { type: Date, required: true },
  venue: { type: String, required: true, maxlength: 180 },
  audience: { type: String, enum: EVENT_AUDIENCES, default: 'all', required: true },
  organizerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  supervisors: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  status: { type: String, enum: EVENT_STATUSES, default: 'published', required: true, index: true },
  // Whether a Student must register BEFORE checking in. This gates the scan and
  // is entirely independent of `requiredForAttendance` below.
  registrationRequired: { type: Boolean, default: false },
  registrationDeadline: { type: Date, default: null },
  // Whether this event counts toward a person's attendance percentage.
  //
  // THIS USED TO HAVE NO FIELD OF ITS OWN. The administrator write contract
  // mapped the "Required for percentage" checkbox straight onto
  // `registrationRequired`, so two unrelated questions shared one stored value
  // and one mislabelled control. An event that merely counted for a percentage
  // therefore also demanded that every Student register first - which is what
  // made an admin-created event refuse check-in with a registration demand the
  // administrator never asked for.
  //
  // It is its own nullable-free boolean now, and deliberately NOT backfilled:
  // see the guarded backfill in scripts/backfill-percentage-flag.js, which
  // copies the value the percentage feature has actually been using so no
  // existing percentage changes when this field starts existing.
  requiredForAttendance: { type: Boolean, default: false },
  checkInOpensAt: { type: Date, required: true },
  checkInClosesAt: { type: Date, required: true },
  lateCutoff: { type: Date, required: true },
  attendanceMethod: { type: String, enum: ATTENDANCE_METHODS, required: true },
  // Optional geofence (GST004). Absent on existing events, so nothing is
  // backfilled and no stored record is rewritten. A scan against an event with
  // no complete geofence is refused with a clear "not configured" message
  // rather than being silently accepted.
  venueLatitude: { type: Number, default: null, min: -90, max: 90 },
  venueLongitude: { type: Number, default: null, min: -180, max: 180 },
  venueRadiusMeters: { type: Number, default: null, min: 1, max: 100_000 },
  // When true the browser must capture a location fix before the QR scan. Kept
  // separate from the geofence fields so an event can opt out explicitly.
  locationVerificationRequired: { type: Boolean, default: true },
  // GST006: the minutes of verified in-zone attendance this event requires.
  // Deliberately nullable and NEVER backfilled: an existing event has no
  // administrator-set requirement, so tracking reports "needs configuration"
  // rather than inventing a duration. Only an administrator sets this.
  requiredAttendanceMinutes: { type: Number, default: null, min: 1, max: 24 * 60 },
  createdAt: { type: Date, default: Date.now },
  dataSource: { type: String, enum: ['managed', 'migration', 'demo', 'legacy-browser'], default: 'managed', index: true },
}, { versionKey: false });

eventSchema.index({ startsAt: 1, name: 1 });
eventSchema.index({ supervisors: 1 });

export default mongoose.models.Event || mongoose.model('Event', eventSchema);
