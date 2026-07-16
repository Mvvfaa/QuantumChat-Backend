import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { storyUpload } from '../middleware/upload.js';
import { createStory, listStories, getStoryMedia, deleteStory } from '../controllers/storyController.js';

const router = Router();

router.use(requireAuth);
router.get('/', listStories);
router.post('/', storyUpload.single('file'), createStory);
router.get('/:id/media', getStoryMedia);
router.delete('/:id', deleteStory);

export default router;
