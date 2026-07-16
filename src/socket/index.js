import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const onlineUsers = new Map(); // userId -> Set(socketId)

function setOnline(userId, socketId) {
  if (!onlineUsers.has(userId)) onlineUsers.set(userId, new Set());
  onlineUsers.get(userId).add(socketId);
}

function setOffline(userId, socketId) {
  const set = onlineUsers.get(userId);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    onlineUsers.delete(userId);
    return true;
  }
  return false;
}

export function isUserOnline(userId) {
  return onlineUsers.has(String(userId));
}

export function getOnlineUserIds() {
  return [...onlineUsers.keys()];
}

async function canBroadcastOnline(userId) {
  try {
    const user = await User.findById(userId).select('privacy');
    return user?.privacy?.online !== 'nobody';
  } catch {
    return true;
  }
}

export function attachSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Missing auth token'));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(payload.id);
      if (!user) return next(new Error('User not found'));

      socket.userId = user._id.toString();
      socket.privacyOnline = user.privacy?.online !== 'nobody';
      next();
    } catch (err) {
      next(new Error('Invalid or expired token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.userId;
    socket.join(userId);
    setOnline(userId, socket.id);

    (async () => {
      const visible = socket.privacyOnline ?? (await canBroadcastOnline(userId));
      if (visible) {
        io.emit('presence:update', { userId, online: true });
      }
      // Snapshot only includes users who allow online visibility
      const ids = getOnlineUserIds();
      const users = await User.find({ _id: { $in: ids } }).select('privacy');
      const visibleIds = users
        .filter((u) => u.privacy?.online !== 'nobody')
        .map((u) => String(u._id));
      socket.emit('presence:snapshot', { onlineUserIds: visibleIds });
    })();

    socket.on('typing:start', ({ to } = {}) => {
      if (!to) return;
      io.to(String(to)).emit('typing:start', { from: userId });
    });

    socket.on('typing:stop', ({ to } = {}) => {
      if (!to) return;
      io.to(String(to)).emit('typing:stop', { from: userId });
    });

    socket.on('message:delivered', async ({ messageId } = {}) => {
      try {
        if (!messageId) return;
        const Message = (await import('../models/Message.js')).default;
        const msg = await Message.findById(messageId);
        if (!msg || msg.group) return;
        if (String(msg.to) !== userId) return;
        if (msg.deliveredAt) return;
        msg.deliveredAt = new Date();
        await msg.save();
        const payload = {
          id: msg._id.toString(),
          deliveredAt: msg.deliveredAt,
          readAt: msg.readAt || null,
        };
        io.to(String(msg.from)).emit('message:status', payload);
        io.to(userId).emit('message:status', payload);
      } catch {
        // ignore
      }
    });

    socket.on('disconnect', async () => {
      socket.leave(userId);
      const wentOffline = setOffline(userId, socket.id);
      if (wentOffline) {
        try {
          await User.findByIdAndUpdate(userId, { lastLoginAt: new Date() });
        } catch {
          // ignore
        }
        const visible = await canBroadcastOnline(userId);
        if (visible) {
          io.emit('presence:update', { userId, online: false, lastLoginAt: new Date().toISOString() });
        }
      }
    });
  });
}
