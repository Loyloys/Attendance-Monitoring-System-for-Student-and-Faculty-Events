import mongoose from 'mongoose';

/**
 * AD003.3 / GST001.0: email-only pending account signup requests.
 *
 * A Google-authenticated person who does not yet have an approved account must
 * remain pending: OAuth alone must not grant an application role or access, and
 * no User account is created until Admin approval. This collection stores only
 * the verified Google identity plus the minimal profile details needed for an
 * administrator to assign role/department/course during approval.
 *
 * Additive only: no existing collection, index, or document is touched. Index
 * creation for this model is approval-gated like AttendanceSession (see
 * INDEX_CREATION_EXCLUDED_MODELS), so importing this file never writes to the
 * live database.
 */
const signupRequestSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: () => new mongoose.Types.ObjectId().toString() },
  // Verified Google identity (from the verified ID token, never browser input).
  googleSub: { type: String, required: true },
  googleEmail: { type: String, required: true, maxlength: 254 },
  googleEmailNormalized: { type: String, required: true, index: true },
  googleHostedDomain: { type: String, default: '', maxlength: 254 },
  googlePictureUrl: { type: String, default: '', maxlength: 1000 },
  // Minimal profile details supplied at signup for admin review.
  accountId: { type: String, default: '', maxlength: 150 },
  accountIdNormalized: { type: String, default: '', index: true },
  displayName: { type: String, default: '', maxlength: 150 },
  // Department/course is NEVER collected from the applicant. It is assigned
  // from the fixed list (DEPARTMENTS) by an administrator during approval.
  department: { type: String, default: '', maxlength: 150 },
  phone: { type: String, default: '', maxlength: 40 },
  // Role inferred server-side from the VERIFIED Google email domain (see
  // PENDING_ROLE_BY_EMAIL_DOMAIN). Empty when no domain matches; an
  // administrator can then assign the role explicitly at approval.
  pendingRole: { type: String, default: '', maxlength: 20 },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

// One pending identity per Google subject: repeat submissions update the same
// request rather than creating duplicates.
signupRequestSchema.index({ googleSub: 1 }, { unique: true, name: 'unique_signup_google_sub' });
// Email-only policy: one pending request per normalized email.
signupRequestSchema.index(
  { googleEmailNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'unique_pending_signup_email',
  },
);

export default mongoose.models.SignupRequest || mongoose.model('SignupRequest', signupRequestSchema);
