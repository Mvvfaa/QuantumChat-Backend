import { toClientMessage } from '../controllers/messageController.js';
import Message from '../models/Message.js';
import { notifyUser } from '../services/pushService.js';
import { conversationKey } from '../utils/conversationKey.js';

const BATCH_SIZE = 100;

/**
 * Unlocks time-capsule DMs whose unlocksAt has arrived: marks them
 * delivered, pushes the now-full message over the socket to both
 * participants, and sends the usual push notification. Mirrors
 * publishScheduledStories.js's io-passthrough pattern — Vercel serverless
 * has no persistent setInterval, so this is driven by an external cron
 * hitting /api/cron/time-capsules, same as the birthday sweep.
 */
export async function runTimeCapsuleDelivery(io) {
  const now = new Date();
  const due = await Message.find({
    timeCapsule: true,
    unlocksAt: { $lte: now },
    capsuleDeliveredAt: null,
  }).limit(BATCH_SIZE);

  let deliveredCount = 0;

  for (const message of due) {
    // Atomic claim — if two overlapping ticks pick up the same capsule,
    // only one wins, so the recipient is never double-notified.
    const claim = await Message.updateOne(
      { _id: message._id, capsuleDeliveredAt: null },
      { $set: { capsuleDeliveredAt: now } }
    );
    if (claim.modifiedCount !== 1) continue;

    const fromId = message.from.toString();
    const toId = message.to.toString();
    const isSelfChat = fromId === toId;
    // Unredacted now — unlocksAt has passed, toClientMessage stops hiding it.
    const payload = toClientMessage(message, toId);

    if (io) {
      io.to(toId).emit('message:new', payload);
      if (!isSelfChat) io.to(fromId).emit('message:new', payload);
    }

    if (!isSelfChat) {
      await notifyUser(message.to, {
        title: 'QuantumChat',
        body: 'A time capsule you received just unlocked',
        kind: 'dm',
        conversationKey: conversationKey({ from: message.from, to: message.to }),
        url: `/chat/${fromId}`,
        actions: [
          { action: 'reply', title: 'Reply', type: 'text', placeholder: 'Type a reply…' },
          { action: 'mark_read', title: 'Mark as Read' },
        ],
        data: { fromUserId: fromId },
      }).catch((error) => {
        console.error(`Failed to send time-capsule unlock notification to ${toId}:`, error);
      });
    }

    deliveredCount += 1;
  }

  return deliveredCount;
}