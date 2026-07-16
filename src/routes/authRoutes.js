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
} from '../controllers/authController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/verify-email', verifyEmail);
router.post('/verify-email', verifyEmail);

router.get('/me', requireAuth, me);
router.post('/change-password', requireAuth, changePassword);
router.post('/resend-verification', requireAuth, resendVerification);

export default router;
