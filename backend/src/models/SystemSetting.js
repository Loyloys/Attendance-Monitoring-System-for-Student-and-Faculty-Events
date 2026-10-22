import mongoose from 'mongoose';

const systemSettingSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { versionKey: false });

export default mongoose.models.SystemSetting || mongoose.model('SystemSetting', systemSettingSchema);
