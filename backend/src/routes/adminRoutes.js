import { Router } from 'express';
import * as controller from '../controllers/adminController.js';
import { requireAuthentication, requireRole } from '../middleware/authentication.js';
import { asyncRoute } from '../utils/errors.js';

const router = Router();
router.use('/admin', requireAuthentication, requireRole('admin'));
router.get('/admin/state/', asyncRoute(controller.state));
router.get('/admin/audit-log/', asyncRoute(controller.auditLog));
router.post('/admin/import-legacy-browser/', asyncRoute(controller.importLegacyBrowserState));
router.post('/admin/users/', asyncRoute(controller.createUser));
// AD003.3: email-only pending signup requests. Listed for review; approval
// creates the User, rejection only marks the request. No User exists before approval.
router.get('/admin/signup-requests/', asyncRoute(controller.signupRequests));
router.post('/admin/signup-requests/:requestId/approve/', asyncRoute(controller.approveSignup));
router.post('/admin/signup-requests/:requestId/reject/', asyncRoute(controller.rejectSignup));
// Declared before the `/admin/users/:accountId/` route so "registrations" is not
// swallowed as an account id. `router.use('/admin', requireAuthentication,
// requireRole('admin'))` above already restricts this to administrators.
router.get('/admin/users/:accountId/registrations/', asyncRoute(controller.userRegistrations));
router.route('/admin/users/:accountId/').patch(asyncRoute(controller.updateUser)).delete(asyncRoute(controller.deleteUser));
router.post('/admin/attendance/', asyncRoute(controller.createAttendance));
router.route('/admin/attendance/:recordId/').patch(asyncRoute(controller.updateAttendance)).delete(asyncRoute(controller.removeAttendance));
router.post('/admin/forms/', asyncRoute(controller.createOrUpdateForm));
router.delete('/admin/forms/:formId/', asyncRoute(controller.removeForm));

export default router;
