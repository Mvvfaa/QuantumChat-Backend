import fs from 'fs';
import mongoose from 'mongoose';
import Story from '../models/Story.js';
import { resolveUploadPath } from '../middleware/upload.js';
import { areUsersBlocked } from './userController.js';

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

export async function createStory(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Media file is required' });
    }

    const sealed = parseSealedFlag(req.body.sealed);
    const declaredMime = typeof req.body.mimetype === 'string' ? req.body.mimetype.trim() : '';
    const mimetype = sealed && declaredMime ? declaredMime : req.file.mimetype;
    const mediaType =
      mediaTypeFromMime(mimetype) ||
      (['image', 'video', 'audio'].includes(String(req.body.mediaType || ''))
        ? String(req.body.mediaType)
        : null);

    if (!mediaType) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, error: 'Unsupported media type' });
    }

    let durationMs = Number(req.body.durationMs || 0);
    if (!Number.isFinite(durationMs) || durationMs < 0) durationMs = 0;
    if ((mediaType === 'video' || mediaType === 'audio') && durationMs > Story.maxDurationMs) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({
        success: false,
        error: `Stories must be ${Story.maxDurationMs / 1000} seconds or shorter`,
      });
    }
    if (mediaType === 'image') durationMs = 0;

    // Caption may remain empty when sealed (client may omit plaintext caption).
    const caption =
      sealed
        ? ''
        : typeof req.body.caption === 'string'
          ? req.body.caption.trim().slice(0, 200)
          : '';
    const relativePath = `stories/${req.file.filename}`;
    const story = await Story.create({
      user: req.user._id,
      mediaType,
      filename: req.file.originalname || req.file.filename,
      mimetype: mimetype || req.file.mimetype,
      size: req.file.size,
      storagePath: relativePath,
      durationMs,
      caption,
      expiresAt: new Date(Date.now() + Story.ttlMs),
      sealed,
      envelopeNonce:
        typeof req.body.envelopeNonce === 'string' ? req.body.envelopeNonce.slice(0, 128) : undefined,
      envelopeEphemeralPublicKey:
        typeof req.body.envelopeEphemeralPublicKey === 'string'
          ? req.body.envelopeEphemeralPublicKey.slice(0, 128)
          : undefined,
      envelopeTargetHint:
        typeof req.body.envelopeTargetHint === 'string'
          ? req.body.envelopeTargetHint.slice(0, 128)
          : undefined,
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
    if (req.file?.path) fs.unlink(req.file.path, () => {});
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

    const filtered = [];
    for (const story of stories) {
      const ownerId = String(story.user?._id || story.user);
      if (blocked.has(ownerId)) continue;
      if (await areUsersBlocked(req.user._id, ownerId)) continue;
      filtered.push({
        ...story.toPublicJSON(),
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

    // Sealed stories: only the author can download ciphertext (device-local key decrypt).
    if (story.sealed && String(story.user) !== String(req.user._id)) {
      return res.status(403).json({
        success: false,
        error: 'Sealed story — unavailable on this build',
        sealed: true,
      });
    }

    const filePath = resolveUploadPath(story.storagePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Media missing' });
    }
    res.setHeader('Content-Type', story.sealed ? 'application/octet-stream' : story.mimetype);
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (story.sealed) res.setHeader('X-QuantumChat-Sealed', '1');
    fs.createReadStream(filePath).pipe(res);
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
      fs.unlink(resolveUploadPath(story.storagePath), () => {});
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
