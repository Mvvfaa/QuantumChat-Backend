import { Router } from 'express';
import {
  initAttachmentUpload,
  uploadPendingAttachmentBytes,
  uploadPendingAttachmentChunk,
  finalizeAttachmentUpload,
  downloadAttachment,
} from '../controllers/attachmentController.js';
import { requireAuthLean } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { upload, chunkUpload } from '../middleware/upload.js';

const router = Router();

router.use(apiLimiter);
router.use(requireAuthLean);

// Three-step upload: init (validate + get an upload target) -> put bytes
// (proxied through us to Cloudinary, or local/dev storage) -> finalize
// (create the Attachment record).
router.post('/init', initAttachmentUpload);
router.put('/pending/:id/bytes', upload.single('file'), uploadPendingAttachmentBytes);
// Large-file path: same pendingUploadId, ciphertext sent as sequential
// small chunks instead of one big body (see uploadPendingAttachmentChunk).
router.put('/pending/:id/chunk', chunkUpload, uploadPendingAttachmentChunk);
router.post('/finalize', finalizeAttachmentUpload);

router.get('/:id/raw', downloadAttachment);

export default router;
