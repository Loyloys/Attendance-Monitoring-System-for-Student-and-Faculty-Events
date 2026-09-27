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
router.route('/admin/users/:accountId/').patch(asyncRoute(controller.updateUser)).delete(asyncRoute(controller.deleteUser));
router.post('/admin/attendance/', asyncRoute(controller.createAttendance));
router.route('/admin/attendance/:recordId/').patch(asyncRoute(controller.updateAttendance)).delete(asyncRoute(controller.removeAttendance));
router.post('/admin/forms/', asyncRoute(controller.createOrUpdateForm));
router.delete('/admin/forms/:formId/', asyncRoute(controller.removeForm));

export default router;
