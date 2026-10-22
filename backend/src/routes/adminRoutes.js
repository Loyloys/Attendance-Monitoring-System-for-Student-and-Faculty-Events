import { Router } from 'express';
import * as controller from '../controllers/adminController.js';
import { requireAuthentication, requireRole } from '../middleware/authentication.js';
import { asyncRoute } from '../utils/errors.js';

const router = Router();
router.use('/admin', requireAuthentication, requireRole('admin'));
router.get('/admin/state/', asyncRoute(controller.state));
router.get('/admin/audit-log/', asyncRoute(controller.auditLog));
router.get('/admin/settings/google-oauth/', asyncRoute(controller.googleOAuthSettings));
router.put('/admin/settings/google-oauth/', asyncRoute(controller.updateGoogleOAuthSettings));
router.get('/admin/announcements/', asyncRoute(controller.adminAnnouncements));
router.post('/admin/announcements/', asyncRoute(controller.createAdminAnnouncement));
router.get('/announcements/', requireAuthentication, asyncRoute(controller.userAnnouncements));
router.post('/admin/import-legacy-browser/', asyncRoute(controller.importLegacyBrowserState));
router.post('/admin/users/', asyncRoute(controller.createUser));
// AD003.3: email-only pending signup requests. Listed for review; approval
// creates the User, rejection only marks the request. No User exists before approval.
router.get('/admin/signup-requests/', asyncRoute(controller.signupRequests));
router.post('/admin/signup-requests/:requestId/approve/', asyncRoute(controller.approveSignup));
router.post('/admin/signup-requests/:requestId/reject/', asyncRoute(controller.rejectSignup));
router.post('/admin/signup-requests/:requestId/password-setup/', asyncRoute(controller.resendSignupPasswordSetup));
// Smallest addition: resend for any approved account (covers emailed links that
// were never delivered/completed); eligibility is enforced in the service.
router.post('/admin/users/:accountId/password-setup/', asyncRoute(controller.resendUserPasswordSetupLink));
// Declared before the `/admin/users/:accountId/` route so "registrations" is not
// swallowed as an account id. `router.use('/admin', requireAuthentication,
// requireRole('admin'))` above already restricts this to administrators.
router.get('/admin/users/:accountId/registrations/', asyncRoute(controller.userRegistrations));
router.post('/admin/users/:accountId/archive/', asyncRoute(controller.archiveUser));
router.post('/admin/users/:accountId/restore/', asyncRoute(controller.restoreUser));
router.route('/admin/users/:accountId/').patch(asyncRoute(controller.updateUser)).delete(asyncRoute(controller.deleteUser));
router.post('/admin/attendance/', asyncRoute(controller.createAttendance));
router.route('/admin/attendance/:recordId/').patch(asyncRoute(controller.updateAttendance)).delete(asyncRoute(controller.removeAttendance));
router.post('/admin/forms/', asyncRoute(controller.createOrUpdateForm));
router.delete('/admin/forms/:formId/', asyncRoute(controller.removeForm));

export default router;
