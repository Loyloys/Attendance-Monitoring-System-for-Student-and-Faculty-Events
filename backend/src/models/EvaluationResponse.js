import mongoose from 'mongoose';

const evaluationResponseSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  formId: { type: String, ref: 'EvaluationForm', required: true, index: true },
  eventId: { type: String, ref: 'Event', required: true, index: true },
  attendeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  answers: { type: mongoose.Schema.Types.Mixed, required: true },
  submittedAt: { type: Date, required: true, default: Date.now },
  dataSource: { type: String, enum: ['managed', 'legacy-browser'], default: 'managed', index: true },
}, { versionKey: false });

evaluationResponseSchema.index({ formId: 1, attendeeId: 1 }, { unique: true, name: 'unique_evaluation_response' });

export default mongoose.models.EvaluationResponse || mongoose.model('EvaluationResponse', evaluationResponseSchema);
