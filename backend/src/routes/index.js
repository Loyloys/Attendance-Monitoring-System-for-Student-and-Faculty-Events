import { Router } from 'express';
import authRoutes from './authRoutes.js';
import eventRoutes from './eventRoutes.js';
import adminEventRoutes from './adminEventRoutes.js';
import reportRoutes from './reportRoutes.js';
import adminRoutes from './adminRoutes.js';

const router = Router();
router.use(authRoutes);
router.use(adminEventRoutes);
router.use(eventRoutes);
router.use(reportRoutes);
router.use(adminRoutes);

export default router;
