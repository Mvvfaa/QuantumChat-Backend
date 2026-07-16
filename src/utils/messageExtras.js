// Local-only message extras (do not affect E2E ciphertext on the server).

function key(userId, suffix) {
  return `qc:${suffix}:${userId}`;
}

function readSet(userId, suffix) {
  try {
    const raw = localStorage.getItem(key(userId, suffix));
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function writeSet(userId, suffix, set) {
  localStorage.setItem(key(userId, suffix), JSON.stringify([...set]));
}

export function getDeletedForMeIds(userId) {
  return [...readSet(userId, 'deleted-for-me')];
}

export function deleteMessageForMe(userId, messageId) {
  const set = readSet(userId, 'deleted-for-me');
  set.add(String(messageId));
  writeSet(userId, 'deleted-for-me', set);
  return [...set];
}

export function isDeletedForMe(userId, messageId) {
  return readSet(userId, 'deleted-for-me').has(String(messageId));
}

export function getStarredIds(userId) {
  return [...readSet(userId, 'starred')];
}

export function toggleStarredMessage(userId, messageId) {
  const set = readSet(userId, 'starred');
  const id = String(messageId);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  writeSet(userId, 'starred', set);
  return [...set];
}

export function isStarredMessage(userId, messageId) {
  return readSet(userId, 'starred').has(String(messageId));
}

/** Pins are scoped per conversation key (dm:userId or group:groupId). */
export function getPinnedIds(userId, conversationKey) {
  return [...readSet(userId, `pinned:${conversationKey}`)];
}

export function togglePinnedMessage(userId, conversationKey, messageId) {
  const set = readSet(userId, `pinned:${conversationKey}`);
  const id = String(messageId);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  writeSet(userId, `pinned:${conversationKey}`, set);
  return [...set];
}

export function isPinnedMessage(userId, conversationKey, messageId) {
  return readSet(userId, `pinned:${conversationKey}`).has(String(messageId));
}
