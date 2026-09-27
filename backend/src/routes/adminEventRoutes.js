import { Router } from 'express';
import * as controller from '../controllers/adminEventController.js';
import { requireAuthentication, requireRole } from '../middleware/authentication.js';
import { asyncRoute } from '../utils/errors.js';

const router = Router();
router.use('/admin', requireAuthentication, requireRole('admin'));
router.route('/admin/events/').get(asyncRoute(controller.list)).post(asyncRoute(controller.list));
router.route('/admin/events/:eventId/').get(asyncRoute(controller.detail)).patch(asyncRoute(controller.detail));
router.post('/admin/events/:eventId/cancel/', asyncRoute(controller.cancel));

export default router;
