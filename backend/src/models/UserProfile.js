import mongoose from 'mongoose';
import { ROLES } from '../utils/domain.js';

const userProfileSchema = new mongoose.Schema({
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
  role: { type: String, enum: Object.values(ROLES), required: true, index: true },
  displayName: { type: String, required: true, maxlength: 150 },
  phone: { type: String, default: '', maxlength: 40 },
  department: { type: String, default: '', maxlength: 150 },
  cardIdentifier: { type: String, default: null, maxlength: 120 },
  cardIdentifierNormalized: { type: String, unique: true, sparse: true, index: true },
}, { versionKey: false });

export default mongoose.models.UserProfile || mongoose.model('UserProfile', userProfileSchema);
