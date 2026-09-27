import mongoose from 'mongoose';

const legacyBrowserSnapshotSchema = new mongoose.Schema({
  sourceKey: { type: String, required: true, index: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  payloadSha256: { type: String, required: true, index: true },
  archivedAt: { type: Date, required: true, default: Date.now },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { versionKey: false });

legacyBrowserSnapshotSchema.index({ sourceKey: 1, payloadSha256: 1 }, { unique: true });

export default mongoose.models.LegacyBrowserSnapshot || mongoose.model('LegacyBrowserSnapshot', legacyBrowserSnapshotSchema);
