import { toClientMessage } from '../controllers/messageController.js';
import Message from '../models/Message.js';
import User from '../models/User.js';
import { conversationKey } from '../utils/conversationKey.js';
import { sealForPublicKey } from '../utils/sealedBox.js';
import { createNotification } from './notificationService.js';
import { notifyUser } from './pushService.js';

/**
 * Sends every mentioned user a real DM ("tagged you in their story"),
 * Instagram-style — a genuine message in their normal chat with the
 * story's author, not just a push notification.
 *
 * Fires for BOTH public and hidden mentions — the visibility setting only
 * controls what OTHER story viewers see, not whether the mentioned person
 * themselves is told. Silently skips a self-mention and anyone missing a
 * public key.
 */
export async function sendStoryMentionMessages(io, story) {
  const mentions = Array.isArray(story.mentions) ? story.mentions : [];
  if (!mentions.length) return;

  const authorId = String(story.user?._id || story.user);
  const author = await User.findById(authorId).select('publicKeys username');
  if (!author?.publicKeys?.length) return;

  for (const m of mentions) {
    const mentionedId = String(m.user?._id || m.user);
    if (mentionedId === authorId) continue;

    try {
      const mentionedUser = await User.findById(mentionedId).select('publicKeys blockedUsers');
      if (!mentionedUser?.publicKeys?.length) continue;

      const authorBlocked = (author.blockedUsers || []).some((id) => String(id) === mentionedId);
      const mentionedBlocked = (mentionedUser.blockedUsers || []).some((id) => String(id) === authorId);
      if (authorBlocked || mentionedBlocked) continue;

      const text = `🏷️ mentioned you in their story`;
      const message = await Message.create({
        from: authorId,
        to: mentionedId,
        forRecipient: sealForPublicKey(text, mentionedUser.publicKeys[0]),
        forSender: sealForPublicKey(text, author.publicKeys[0]),
        kind: 'story_mention',
        storyRef: story._id,
      });

      const payload = toClientMessage(message);

      if (io) {
        io.to(mentionedId).emit('message:new', payload);
        io.to(authorId).emit('message:new', payload);
      }

      notifyUser(mentionedId, {
        title: 'QuantumChat',
        body: 'New message',
        kind: 'dm',
        conversationKey: conversationKey({ from: authorId, to: mentionedId }),
        url: `/chat/${authorId}`,
        actions: [
          { action: 'reply', title: 'Reply', type: 'text', placeholder: 'Type a reply…' },
          { action: 'mark_read', title: 'Mark as Read' },
        ],
        data: { fromUserId: authorId },
      }).catch(() => {});
      // No `push` passed here — the notifyUser() call just above already
      // covers the push for this event (it's the same DM-send push every
      // normal message gets). This just persists it for the Activity feed
      // and unread count, and emits the live in-app event.
      createNotification({
        recipient: mentionedId,
        actor: authorId,
        type: 'STORY_MENTION',
        entityType: 'story',
        entityId: story._id,
        metadata: { mentionType: m.visibility },
        expiresAt: story.expiresAt || null,
        io,
      }).catch(() => {});
    } catch (err) {
      console.error(`Failed to send story-mention message to ${mentionedId}:`, err.message);
    }
  }
}