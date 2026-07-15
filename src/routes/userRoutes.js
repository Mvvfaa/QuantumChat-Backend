import { Router } from 'express';
import {
  listUsers,
  getUser,
  updatePublicKeys,
  blockUser,
  unblockUser,
  uploadAvatar,
  getAvatar,
} from '../controllers/userController.js';
import { requireAuth } from '../middleware/auth.js';
import { avatarUpload } from '../middleware/upload.js';

const router = Router();

router.use(requireAuth);
router.get('/', listUsers);
router.patch('/me/public-keys', updatePublicKeys);
router.post('/me/avatar', avatarUpload.single('avatar'), uploadAvatar);
router.post('/:id/block', blockUser);
router.delete('/:id/block', unblockUser);
router.get('/:id/avatar', getAvatar);
router.get('/:id', getUser);

export default router;
