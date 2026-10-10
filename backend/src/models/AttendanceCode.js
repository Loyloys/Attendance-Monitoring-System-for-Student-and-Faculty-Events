import mongoose from 'mongoose';

const attendanceCodeSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  eventId: { type: String, ref: 'Event', required: true, index: true },
  createdById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  tokenHash: { type: String, required: true, unique: true, maxlength: 64 },
  // AES-256-GCM ciphertext of the token (iv.authTag.ciphertext, base64url).
  // This is what lets an authorized Administrator re-display the SAME current
  // code after a refresh instead of having to revoke and reissue it. It is
  // never returned by an API and never logged.
  tokenEncrypted: { type: String, required: true, maxlength: 512 },
  expiresAt: { type: Date, required: true },
  active: { type: Boolean, default: true, index: true },
  createdAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

// At most ONE active credential per event. This is what makes concurrent
// issuance safe: a second request loses the race on this index rather than
// creating a competing code that attendees might scan.
attendanceCodeSchema.index({ eventId: 1, active: 1 }, { unique: true, partialFilterExpression: { active: true }, name: 'unique_active_code_per_event' });
attendanceCodeSchema.index({ eventId: 1, active: 1, expiresAt: 1 });

export default mongoose.models.AttendanceCode || mongoose.model('AttendanceCode', attendanceCodeSchema);
