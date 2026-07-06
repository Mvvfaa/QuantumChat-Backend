import { useState, useRef } from 'react';
import { useWidget } from '../../context/WidgetContext';
import { prepareOutgoingContent, ensureConversationKey } from '../../utils/messageCrypto';
import { encryptFileForUpload } from '../../utils/attachmentCrypto';
import type { IMessage, IAttachment } from '@quantum-chat/shared';

interface MessageInputProps {
  replyTo: IMessage | null;
  onClearReply: () => void;
}

interface PendingFile {
  id: string;
  name: string;
}

export function MessageInput({ replyTo, onClearReply }: MessageInputProps) {
  const { api, socket, state } = useWidget();
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout>>();
  const convId = state.activeConversationId!;

  const handleTyping = () => {
    socket?.startTyping(convId);
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => socket?.stopTyping(convId), 2000);
  };

  const sendKeyExchangeIfNeeded = async () => {
    const { keyExchange } = await ensureConversationKey(convId);
    if (!keyExchange) return;
    try {
      await socket?.sendMessage({ conversationId: convId, content: keyExchange });
    } catch {
      await api.sendMessage({ conversationId: convId, content: keyExchange });
    }
  };

  const handleSend = async () => {
    if (!content.trim() && attachments.length === 0) return;
    const plaintext = content.trim();
    const hasAttachments = attachments.length > 0;

    try {
      if (plaintext) {
        const { encrypted, keyExchange } = await prepareOutgoingContent(convId, plaintext);
        if (keyExchange) {
          await socket?.sendMessage({ conversationId: convId, content: keyExchange });
        }
        await socket?.sendMessage({
          conversationId: convId,
          content: encrypted,
          replyTo: replyTo?._id,
          attachmentIds: hasAttachments ? attachments : undefined,
        });
      } else if (hasAttachments) {
        await sendKeyExchangeIfNeeded();
        await socket?.sendMessage({
          conversationId: convId,
          content: '',
          replyTo: replyTo?._id,
          attachmentIds: attachments,
        });
      }
    } catch {
      if (plaintext) {
        const { encrypted, keyExchange } = await prepareOutgoingContent(convId, plaintext);
        if (keyExchange) {
          await api.sendMessage({ conversationId: convId, content: keyExchange });
        }
        await api.sendMessage({
          conversationId: convId,
          content: encrypted,
          replyTo: replyTo?._id,
          attachmentIds: hasAttachments ? attachments : undefined,
        });
      } else if (hasAttachments) {
        await sendKeyExchangeIfNeeded();
        await api.sendMessage({
          conversationId: convId,
          content: '',
          replyTo: replyTo?._id,
          attachmentIds: attachments,
        });
      }
    }
    setContent('');
    setAttachments([]);
    setPendingFiles([]);
    onClearReply();
    socket?.stopTyping(convId);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxBytes = state.settings.maxFileSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      alert(`File too large. Max ${state.settings.maxFileSizeMb}MB`);
      return;
    }
    setIsUploading(true);
    try {
      const { file: encryptedFile, meta } = await encryptFileForUpload(convId, file);
      const attachment: IAttachment = await api.uploadFile(encryptedFile, meta);
      setAttachments((prev) => [...prev, attachment._id]);
      setPendingFiles((prev) => [...prev, { id: attachment._id, name: file.name }]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a !== id));
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const canSend = content.trim() || attachments.length > 0;
  const allowUploads = state.settings.allowFileUploads;

  return (
    <div className="qc-message-compose">
      {replyTo && (
        <div className="qc-compose-reply">
          <span>↩ {replyTo.content.slice(0, 60)}</span>
          <button type="button" onClick={onClearReply} aria-label="Clear reply">×</button>
        </div>
      )}

      {pendingFiles.length > 0 && (
        <div className="qc-compose-files">
          {pendingFiles.map((file) => (
            <span key={file.id} className="qc-compose-file-chip">
              📎 {file.name}
              <button type="button" onClick={() => removeAttachment(file.id)} aria-label="Remove file">×</button>
            </span>
          ))}
        </div>
      )}

      <div className="qc-compose-row">
        {allowUploads && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={isUploading}
              className="qc-compose-attach-btn"
              title={`Attach file (max ${state.settings.maxFileSizeMb}MB)`}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
              {isUploading ? '...' : 'Attach'}
            </button>
            <input ref={fileRef} type="file" onChange={handleFile} accept="image/*,video/*,.pdf,.doc,.docx,.txt" style={{ display: 'none' }} />
          </>
        )}

        <textarea
          value={content}
          onChange={(e) => { setContent(e.target.value); handleTyping(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={allowUploads ? 'Type a message or attach a file...' : 'Type a message...'}
          rows={1}
          className="qc-search-input qc-compose-input"
        />

        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={`qc-compose-send-btn ${canSend ? 'qc-compose-send-btn--active' : 'qc-compose-send-btn--disabled'}`}
          aria-label="Send message"
        >
          <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
