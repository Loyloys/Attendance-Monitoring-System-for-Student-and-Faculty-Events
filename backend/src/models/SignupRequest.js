import mongoose from 'mongoose';

/**
 * AD003.3 / GST001.0: Google- or manually verified pending signup requests.
 *
 * A Google-authenticated person who does not yet have an approved account must
 * remain pending: verifying an email or Google identity alone must not grant an
 * application account or access, and no User account is created until Admin
 * approval. Manual requests are recorded only after the email token is verified.
 * The applicant never selects their role or department.
 *
 * Additive only: no existing collection, index, or document is touched. Index
 * creation for this model is approval-gated like AttendanceSession (see
 * INDEX_CREATION_EXCLUDED_MODELS), so importing this file never writes to the
 * live database.
 */
const signupRequestSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: () => new mongoose.Types.ObjectId().toString() },
  // Google identity is trusted only after server-side ID-token verification.
  // Email-only requests leave googleSub null and are created after token proof.
  provider: { type: String, enum: ['google', 'email'], default: 'google', required: true },
  googleSub: { type: String, default: null },
  googleEmail: { type: String, required: true, maxlength: 254 },
  googleEmailNormalized: { type: String, required: true, index: true },
  googleHostedDomain: { type: String, default: '', maxlength: 254 },
  googlePictureUrl: { type: String, default: '', maxlength: 1000 },
  // Assigned by an administrator during approval. Pending account-ID suggestions
  // are derived from the server-verified email, never from browser input.
  accountId: { type: String, default: '', maxlength: 150 },
  accountIdNormalized: { type: String, default: '', index: true },
  displayName: { type: String, default: '', maxlength: 150 },
  // Department/course is NEVER collected from the applicant. It is assigned
  // from the fixed list (DEPARTMENTS) by an administrator during approval.
  department: { type: String, default: '', maxlength: 150 },
  phone: { type: String, default: '', maxlength: 40 },
  // Role inferred server-side only from a verified address (see
  // PENDING_ROLE_BY_EMAIL_DOMAIN). The approval service recomputes it from the
  // verified address; empty when no domain matches.
  pendingRole: { type: String, default: '', maxlength: 20 },
  emailVerifiedAt: { type: Date, default: null },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
  reviewedAt: { type: Date, default: null },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

// One request per verified Google subject and one pending request per email.
signupRequestSchema.index(
  { googleSub: 1 },
  { unique: true, partialFilterExpression: { googleSub: { $type: 'string' } }, name: 'unique_signup_google_sub' },
);
signupRequestSchema.index(
  { googleEmailNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'unique_pending_signup_email',
  },
);

export default mongoose.models.SignupRequest || mongoose.model('SignupRequest', signupRequestSchema);
