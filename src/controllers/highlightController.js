import path from 'path';
import { getStorage, isSafeImageMime, newObjectName, safeImageContentType } from '../middleware/upload.js';
import Highlight from '../models/Highlight.js';
import User from '../models/User.js';
import { toObjectId } from '../utils/toObjectId.js';
import { areUsersBlocked } from './userController.js';

function mediaTypeFromMime(mimetype = '') {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return null;
}

async function canViewProfile(viewer, ownerId) {
  const ownerOid = toObjectId(ownerId);
  if (!ownerOid) return false;
  if (String(viewer._id) === String(ownerOid)) return true;
  if (await areUsersBlocked(viewer._id, ownerOid)) return false;
  const owner = await User.findById(ownerOid).select('privacy blockedUsers friends');
  if (!owner) return false;
  const visibility = owner.privacy?.profileVisibility || 'everyone';
  if (visibility === 'nobody') return false;
  if (visibility === 'friends') {
    const friends = (owner.friends || []).map(String);
    return friends.includes(String(viewer._id));
  }
  return true;
}

async function storeCoverFile(file, userId) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const safeExt = ext === '.svg' ? '' : ext;
  const objectName = newObjectName('highlight-covers', safeExt);
  const mime = isSafeImageMime(file.mimetype) ? file.mimetype : 'image/jpeg';
  return getStorage().put(file.buffer, objectName, mime, String(userId));
}

