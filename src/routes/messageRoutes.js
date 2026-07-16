import { Router } from 'express';
import {
  sendMessage,
  getConversation,
  markConversationRead,
  deleteMessage,
  reactToMessage,
  editMessage,
  publishQuantumAIDirectResponse,
} from '../controllers/messageController.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);
router.post('/', sendMessage);
router.post('/quantum-ai-response', publishQuantumAIDirectResponse);
router.get('/:userId', getConversation);
router.post('/:userId/read', markConversationRead);
router.patch('/:messageId', editMessage);
router.delete('/:messageId', deleteMessage);
router.post('/:messageId/reactions', reactToMessage);

export default router;
