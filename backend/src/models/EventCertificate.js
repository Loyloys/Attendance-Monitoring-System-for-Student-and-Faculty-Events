import mongoose from 'mongoose';

const eventCertificateSchema = new mongoose.Schema({
  _id: { type: Number, required: true },
  eventId: { type: String, ref: 'Event', required: true, index: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  issuedById: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reference: { type: String, required: true, unique: true, maxlength: 80 },
  message: { type: String, default: '', maxlength: 240 },
  issuedAt: { type: Date, required: true, default: Date.now },
}, { versionKey: false });

eventCertificateSchema.index({ eventId: 1, studentId: 1 }, { unique: true, name: 'unique_event_certificate' });

export default mongoose.models.EventCertificate || mongoose.model('EventCertificate', eventCertificateSchema);
