import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  createGroup,
  listGroups,
  getGroup,
  sendGroupMessage,
  getGroupMessages,
  renameGroup,
  addMembers,
  removeMember,
  deleteGroup
} from '../controllers/groupController.js';

const router = Router();

router.use(requireAuth);
router.get('/', listGroups);
router.post('/', createGroup);
router.get('/:id', getGroup);
router.get('/:groupId/messages', getGroupMessages);
router.post('/:groupId/messages', sendGroupMessage);
router.patch('/:id', renameGroup);
router.post('/:id/members', addMembers);
router.delete('/:id/members/:memberId', removeMember);
router.delete('/:id', deleteGroup);

export default router;
