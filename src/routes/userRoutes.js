import { Router } from 'express';
import {
  listUsers,
  getUser,
  updatePublicKeys,
  updateProfile,
  blockUser,
  unblockUser,
  listBlockedUsers,
  uploadAvatar,
  deleteAvatar,
  getAvatar,
  exportAccountData,
  deleteAccount,
} from '../controllers/userController.js';
import { requireAuth } from '../middleware/auth.js';
import { avatarUpload } from '../middleware/upload.js';

const router = Router();

router.use(requireAuth);
router.get('/', listUsers);
router.patch('/me', updateProfile);
router.patch('/me/public-keys', updatePublicKeys);
router.get('/me/blocked', listBlockedUsers);
router.get('/me/export', exportAccountData);
router.delete('/me', deleteAccount);
router.post('/me/avatar', avatarUpload.single('avatar'), uploadAvatar);
router.delete('/me/avatar', deleteAvatar);
router.post('/:id/block', blockUser);
router.delete('/:id/block', unblockUser);
router.get('/:id/avatar', getAvatar);
router.get('/:id', getUser);

export default router;
