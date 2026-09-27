import { User, UserProfile } from '../models/index.js';
import { AuthenticationError } from '../utils/errors.js';

export async function loadAuthentication(request, response, next) {
  request.user = null;
  if (request.session?.userId) {
    const user = await User.findById(request.session.userId).lean();
    if (user?.isActive) {
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
