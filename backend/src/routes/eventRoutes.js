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
// GST006: Faculty reach their assigned event's QR here. The route is open to
// admin as well so an Administrator can manage any event's code; the SERVICE
// then refuses any event the caller is not entitled to.
router.route('/events/:eventId/check-in-code/')
  .get(requireRole('faculty', 'admin'), asyncRoute(controller.checkinCode))
  .post(requireRole('faculty', 'admin'), asyncRoute(controller.checkinCode));
router.get('/events/:eventId/attendance/', requireRole('faculty'), asyncRoute(controller.attendance));
router.post('/events/:eventId/feedback/', asyncRoute(controller.feedback));
router.post('/attendance/scan/', asyncRoute(controller.scan));
router.post('/attendance/session/', asyncRoute(controller.startSession));
router.patch('/attendance/session/:sessionId/', asyncRoute(controller.updateSession));
router.post('/attendance/session/:sessionId/checkout/', asyncRoute(controller.checkoutSession));
router.get('/attendance/session/event/:eventId/', requireRole('student', 'faculty'), asyncRoute(controller.mySession));
router.get('/attendance/sessions/event/:eventId/', requireRole('faculty', 'admin'), asyncRoute(controller.monitorSessions));
router.get('/attendance/me/', requireRole('student', 'faculty'), asyncRoute(controller.myAttendance));

export default router;
