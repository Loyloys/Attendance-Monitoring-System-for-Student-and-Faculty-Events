import mongoose from 'mongoose';
import { REGISTRATION_STATUSES } from '../utils/domain.js';

const eventRegistrationSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  eventId: { type: String, ref: 'Event', required: true, index: true },
  attendeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: REGISTRATION_STATUSES, required: true },
  registeredAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

eventRegistrationSchema.index({ eventId: 1, attendeeId: 1 }, { unique: true, name: 'unique_event_registration' });

export default mongoose.models.EventRegistration || mongoose.model('EventRegistration', eventRegistrationSchema);
