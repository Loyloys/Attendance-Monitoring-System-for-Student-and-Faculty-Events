import { Router } from 'express';
import * as controller from '../controllers/authController.js';
import { requireAuthentication } from '../middleware/authentication.js';
import { requireObjectBody } from '../controllers/authController.js';
import { loginLimiter, googleAuthLimiter, emailActionLimiter } from '../middleware/rateLimits.js';
import { asyncRoute } from '../utils/errors.js';

const router = Router();

router.get('/auth/csrf/', controller.csrf);
router.get('/auth/google/config/', controller.googleConfig);
router.get('/auth/email/status/', controller.emailStatus);
router.post('/auth/email/signup/', emailActionLimiter, requireObjectBody, asyncRoute(controller.emailSignup));
router.post('/auth/email/verify/', emailActionLimiter, requireObjectBody, asyncRoute(controller.emailVerify));
router.post('/auth/password/setup/', emailActionLimiter, requireObjectBody, asyncRoute(controller.passwordSetup));
router.post('/auth/login/', loginLimiter, requireObjectBody, asyncRoute(controller.login));
router.post('/auth/logout/', controller.logout);
router.get('/auth/me/', requireAuthentication, controller.me);
router.route('/profile/').get(requireAuthentication, controller.profile).patch(requireAuthentication, requireObjectBody, asyncRoute(controller.profile));

// Google Identity Services popup flow. Every unsafe route below is already behind
// the global CSRF middleware, and the nonce binds the credential to this session.
router.post('/auth/google/session/', googleAuthLimiter, requireObjectBody, asyncRoute(controller.googleSession));
router.post('/auth/google/', googleAuthLimiter, requireObjectBody, asyncRoute(controller.googleAuthenticate));
router.post('/auth/google/complete-profile/', requireObjectBody, asyncRoute(controller.googleCompleteProfile));
router.post('/auth/google/link/', requireAuthentication, requireObjectBody, asyncRoute(controller.googleLink));

export default router;
