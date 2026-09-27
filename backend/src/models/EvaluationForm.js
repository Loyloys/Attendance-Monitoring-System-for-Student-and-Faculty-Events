import mongoose from 'mongoose';

const evaluationFormSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  title: { type: String, required: true, maxlength: 180 },
  eventId: { type: String, ref: 'Event', required: true, index: true },
  questions: [{
    _id: false,
    id: { type: String, required: true },
    prompt: { type: String, required: true, maxlength: 500 },
    type: { type: String, enum: ['rating', 'text'], default: 'text' },
    required: { type: Boolean, default: false },
  }],
  active: { type: Boolean, default: true },
  createdAt: { type: Date, required: true, default: Date.now },
  updatedAt: { type: Date, required: true, default: Date.now },
  dataSource: { type: String, enum: ['managed', 'legacy-browser'], default: 'managed', index: true },
}, { versionKey: false });

export default mongoose.models.EvaluationForm || mongoose.model('EvaluationForm', evaluationFormSchema);
