import { Router } from 'express';
import * as controller from '../controllers/reportController.js';
import { requireAuthentication, requireRole } from '../middleware/authentication.js';
import { asyncRoute } from '../utils/errors.js';

const router = Router();
router.use(requireAuthentication);
router.get('/reports/me.pdf', requireRole('student', 'faculty'), asyncRoute(controller.personal));
router.get('/reports/events/:eventId.pdf', requireRole('faculty'), asyncRoute(controller.event));
router.get('/certificates/:certificateId/download/', requireRole('student'), asyncRoute(controller.certificate));

export default router;
