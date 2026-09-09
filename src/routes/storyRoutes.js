import { Router } from 'express';
import {
  createStory,
  deleteStory,
  getStoryById,
  getStoryMedia,
  getStoryViewers,
  listMyDrafts,
  listStories,
  listMyArchive,
  markStoryViewed,
  publishStory,
  updateStory,
  reshareStory,
} from '../controllers/storyController.js';
import { requireAuthLean } from '../middleware/auth.js';
import { apiLimiter } from '../middleware/rateLimiter.js';
import { storyUpload } from '../middleware/upload.js';

const router = Router();

router.use(apiLimiter);
router.use(requireAuthLean);
router.get('/', listStories);
router.get('/mine/drafts', listMyDrafts);
router.get('/mine/archive', listMyArchive);
router.post('/', storyUpload.single('file'), createStory);
router.get('/:id', getStoryById);
router.patch('/:id', updateStory);
router.post('/:id/publish', publishStory);
router.post('/:id/reshare', reshareStory);
router.get('/:id/media', getStoryMedia);
router.post('/:id/view', markStoryViewed);
router.get('/:id/viewers', getStoryViewers);
router.delete('/:id', deleteStory);

export default router;
