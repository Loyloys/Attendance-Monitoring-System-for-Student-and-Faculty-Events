import mongoose from 'mongoose';

const eventFeedbackSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  eventId: { type: String, ref: 'Event', required: true, index: true },
  attendeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  rating: { type: Number, min: 1, max: 5, required: true },
  comments: { type: String, default: '', maxlength: 2000 },
  submittedAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

eventFeedbackSchema.index({ eventId: 1, attendeeId: 1 }, { unique: true, name: 'unique_event_feedback' });

export default mongoose.models.EventFeedback || mongoose.model('EventFeedback', eventFeedbackSchema);
