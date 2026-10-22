import { User, UserProfile } from '../models/index.js';
import { AuthenticationError } from '../utils/errors.js';

/**
 * The effective access state of an account.
 *
 * Documents written before this field existed have no `approvalStatus` at all,
 * and `lean()` queries do not apply schema defaults, so this fallback is part
 * of the read path rather than something the database guarantees. Pre-existing
 * accounts therefore keep working exactly as before, with no migration.
 *
 * Registration now approves a new Student account immediately, so `approved`
 * is the normal value. `pending` and `rejected` survive on records created under
 * the old administrator-managed access policy. Both stay blocked and neither
 * is ever cleared automatically.
 */
export function approvalStatusOf(user) {
  const status = user?.approvalStatus;
  return status === 'pending' || status === 'rejected' ? status : 'approved';
}

export function isApproved(user) {
  return approvalStatusOf(user) === 'approved';
}

export async function loadAuthentication(request, response, next) {
  request.user = null;
  if (request.session?.userId) {
    const user = await User.findById(request.session.userId).lean();
    if (user?.isActive && !user.archivedAt) {
      const profile = await UserProfile.findOne({ userId: user._id }).lean();
      if (profile) request.user = { ...user, profile };
      else request.session.destroy(() => {});
    } else {
      request.session.destroy(() => {});
    }
  }
  return next();
}

export function requireAuthentication(request, response, next) {
  if (!request.user) return next(new AuthenticationError());
  return next();
}

export const requireRole = (...roles) => (request, response, next) => {
  if (!request.user) return next(new AuthenticationError());
  if (!roles.includes(request.user.profile.role)) {
    return next(Object.assign(new Error('This action is not available for your role.'), { status: 403 }));
  }
  return next();
};

/**
 * Blocks legacy accounts with an unapproved state from every protected route.
 *
 * A person whose legacy account is `rejected`, or who is still `pending` from
 * previous manual-approval policy, stays signed in only so the interface can
 * explain the situation, but they reach no attendance feature at all: no events,
 * no scanning, no history, no reports, no administrator API. New Student
 * registrations are activated automatically and pass straight through.
 *
 * Legacy inactive accounts remain enforced separately and independently:
 * `loadAuthentication` refuses a session whose `isActive` is false. Archiving
 * also sets this field while preserving its original value for restoration.
 *
 * Unauthenticated requests pass through untouched, because
 * `requireAuthentication` produces the correct 401 for them.
 */
export function requireApprovedAccount(request, response, next) {
  if (!request.user) return next();
  const status = approvalStatusOf(request.user);
  if (status === 'approved') return next();
  return next(Object.assign(
    new Error(status === 'rejected'
      ? 'Your account has been blocked by an administrator. Contact them for help.'
      : 'Your account is not active yet. Contact an administrator for help.'),
    { status: 403, code: status === 'rejected' ? 'account_rejected' : 'account_pending_approval' },
  ));
}
