import mongoose from 'mongoose';
import crypto from 'node:crypto';

const emailActionTokenSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  purpose: { type: String, enum: ['verify-signup-email', 'set-application-password'], required: true },
  emailNormalized: { type: String, required: true },
  signupRequestId: { type: String, default: null },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

emailActionTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.EmailActionToken || mongoose.model('EmailActionToken', emailActionTokenSchema);
