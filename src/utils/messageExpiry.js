export const ALLOWED_EXPIRES_IN_SECONDS = [30, 300, 3600, 86400, 604800];

/** @returns {Date|undefined|null} Date when valid, undefined when off, null when invalid */
export function resolveExpiresAt(expiresInSeconds) {
  if (expiresInSeconds == null || expiresInSeconds === '' || expiresInSeconds === false) {
    return undefined;
  }
  const n = Number(expiresInSeconds);
  if (!Number.isFinite(n) || n === 0) return undefined;
  if (!ALLOWED_EXPIRES_IN_SECONDS.includes(n)) return null;
  return new Date(Date.now() + n * 1000);
}

export function notExpiredFilter(now = new Date()) {
  return {
    $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
  };
}
