import { Router } from 'express';
import {
  listPresets,
  getChatTheme,
  setChatTheme,
  resetChatTheme,
  uploadWallpaper,
  getWallpaperImage,
  deleteWallpaperImage,
} from '../controllers/chatThemeController.js';
import { requireAuthLean } from '../middleware/auth.js';
import { wallpaperUpload } from '../middleware/upload.js';
import { apiLimiter } from '../middleware/rateLimiter.js';

const router = Router();

router.use(apiLimiter);
router.use(requireAuthLean);

router.get('/presets', listPresets);

// Group-scoped theme (same handlers, resolved via req.params.groupId).
router.get('/group/:groupId', getChatTheme);
router.put('/group/:groupId', setChatTheme);
router.delete('/group/:groupId', resetChatTheme);
router.post('/group/:groupId/wallpaper', wallpaperUpload.single('wallpaper'), uploadWallpaper);
router.get('/group/:groupId/wallpaper', getWallpaperImage);
router.delete('/group/:groupId/wallpaper', deleteWallpaperImage);

// 1:1 peer-scoped theme (unchanged).
router.get('/:peerId', getChatTheme);
router.put('/:peerId', setChatTheme);
router.delete('/:peerId', resetChatTheme);
router.post('/:peerId/wallpaper', wallpaperUpload.single('wallpaper'), uploadWallpaper);
router.get('/:peerId/wallpaper', getWallpaperImage);
router.delete('/:peerId/wallpaper', deleteWallpaperImage);

export default router;