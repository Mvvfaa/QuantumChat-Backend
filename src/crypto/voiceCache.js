const PREFIX = 'qc_voice_';

function toBase64(bytes) {
  let binary = '';
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice);
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function attachmentIdOf(attachmentOrId) {
  if (!attachmentOrId) return null;
  if (typeof attachmentOrId === 'string') return attachmentOrId;
  return attachmentOrId.id != null
    ? String(attachmentOrId.id)
    : attachmentOrId._id != null
      ? String(attachmentOrId._id)
      : null;
}

/** Normalize API attachment docs so the UI always has `id` + envelope fields. */
export function normalizeAttachment(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return { id: raw };
  }
  const id = attachmentIdOf(raw);
  if (!id) return null;
  return {
    ...raw,
    id,
    filename: raw.filename || 'attachment',
    mimetype: raw.mimetype || 'application/octet-stream',
  };
}

/** Cache a voice note locally so the sender can replay it after send. */
export function cacheVoiceNote(attachmentId, { bytes, mimetype }) {
  const id = attachmentIdOf(attachmentId);
  if (!id || !bytes) return;
  try {
    localStorage.setItem(
      PREFIX + id,
      JSON.stringify({ mimetype: mimetype || 'audio/webm', data: toBase64(bytes) })
    );
  } catch {
    // Quota exceeded — voice still sends; sender just can't replay locally.
  }
}

export function getCachedVoiceNote(attachmentId) {
  const id = attachmentIdOf(attachmentId);
  if (!id) return null;
  try {
    const raw = localStorage.getItem(PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data) return null;
    return {
      mimetype: parsed.mimetype || 'audio/webm',
      bytes: fromBase64(parsed.data),
    };
  } catch {
    return null;
  }
}

export function pickRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}
