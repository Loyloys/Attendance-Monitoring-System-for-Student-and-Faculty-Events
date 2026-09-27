import { Router } from 'express';
import * as controller from '../controllers/eventController.js';
import { requireAuthentication, requireRole } from '../middleware/authentication.js';
import { asyncRoute } from '../utils/errors.js';

const router = Router();
router.use(requireAuthentication);

router.get('/events/managed/', requireRole('faculty'), asyncRoute(controller.managedEvents));
router.get('/events/', asyncRoute(controller.listEvents));
router.get('/events/:eventId/', asyncRoute(controller.eventDetail));
router.post('/events/:eventId/registrations/', requireRole('student'), asyncRoute(controller.register));
router.post('/events/:eventId/check-in-code/', requireRole('faculty'), asyncRoute(controller.checkinCode));
router.get('/events/:eventId/attendance/', requireRole('faculty'), asyncRoute(controller.attendance));
router.post('/events/:eventId/feedback/', asyncRoute(controller.feedback));
router.post('/attendance/scan/', asyncRoute(controller.scan));
router.get('/attendance/me/', requireRole('student', 'faculty'), asyncRoute(controller.myAttendance));

export default router;
