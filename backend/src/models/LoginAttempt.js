import mongoose from 'mongoose';

const loginAttemptSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  failures: { type: Number, required: true, default: 0 },
  windowStartedAt: { type: Date, required: true },
  lockedUntil: { type: Date, default: null },
  updatedAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

loginAttemptSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export default mongoose.models.LoginAttempt || mongoose.model('LoginAttempt', loginAttemptSchema);
