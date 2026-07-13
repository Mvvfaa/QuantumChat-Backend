import { Router } from 'express';
import { listUsers, getUser, updatePublicKeys, blockUser, unblockUser } from '../controllers/userController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.get('/', listUsers);
router.patch('/me/public-keys', updatePublicKeys);
router.post('/:id/block', blockUser);
router.delete('/:id/block', unblockUser);
router.get('/:id', getUser);

export default router;
