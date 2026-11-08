import { AuditLog } from '../models/index.js';

const ACTIONS = new Set([
  'login_succeeded',
  'profile_updated',
  'event_registered',
  'event_registration_cancelled',
  'attendance_checked_in',
  'attendance_status_changed',
  'account_created',
  'account_updated',
  'role_changed',
  'account_deactivated',
  'account_reactivated',
  'account_approved',
  'account_rejected',
  'account_approval_reset',
  'account_archived',
  'account_restored',
  'account_deleted',
  'event_created',
  'event_updated',
  'event_cancelled',
  'event_archived',
  'event_restored',
]);

/**
 * Append one safe, successful action. Audit persistence must not turn a
 * completed business action into a failed request, but callers only invoke
 * this after their mutation has succeeded.
 */
export async function recordAudit({ actor, action, targetUser = null, event = null, detail = '' }) {
  if (!actor?._id || !ACTIONS.has(action)) return;
  await AuditLog.create({
    actorId: actor._id,
    actorName: actor.profile?.displayName || actor.accountId || '',
    actorRole: actor.profile?.role || '',
    action,
    ...(targetUser?._id || targetUser?.userId ? {
      targetUserId: targetUser._id || targetUser.userId,
      targetAccountId: targetUser.accountId || '',
      targetName: targetUser.profile?.displayName || targetUser.displayName || '',
    } : {}),
    ...(event?._id || event?.eventId ? {
      targetEventId: String(event._id || event.eventId),
      eventName: event.name || event.eventName || '',
    } : {}),
    detail: String(detail || '').slice(0, 500),
  }).catch(() => {});
}
