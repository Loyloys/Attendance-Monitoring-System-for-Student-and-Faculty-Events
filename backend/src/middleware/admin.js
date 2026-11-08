import { requireAuthentication, requireRole } from './authentication.js';

/**
 * Shared protection for Admin-only route surfaces.
 *
 * The underlying middleware remains the single source of truth for 401/403
 * behavior; this module only composes it for consistent route registration.
 */
export const requireAdmin = [requireAuthentication, requireRole('admin')];
