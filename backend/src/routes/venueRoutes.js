import { Router } from 'express';
import * as controller from '../controllers/venueController.js';
import { requireAdmin } from '../middleware/admin.js';
import { asyncRoute } from '../utils/errors.js';

const router = Router();

// Administrator-only, exactly like every other admin surface. A saved venue is
// a template the Administrator picks from when scheduling an event, so students
// and faculty have no reason to read, create or change one.
router.use('/admin', requireAdmin);
router.route('/admin/venues/').get(asyncRoute(controller.list)).post(asyncRoute(controller.list));
router.route('/admin/venues/:venueId/')
  .get(asyncRoute(controller.detail))
  .patch(asyncRoute(controller.detail))
  .delete(asyncRoute(controller.detail));

export default router;
