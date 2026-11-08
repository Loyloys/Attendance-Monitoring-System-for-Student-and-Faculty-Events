import { Router } from 'express';
import * as controller from '../controllers/notificationController.js';
import { requireApprovedAccount, requireAuthentication } from '../middleware/authentication.js';
import { requireObjectBody } from '../controllers/authController.js';
import { asyncRoute } from '../utils/errors.js';

const router = Router();

router.get('/notifications/status/', asyncRoute(controller.notificationStatus));
router.post('/notifications/devices/', requireAuthentication, requireApprovedAccount, requireObjectBody, asyncRoute(controller.registerDevice));
router.delete('/notifications/devices/', requireAuthentication, requireApprovedAccount, requireObjectBody, asyncRoute(controller.unregisterDevice));

export default router;