export async function listHighlights(req, res) {
  try {
    const userId = toObjectId(req.query.userId || req.user._id);
    if (!userId) {
      return res.status(400).json({ success: false, error: 'Invalid user id' });
    }
    if (!(await canViewProfile(req.user, userId))) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }

    const highlights = await Highlight.find({ owner: userId }).sort({ order: 1, createdAt: 1 });
    const isOwner = String(req.user._id) === String(userId);

    const list = highlights
      .filter((h) => isOwner || (h.items && h.items.length > 0))
      .map((h) => h.toPublicJSON());

    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getHighlight(req, res) {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid highlight id' });
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (!(await canViewProfile(req.user, highlight.owner))) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }
    const isOwner = String(req.user._id) === String(highlight.owner);
    if (!isOwner && !(highlight.items || []).length) {
      return res.status(404).json({ success: false, error: 'Highlight not found' });
    }
    res.json({ success: true, data: highlight.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** Create a new named highlight, optionally with a custom cover image. */
export async function createHighlight(req, res) {
  try {
    const name = String(req.body.name || '').trim().slice(0, 40);
    if (!name) {
      return res.status(400).json({ success: false, error: 'Highlight name is required' });
    }

    const count = await Highlight.countDocuments({ owner: req.user._id });
    if (count >= Highlight.maxPerUser) {
      return res.status(400).json({
        success: false,
        error: `You can only have ${Highlight.maxPerUser} highlights`,
      });
    }

    const highlight = new Highlight({
      owner: req.user._id,
      name,
      order: count,
      items: [],
    });

    if (req.file?.buffer) {
      const stored = await storeCoverFile(req.file, req.user._id);
      highlight.coverStoragePath = stored.key;
      highlight.coverMimeType = isSafeImageMime(req.file.mimetype) ? req.file.mimetype : 'image/jpeg';
      highlight.coverStorageProvider = stored.provider;
      highlight.coverIsCustom = true;
    }

    await highlight.save();
    res.status(201).json({ success: true, data: highlight.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** Rename a highlight and/or replace its cover. */
export async function updateHighlight(req, res) {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid highlight id' });
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (String(highlight.owner) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    if (typeof req.body.name === 'string') {
      const name = req.body.name.trim().slice(0, 40);
      if (!name) return res.status(400).json({ success: false, error: 'Highlight name is required' });
      highlight.name = name;
    }

    if (req.file?.buffer) {
      const oldCover = highlight.coverIsCustom ? highlight.coverStoragePath : null;
      const stored = await storeCoverFile(req.file, req.user._id);
      highlight.coverStoragePath = stored.key;
      highlight.coverMimeType = isSafeImageMime(req.file.mimetype) ? req.file.mimetype : 'image/jpeg';
      highlight.coverStorageProvider = stored.provider;
      highlight.coverIsCustom = true;
      if (oldCover) {
        try {
          await getStorage().delete(oldCover);
        } catch {
          // best-effort
        }
      }
    }

    await highlight.save();
    res.json({ success: true, data: highlight.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** Add media to an existing highlight (by id — no more implicit create-by-category). */
export async function addHighlightItem(req, res) {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid highlight id' });
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (String(highlight.owner) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'Media file is required' });
    }
    if ((highlight.items || []).length >= Highlight.maxItems) {
      return res.status(400).json({
        success: false,
        error: `This highlight already has ${Highlight.maxItems} items`,
      });
    }

    const mimetype = req.file.mimetype || 'application/octet-stream';
    let mediaType =
      mediaTypeFromMime(mimetype) ||
      (['image', 'video', 'audio'].includes(String(req.body.mediaType || ''))
        ? String(req.body.mediaType)
        : null);
    if (!mediaType && mimetype === 'application/octet-stream') mediaType = 'image';
    if (!mediaType) {
      return res.status(400).json({ success: false, error: 'Unsupported media type' });
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const safeExt = ext === '.svg' ? '' : ext;
    const objectName = newObjectName('highlights', safeExt);
    const storeMime =
      mimetype === 'application/octet-stream'
        ? mediaType === 'video'
          ? 'video/mp4'
          : mediaType === 'audio'
            ? 'audio/mp4'
            : 'image/jpeg'
        : mimetype;

    const stored = await getStorage().put(req.file.buffer, objectName, storeMime, String(req.user._id));

    let durationMs = Number(req.body.durationMs || 0);
    if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;

    const caption = typeof req.body.caption === 'string' ? req.body.caption.trim().slice(0, 200) : '';
    const sourceStoryId = toObjectId(req.body.sourceStoryId);

    highlight.items.push({
      mediaType,
      filename: req.file.originalname || objectName,
      mimetype: storeMime,
      size: req.file.size,
      storagePath: stored.key,
      storageProvider: stored.provider,
      durationMs,
      caption,
      sourceStoryId,
      addedAt: new Date(),
    });

    // Only auto-derive a cover if the user hasn't set a custom one.
    if (!highlight.coverIsCustom && !highlight.coverStoragePath) {
      highlight.coverStoragePath = stored.key;
      highlight.coverMimeType = storeMime;
      highlight.coverStorageProvider = stored.provider;
    }

    await highlight.save();
    res.status(201).json({ success: true, data: highlight.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function deleteHighlight(req, res) {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid highlight id' });
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (String(highlight.owner) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const storage = getStorage();
    const paths = new Set();
    if (highlight.coverStoragePath) paths.add(highlight.coverStoragePath);
    for (const item of highlight.items || []) {
      if (item.storagePath) paths.add(item.storagePath);
    }
    for (const p of paths) {
      try {
        await storage.delete(p);
      } catch {
        // best-effort
      }
    }
    await Highlight.deleteOne({ _id: highlight._id });
    res.json({ success: true, data: { id: String(id) } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function deleteHighlightItem(req, res) {
  try {
    const id = toObjectId(req.params.id);
    const itemId = toObjectId(req.params.itemId);
    if (!id || !itemId) return res.status(400).json({ success: false, error: 'Invalid id' });
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (String(highlight.owner) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const item = (highlight.items || []).id(itemId);
    if (!item) return res.status(404).json({ success: false, error: 'Item not found' });

    const storage = getStorage();
    try {
      if (item.storagePath) await storage.delete(item.storagePath);
    } catch {
      // ignore
    }

    // Only fall back to an item-derived cover if the cover wasn't custom
    // and it was actually pointing at the item being removed.
    const wasAutoCover =
      !highlight.coverIsCustom && highlight.coverStoragePath && highlight.coverStoragePath === item.storagePath;
    item.deleteOne();

    if (wasAutoCover) {
      const nextCover = (highlight.items || []).find((i) => i.mediaType === 'image') || highlight.items?.[0];
      if (nextCover) {
        highlight.coverStoragePath = nextCover.storagePath;
        highlight.coverMimeType = nextCover.mimetype;
        highlight.coverStorageProvider = nextCover.storageProvider;
      } else {
        highlight.coverStoragePath = '';
        highlight.coverMimeType = '';
        highlight.coverStorageProvider = '';
      }
    }

    await highlight.save();
    res.json({ success: true, data: highlight.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getHighlightCover(req, res) {
  try {
    const id = toObjectId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid highlight id' });
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (!(await canViewProfile(req.user, highlight.owner))) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }

    let storagePath = highlight.coverStoragePath;
    let mimetype = highlight.coverMimeType || 'image/jpeg';
    if (!storagePath) {
      const first = (highlight.items || []).find((i) => i.mediaType === 'image') || (highlight.items || [])[0];
      if (!first?.storagePath) return res.status(404).json({ success: false, error: 'No cover' });
      storagePath = first.storagePath;
      mimetype = first.mimetype;
    }

    const bytes = await getStorage().read(storagePath);
    res.setHeader('Content-Type', isSafeImageMime(mimetype) ? safeImageContentType(mimetype) : mimetype || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  } catch (err) {
    if (!res.headersSent) res.status(404).json({ success: false, error: 'Cover missing' });
  }
}

export async function getHighlightItemMedia(req, res) {
  try {
    const id = toObjectId(req.params.id);
    const itemId = toObjectId(req.params.itemId);
    if (!id || !itemId) return res.status(400).json({ success: false, error: 'Invalid id' });
    const highlight = await Highlight.findById(id);
    if (!highlight) return res.status(404).json({ success: false, error: 'Highlight not found' });
    if (!(await canViewProfile(req.user, highlight.owner))) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }
    const item = (highlight.items || []).id(itemId);
    if (!item?.storagePath) return res.status(404).json({ success: false, error: 'Item not found' });

    const bytes = await getStorage().read(item.storagePath);
    if (isSafeImageMime(item.mimetype)) {
      res.setHeader('Content-Type', safeImageContentType(item.mimetype));
      res.setHeader('Content-Disposition', 'inline');
    } else if (String(item.mimetype || '').startsWith('video/') || String(item.mimetype || '').startsWith('audio/')) {
      res.setHeader('Content-Type', item.mimetype);
      res.setHeader('Content-Disposition', 'inline');
    } else {
      res.setHeader('Content-Type', item.mimetype || 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  } catch (err) {
    if (!res.headersSent) res.status(404).json({ success: false, error: 'Media missing' });
  }
}