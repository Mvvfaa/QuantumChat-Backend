import { useEffect, useState } from 'react';
import client from '../api/client.js';
import { secretboxOpen } from '../crypto/keys.js';
import AttachmentBubble from './AttachmentBubble.jsx';

function MentionText({ text }) {
  const parts = [];
  const re = /(@[a-zA-Z0-9_.-]{2,32})/g;
  let last = 0;
  let match;
  while ((match = re.exec(text || ''))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <span key={match.index} className="mention-chip">
        {match[1]}
      </span>
    );
    last = match.index + match[1].length;
  }
  if (last < (text || '').length) parts.push(text.slice(last));
  return <>{parts}</>;
}

function GroupFileCard({ payload, resolveSecretKey }) {
  const [url, setUrl] = useState(null);
  const [status, setStatus] = useState('idle');
  const [mime, setMime] = useState(payload.mimetype || 'application/octet-stream');

  useEffect(() => {
    let revoked;
    let cancelled = false;
    async function load() {
      if (!payload?.attachmentId || !payload.key || !payload.nonce) return;
      setStatus('loading');
      try {
        const res = await client.get(`/attachments/${payload.attachmentId}/raw`, { responseType: 'arraybuffer' });
        if (cancelled) return;
        const plain = secretboxOpen(new Uint8Array(res.data), payload.nonce, payload.key);
        if (!plain) {
          setStatus('error');
          return;
        }
        const type = payload.mimetype || 'application/octet-stream';
        setMime(type);
        const objectUrl = URL.createObjectURL(new Blob([plain], { type }));
        revoked = objectUrl;
        setUrl(objectUrl);
        setStatus('idle');
      } catch {
        if (!cancelled) setStatus('error');
      }
    }
    load();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [payload?.attachmentId, payload?.key, payload?.nonce, payload?.mimetype]);

  if (status === 'loading') return <div className="skeleton attachment-preview-placeholder" />;
  if (status === 'error' || !url) {
    return (
      <div className="attachment-chip">
        <span>{payload.filename || 'Encrypted file'}</span>
        <span className="attachment-note">can&apos;t decrypt</span>
      </div>
    );
  }

  if (mime.startsWith('image/')) {
    return <img className="attachment-preview" src={url} alt={payload.filename || 'Image'} />;
  }
  if (mime.startsWith('video/')) {
    return <video className="attachment-video" src={url} controls playsInline />;
  }
  if (mime.startsWith('audio/')) {
    return <audio src={url} controls className="attachment-audio" />;
  }
  if (mime === 'application/pdf') {
    return <iframe className="attachment-pdf" src={url} title={payload.filename || 'PDF'} />;
  }

  return (
    <div className="attachment-chip">
      <span>{payload.filename || 'File'}</span>
      <a href={url} download={payload.filename || 'download'}>
        Download
      </a>
    </div>
  );
}

export default function GroupMessageContent({
  message,
  payload,
  currentUserId,
  onVotePoll,
  resolveSecretKey,
  attachment,
  isMine,
  onImagePreview,
  onImageReady,
}) {
  if (!payload || payload.type === 'text') {
    const body = payload?.body ?? message?.text ?? '';
    return (
      <div className="message-text">
        <MentionText text={body} />
      </div>
    );
  }

  if (payload.type === 'announcement') {
    return (
      <div className="group-announcement">
        <span className="group-kind-badge">Announcement</span>
        <MentionText text={payload.body || ''} />
      </div>
    );
  }

  if (payload.type === 'event') {
    return (
      <div className="group-event-card">
        <span className="group-kind-badge">Event</span>
        <strong>{payload.title || 'Event'}</strong>
        {payload.when && <div className="group-event-row">When: {new Date(payload.when).toLocaleString()}</div>}
        {payload.where && <div className="group-event-row">Where: {payload.where}</div>}
        {payload.notes && <div className="group-event-notes">{payload.notes}</div>}
      </div>
    );
  }

  if (payload.type === 'poll') {
    const votes = message.pollVotes || [];
    const total = votes.length;
    const myVote = votes.find((v) => String(v.user) === String(currentUserId));
    const options = payload.options || [];
    return (
      <div className="group-poll-card">
        <span className="group-kind-badge">Poll</span>
        <strong>{payload.question}</strong>
        <div className="group-poll-options">
          {options.map((opt, idx) => {
            const count = votes.filter((v) => v.optionIndex === idx).length;
            const pct = total ? Math.round((count / total) * 100) : 0;
            const selected = myVote?.optionIndex === idx;
            return (
              <button
                key={idx}
                type="button"
                className={`group-poll-option ${selected ? 'selected' : ''}`}
                onClick={() => onVotePoll?.(message.id || message._id, idx)}
                disabled={!onVotePoll}
              >
                <span className="group-poll-fill" style={{ width: `${pct}%` }} />
                <span className="group-poll-label">
                  {opt}
                  <em>
                    {count} · {pct}%
                  </em>
                </span>
              </button>
            );
          })}
        </div>
        <div className="group-poll-meta">{total} vote{total === 1 ? '' : 's'}</div>
      </div>
    );
  }

  if (payload.type === 'file') {
    return <GroupFileCard payload={payload} resolveSecretKey={resolveSecretKey} />;
  }

  if (attachment) {
    return (
      <AttachmentBubble
        attachment={attachment}
        isMine={isMine}
        resolveSecretKey={resolveSecretKey}
        onImagePreview={onImagePreview}
        onImageReady={onImageReady}
      />
    );
  }

  return <MentionText text={message?.text || ''} />;
}
