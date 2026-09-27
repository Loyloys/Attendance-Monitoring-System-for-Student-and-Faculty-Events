import mongoose from 'mongoose';

const attendanceCodeSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  eventId: { type: String, ref: 'Event', required: true, index: true },
  createdById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true, unique: true, maxlength: 64 },
  expiresAt: { type: Date, required: true },
  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

attendanceCodeSchema.index({ eventId: 1, active: 1, expiresAt: 1 });

export default mongoose.models.AttendanceCode || mongoose.model('AttendanceCode', attendanceCodeSchema);
