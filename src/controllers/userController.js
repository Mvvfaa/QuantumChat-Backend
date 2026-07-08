import User from '../models/User.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

const PUBLIC_FIELDS = 'username email publicKey keyRotatedAt lastLoginAt';

export async function listUsers(req, res) {
  const users = await User.find({ _id: { $ne: req.user._id } }).select(PUBLIC_FIELDS);
  res.json({ success: true, data: users.map((u) => u.toPublicJSON()) });
}

export async function getUser(req, res) {
  const user = await User.findById(req.params.id).select(PUBLIC_FIELDS);
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });
  res.json({ success: true, data: user.toPublicJSON() });
}

// Lets a user register a fresh keypair from a new/wiped device. Any messages
// encrypted under the old public key become permanently undecryptable — this
// is an inherent tradeoff of true E2E encryption, not a bug.
export async function updatePublicKey(req, res) {
  const { publicKey } = req.body;
  if (!HEX_64.test(publicKey || '')) {
    return res.status(400).json({
      success: false,
      error: 'publicKey must be a 64-character hex string (32-byte X25519 public key)',
    });
  }
  req.user.publicKey = publicKey.toLowerCase();
  req.user.keyRotatedAt = new Date();
  await req.user.save();
  res.json({ success: true, data: req.user.toPublicJSON() });
}
