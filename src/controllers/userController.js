import User, { KEY_SET_SIZE } from '../models/User.js';
import mongoose from 'mongoose';
import fs from 'fs';
import { resolveUploadPath } from '../middleware/upload.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

const PUBLIC_FIELDS = 'username email publicKeys keyRotatedAt lastLoginAt blockedUsers avatarPath avatarMimeType';

export async function areUsersBlocked(userAId, userBId) {
  const [a, b] = await Promise.all([
    User.findById(userAId).select('blockedUsers'),
    User.findById(userBId).select('blockedUsers'),
  ]);
  if (!a || !b) return true;
  const aBlocked = (a.blockedUsers || []).some((id) => String(id) === String(userBId));
  const bBlocked = (b.blockedUsers || []).some((id) => String(id) === String(userAId));
  return aBlocked || bBlocked;
}

export async function listUsers(req, res) {
  const blockedIds = (req.user.blockedUsers || []).map((id) => id);
  const users = await User.find({
    _id: { $nin: [req.user._id, ...blockedIds] },
  }).select(PUBLIC_FIELDS);
  res.json({ success: true, data: users.map((u) => u.toPublicJSON()) });
}

export async function getUser(req, res) {
  const user = await User.findById(req.params.id).select(PUBLIC_FIELDS);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  if (await areUsersBlocked(req.user._id, user._id)) {
    return res.status(403).json({ success: false, error: 'User is blocked' });
  }
  res.json({ success: true, data: user.toPublicJSON() });
}

export async function blockUser(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ success: false, error: 'Invalid user id' });
  }
  if (String(id) === String(req.user._id)) {
    return res.status(400).json({ success: false, error: 'You cannot block yourself' });
  }

  const target = await User.findById(id).select('_id');
  if (!target) return res.status(404).json({ success: false, error: 'User not found' });

  await User.updateOne({ _id: req.user._id }, { $addToSet: { blockedUsers: target._id } });
  const me = await User.findById(req.user._id);
  res.json({ success: true, data: me.toSelfJSON() });
}

export async function unblockUser(req, res) {
  const { id } = req.params;
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ success: false, error: 'Invalid user id' });
  }

  await User.updateOne({ _id: req.user._id }, { $pull: { blockedUsers: id } });
  const me = await User.findById(req.user._id);
  res.json({ success: true, data: me.toSelfJSON() });
}

// Replaces the whole 5-key pool: used by the periodic 30-minute client-side
// rotation, and to recover a wiped/new device. Messages sealed under keys
// that are no longer in the pool stay decryptable only on devices whose
// local keyring still holds the matching private key — an inherent
// tradeoff of true E2E encryption, not a bug.
export async function updatePublicKeys(req, res) {
  const { publicKeys } = req.body;
  const valid = Array.isArray(publicKeys) && publicKeys.length === KEY_SET_SIZE && publicKeys.every((k) => HEX_64.test(k));
  if (!valid) {
    return res.status(400).json({
      success: false,
      error: `publicKeys must be an array of ${KEY_SET_SIZE} 64-character hex X25519 public keys`,
    });
  }
  req.user.publicKeys = publicKeys.map((k) => k.toLowerCase());
  req.user.keyRotatedAt = new Date();
  await req.user.save();
  res.json({ success: true, data: req.user.toSelfJSON() });
}

export async function uploadAvatar(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Image file is required' });
    }

    const relativePath = `avatars/${req.file.filename}`;
    if (req.user.avatarPath) {
      try {
        fs.unlink(resolveUploadPath(req.user.avatarPath), () => {});
      } catch {
        // ignore missing old file
      }
    }

    req.user.avatarPath = relativePath;
    req.user.avatarMimeType = req.file.mimetype;
    await req.user.save();
    res.json({ success: true, data: req.user.toSelfJSON() });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getAvatar(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user id' });
    }
    const user = await User.findById(id).select('avatarPath avatarMimeType');
    if (!user?.avatarPath) {
      return res.status(404).json({ success: false, error: 'No avatar' });
    }
    const filePath = resolveUploadPath(user.avatarPath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Avatar file missing' });
    }
    res.setHeader('Content-Type', user.avatarMimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
