import mongoose from 'mongoose';

const AUTH_PROVIDERS = ['password', 'google'];

const userSchema = new mongoose.Schema({
  legacyId: { type: Number, unique: true, sparse: true, index: true },
  accountId: { type: String, required: true, maxlength: 150 },
  accountIdNormalized: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true, maxlength: 150 },
  usernameNormalized: { type: String, required: true, unique: true, index: true },
  // Optional: accounts created through Google sign-in have no password at all and
  // must never be given a fabricated one. Password login rejects them cleanly.
  passwordHash: { type: String, default: null, select: false },
  authProviders: { type: [String], enum: AUTH_PROVIDERS, default: ['password'] },
  googleSub: { type: String, default: null },
  googleEmail: { type: String, default: '', maxlength: 254 },
  googleEmailNormalized: { type: String, default: '', index: true },
  // Additive: records the Workspace domain from the verified `hd` claim. Existing
  // documents simply keep the empty default, and no index is added, so no stored
  // record or relationship is rewritten.
  googleHostedDomain: { type: String, default: '', maxlength: 254 },
  googlePictureUrl: { type: String, default: '', maxlength: 1000 },
  googleLinkedAt: { type: Date, default: null },
  profileCompleted: { type: Boolean, default: true },
  firstName: { type: String, default: '', maxlength: 150 },
  lastName: { type: String, default: '', maxlength: 150 },
  email: { type: String, default: '', maxlength: 254 },
  emailNormalized: { type: String, default: '', index: true },
  isActive: { type: Boolean, default: true, index: true },
  isStaff: { type: Boolean, default: false },
  isSuperuser: { type: Boolean, default: false },
  lastLogin: { type: Date, default: null },
  dateJoined: { type: Date, default: Date.now },
  dataSource: { type: String, enum: ['managed', 'migration', 'demo', 'legacy-browser', 'google'], default: 'managed', index: true },
}, { versionKey: false });

userSchema.index({ usernameNormalized: 1, emailNormalized: 1 });

// One account per Google identity. The partial filter keeps every password-only
// account valid, because those store `googleSub: null` rather than a subject.
userSchema.index(
  { googleSub: 1 },
  {
    unique: true,
    partialFilterExpression: { googleSub: { $type: 'string' } },
    name: 'unique_google_sub',
  },
);

export default mongoose.models.User || mongoose.model('User', userSchema);
