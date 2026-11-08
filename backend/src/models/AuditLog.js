import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * Append-only audit trail for successful user and administrator actions.
 */
const auditLogSchema = new mongoose.Schema({
  _id: { type: String, required: true, default: () => crypto.randomUUID() },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  actorName: { type: String, default: '', maxlength: 180 },
  actorRole: { type: String, default: '', maxlength: 30 },
  action: {
    type: String,
    enum: [
      'login_succeeded', 'profile_updated', 'event_registered', 'event_registration_cancelled',
      'attendance_checked_in', 'attendance_status_changed', 'account_created', 'account_updated',
      'role_changed', 'account_deactivated', 'account_reactivated', 'account_approved',
      'account_rejected', 'account_approval_reset', 'account_archived', 'account_restored',
      'account_deleted', 'event_created', 'event_updated', 'event_cancelled', 'event_archived',
      'event_restored',
    ],
    required: true,
    index: true,
  },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  targetAccountId: { type: String, default: '', maxlength: 150 },
  targetName: { type: String, default: '', maxlength: 180 },
  targetEventId: { type: String, default: '', index: true },
  eventName: { type: String, default: '', maxlength: 200 },
  detail: { type: String, default: '', maxlength: 500 },
  createdAt: { type: Date, default: Date.now, index: true },
}, { versionKey: false });

auditLogSchema.index({ createdAt: -1 });

export default mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);