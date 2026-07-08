import User, { KEY_SET_SIZE } from '../models/User.js';
import { generateToken } from '../utils/generateToken.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

function validateKeySet(publicKeys) {
  return Array.isArray(publicKeys) && publicKeys.length === KEY_SET_SIZE && publicKeys.every((k) => HEX_64.test(k));
}

export async function register(req, res) {
  try {
    const { username, email, password, publicKeys } = req.body;

    if (!username || !email || !password || !publicKeys) {
      return res.status(400).json({
        success: false,
        error: 'username, email, password and publicKeys are all required',
      });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    if (!validateKeySet(publicKeys)) {
      return res.status(400).json({
        success: false,
        error: `publicKeys must be an array of ${KEY_SET_SIZE} 64-character hex X25519 public keys`,
      });
    }

    const existing = await User.findOne({ $or: [{ email: email.toLowerCase() }, { username }] });
    if (existing) {
      return res.status(409).json({ success: false, error: 'Username or email already in use' });
    }

    const user = await User.create({
      username,
      email,
      password,
      publicKeys: publicKeys.map((k) => k.toLowerCase()),
      lastLoginAt: new Date(),
    });
    const token = generateToken(user._id);

    res.status(201).json({ success: true, data: { token, user: user.toPublicJSON() } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function login(req, res) {
  try {
    const { email, password, publicKeys } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'email and password are required' });
    }
    if (!validateKeySet(publicKeys)) {
      return res.status(400).json({
        success: false,
        error: `publicKeys must be an array of ${KEY_SET_SIZE} 64-character hex X25519 public keys`,
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

    // Every successful login rotates the whole key set, not just the
    // periodic 30-minute timer. The client generates a fresh 5 keypairs
    // before calling this endpoint and keeps the old ones in its local
    // keyring, so past messages sealed under the retired keys stay
    // decryptable — only the publicly-advertised set changes here.
    user.publicKeys = publicKeys.map((k) => k.toLowerCase());
    user.keyRotatedAt = new Date();
    user.lastLoginAt = new Date();
    await user.save();

    const token = generateToken(user._id);
    res.json({ success: true, data: { token, user: user.toPublicJSON() } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function me(req, res) {
  res.json({ success: true, data: { user: req.user.toPublicJSON() } });
}
