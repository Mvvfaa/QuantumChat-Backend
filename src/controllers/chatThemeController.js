import ChatTheme from '../models/ChatTheme.js';
import User from '../models/User.js';
import Group from '../models/Group.js';
import { toObjectId } from '../utils/toObjectId.js';
import { getStorage, newObjectName, safeImageContentType } from '../middleware/upload.js';
import {
  getCatalog,
  getPresetById,
  isValidBubbleColorId,
  isValidPresetId,
  isValidWallpaperId,
  CUSTOM_WALLPAPER_ID,
} from '../utils/chatThemePresets.js';

/**
 * Resolves which conversation a theme request targets — a 1:1 peer or a
 * group — validates it (peer exists / caller is a group member), and
 * returns { field: 'peer' | 'group', id }. Sends its own error response and
 * returns null on any failure, so callers just `if (!scope) return;`.
 */
async function resolveScope(req, res) {
  if (req.params.groupId !== undefined) {
    const groupId = toObjectId(req.params.groupId);
    if (!groupId) {
      res.status(400).json({ success: false, error: 'Invalid group id' });
      return null;
    }
    const group = await Group.findById(groupId).select('members');
    if (!group) {
      res.status(404).json({ success: false, error: 'Group not found' });
      return null;
    }
    if (!group.isMember(req.user._id)) {
      res.status(403).json({ success: false, error: 'Not a group member' });
      return null;
    }
    return { field: 'group', id: groupId };
  }

  const peerId = toObjectId(req.params.peerId);
  if (!peerId) {
    res.status(400).json({ success: false, error: 'Invalid peer id' });
    return null;
  }
  if (String(peerId) === String(req.user._id)) {
    res.status(400).json({ success: false, error: 'Cannot set a chat theme with yourself' });
    return null;
  }
  const exists = await User.exists({ _id: peerId });
  if (!exists) {
    res.status(404).json({ success: false, error: 'User not found' });
    return null;
  }
  return { field: 'peer', id: peerId };
}

function scopeFilter(ownerId, scope) {
  return { owner: ownerId, [scope.field]: scope.id };
}

function defaultThemeJSON(scope) {
  return {
    peer: scope.field === 'peer' ? scope.id : null,
    group: scope.field === 'group' ? scope.id : null,
    presetId: null,
    bubbleColorId: 'default',
    wallpaperId: 'none',
    hasCustomWallpaper: false,
    updatedAt: null,
  };
}

// GET /api/chat-themes/presets
export async function listPresets(req, res) {
  res.json({ success: true, data: getCatalog() });
}

// GET /api/chat-themes/:peerId  |  GET /api/chat-themes/group/:groupId
export async function getChatTheme(req, res) {
  const scope = await resolveScope(req, res);
  if (!scope) return;

  const theme = await ChatTheme.findOne(scopeFilter(req.user._id, scope));
  if (!theme) {
    return res.json({ success: true, data: defaultThemeJSON(scope) });
  }
  res.json({ success: true, data: theme.toPublicJSON() });
}

// PUT /api/chat-themes/:peerId  |  PUT /api/chat-themes/group/:groupId
export async function setChatTheme(req, res) {
  const scope = await resolveScope(req, res);
  if (!scope) return;

  const { presetId, bubbleColorId, wallpaperId } = req.body;
  const filter = scopeFilter(req.user._id, scope);

  const mongoUpdate = { $set: { [scope.field]: scope.id }, $unset: {} };
  if (presetId !== undefined) {
    if (!isValidPresetId(presetId)) {
      return res.status(400).json({ success: false, error: 'Unknown presetId' });
    }
    const preset = getPresetById(presetId);
    mongoUpdate.$set = {
      ...mongoUpdate.$set,
      presetId: preset.id,
      bubbleColorId: preset.bubbleColorId,
      wallpaperId: preset.wallpaperId,
    };
    mongoUpdate.$unset = { wallpaperPath: 1, wallpaperStorageProvider: 1, wallpaperMimeType: 1 };
  } else {
    if (bubbleColorId === undefined && wallpaperId === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Provide at least one of bubbleColorId or wallpaperId (or a presetId).',
      });
    }
    if (bubbleColorId !== undefined && !isValidBubbleColorId(bubbleColorId)) {
      return res.status(400).json({ success: false, error: 'Invalid bubbleColorId' });
    }
    if (wallpaperId !== undefined && !isValidWallpaperId(wallpaperId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid wallpaperId (use the wallpaper upload route to set a custom image)',
      });
    }

    mongoUpdate.$unset = { presetId: 1 };
    if (bubbleColorId !== undefined) mongoUpdate.$set.bubbleColorId = bubbleColorId;
    if (wallpaperId !== undefined) {
      mongoUpdate.$set.wallpaperId = wallpaperId;
      mongoUpdate.$unset.wallpaperPath = 1;
      mongoUpdate.$unset.wallpaperStorageProvider = 1;
      mongoUpdate.$unset.wallpaperMimeType = 1;
    }
  }

  const previous = await ChatTheme.findOne(filter);
  const theme = await ChatTheme.findOneAndUpdate(filter, mongoUpdate, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });

  if (previous?.wallpaperPath && mongoUpdate.$unset?.wallpaperPath) {
    try {
      await getStorage().delete(previous.wallpaperPath);
    } catch {
      // best-effort
    }
  }

  res.json({ success: true, data: theme.toPublicJSON() });
}

