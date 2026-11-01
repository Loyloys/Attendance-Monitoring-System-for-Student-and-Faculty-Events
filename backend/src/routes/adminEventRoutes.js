import { Router } from 'express';
import * as controller from '../controllers/adminEventController.js';
import { requireAuthentication, requireRole } from '../middleware/authentication.js';
import { asyncRoute } from '../utils/errors.js';

const router = Router();
router.use('/admin', requireAuthentication, requireRole('admin'));
router.route('/admin/events/').get(asyncRoute(controller.list)).post(asyncRoute(controller.list));
router.route('/admin/events/:eventId/').get(asyncRoute(controller.detail)).patch(asyncRoute(controller.detail));
router.route('/admin/events/:eventId/qr/').get(asyncRoute(controller.qr)).post(asyncRoute(controller.qr));
router.post('/admin/events/:eventId/certificates/', asyncRoute(controller.issue));
router.get('/admin/events/:eventId/qr/status/', asyncRoute(controller.qrStatus));
router.get('/admin/events/:eventId/registrants/', asyncRoute(controller.listRegistrants));
router.post('/admin/events/:eventId/archive/', asyncRoute(controller.archive));
router.post('/admin/events/:eventId/restore/', asyncRoute(controller.restore));
router.get('/admin/archive/', asyncRoute(controller.listArchived));

export default router;
