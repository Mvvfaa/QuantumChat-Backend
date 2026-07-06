import { useRef, useEffect, useCallback } from 'react';
import { useWidget } from '../../context/WidgetContext';
import { MessageBubble } from './MessageBubble';
import { processMessageList } from '../../utils/messageCrypto';
import { normalizeId } from '../../utils/helpers';
import type { IMessage } from '@quantum-chat/shared';

export function MessageList({ onReply }: { onReply: (message: IMessage) => void }) {
  const { state, dispatch, api } = useWidget();
  const containerRef = useRef<HTMLDivElement>(null);
  const convId = state.activeConversationId!;
  const messages = state.messages[convId] || [];
  const typingUsers = (state.typingUsers[convId] || []).filter((id) => normalizeId(id) !== normalizeId(state.user?._id));

  const loadMore = useCallback(async () => {
    if (!state.hasMoreMessages[convId]) return;
    const page = (state.messagePages[convId] || 1) + 1;
    const result = await api.getMessages(convId, page);
    const decrypted = await processMessageList(result.data);
    dispatch({
      type: 'PREPEND_MESSAGES',
      payload: { conversationId: convId, messages: decrypted, hasMore: result.hasMore },
    });
    dispatch({ type: 'INCREMENT_PAGE', payload: convId });
  }, [convId, state.hasMoreMessages, state.messagePages, api, dispatch]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el || el.scrollTop > 50) return;
    loadMore();
  };

  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div ref={containerRef} onScroll={handleScroll} className="qc-message-list qc-scrollbar">
      {state.hasMoreMessages[convId] && (
        <button type="button" onClick={loadMore} className="qc-load-more-btn">
          Load earlier messages
        </button>
      )}

      {messages.map((msg) => (
        <MessageBubble
          key={msg._id}
          message={msg as Parameters<typeof MessageBubble>[0]['message']}
          isOwn={
            typeof msg.senderId === 'object' && msg.senderId !== null
              ? normalizeId(msg.senderId) === normalizeId(state.user?._id)
              : String(msg.senderId) === state.user?._id
          }
          onReply={onReply}
        />
      ))}

      {typingUsers.length > 0 && (
        <div className="qc-typing-indicator">
          <div style={{ display: 'flex', gap: 4 }}>
            <span className="qc-typing-dot" style={{ width: 6, height: 6, borderRadius: '50%' }} />
            <span className="qc-typing-dot" style={{ width: 6, height: 6, borderRadius: '50%' }} />
            <span className="qc-typing-dot" style={{ width: 6, height: 6, borderRadius: '50%' }} />
          </div>
          <span>typing...</span>
        </div>
      )}
    </div>
  );
}
