import mongoose from 'mongoose';
import { ATTENDANCE_METHODS, ATTENDANCE_STATUSES } from '../utils/domain.js';

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
}, { versionKey: false });

eventAttendanceSchema.index({ eventId: 1, attendeeId: 1 }, { unique: true, name: 'unique_event_attendance' });
eventAttendanceSchema.index({ recordedAt: -1 });

export default mongoose.models.EventAttendance || mongoose.model('EventAttendance', eventAttendanceSchema);
