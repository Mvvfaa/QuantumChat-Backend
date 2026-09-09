import { Router } from 'express';
import {
  initAttachmentUpload,
  uploadPendingAttachmentBytes,
  uploadPendingAttachmentChunk,
  finalizeAttachmentUpload,
  downloadAttachment,
} from '../controllers/attachmentController.js';
import { requireAuthLean } from '../middleware/auth.js';
import { attachmentLimiter } from '../middleware/rateLimiter.js';
import { upload, chunkUpload } from '../middleware/upload.js';

const router = Router();

// attachmentLimiter is keyed by user and requires req.user, so it must run
// AFTER requireAuthLean — unlike apiLimiter elsewhere, which runs before
// auth as an IP-keyed gate. Order matters here.
router.use(requireAuthLean);
router.use(attachmentLimiter);

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
