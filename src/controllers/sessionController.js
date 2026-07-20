import crypto from 'crypto';
import DeviceSession from '../models/DeviceSession.js';

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 64);
}

/**
 * Create a DeviceSession after successful login.
 * Returns the new session document (caller includes sessionId in the response).
 */
export async function registerSession(userId, req, { deviceLabel } = {}) {
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 512);
  const label =
    (typeof deviceLabel === 'string' && deviceLabel.trim()
      ? deviceLabel.trim()
      : userAgent || 'Unknown device'
    ).slice(0, 200);

  const session = await DeviceSession.create({
    user: userId,
    sessionId: crypto.randomUUID(),
    label,
    userAgent,
    ip: clientIp(req),
    lastSeenAt: new Date(),
  });
  return session;
}

export async function listSessions(req, res) {
  try {
    const sessions = await DeviceSession.find({
      user: req.user._id,
      revokedAt: null,
    }).sort({ lastSeenAt: -1 });
    res.json({ success: true, data: sessions.map((s) => s.toJSON()) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function revokeSession(req, res) {
  try {
    const sessionId = String(req.params.sessionId || '').trim();
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'sessionId is required' });
    }

    const session = await DeviceSession.findOne({
      user: req.user._id,
      sessionId,
      revokedAt: null,
    });
    if (!session) {
      return res.status(404).json({ success: false, error: 'Session not found' });
    }

    session.revokedAt = new Date();
    await session.save();

    res.json({
      success: true,
      data: {
        session: session.toJSON(),
        message: 'Session revoked',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
