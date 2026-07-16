import crypto from 'crypto';
import User, { KEY_SET_SIZE } from '../models/User.js';
import { generateToken } from '../utils/generateToken.js';
import { appBaseUrl, sendAppMail, shouldExposeEmailLinks } from '../utils/mail.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

function validateKeySet(publicKeys) {
  return Array.isArray(publicKeys) && publicKeys.length === KEY_SET_SIZE && publicKeys.every((k) => HEX_64.test(k));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function register(req, res) {
  try {
    const { username, email, password, publicKeys, displayName } = req.body;

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

    const user = new User({
      username,
      email,
      password,
      displayName: typeof displayName === 'string' ? displayName.trim().slice(0, 60) : '',
      publicKeys: publicKeys.map((k) => k.toLowerCase()),
      lastLoginAt: new Date(),
      emailVerified: false,
    });
    const verifyToken = user.createEmailVerifyToken();
    await user.save();

    const verifyUrl = `${appBaseUrl()}/verify-email?token=${verifyToken}`;
    await sendAppMail({
      to: user.email,
      subject: 'Verify your QuantumChat email',
      text: `Welcome to QuantumChat.\n\nVerify your email:\n${verifyUrl}\n\nThis link expires in 24 hours.`,
    });

    const token = generateToken(user._id);
    const payload = { token, user: user.toSelfJSON() };
    if (shouldExposeEmailLinks()) payload.verifyUrl = verifyUrl;

    res.status(201).json({ success: true, data: payload });
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
    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: user.lastLoginAt } });

    const token = generateToken(user._id);
    res.json({ success: true, data: { token, user: user.toSelfJSON() } });
  } catch (err) {
    console.error('login failed:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function me(req, res) {
  res.json({ success: true, data: { user: req.user.toSelfJSON() } });
}

export async function changePassword(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: 'currentPassword and newPassword are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, error: 'New password must be at least 8 characters' });
    }
    const user = await User.findById(req.user._id).select('+password');
    if (!user || !(await user.comparePassword(currentPassword))) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }
    user.password = newPassword;
    await user.save();
    res.json({ success: true, data: { message: 'Password updated' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function forgotPassword(req, res) {
  try {
    const email = String(req.body?.email || '')
      .trim()
      .toLowerCase();
    const generic = {
      success: true,
      data: {
        message:
          'If an account exists for that email, password reset instructions were generated. This only resets login access — message keys stay on your devices.',
      },
    };
    if (!email) return res.status(400).json({ success: false, error: 'email is required' });

    const user = await User.findOne({ email });
    if (!user) return res.json(generic);

    const resetToken = user.createPasswordResetToken();
    await user.save({ validateBeforeSave: false });
    const resetUrl = `${appBaseUrl()}/reset-password?token=${resetToken}`;
    await sendAppMail({
      to: user.email,
      subject: 'Reset your QuantumChat password',
      text: `Reset your password (expires in 1 hour):\n${resetUrl}\n\nThis does not restore encrypted message keys. Keep your keys.txt backup safe.`,
    });

    if (shouldExposeEmailLinks()) generic.data.resetUrl = resetUrl;
    res.json(generic);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function resetPassword(req, res) {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ success: false, error: 'token and newPassword are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    const hashed = hashToken(String(token));
    const user = await User.findOne({
      passwordResetToken: hashed,
      passwordResetExpires: { $gt: new Date() },
    }).select('+password +passwordResetToken +passwordResetExpires');
    if (!user) {
      return res.status(400).json({ success: false, error: 'Reset link is invalid or expired' });
    }
    user.password = newPassword;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    res.json({
      success: true,
      data: {
        message: 'Password reset. Log in with your new password. Local encryption keys are unchanged.',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function verifyEmail(req, res) {
  try {
    const token = String(req.body?.token || req.query?.token || '');
    if (!token) return res.status(400).json({ success: false, error: 'token is required' });
    const hashed = hashToken(token);
    const user = await User.findOne({
      emailVerifyToken: hashed,
      emailVerifyExpires: { $gt: new Date() },
    }).select('+emailVerifyToken +emailVerifyExpires');
    if (!user) {
      return res.status(400).json({ success: false, error: 'Verification link is invalid or expired' });
    }
    user.emailVerified = true;
    user.emailVerifyToken = undefined;
    user.emailVerifyExpires = undefined;
    await user.save();
    res.json({ success: true, data: { user: user.toSelfJSON(), message: 'Email verified' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function resendVerification(req, res) {
  try {
    const user = await User.findById(req.user._id).select('+emailVerifyToken +emailVerifyExpires');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.emailVerified) {
      return res.json({ success: true, data: { message: 'Email already verified', user: user.toSelfJSON() } });
    }
    const verifyToken = user.createEmailVerifyToken();
    await user.save({ validateBeforeSave: false });
    const verifyUrl = `${appBaseUrl()}/verify-email?token=${verifyToken}`;
    await sendAppMail({
      to: user.email,
      subject: 'Verify your QuantumChat email',
      text: `Verify your email:\n${verifyUrl}\n\nExpires in 24 hours.`,
    });
    const data = { message: 'Verification email generated', user: user.toSelfJSON() };
    if (shouldExposeEmailLinks()) data.verifyUrl = verifyUrl;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
