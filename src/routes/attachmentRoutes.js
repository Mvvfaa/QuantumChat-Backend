import { Router } from 'express';
import { uploadAttachment, downloadAttachment } from '../controllers/attachmentController.js';
import { requireAuth } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = Router();

router.use(requireAuth);
router.post('/', upload.single('file'), uploadAttachment);
router.get('/:id/raw', downloadAttachment);

export default router;
