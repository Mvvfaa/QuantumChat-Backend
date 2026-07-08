import User, { KEY_SET_SIZE } from '../models/User.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

const PUBLIC_FIELDS = 'username email publicKeys keyRotatedAt lastLoginAt';

export async function listUsers(req, res) {
  const users = await User.find({ _id: { $ne: req.user._id } }).select(PUBLIC_FIELDS);
  res.json({ success: true, data: users.map((u) => u.toPublicJSON()) });
}

export async function getUser(req, res) {
  const user = await User.findById(req.params.id).select(PUBLIC_FIELDS);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, data: user.toPublicJSON() });
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
  res.json({ success: true, data: req.user.toPublicJSON() });
}
