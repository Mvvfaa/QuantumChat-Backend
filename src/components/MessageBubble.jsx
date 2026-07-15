import { useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { MoreHorizontal, Pencil, Reply, Smile, Trash2 } from 'lucide-react';
import AttachmentBubble from './AttachmentBubble.jsx';
import ImageLightbox from './ImageLightbox.jsx';
import { QUICK_REACTIONS } from '../utils/emojis.js';

const MENU_GAP = 8;
const VIEW_PAD = 12;

function groupReactions(reactions = []) {
  const map = new Map();
  for (const r of reactions) {
    if (!r?.emoji) continue;
    const entry = map.get(r.emoji) || { emoji: r.emoji, count: 0, users: [] };
    entry.count += 1;
    entry.users.push(String(r.user));
    map.set(r.emoji, entry);
  }
  return [...map.values()];
}

function placePopover(anchorRect, popoverEl, { preferMine }) {
  if (!anchorRect || !popoverEl) return { top: 0, left: 0, placement: 'below' };

  const pop = popoverEl.getBoundingClientRect();
  const header = document.querySelector('.chat-header');
  const topLimit = Math.max(VIEW_PAD, header ? header.getBoundingClientRect().bottom + 6 : VIEW_PAD);
  const bottomLimit = window.innerHeight - VIEW_PAD;
  const spaceAbove = anchorRect.top - topLimit;
  const spaceBelow = bottomLimit - anchorRect.bottom;

  let placement = 'below';
  if (spaceBelow < pop.height + MENU_GAP && spaceAbove > spaceBelow) placement = 'above';
  else if (spaceAbove >= pop.height + MENU_GAP && spaceBelow < pop.height + MENU_GAP) placement = 'above';
  else if (spaceBelow >= pop.height + MENU_GAP) placement = 'below';
  else placement = spaceAbove > spaceBelow ? 'above' : 'below';

  let top =
    placement === 'above' ? anchorRect.top - pop.height - MENU_GAP : anchorRect.bottom + MENU_GAP;
  top = Math.min(Math.max(top, topLimit), bottomLimit - pop.height);

  let left = preferMine ? anchorRect.right - pop.width : anchorRect.left;
  left = Math.min(Math.max(VIEW_PAD, left), window.innerWidth - pop.width - VIEW_PAD);

  return { top, left, placement };
}

// Relative timestamp formatting
function formatRelativeTime(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Read receipt checkmark SVGs
function ReadReceipt({ status }) {
  if (!status) return null;

  if (status === 'sent') {
    return (
      <span className="read-receipt sent" title="Sent">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </span>
    );
  }

  return (
    <span className={`read-receipt ${status}`} title={status === 'read' ? 'Read' : 'Delivered'}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="18 6 7 17 2 12" />
        <polyline points="24 6 13 17 10 14" />
      </svg>
    </span>
  );
}

export default function MessageBubble({
  message,
  isMine,
  currentUserId,
  resolveSecretKey,
  resolveAttachmentKey,
  grouped,
  senderLabel,
  replyPreview,
  onDelete,
  onReact,
  onReply,
  onEdit,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reactOpen, setReactOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, placement: 'below', ready: false });
  const [lightboxSrc, setLightboxSrc] = useState(null);

  const rootRef = useRef(null);
  const moreRef = useRef(null);
  const reactBtnRef = useRef(null);
  const popoverRef = useRef(null);
  const anchorRef = useRef(null);
  const messageId = message.id || message._id;
  const reactionGroups = groupReactions(message.reactions);
  const myReaction = (message.reactions || []).find((r) => String(r.user) === String(currentUserId))?.emoji;
  const anyPopover = menuOpen || reactOpen;

  const keyResolver = resolveSecretKey || resolveAttachmentKey;

  // Determine read receipt status for own messages
  const receiptStatus = useMemo(() => {
    if (!isMine) return null;
    if (message.readAt) return 'read';
    if (message.deliveredAt) return 'delivered';
    return 'sent';
  }, [isMine, message.readAt, message.deliveredAt]);

  const relativeTime = useMemo(() => formatRelativeTime(message.createdAt), [message.createdAt]);
  const fullTime = useMemo(() => new Date(message.createdAt).toLocaleString(), [message.createdAt]);

  const hasTextContent = message.text && message.text.length > 0;
  const isDecryptionFail = message.text === null;

  function closeAll() {
    setMenuOpen(false);
    setReactOpen(false);
    setCoords((prev) => ({ ...prev, ready: false }));
  }

  function updatePlacement() {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const next = placePopover(anchor, popoverRef.current, { preferMine: isMine });
    setCoords({ ...next, ready: true });
  }

  useLayoutEffect(() => {
    if (!anyPopover) {
      setCoords((prev) => ({ ...prev, ready: false }));
      return undefined;
    }
    updatePlacement();
    const id = requestAnimationFrame(updatePlacement);
    return () => cancelAnimationFrame(id);
  }, [anyPopover, menuOpen, reactOpen, isMine]);

  useEffect(() => {
    if (!anyPopover) return undefined;

    function onDocClick(e) {
      if (rootRef.current?.contains(e.target)) return;
      if (popoverRef.current?.contains(e.target)) return;
      closeAll();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') closeAll();
    }
    function onReposition() {
      updatePlacement();
    }

    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onReposition);
    const list = document.querySelector('.message-list');
    list?.addEventListener('scroll', onReposition, { passive: true });

    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onReposition);
      list?.removeEventListener('scroll', onReposition);
    };
  }, [anyPopover, isMine]);

  const popover =
    anyPopover &&
    createPortal(
      <div
        ref={popoverRef}
        className={`message-popover ${isMine ? 'mine' : 'theirs'} ${coords.placement} ${coords.ready ? 'ready' : ''}`}
        style={{ top: coords.top, left: coords.left }}
        role={menuOpen ? 'menu' : 'listbox'}
        aria-label={menuOpen ? 'Message options' : 'Pick a reaction'}
      >
        {menuOpen && (
          <>
            {onReply && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeAll();
                  onReply(message);
                }}
              >
                <span className="message-menu-icon" aria-hidden="true">
                  <Reply size={16} strokeWidth={2} />
                </span>
                <span>Reply</span>
              </button>
            )}
            {isMine && onEdit && !message.attachment && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeAll();
                  onEdit(message);
                }}
              >
                <span className="message-menu-icon" aria-hidden="true">
                  <Pencil size={16} strokeWidth={2} />
                </span>
                <span>Edit</span>
              </button>
            )}
            {isMine && onDelete && (
              <button
                type="button"
                className="danger"
                role="menuitem"
                onClick={() => {
                  closeAll();
                  onDelete(messageId);
                }}
              >
                <span className="message-menu-icon" aria-hidden="true">
                  <Trash2 size={16} strokeWidth={2} />
                </span>
                <span>Delete for everyone</span>
              </button>
            )}
          </>
        )}

        {reactOpen && onReact && (
          <div className="reaction-picker-inline">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="option"
                aria-selected={myReaction === emoji}
                className={myReaction === emoji ? 'active' : ''}
                onClick={() => {
                  closeAll();
                  onReact(messageId, emoji);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>,
      document.body
    );

  return (
    <>
      <motion.div
        ref={rootRef}
        className={`message-row ${isMine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''} ${anyPopover ? 'popover-open' : ''}`}
        initial={grouped ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={`message-bubble-wrap ${isMine ? 'mine' : 'theirs'}`}>
          <div className={`message-bubble ${isMine ? 'mine' : 'theirs'} ${grouped ? 'grouped' : ''}`}>
            {senderLabel && !isMine && !grouped && <div className="message-sender-label">{senderLabel}</div>}
            {replyPreview && (
              <div className="message-reply-preview">
                <span className="message-reply-label">{replyPreview.label}</span>
                <span className="message-reply-text">{replyPreview.text}</span>
              </div>
            )}
            {message.attachment && (
              <AttachmentBubble
                attachment={message.attachment}
                isMine={isMine}
                resolveSecretKey={keyResolver}
                onImagePreview={setLightboxSrc}
              />
            )}
            {hasTextContent ? message.text : isDecryptionFail ? <em>[Unable to decrypt message]</em> : null}
            <div className="message-time" title={fullTime}>
              {relativeTime}
              {message.editedAt ? <span className="message-edited"> · edited</span> : null}
              {isMine && <ReadReceipt status={receiptStatus} />}
            </div>
          </div>

          <div className="message-action-cluster">
            {onReact && (
              <button
                ref={reactBtnRef}
                type="button"
                className={`message-react-btn ${reactOpen || myReaction ? 'visible' : ''}`}
                aria-label="Add reaction"
                onClick={() => {
                  anchorRef.current = reactBtnRef.current;
                  setReactOpen((v) => !v);
                  setMenuOpen(false);
                }}
              >
                <Smile size={16} strokeWidth={2} aria-hidden="true" />
              </button>
            )}
            <button
              ref={moreRef}
              type="button"
              className={`message-more-btn ${anyPopover ? 'visible' : ''}`}
              aria-label="Message options"
              aria-expanded={anyPopover}
              onClick={() => {
                anchorRef.current = moreRef.current;
                setMenuOpen((v) => !v);
                setReactOpen(false);
              }}
            >
              <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>

        {popover}

        {reactionGroups.length > 0 && (
          <div className={`message-reactions ${isMine ? 'mine' : 'theirs'}`}>
            {reactionGroups.map((g) => (
              <button
                key={g.emoji}
                type="button"
                className={`reaction-chip ${g.users.includes(String(currentUserId)) ? 'mine' : ''}`}
                onClick={() => onReact?.(messageId, g.emoji)}
                aria-label={`React with ${g.emoji}`}
                disabled={!onReact}
              >
                <span>{g.emoji}</span>
                {g.count > 1 && <span className="reaction-count">{g.count}</span>}
              </button>
            ))}
          </div>
        )}
      </motion.div>
      {lightboxSrc && (
        <ImageLightbox
          src={lightboxSrc}
          alt={message.attachment?.filename || 'Image preview'}
          isOpen={true}
          onClose={() => setLightboxSrc(null)}
        />
      )}
    </>
  );
}
