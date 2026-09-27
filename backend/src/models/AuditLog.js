import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * Audit trail for administrator actions that change who can do what (AD003).
 * The requirement is "record role changes using the existing audit mechanism,
 * where available" - no such mechanism existed, so this small append-only
 * collection is introduced rather than leaving role changes untraceable.
 *
 * Nothing here blocks or alters an account: it is a record written after the
 * change succeeds.
 */
const auditLogSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: () => crypto.randomUUID() },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actorName: { type: String, default: '', maxlength: 180 },
  action: {
    type: String,
    enum: ['role_changed', 'account_created', 'account_updated', 'account_deactivated', 'account_reactivated', 'account_deleted'],
    required: true,
    index: true,
  },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  targetAccountId: { type: String, default: '', maxlength: 150 },
  detail: { type: String, default: '', maxlength: 500 },
  createdAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false });

auditLogSchema.index({ createdAt: -1 });

export default mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);