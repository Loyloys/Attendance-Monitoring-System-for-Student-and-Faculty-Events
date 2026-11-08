import mongoose from 'mongoose';

const pushDeviceSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  tokenEncrypted: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
}, { versionKey: false });

export default mongoose.models.PushDevice || mongoose.model('PushDevice', pushDeviceSchema);
