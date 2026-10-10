import { approvalStatusOf } from '../middleware/authentication.js';

export function serializeAuthUser(user) {
  return {
    id: user.username,
    username: user.username,
    email: user.email || '',
    name: user.profile.displayName,
    role: user.profile.role,
    phone: user.profile.phone || '',
    department: user.profile.department || '',
    // Google linkage is public account information; the credential itself is never
    // returned or stored beyond the verified profile fields.
    authProviders: user.authProviders?.length ? [...user.authProviders] : ['password'],
    googleLinked: Boolean(user.googleSub),
    profileCompleted: user.profileCompleted !== false,
    // The browser needs this to know whether an administrator has blocked the
    // account. Registration itself never produces a pending value: documents
    // predating the field read as approved.
    approvalStatus: approvalStatusOf(user),
    picture: user.googlePictureUrl || '',
  };
}
