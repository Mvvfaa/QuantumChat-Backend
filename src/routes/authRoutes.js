import { Router } from 'express';
import {
  register,
  login,
  me,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  setup2fa,
  enable2fa,
  disable2fa,
  verify2fa,
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/verify-email', verifyEmail);
router.post('/verify-email', verifyEmail);
router.post('/2fa/verify', verify2fa);

router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, changePassword);
router.post('/resend-verification', requireAuth, resendVerification);
router.post('/2fa/setup', requireAuth, setup2fa);
router.post('/2fa/enable', requireAuth, enable2fa);
router.post('/2fa/disable', requireAuth, disable2fa);

export default router;
