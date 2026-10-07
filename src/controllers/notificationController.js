import mongoose from 'mongoose';
import { getUnreadCount, listNotifications, markAllRead, markRead } from '../services/notificationService.js';

export async function getUnreadCountHandler(req, res) {
  try {
    const count = await getUnreadCount(req.user._id);
    res.json({ success: true, data: { count } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

function toClientNotification(doc) {
  const pub = doc.toPublicJSON();
  return {
    ...pub,
    actor: doc.actor
      ? { id: doc.actor._id, username: doc.actor.username, hasAvatar: Boolean(doc.actor.avatarPath) }
      : null,
  };
}

export async function listNotificationsHandler(req, res) {
  try {
    const limit = req.query.limit;
    const docs = await listNotifications(req.user._id, {
      before: req.query.before,
      limit,
      unreadOnly: req.query.unread === 'true',
    });
    const cap = Math.min(Math.max(Number(limit) || 30, 1), 100);
    res.json({
      success: true,
      data: docs.map(toClientNotification),
      meta: { hasMore: docs.length === cap },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function markReadHandler(req, res) {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => mongoose.isValidObjectId(id))) {
      return res.status(400).json({ success: false, error: 'ids must be a non-empty array of valid ids' });
    }
    const modified = await markRead(req.user._id, ids);
    res.json({ success: true, data: { modified } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function markAllReadHandler(req, res) {
  try {
    const modified = await markAllRead(req.user._id);
    res.json({ success: true, data: { modified } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}