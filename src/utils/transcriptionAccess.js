export function getDirectTranscriptTargetKey(message, userId) {
  if (!message || message.group) return null;

  const id = String(userId);
  if (String(message.from) === id) {
    return message.forSender?.targetPublicKey || null;
  }
  if (String(message.to) === id) {
    return message.forRecipient?.targetPublicKey || null;
  }
  return null;
}

export function getGroupTranscriptTargetKey(message, userId) {
  if (!message?.group || !Array.isArray(message.envelopes)) return null;
  const id = String(userId);
  const mine = message.envelopes.find((entry) => String(entry.user) === id);
  return mine?.targetPublicKey || null;
}

export function getTranscriptTargetKey(message, userId) {
  return getDirectTranscriptTargetKey(message, userId) || getGroupTranscriptTargetKey(message, userId);
}

export function isDirectTranscriptTargetAllowed(message, userId, targetPublicKey) {
  const expectedTargetPublicKey = getTranscriptTargetKey(message, userId);
  return Boolean(
    expectedTargetPublicKey &&
    /^[0-9a-f]{64}$/i.test(targetPublicKey || '') &&
    String(targetPublicKey).toLowerCase() === String(expectedTargetPublicKey).toLowerCase(),
  );
}