// POST /api/chat-themes/:peerId/wallpaper  |  POST /api/chat-themes/group/:groupId/wallpaper
export async function uploadWallpaper(req, res) {
  const scope = await resolveScope(req, res);
  if (!scope) return;

  if (!req.file?.buffer) {
    return res.status(400).json({ success: false, error: 'Image file is required' });
  }

  try {
    const storage = getStorage();
    const ext = (() => {
      const raw = String(req.file.originalname || '');
      const i = raw.lastIndexOf('.');
      return i >= 0 ? raw.slice(i).toLowerCase() : '.jpg';
    })();
    const objectName = newObjectName('wallpapers', ext === '.jpeg' ? '.jpg' : ext);
    const stored = await storage.put(
      req.file.buffer,
      objectName,
      safeImageContentType(req.file.mimetype),
      String(req.user._id)
    );

    const filter = scopeFilter(req.user._id, scope);
    const previous = await ChatTheme.findOne(filter);

    const theme = await ChatTheme.findOneAndUpdate(
      filter,
      {
        $set: {
          [scope.field]: scope.id,
          wallpaperId: CUSTOM_WALLPAPER_ID,
          wallpaperPath: stored.key,
          wallpaperStorageProvider: stored.provider,
          wallpaperMimeType: safeImageContentType(req.file.mimetype),
        },
        $unset: { presetId: 1 },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    if (previous?.wallpaperPath && previous.wallpaperPath !== stored.key) {
      try {
        await storage.delete(previous.wallpaperPath);
      } catch {
        // best-effort
      }
    }

    res.json({ success: true, data: theme.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// GET /api/chat-themes/:peerId/wallpaper  |  GET /api/chat-themes/group/:groupId/wallpaper
export async function getWallpaperImage(req, res) {
  const scope = await resolveScope(req, res);
  if (!scope) return;

  try {
    const theme = await ChatTheme.findOne(scopeFilter(req.user._id, scope)).select(
      'wallpaperPath wallpaperMimeType'
    );
    if (!theme?.wallpaperPath) {
      return res.status(404).json({ success: false, error: 'No custom wallpaper set' });
    }
    const bytes = await getStorage().read(theme.wallpaperPath);
    res.setHeader('Content-Type', safeImageContentType(theme.wallpaperMimeType));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(bytes);
  } catch {
    if (!res.headersSent) {
      res.status(404).json({ success: false, error: 'Wallpaper image not found' });
    }
  }
}

// DELETE /api/chat-themes/:peerId/wallpaper  |  DELETE /api/chat-themes/group/:groupId/wallpaper
export async function deleteWallpaperImage(req, res) {
  const scope = await resolveScope(req, res);
  if (!scope) return;

  const filter = scopeFilter(req.user._id, scope);
  const theme = await ChatTheme.findOne(filter);
  if (theme?.wallpaperPath) {
    try {
      await getStorage().delete(theme.wallpaperPath);
    } catch {
      // best-effort
    }
    theme.wallpaperId = 'none';
    theme.wallpaperPath = null;
    theme.wallpaperStorageProvider = null;
    theme.wallpaperMimeType = null;
    await theme.save();
    return res.json({ success: true, data: theme.toPublicJSON() });
  }

  res.json({ success: true, data: theme ? theme.toPublicJSON() : defaultThemeJSON(scope) });
}

// DELETE /api/chat-themes/:peerId  |  DELETE /api/chat-themes/group/:groupId
export async function resetChatTheme(req, res) {
  const scope = await resolveScope(req, res);
  if (!scope) return;

  const filter = scopeFilter(req.user._id, scope);
  const theme = await ChatTheme.findOne(filter);
  if (theme?.wallpaperPath) {
    try {
      await getStorage().delete(theme.wallpaperPath);
    } catch {
      // best-effort
    }
  }
  await ChatTheme.deleteOne(filter);
  res.json({ success: true, data: defaultThemeJSON(scope) });
}