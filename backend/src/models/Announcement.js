import mongoose from 'mongoose';
import crypto from 'node:crypto';

const announcementSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: () => crypto.randomUUID() },
  title: { type: String, required: true, maxlength: 180 },
  message: { type: String, required: true, maxlength: 10_000 },
  audience: { type: String, enum: ['all', 'student', 'faculty'], required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  createdByName: { type: String, default: '', maxlength: 180 },
  createdAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false });

export default mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);
