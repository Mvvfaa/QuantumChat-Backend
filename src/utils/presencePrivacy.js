/**
 * Whether `viewerId` is allowed to see that `targetUser` is online.
 * Shared by Socket.IO presence and REST heartbeat fallback.
 */
export function canViewerSeeUserOnline(targetUser, viewerId) {
  if (!targetUser || !viewerId) return false;
  const targetId = String(targetUser._id || targetUser.id || '');
  if (targetId === String(viewerId)) return true;

  const privacy = targetUser.privacy || {};
  let setting = privacy.onlineStatus;
  if (!setting) {
    setting = privacy.online === 'nobody' ? 'selected' : (privacy.online || 'everyone');
  }

  if (setting === 'everyone') return true;
  if (setting === 'nobody') return false;

  const friendIds = (targetUser.friends || []).map((f) => String(f._id || f));
  const vId = String(viewerId);

  if (setting === 'friends') {
    return friendIds.includes(vId);
  }

  if (setting === 'selected') {
    const visibleTo = (privacy.onlineStatusVisibleTo || []).map((u) => String(u._id || u));
    return visibleTo.includes(vId);
  }

  return true;
}

/**
 * Whether `viewerId` may see `targetUser`'s last-seen timestamp.
 */
export function canViewerSeeUserLastSeen(targetUser, viewerId) {
  if (!targetUser || !viewerId) return false;
  const targetId = String(targetUser._id || targetUser.id || '');
  if (targetId === String(viewerId)) return true;

  const setting = targetUser.privacy?.lastSeen || 'everyone';
  if (setting === 'everyone') return true;
  if (setting === 'nobody') return false;

  if (setting === 'friends') {
    const friendIds = (targetUser.friends || []).map((f) => String(f._id || f));
    return friendIds.includes(String(viewerId));
  }

  return false;
}
