import mongoose from 'mongoose';

const revokedIdentifierSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reason: { type: String, default: 'Identity changed', maxlength: 240 },
  revokedAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

export default mongoose.models.RevokedIdentifier || mongoose.model('RevokedIdentifier', revokedIdentifierSchema);
