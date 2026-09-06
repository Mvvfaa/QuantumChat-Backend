import mongoose from 'mongoose';
import path from 'path';
import { getStorage, isSafeImageMime, newObjectName, safeImageContentType } from '../middleware/upload.js';
import Story from '../models/Story.js';
import { areUsersBlocked } from './userController.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

function mediaTypeFromMime(mimetype = '') {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return null;
}

function parseSealedFlag(value) {
  if (value === true || value === 1) return true;
  const s = String(value || '').toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function parseEnvelopes(raw) {
  let list = raw;
  if (typeof raw === 'string') {
    try {
      list = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list) || !list.length) return null;
  const out = [];
  for (const item of list) {
    if (
      !item ||
      !mongoose.isValidObjectId(item.user) ||
      typeof item.ciphertext !== 'string' ||
      typeof item.nonce !== 'string' ||
      !HEX_64.test(item.ephemeralPublicKey || '') ||
      !HEX_64.test(item.targetPublicKey || '')
    ) {
      return null;
    }
    out.push({
      user: item.user,
      ciphertext: item.ciphertext,
      nonce: item.nonce,
      ephemeralPublicKey: String(item.ephemeralPublicKey).toLowerCase(),
      targetPublicKey: String(item.targetPublicKey).toLowerCase(),
    });
  }
  return out;
}

export async function createStory(req, res) {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'Media file is required' });
    }

    const sealed = parseSealedFlag(req.body.sealed);
    const declaredMime = typeof req.body.mimetype === 'string' ? req.body.mimetype.trim() : '';
    const mimetype = sealed && declaredMime ? declaredMime : req.file.mimetype;
    const mediaType =
      mediaTypeFromMime(mimetype) ||
      (['image', 'video', 'audio', 'text'].includes(String(req.body.mediaType || ''))
        ? String(req.body.mediaType)
        : null);

    if (!mediaType) {
      return res.status(400).json({ success: false, error: 'Unsupported media type' });
    }

    let durationMs = Number(req.body.durationMs || 0);
    if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;
    if ((mediaType === 'video' || mediaType === 'audio') && durationMs > Story.maxDurationMs) {
      return res.status(400).json({
        success: false,
        error: `Stories must be ${Story.maxDurationMs / 1000} seconds or shorter`,
      });
    }
    if (mediaType === 'image') durationMs = 0;

    let ttlMs = Number(req.body.ttlMs || 0);
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      ttlMs = Story.ttlMs; // fallback to default (24h)
    } else {
      ttlMs = Math.min(Math.max(ttlMs, Story.minTtlMs), Story.maxTtlMs);
    }

    const caption =
      sealed
        ? ''
        : typeof req.body.caption === 'string'
          ? req.body.caption.trim().slice(0, 200)
          : '';

    const allowReplies = parseSealedFlag(
      req.body.allowReplies === undefined ? true : req.body.allowReplies
    );

    let envelopes;
    let contentIv;
    if (sealed) {
      envelopes = parseEnvelopes(req.body.envelopes);
      if (!envelopes) {
        return res.status(400).json({
          success: false,
          error: 'Sealed stories require per-viewer X5 envelopes',
        });
      }
      const selfIncluded = envelopes.some((e) => String(e.user) === String(req.user._id));
      if (!selfIncluded) {
        return res.status(400).json({
          success: false,
          error: 'Sealed stories must include an envelope for the author',
        });
      }

      // --- Story privacy enforcement (new) ---
      // Reject envelopes for viewers outside the author's configured story
      // audience. Clients build the envelope list themselves, so this can't
      // be trusted without a server-side check.
      const storyPrivacy = req.user.privacy?.story || 'everyone';
      if (storyPrivacy !== 'everyone') {
        const authorId = String(req.user._id);
        const friendSet = new Set((req.user.friends || []).map((id) => String(id)));
        const selectedSet = new Set(
          (req.user.privacy?.storyViewers || []).map((id) => String(id))
        );
        const disallowed = envelopes.find((e) => {
          const viewerId = String(e.user);
          if (viewerId === authorId) return false;
          if (storyPrivacy === 'nobody') return true;
          if (storyPrivacy === 'friends') return !friendSet.has(viewerId);
          if (storyPrivacy === 'selected') return !selectedSet.has(viewerId);
          return false;
        });
        if (disallowed) {
          return res.status(400).json({
            success: false,
            error: 'Story envelopes include a viewer outside your story privacy audience',
          });
        }
      }
      contentIv = typeof req.body.contentIv === 'string' ? req.body.contentIv.slice(0, 128) : '';
      if (!contentIv) {
        return res.status(400).json({ success: false, error: 'contentIv is required for sealed stories' });
      }
    }

    const ext = path.extname(req.file.originalname || '').toLowerCase();
    const safeExt = ext === '.svg' ? '' : ext;
    const objectName = newObjectName('stories', safeExt);
    const stored = await getStorage().put(
      req.file.buffer,
      objectName,
      mimetype || req.file.mimetype || 'application/octet-stream',
      String(req.user._id)
    );

    const story = await Story.create({
      user: req.user._id,
      mediaType,
      filename: req.file.originalname || objectName,
      mimetype: mimetype || req.file.mimetype,
      size: req.file.size,
      storagePath: stored.key,
      storageProvider: stored.provider,
      durationMs,
      caption,
     expiresAt: new Date(Date.now() + ttlMs),
      sealed,
      allowReplies,
      contentIv: sealed ? contentIv : undefined,
      envelopes: sealed ? envelopes : undefined,
    });

    const payload = {
      ...story.toPublicJSON(),
      user: {
        id: req.user._id,
        username: req.user.username,
        hasAvatar: Boolean(req.user.avatarPath),
      },
    };

    const io = req.app.get('io');
    if (io) io.emit('story:new', payload);

    res.status(201).json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function listStories(req, res) {
  try {
    const now = new Date();
    const blocked = new Set((req.user.blockedUsers || []).map(String));
    const stories = await Story.find({ expiresAt: { $gt: now } })
      .sort({ createdAt: -1 })
      .populate('user', 'username avatarPath');

    const viewerId = String(req.user._id);
    const filtered = [];
    for (const story of stories) {
      const ownerId = String(story.user?._id || story.user);
      if (blocked.has(ownerId)) continue;
      if (await areUsersBlocked(req.user._id, ownerId)) continue;
      if (story.sealed) {
        const envelopes = story.envelopes || [];
        const allowed = envelopes.some((e) => String(e.user) === viewerId);
        if (!allowed) continue;
      }
      filtered.push({
        ...(() => {
          const pub = story.toPublicJSON();
          // Only ship this viewer's envelope — smaller list payload, faster unlock.
          if (pub.sealed && Array.isArray(pub.envelopes)) {
            pub.envelopes = pub.envelopes.filter((e) => String(e.user) === viewerId);
          }
          return pub;
        })(),
        user: {
          id: ownerId,
          username: story.user?.username || 'User',
          hasAvatar: Boolean(story.user?.avatarPath),
        },
      });
    }

    res.json({ success: true, data: filtered });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
export async function getStoryById(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid story id' });
    }
    const story = await Story.findById(id).populate('user', 'username avatarPath');
    if (!story || story.expiresAt <= new Date()) {
      return res.status(404).json({ success: false, error: 'Story not found or expired' });
    }
    const ownerId = String(story.user?._id || story.user);
    if (await areUsersBlocked(req.user._id, ownerId)) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }
    if (story.sealed) {
      const envelopes = story.envelopes || [];
      const allowed = envelopes.some((e) => String(e.user) === String(req.user._id));
      if (!allowed) {
        return res.status(404).json({ success: false, error: 'Story not found or expired' });
      }
    }
    res.json({
      success: true,
      data: {
        ...story.toPublicJSON(),
        user: {
          id: ownerId,
          username: story.user?.username || 'User',
          hasAvatar: Boolean(story.user?.avatarPath),
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
export async function getStoryMedia(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid story id' });
    }
    const story = await Story.findById(id);
    if (!story || story.expiresAt <= new Date()) {
      return res.status(404).json({ success: false, error: 'Story not found or expired' });
    }
    if (await areUsersBlocked(req.user._id, story.user)) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }

    if (story.sealed) {
      const envelopes = story.envelopes || [];
      const allowed = envelopes.some((e) => String(e.user) === String(req.user._id));
      if (!allowed) {
        return res.status(403).json({
          success: false,
          error: 'Not in sealed story audience',
          sealed: true,
        });
      }
    }

    const bytes = await getStorage().read(story.storagePath);
    if (story.sealed) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-QuantumChat-Sealed', '1');
    } else if (isSafeImageMime(story.mimetype)) {
      res.setHeader('Content-Type', safeImageContentType(story.mimetype));
      res.setHeader('Content-Disposition', 'inline');
    } else if (
      String(story.mimetype || '').startsWith('video/') ||
      String(story.mimetype || '').startsWith('audio/')
    ) {
      res.setHeader('Content-Type', story.mimetype);
      res.setHeader('Content-Disposition', 'inline');
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(bytes);
  } catch (err) {
    if (!res.headersSent) {
      res.status(404).json({ success: false, error: 'Media missing' });
    }
  }
}

/** Records that the current user viewed a story. Called once per open. */
export async function markStoryViewed(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid story id' });
    }
    const story = await Story.findById(id);
    if (!story || story.expiresAt <= new Date()) {
      return res.status(404).json({ success: false, error: 'Story not found or expired' });
    }
    const ownerId = String(story.user);
    const viewerId = String(req.user._id);

    // Don't record self-views, and respect the same blocked-user gate as reads.
    if (viewerId === ownerId) {
      return res.json({ success: true, data: { recorded: false } });
    }
    if (await areUsersBlocked(req.user._id, ownerId)) {
      return res.status(403).json({ success: false, error: 'Not allowed' });
    }

    const result = await Story.updateOne(
  { _id: id, 'views.user': { $ne: req.user._id } },
  { $push: { views: { user: req.user._id, viewedAt: new Date() } } }
  );
  const wasNewView = result.modifiedCount === 1;

  if (wasNewView) {
    const io = req.app.get('io');
    if (io) {
      const updated = await Story.findById(id).select('views');
      io.to(ownerId).emit('story:viewed', {
        storyId: String(story._id),
        viewer: { id: viewerId, username: req.user.username, hasAvatar: Boolean(req.user.avatarPath) },
        viewedAt: new Date().toISOString(),
        viewerCount: updated.views.length,
      });
    }
  }

    res.json({ success: true, data: { recorded: wasNewView } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/** Returns the viewer list for a story. Owner-only. */
export async function getStoryViewers(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid story id' });
    }
    const story = await Story.findById(id).populate('views.user', 'username avatarPath');
    if (!story) {
      return res.status(404).json({ success: false, error: 'Story not found' });
    }
    if (String(story.user) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const viewers = (story.views || [])
      .slice()
      .sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt))
      .map((v) => ({
        id: String(v.user?._id || v.user),
        username: v.user?.username || 'User',
        hasAvatar: Boolean(v.user?.avatarPath),
        viewedAt: v.viewedAt,
      }));

    res.json({ success: true, data: { viewerCount: viewers.length, viewers } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function deleteStory(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid story id' });
    }
    const story = await Story.findById(id);
    if (!story) return res.status(404).json({ success: false, error: 'Story not found' });
    if (story.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    try {
      if (story.storagePath) await getStorage().delete(story.storagePath);
    } catch {
      // ignore
    }
    await Story.deleteOne({ _id: story._id });
    const io = req.app.get('io');
    if (io) io.emit('story:deleted', { id });
    res.json({ success: true, data: { id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
