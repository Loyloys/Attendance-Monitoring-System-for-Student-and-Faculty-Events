import { Router } from 'express';
import authRoutes from './authRoutes.js';
import eventRoutes from './eventRoutes.js';
import adminEventRoutes from './adminEventRoutes.js';
import venueRoutes from './venueRoutes.js';
import reportRoutes from './reportRoutes.js';
import adminRoutes from './adminRoutes.js';
import notificationRoutes from './notificationRoutes.js';
import { requireApprovedAccount } from '../middleware/authentication.js';

const router = Router();

// The auth routes are mounted FIRST and deliberately stay outside the approval
// gate: a pending or rejected person must still be able to reach /auth/me (to
// see their status), /auth/logout, and the Google flow itself. Everything
// mounted after this line is an attendance feature and requires approval.
router.use(authRoutes);
router.use(notificationRoutes);
// The read-only reCAPTCHA capability endpoint is needed by the anonymous login
// page. Admin mutations remain protected inside adminRoutes.
router.use(adminRoutes);
router.use(requireApprovedAccount);
router.use(adminEventRoutes);
router.use(venueRoutes);
router.use(eventRoutes);
router.use(reportRoutes);

export default router;
