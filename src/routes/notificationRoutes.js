import { Router } from 'express';
import {
    getUnreadCountHandler,
    listNotificationsHandler,
    markAllReadHandler,
    markReadHandler,
} from '../controllers/notificationController.js';
import { requireAuthLean } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

const router = Router();

// Same pattern as activityRoutes.js: apiLimiter (IP-based) before auth.
router.use(apiLimiter);
router.use(requireAuthLean);

router.get('/unread-count', getUnreadCountHandler);
router.get('/', listNotificationsHandler);
router.post('/read', markReadHandler);
router.post('/read-all', markAllReadHandler);

export default router;