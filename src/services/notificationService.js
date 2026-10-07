import Notification from '../models/Notification.js';
import { notifyUser } from './pushService.js';

/**
 * The one place that creates a Notification row. Every future event source
 * (friend requests, reactions, group mentions, story mentions, ...) should
 * call this rather than writing to the model directly, so the "never
 * notify yourself" rule and the live socket + push fan-out can't be
 * forgotten at a new call site.
 *
 * `push`, if given, is passed straight through to notifyUser() — same
 * shape used everywhere else in the app (title/body/kind/conversationKey/
 * actions/data). Pass nothing to skip the push and only persist + emit the
 * in-app event (e.g. for something that already sends its own push, like
 * story mentions piggybacking on sendStoryMentionMessages's DM push).
 */
export async function createNotification({
  recipient,
  actor,
  type,
  entityType,
  entityId,
  metadata,
  expiresAt,
  io,
  push,
}) {
  const recipientId = String(recipient);
  const actorId = actor ? String(actor) : null;
  if (actorId && actorId === recipientId) return null;

  const doc = await Notification.create({
    recipient: recipientId,
    actor: actorId,
    type,
    entityType,
    entityId,
    metadata,
    expiresAt: expiresAt || null,
  });

  if (io) {
    io.to(recipientId).emit('notification:new', doc.toPublicJSON());
  }

  if (push) {
    notifyUser(recipientId, push).catch(() => {});
  }

  return doc;
}

export async function getUnreadCount(userId) {
  return Notification.countDocuments({ recipient: userId, readAt: null });
}

export async function listNotifications(userId, { before, limit = 30, unreadOnly = false } = {}) {
  const query = { recipient: userId };
  if (unreadOnly) query.readAt = null;
  if (before) {
    const beforeDate = new Date(before);
    if (!Number.isNaN(beforeDate.getTime())) query.createdAt = { $lt: beforeDate };
  }
  const cap = Math.min(Math.max(Number(limit) || 30, 1), 100);
  return Notification.find(query)
    .sort({ createdAt: -1 })
    .limit(cap)
    .populate('actor', 'username avatarPath');
}

export async function markRead(userId, ids) {
  const list = (Array.isArray(ids) ? ids : [ids]).map(String);
  const result = await Notification.updateMany(
    { _id: { $in: list }, recipient: userId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return result.modifiedCount;
}

export async function markAllRead(userId) {
  const result = await Notification.updateMany(
    { recipient: userId, readAt: null },
    { $set: { readAt: new Date() } }
  );
  return result.modifiedCount;
}   