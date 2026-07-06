import { useState, type ReactNode } from 'react';
import { useWidget } from '../../context/WidgetContext';
import { Avatar } from '../ui/Avatar';
import { formatMessageTime } from '../../utils/helpers';
import { encryptEditedContent } from '../../utils/messageCrypto';
import { EncryptedAttachment } from './EncryptedAttachment';
import type { IMessage, IAttachment } from '@quantum-chat/shared';

const REACTIONS = ['👍', '❤️', '😂', '🔥', '👏'];

interface MessageBubbleProps {
  message: IMessage & {
    senderId: { _id: string; displayName: string; avatarUrl?: string };
    attachments?: Array<IAttachment | string>;
  };
  isOwn: boolean;
  onReply: (message: IMessage) => void;
}

function isPopulatedAttachment(a: IAttachment | string): a is IAttachment {
  return typeof a === 'object' && a !== null && '_id' in a;
}

function IconReply() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 015 5v2M3 10l4-4M3 10l4 4" />
    </svg>
  );
}

function IconReact() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function IconEdit() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
    </svg>
  );
}

function IconDelete() {
  return (
    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}

function MessageAction({
  label,
  onClick,
  icon,
  variant = 'default',
}: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  variant?: 'default' | 'danger' | 'primary';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`qc-msg-action-btn qc-msg-action-btn--${variant}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function MessageBubble({ message, isOwn, onReply }: MessageBubbleProps) {
  const { state, api, dispatch, config } = useWidget();
  const [showReactions, setShowReactions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const attachments = (message.attachments || []).filter(isPopulatedAttachment);

  if (message.isDeleted) {
    return (
      <div className={`qc-message-row qc-message-row--${isOwn ? 'own' : 'other'}`}>
        <p className="qc-message-deleted">Message deleted</p>
      </div>
    );
  }

  const handleEdit = async () => {
    if (!editContent.trim()) return;
    const encrypted = await encryptEditedContent(message.conversationId, editContent);
    await api.editMessage(message._id, encrypted);
    setIsEditing(false);
  };

  const handleDelete = async () => {
    await api.deleteMessage(message._id);
    dispatch({ type: 'DELETE_MESSAGE', payload: { conversationId: message.conversationId, messageId: message._id } });
  };

  const handleReact = async (emoji: string) => {
    await api.reactMessage(message._id, emoji);
    setShowReactions(false);
  };

  const isRead = message.readBy?.length > 1;
  const baseUrl = config.apiUrl || 'http://localhost:4000';

  return (
    <div className={`qc-message-row qc-message-row--${isOwn ? 'own' : 'other'}`}>
      {!isOwn && <Avatar name={message.senderId.displayName} src={message.senderId.avatarUrl} size="sm" />}

      <div className="qc-message-content">
        {!isOwn && <span className="qc-message-sender">{message.senderId.displayName}</span>}

        {isEditing ? (
          <div className="qc-message-edit">
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="qc-search-input qc-message-edit-input"
              autoFocus
            />
            <div className="qc-message-edit-actions">
              <MessageAction label="Save" onClick={handleEdit} icon={<IconEdit />} variant="primary" />
              <MessageAction label="Cancel" onClick={() => setIsEditing(false)} icon={<IconDelete />} />
            </div>
          </div>
        ) : (
          <div className={`qc-message-bubble ${isOwn ? 'qc-bubble-own' : 'qc-bubble-other'}`}>
            {message.replyTo && typeof message.replyTo === 'object' && (
              <div className="qc-message-reply-preview">↩ Replying to a message</div>
            )}
            {message.content && <p className="qc-message-text">{message.content}</p>}
            {attachments.length > 0 && (
              <div className={`qc-message-attachments${message.content ? ' qc-message-attachments--spaced' : ''}`}>
                {attachments.map((file) => {
                  if (file.isEncrypted) {
                    return (
                      <EncryptedAttachment
                        key={file._id}
                        file={file}
                        conversationId={message.conversationId}
                        baseUrl={baseUrl}
                      />
                    );
                  }
                  const fileUrl = file.url?.startsWith('http') ? file.url : `${baseUrl}${file.url}`;
                  const isImage = file.mimeType?.startsWith('image/');
                  return isImage ? (
                    <a key={file._id} href={fileUrl} target="_blank" rel="noreferrer" className="qc-attachment-image-link">
                      <img src={fileUrl} alt={file.originalName} className="qc-attachment-image" />
                    </a>
                  ) : (
                    <a key={file._id} href={fileUrl} target="_blank" rel="noreferrer" className="qc-attachment-file-link">
                      📎 {file.originalName || 'Attachment'}
                    </a>
                  );
                })}
              </div>
            )}
            {message.isEdited && <span className="qc-message-edited">edited</span>}
          </div>
        )}

        {message.reactions && message.reactions.length > 0 && (
          <div className="qc-message-reactions">
            {message.reactions.map((r, i) => (
              <span key={i} className="qc-reaction-pill">{r.emoji}</span>
            ))}
          </div>
        )}

        <div className="qc-message-meta">
          <span>{formatMessageTime(message.createdAt)}</span>
          {isOwn && <span className={isRead ? 'qc-read-receipt qc-read-receipt--read' : 'qc-read-receipt'}>{isRead ? '✓✓' : '✓'}</span>}
        </div>

        {!isEditing && (
          <div className="qc-message-actions">
            <MessageAction label="Reply" onClick={() => onReply(message)} icon={<IconReply />} />
            {state.settings.allowReactions && (
              <MessageAction label="React" onClick={() => setShowReactions((v) => !v)} icon={<IconReact />} />
            )}
            {isOwn && state.settings.allowEditing && (
              <MessageAction label="Edit" onClick={() => setIsEditing(true)} icon={<IconEdit />} variant="primary" />
            )}
            {isOwn && (
              <MessageAction label="Delete" onClick={handleDelete} icon={<IconDelete />} variant="danger" />
            )}
          </div>
        )}

        {showReactions && (
          <div className="qc-reaction-picker">
            {REACTIONS.map((emoji) => (
              <button key={emoji} type="button" onClick={() => handleReact(emoji)} className="qc-reaction-picker-btn">
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
