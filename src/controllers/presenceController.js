import User from '../models/User.js';
import {
  canViewerSeeUserLastSeen,
  canViewerSeeUserOnline,
} from '../utils/presencePrivacy.js';
import { toObjectId } from '../utils/toObjectId.js';

/** Consider a user online if they heartbeat within this window. */
export const PRESENCE_ONLINE_MS = 45_000;
/** Typing expires quickly so the indicator clears without an explicit stop. */
export const PRESENCE_TYPING_MS = 5_000;

/**
 * REST presence/typing for serverless hosts where Socket.IO cannot stay open.
 * One POST both refreshes the caller's heartbeat and returns a filtered snapshot.
 *
 * Also bumps lastLoginAt so "last seen" tracks real activity (not only login time).
 */
export async function heartbeatPresence(req, res) {
  try {
    const viewerId = req.user._id;
    const body = req.body || {};
    const now = new Date();

    const typingEnabled = req.user.privacy?.typingIndicator !== false;
    let typingTo = null;
    let typingGroupId = null;
    let typingAt = null;

    if (typingEnabled) {
      const toId = body.typingTo != null ? toObjectId(body.typingTo) : null;
      const groupId = body.typingGroupId != null ? toObjectId(body.typingGroupId) : null;
      if (toId && !toId.equals(viewerId)) {
        typingTo = toId;
        typingAt = now;
      } else if (groupId) {
        typingGroupId = groupId;
        typingAt = now;
      }
    }

    await User.updateOne(
      { _id: viewerId },
      {
        $set: {
          presenceAt: now,
          // Keep last seen = last real activity for REST clients (no socket disconnect).
          lastLoginAt: now,
          typingTo,
          typingGroupId,
          typingAt,
        },
      },
    );

    const onlineCutoff = new Date(now.getTime() - PRESENCE_ONLINE_MS);
    const typingCutoff = new Date(now.getTime() - PRESENCE_TYPING_MS);

    const onlineUsers = await User.find({ presenceAt: { $gte: onlineCutoff } })
      .select('privacy friends typingTo typingGroupId typingAt')
      .lean();

    const onlineUserIds = onlineUsers
      .filter((u) => canViewerSeeUserOnline(u, viewerId))
      .map((u) => String(u._id));

    const watchPeerId = body.watchPeerId != null ? String(body.watchPeerId) : null;
    const watchGroupId = body.watchGroupId != null ? String(body.watchGroupId) : null;
    const typing = [];

    for (const u of onlineUsers) {
      if (String(u._id) === String(viewerId)) continue;
      if (u.privacy?.typingIndicator === false) continue;
      if (!u.typingAt || new Date(u.typingAt) < typingCutoff) continue;

      if (
        watchPeerId &&
        String(u._id) === watchPeerId &&
        u.typingTo &&
        String(u.typingTo) === String(viewerId)
      ) {
        typing.push({ from: String(u._id) });
      }

      if (
        watchGroupId &&
        u.typingGroupId &&
        String(u.typingGroupId) === watchGroupId
      ) {
        typing.push({ from: String(u._id), groupId: watchGroupId });
      }
    }

    let peerPresence = null;
    if (watchPeerId && toObjectId(watchPeerId)) {
      const peer = await User.findById(watchPeerId)
        .select('privacy friends lastLoginAt presenceAt')
        .lean();
      if (peer) {
        const online = onlineUserIds.includes(String(peer._id));
        const showLastSeen = canViewerSeeUserLastSeen(peer, viewerId);
        // Use the newest of presence heartbeat and lastLoginAt.
        const presenceMs = peer.presenceAt ? new Date(peer.presenceAt).getTime() : 0;
        const loginMs = peer.lastLoginAt ? new Date(peer.lastLoginAt).getTime() : 0;
        const activityMs = Math.max(presenceMs, loginMs);
        const activityAt = activityMs > 0 ? new Date(activityMs) : null;
        peerPresence = {
          userId: String(peer._id),
          online,
          lastLoginAt:
            showLastSeen && activityAt ? activityAt.toISOString() : null,
        };
      }
    }

    return res.json({
      success: true,
      data: { onlineUserIds, typing, peerPresence },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
