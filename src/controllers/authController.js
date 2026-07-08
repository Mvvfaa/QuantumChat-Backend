import User from '../models/User.js';
import { generateToken } from '../utils/generateToken.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

export async function register(req, res) {
  try {
    const { username, email, password, publicKey } = req.body;

    if (!username || !email || !password || !publicKey) {
      return res.status(400).json({
        success: false,
        error: 'username, email, password and publicKey are all required',
      });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    if (!HEX_64.test(publicKey)) {
      return res.status(400).json({
        success: false,
        error: 'publicKey must be a 64-character hex string (32-byte X25519 public key)',
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
      publicKey: publicKey.toLowerCase(),
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
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, error: 'Invalid email or password' });
    }

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
