import { Router } from 'express';
import {
  addHighlightItem,
  createHighlight,
  deleteHighlight,
  deleteHighlightItem,
  getHighlight,
  getHighlightCover,
  getHighlightItemMedia,
  listHighlights,
  updateHighlight,
} from '../controllers/highlightController.js';
import { requireAuthLean } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { highlightCoverUpload, highlightUpload } from '../middleware/upload.js';

const router = Router();

router.use(apiLimiter);
router.use(requireAuthLean);

router.get('/', listHighlights);
router.post('/', highlightCoverUpload.single('cover'), createHighlight);
router.get('/:id', getHighlight);
router.patch('/:id', highlightCoverUpload.single('cover'), updateHighlight);
router.post('/:id/items', highlightUpload.single('file'), addHighlightItem);
router.delete('/:id/items/:itemId', deleteHighlightItem);
router.get('/:id/cover', getHighlightCover);
router.get('/:id/items/:itemId/media', getHighlightItemMedia);
router.delete('/:id', deleteHighlight);

export default router;