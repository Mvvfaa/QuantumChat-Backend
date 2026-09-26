import Story from '../models/Story.js';
import { notifyUser } from '../services/pushService.js';

/**
 * Publish scheduled stories whose publishAt has arrived.
 * Emits story:new for each newly published story.
 */
export async function publishDueStories(io) {
  const now = new Date();
  const due = await Story.find({
    status: 'scheduled',
    publishAt: { $lte: now },
  })
    .limit(50)
    .populate('user', 'username avatarPath')
    .populate('mentions.user', 'username avatarPath');

  if (!due.length) return 0;

  let published = 0;
  for (const story of due) {
    const ttl = story.ttlMs || Story.ttlMs;
    story.status = 'published';
    story.expiresAt = new Date(now.getTime() + ttl);
    if (!story.publishAt) story.publishAt = now;
    await story.save();
    published += 1;

    if (!io) continue;
    const owner = story.user;
    const mentions = Array.isArray(story.mentions) ? story.mentions : [];
    io.emit('story:new', {
      ...story.toPublicJSON(),
      mentions: mentions
        .filter((m) => m.visibility === 'public')
        .map((m) => ({
          user: {
            id: m.user?._id || m.user,
            username: m.user?.username || 'User',
            hasAvatar: Boolean(m.user?.avatarPath),
          },
          visibility: m.visibility,
        })),
      user: {
        id: owner?._id || story.user,
        username: owner?.username || 'User',
        hasAvatar: Boolean(owner?.avatarPath),
      },
    });
    for (const m of mentions) {
      const targetId = String(m.user?._id || m.user);
      if (targetId === String(story.user?._id || story.user)) continue;
      notifyUser(targetId, {
        title: 'QuantumChat',
        body: `${owner?.username || 'Someone'} mentioned you in their story`,
        kind: 'story_mention',
        conversationKey: `story-mention:${story._id}`,
        url: `/stories/${story._id}`,
        data: { storyId: String(story._id) },
      }).catch(() => {});
    }
  }

  return published;
}

export async function runStoryPublishJobs(io) {
  try {
    return await publishDueStories(io);
  } catch (err) {
    console.error('publishDueStories failed:', err.message);
    return 0;
  }
}
