import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { getBlindnessReport } from '../services/blindnessStats.js';

const router = Router();

router.use(requireAuth);
router.use(apiLimiter);

router.get('/blindness', (req, res) => {
  res.json({ success: true, data: getBlindnessReport() });
});

export default router;
