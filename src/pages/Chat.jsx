import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  Menu,
  MessageSquare,
  Mic,
  Paperclip,
  Send,
  Smile,
  Square,
  Users,
  X,
  Search,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import client from '../api/client.js';
import { connectSocket, getSocket } from '../api/socket.js';
import { sealMessage, unsealMessage, sealBytes, pickRandom } from '../crypto/keys.js';
import { formatKeyFile, downloadKeyFile, parseKeyFile } from '../crypto/keyFile.js';
import { getCurrentKeySet, findSecretKeyForPublicKey } from '../crypto/keyStorage.js';
import { normalizeAttachment, pickRecorderMimeType } from '../crypto/voiceCache.js';
import { playReceiveSound, playSendSound } from '../utils/sounds.js';
import {
  conversationKeyForGroup,
  conversationKeyForUser,
  getConversationActivity,
  isUnreadConversation,
  markConversationRead,
  setConversationActivity,
} from '../utils/readState.js';
import ConversationList from '../components/ConversationList.jsx';
import CreateGroupModal from '../components/CreateGroupModal.jsx';
import MessageBubble from '../components/MessageBubble.jsx';
import EmojiPicker from '../components/EmojiPicker.jsx';
import SidebarMenu from '../components/SidebarMenu.jsx';
import SettingsModal from '../components/SettingsModal.jsx';
import StoriesRail from '../components/StoriesRail.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import ThemeSwitcher from '../components/ThemeSwitcher.jsx';
import DateSeparator from '../components/DateSeparator.jsx';
import MessageSearch from '../components/MessageSearch.jsx';
import DragDropOverlay from '../components/DragDropOverlay.jsx';
import { useToast } from '../components/ToastProvider.jsx';
import { getHiddenChatIds, hideChat, unhideChat } from '../utils/hiddenChats.js';

const MAX_VOICE_SECONDS = 60;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB

function isRecentlyActive(iso) {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < ACTIVE_WINDOW_MS;
}

function formatLastSeen(iso) {
  if (!iso) return 'never logged in';
  if (isRecentlyActive(iso)) return 'online';
  return `last seen ${new Date(iso).toLocaleString()}`;
}

function formatVoiceTimer(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function memberId(m) {
  return String(m?.id || m?._id || m);
}

// Check if two ISO dates fall on the same calendar day
function isSameDay(d1, d2) {
  const a = new Date(d1);
  const b = new Date(d2);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function Chat() {
  const { user, logout, regenerateKeys, importKeys, hasLocalKeyring, updateSessionUser } = useAuth();
  const { showToast } = useToast();

  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState(null); // { type: 'dm'|'group', id, ... }
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [importError, setImportError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [sendingVoice, setSendingVoice] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [hiddenChatIds, setHiddenChatIds] = useState(() => getHiddenChatIds(user?.id));
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [activityTick, setActivityTick] = useState(0);

  // Custom UI feature states
  const [searchOpen, setSearchOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const messageListRef = useRef(null);
  const bottomRef = useRef(null);
  const fileInputRef = useRef(null);
  const keyFileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const selectedRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordTimerRef = useRef(null);
  const recordStartedAtRef = useRef(0);
  const dragCountRef = useRef(0);
  const typingTimeoutRef = useRef(null);
  selectedRef.current = selected;

  const bumpActivity = useCallback(() => setActivityTick((n) => n + 1), []);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (messageListRef.current) {
      const el = messageListRef.current;
      el.scrollTo({
        top: el.scrollHeight,
        behavior,
      });
    }
    setHasUnread(false);
  }, []);

  const handleScroll = useCallback(() => {
    if (!messageListRef.current) return;
    const el = messageListRef.current;
    const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 150;
    if (!isUp) {
      setHasUnread(false);
    }
  }, []);

  const resolveMySecretKey = useCallback(
    (targetPublicKeyHex) => findSecretKeyForPublicKey(user.id, targetPublicKeyHex),
    [user]
  );

  const decorate = useCallback(
    (raw) => {
      const isMine = String(raw.from) === String(user.id);
      let text = null;
      let hasEnvelope = false;

      if (raw.group && Array.isArray(raw.envelopes)) {
        const mine = raw.envelopes.find((e) => String(e.user) === String(user.id));
        hasEnvelope = Boolean(mine?.targetPublicKey);
        if (mine?.targetPublicKey) {
          const mySecretKey = resolveMySecretKey(mine.targetPublicKey);
          text = mySecretKey ? unsealMessage(mine, mySecretKey) : null;
        }
      } else {
        const envelope = isMine ? raw.forSender : raw.forRecipient;
        hasEnvelope = Boolean(envelope?.targetPublicKey);
        if (envelope?.targetPublicKey) {
          const mySecretKey = resolveMySecretKey(envelope.targetPublicKey);
          text = mySecretKey ? unsealMessage(envelope, mySecretKey) : null;
        }
      }

      const reactions = (raw.reactions || []).map((r) => {
        if (r.emoji && !r.forRecipient && !r.forSender) {
          return { ...r, user: String(r.user), emoji: r.emoji };
        }
        const mineReaction = String(r.user) === String(user.id);
        const reactionEnvelope = mineReaction ? r.forSender : r.forRecipient;
        if (!reactionEnvelope?.targetPublicKey) {
          return { ...r, user: String(r.user), emoji: null };
        }
        const sk = resolveMySecretKey(reactionEnvelope.targetPublicKey);
        return {
          ...r,
          user: String(r.user),
          emoji: sk ? unsealMessage(reactionEnvelope, sk) : null,
        };
      });

      return {
        ...raw,
        id: raw.id || raw._id,
        attachment: normalizeAttachment(raw.attachment),
        text: hasEnvelope ? text : null,
        reactions,
        replyTo: raw.replyTo
          ? (() => {
              const parent = raw.replyTo;
              const parentMine = String(parent.from) === String(user.id);
              let parentText = null;
              if (parent.group && Array.isArray(parent.envelopes)) {
                const mine = parent.envelopes.find((e) => String(e.user) === String(user.id));
                if (mine?.targetPublicKey) {
                  const sk = resolveMySecretKey(mine.targetPublicKey);
                  parentText = sk ? unsealMessage(mine, sk) : null;
                }
              } else {
                const env = parentMine ? parent.forSender : parent.forRecipient;
                if (env?.targetPublicKey) {
                  const sk = resolveMySecretKey(env.targetPublicKey);
                  parentText = sk ? unsealMessage(env, sk) : null;
                }
              }
              return {
                id: parent.id || parent._id,
                from: parent.from,
                text: parentText,
              };
            })()
          : null,
      };
    },
    [user, resolveMySecretKey]
  );

  const recordActivityFromMessage = useCallback(
    (raw) => {
      const at = raw.createdAt || new Date().toISOString();
      const from = raw.from;
      if (raw.group) {
        const key = conversationKeyForGroup(raw.group);
        setConversationActivity(user.id, key, { at, from });
      } else {
        const otherId = String(raw.from) === String(user.id) ? raw.to : raw.from;
        if (!otherId) return;
        setConversationActivity(user.id, conversationKeyForUser(otherId), { at, from });
      }
      bumpActivity();
    },
    [user.id, bumpActivity]
  );

  const loadDirectory = useCallback(() => {
    if (!hasLocalKeyring) return;
    setLoadingUsers(true);

    const usersReq = client
      .get('/users')
      .then((res) => setUsers(res.data.data || []))
      .catch((err) => showToast(err.response?.data?.error || 'Failed to load users', 'error'));

    const groupsReq = client
      .get('/groups')
      .then((res) => setGroups(res.data.data || []))
      .catch(() => setGroups([]));

    Promise.allSettled([usersReq, groupsReq]).finally(() => setLoadingUsers(false));
  }, [hasLocalKeyring]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  // Socket routing and listener hooks
  useEffect(() => {
    if (!hasLocalKeyring) return;
    connectSocket();
    const socket = getSocket();
    if (!socket) return undefined;

    function isCurrentConversation(raw) {
      const current = selectedRef.current;
      if (!current) return false;
      if (raw.group) {
        return current.type === 'group' && String(current.id) === String(raw.group);
      }
      const otherId = String(raw.from) === String(user.id) ? raw.to : raw.from;
      return current.type === 'dm' && String(current.id) === String(otherId);
    }

    function handleIncoming(raw) {
      if (raw.group) {
        // group messages
      } else {
        const otherId = String(raw.from) === String(user.id) ? raw.to : raw.from;
        const blocked = (user.blockedUsers || []).map(String);
        if (blocked.includes(String(otherId))) return;
      }

      recordActivityFromMessage(raw);
      if (!isCurrentConversation(raw)) return;

      if (String(raw.from) !== String(user.id)) {
        playReceiveSound();
        if (selectedRef.current?.key) {
          markConversationRead(
            user.id,
            selectedRef.current.key,
            raw.createdAt || new Date().toISOString()
          );
          bumpActivity();
        }
      }

      setMessages((prev) => {
        const id = String(raw.id || raw._id);
        if (prev.some((m) => String(m.id || m._id) === id)) return prev;
        const next = [...prev, decorate(raw)];

        if (messageListRef.current) {
          const el = messageListRef.current;
          const isUp = el.scrollHeight - el.scrollTop - el.clientHeight > 150;
          if (isUp) {
            setHasUnread(true);
          } else {
            setTimeout(() => scrollToBottom('smooth'), 50);
          }
        }
        return next;
      });
    }

    function handleDeleted(payload) {
      const id = String(payload?.id || '');
      if (!id) return;
      setMessages((prev) => prev.filter((m) => String(m.id || m._id) !== id));
    }

    function handleReaction(raw) {
      const id = String(raw?.id || raw?._id || '');
      if (!id) return;
      if (!isCurrentConversation(raw)) return;
      setMessages((prev) => prev.map((m) => (String(m.id || m._id) === id ? decorate(raw) : m)));
    }

    function handleEdited(raw) {
      const id = String(raw?.id || raw?._id || '');
      if (!id) return;
      if (!isCurrentConversation(raw)) return;
      setMessages((prev) => prev.map((m) => (String(m.id || m._id) === id ? decorate(raw) : m)));
    }

    function handleGroupNew(group) {
      setGroups((prev) => {
        if (prev.some((g) => String(g.id) === String(group.id))) {
          return prev.map((g) => (String(g.id) === String(group.id) ? group : g));
        }
        return [group, ...prev];
      });
    }

    socket.on('message:new', handleIncoming);
    socket.on('message:deleted', handleDeleted);
    socket.on('message:reaction', handleReaction);
    socket.on('message:edited', handleEdited);
    socket.on('group:new', handleGroupNew);
    return () => {
      socket.off('message:new', handleIncoming);
      socket.off('message:deleted', handleDeleted);
      socket.off('message:reaction', handleReaction);
      socket.off('message:edited', handleEdited);
      socket.off('group:new', handleGroupNew);
    };
  }, [hasLocalKeyring, user, decorate, scrollToBottom, recordActivityFromMessage, bumpActivity]);

  useEffect(() => {
    if (!selected || !hasLocalKeyring) return undefined;

    let cancelled = false;
    let firstLoad = true;
    const endpoint =
      selected.type === 'group' ? `/groups/${selected.id}/messages` : `/messages/${selected.id}`;

    const fetchMessages = () => {
      if (firstLoad) setLoadingMessages(true);
      client
        .get(endpoint)
        .then((res) => {
          if (cancelled) return;
          const next = (res.data.data || []).map(decorate);
          if (next.length) {
            const last = next[next.length - 1];
            recordActivityFromMessage(last);
          }
          setMessages((prev) => {
            const same =
              prev.length === next.length &&
              prev.every((m, i) => (m.id || m._id) === (next[i].id || next[i]._id));
            if (!same && !firstLoad) {
              const prevIds = new Set(prev.map((m) => String(m.id || m._id)));
              const hasNewIncoming = next.some(
                (m) => !prevIds.has(String(m.id || m._id)) && String(m.from) !== String(user.id)
              );
              if (hasNewIncoming) playReceiveSound();
            }
            return same ? prev : next;
          });
          if (firstLoad) {
            markConversationRead(user.id, selected.key);
            bumpActivity();
            setTimeout(() => scrollToBottom('auto'), 50);
          }
        })
        .finally(() => {
          if (firstLoad) {
            setLoadingMessages(false);
            firstLoad = false;
          }
        });
    };

    fetchMessages();
    const intervalId = setInterval(fetchMessages, 3000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [selected, hasLocalKeyring, decorate, scrollToBottom, user.id, recordActivityFromMessage, bumpActivity]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const canChat = hasLocalKeyring;
  const isGroupChat = selected?.type === 'group';

  const usernameById = useMemo(() => {
    const map = new Map();
    for (const u of users) map.set(String(u.id), u.username);
    map.set(String(user.id), user.username);
    for (const g of groups) {
      for (const m of g.members || []) {
        const id = memberId(m);
        if (m.username) map.set(id, m.username);
      }
    }
    return map;
  }, [users, groups, user]);

  const conversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hidden = new Set(hiddenChatIds);
    const items = [];

    for (const u of users) {
      const key = conversationKeyForUser(u.id);
      const activity = getConversationActivity(user.id, key);
      const unread = isUnreadConversation(user.id, key, activity?.at, activity?.from);
      items.push({
        key,
        type: 'dm',
        id: u.id,
        title: u.username || 'Unknown user',
        subtitle: null,
        searchText: `${u.username || ''} ${u.email || ''}`.toLowerCase(),
        lastLoginAt: u.lastLoginAt,
        unread,
        sortAt: activity?.at || u.lastLoginAt || '',
        peer: u,
      });
    }

    for (const g of groups) {
      const key = conversationKeyForGroup(g.id);
      const activity = getConversationActivity(user.id, key);
      const unread = isUnreadConversation(user.id, key, activity?.at, activity?.from);
      const memberCount = (g.members || []).length;
      items.push({
        key,
        type: 'group',
        id: g.id,
        title: g.name,
        subtitle: `${memberCount} member${memberCount === 1 ? '' : 's'}`,
        searchText: (g.name || '').toLowerCase(),
        lastLoginAt: g.updatedAt,
        unread,
        sortAt: activity?.at || g.updatedAt || g.createdAt || '',
        group: g,
      });
    }

    items.sort((a, b) => {
      if (a.unread !== b.unread) return a.unread ? -1 : 1;
      return String(b.sortAt).localeCompare(String(a.sortAt));
    });

    return items.filter((c) => {
      if (c.type === 'dm' && !q && hidden.has(String(c.id))) return false;
      if (filter === 'groups' && c.type !== 'group') return false;
      if (filter === 'unread' && !c.unread) return false;
      if (q && !(c.searchText || '').includes(q)) return false;
      return true;
    });
  }, [users, groups, user.id, search, filter, activityTick, hiddenChatIds]);

  // Update browser tab unread count prefix (must run after conversations is defined)
  useEffect(() => {
    const totalUnread = conversations.reduce((acc, c) => acc + (c.unread ? 1 : 0), 0);
    const prefix = totalUnread > 0 ? `(${totalUnread}) ` : '';
    document.title = selected
      ? `${prefix}${selected.title} — QuantumChat`
      : `${prefix}QuantumChat`;
  }, [selected, activityTick, conversations]);

  function handleSelectConversation(c) {
    if (c.type === 'dm' && hiddenChatIds.includes(String(c.id))) {
      setHiddenChatIds(unhideChat(user.id, c.id));
    }
    setSelected(c);
    setError('');
    setDraft('');
    setReplyTo(null);
    setEditingMessage(null);
    setShowEmojiPicker(false);
    setSearchOpen(false);
    setSidebarOpen(false);
    markConversationRead(user.id, c.key);
    bumpActivity();
  }

  async function handleCreateGroup({ name, memberIds }) {
    const { data } = await client.post('/groups', { name, memberIds });
    const group = data.data;
    setGroups((prev) => {
      if (prev.some((g) => String(g.id) === String(group.id))) return prev;
      return [group, ...prev];
    });
    handleSelectConversation({
      key: conversationKeyForGroup(group.id),
      type: 'group',
      id: group.id,
      title: group.name,
      subtitle: `${(group.members || []).length} members`,
      group,
    });
  }

  function sealGroupEnvelopes(plaintext, group) {
    const members = group.members || [];
    const envelopes = [];
    for (const member of members) {
      const id = memberId(member);
      let publicKey;
      if (String(id) === String(user.id)) {
        publicKey = pickRandom(getCurrentKeySet(user.id))?.publicKey;
      } else {
        const keys = (member.publicKeys || []).filter(Boolean);
        publicKey = pickRandom(keys);
      }
      if (!publicKey) {
        throw new Error(`Missing encryption keys for ${member.username || id}`);
      }
      envelopes.push({ user: id, ...sealMessage(plaintext, publicKey) });
    }
    return envelopes;
  }

  function handleHideChat(u) {
    const peerId = String(u.id);
    setHiddenChatIds(hideChat(user.id, peerId));
    if (selected?.type === 'dm' && String(selected.id) === peerId) {
      setSelected(null);
      setMessages([]);
    }
  }

  function handleBlockUser(u) {
    setConfirmDialog({
      type: 'block',
      user: u,
      title: `Block ${u.username}?`,
      message: 'They’ll be removed from your list and you won’t be able to message each other. Chat history is kept.',
      confirmLabel: 'Block',
      danger: true,
    });
  }

  async function executeBlockUser(u) {
    try {
      setConfirmBusy(true);
      const { data } = await client.post(`/users/${u.id}/block`);
      updateSessionUser(data.data);
      setUsers((prev) => prev.filter((peer) => String(peer.id) !== String(u.id)));
      setHiddenChatIds(hideChat(user.id, u.id));
      if (selected?.type === 'dm' && String(selected.id) === String(u.id)) {
        setSelected(null);
        setMessages([]);
      }
      setError('');
      setConfirmDialog(null);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to block user', 'error');
      setConfirmDialog(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  // Keydown to trigger search (Ctrl+K)
  useEffect(() => {
    function handleGlobalKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  function handleSearchResult(messageId) {
    setSearchOpen(false);
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.animation = 'none';
      el.offsetHeight; // trigger reflow
      el.style.animation = 'msgIn 400ms ease both';
    }
  }

  // Textarea composition handlers
  function handleDraftChange(e) {
    setDraft(e.target.value);
    if (!selected || selected.type !== 'dm') return;
    const socket = getSocket();
    if (!socket) return;

    socket.emit('typing:start', { to: selected.id });
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('typing:stop', { to: selected.id });
    }, 2000);
  }

  function handleTextareaInput(e) {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }

  function handleTextareaKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!draft.trim() || !selected) return;

    const socket = getSocket();
    if (socket && selected.type === 'dm') socket.emit('typing:stop', { to: selected.id });
    clearTimeout(typingTimeoutRef.current);

    try {
      if (editingMessage) {
        if (selected.type === 'group') {
          const group = selected.group || groups.find((g) => String(g.id) === String(selected.id));
          if (!group) {
            showToast('Group not found', 'error');
            return;
          }
          const envelopes = sealGroupEnvelopes(draft, group);
          const { data } = await client.patch(`/messages/${editingMessage.id || editingMessage._id}`, { envelopes });
          setMessages((prev) =>
            prev.map((m) =>
              String(m.id || m._id) === String(editingMessage.id || editingMessage._id) ? decorate(data.data) : m
            )
          );
        } else {
          const peer = selected.peer || users.find((u) => String(u.id) === String(selected.id));
          const myKey = pickRandom(getCurrentKeySet(user.id));
          const recipientKeys = (peer?.publicKeys || []).filter(Boolean);
          if (!myKey?.publicKey || recipientKeys.length === 0) {
            showToast('Missing encryption keys for this conversation', 'error');
            return;
          }
          const forRecipient = sealMessage(draft, pickRandom(recipientKeys));
          const forSender = sealMessage(draft, myKey.publicKey);
          const { data } = await client.patch(`/messages/${editingMessage.id || editingMessage._id}`, {
            forRecipient,
            forSender,
          });
          setMessages((prev) =>
            prev.map((m) =>
              String(m.id || m._id) === String(editingMessage.id || editingMessage._id) ? decorate(data.data) : m
            )
          );
        }
        setEditingMessage(null);
        setDraft('');
        setReplyTo(null);
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
        return;
      }

      if (selected.type === 'group') {
        const group = selected.group || groups.find((g) => String(g.id) === String(selected.id));
        if (!group) {
          showToast('Group not found', 'error');
          return;
        }
        const envelopes = sealGroupEnvelopes(draft, group);
        const payload = { envelopes };
        if (replyTo) payload.replyTo = replyTo.id || replyTo._id;
        const { data } = await client.post(`/groups/${selected.id}/messages`, payload);
        recordActivityFromMessage(data.data);
        setMessages((prev) => {
          const id = String(data.data.id || data.data._id);
          if (prev.some((m) => String(m.id || m._id) === id)) return prev;
          return [...prev, decorate(data.data)];
        });
      } else {
        const peer = selected.peer || users.find((u) => String(u.id) === String(selected.id));
        const myKey = pickRandom(getCurrentKeySet(user.id));
        const recipientKeys = (peer?.publicKeys || []).filter(Boolean);
        if (!myKey?.publicKey || recipientKeys.length === 0) {
          showToast('Missing encryption keys for this conversation', 'error');
          return;
        }
        const forRecipient = sealMessage(draft, pickRandom(recipientKeys));
        const forSender = sealMessage(draft, myKey.publicKey);
        const body = { to: selected.id, forRecipient, forSender };
        if (replyTo) body.replyTo = replyTo.id || replyTo._id;
        const { data } = await client.post('/messages', body);
        recordActivityFromMessage(data.data);
        setMessages((prev) => {
          const id = String(data.data.id || data.data._id);
          if (prev.some((m) => String(m.id || m._id) === id)) return prev;
          return [...prev, decorate(data.data)];
        });
      }
      setDraft('');
      setReplyTo(null);
      playSendSound();
      markConversationRead(user.id, selected.key);
      bumpActivity();
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      setTimeout(() => scrollToBottom('smooth'), 50);
    } catch (err) {
      showToast(err.response?.data?.error || err.message || 'Failed to send message', 'error');
    }
  }

  async function sendAttachmentFile(file, { plainBytes } = {}) {
    if (!file || !selected || selected.type !== 'dm') return;

    if (file.size > MAX_FILE_SIZE) {
      showToast(`File too large (${formatFileSize(file.size)}). Maximum size is ${formatFileSize(MAX_FILE_SIZE)}.`, 'error');
      return;
    }

    const peer = selected.peer || users.find((u) => String(u.id) === String(selected.id));
    const myKey = pickRandom(getCurrentKeySet(user.id));
    const recipientKeys = (peer?.publicKeys || []).filter(Boolean);
    if (!myKey?.publicKey || recipientKeys.length === 0) {
      showToast('Missing encryption keys for this conversation', 'error');
      return;
    }
    const recipientPublicKey = pickRandom(recipientKeys);
    const fileBytes = plainBytes || new Uint8Array(await file.arrayBuffer());
    const forRecipientFile = sealBytes(fileBytes, recipientPublicKey);
    const forSenderFile = sealBytes(fileBytes, myKey.publicKey);

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([forRecipientFile.cipherBytes], { type: file.type || 'application/octet-stream' }),
      file.name
    );
    formData.append(
      'senderFile',
      new Blob([forSenderFile.cipherBytes], { type: file.type || 'application/octet-stream' }),
      file.name
    );
    formData.append('recipientId', selected.id);
    formData.append('nonce', forRecipientFile.nonce);
    formData.append('ephemeralPublicKey', forRecipientFile.ephemeralPublicKey);
    formData.append('targetPublicKey', forRecipientFile.targetPublicKey);
    formData.append('forSenderNonce', forSenderFile.nonce);
    formData.append('forSenderEphemeralPublicKey', forSenderFile.ephemeralPublicKey);
    formData.append('forSenderTargetPublicKey', forSenderFile.targetPublicKey);
    const uploadRes = await client.post('/attachments', formData);
    const attachmentId = uploadRes.data.data.id;

    const forRecipient = sealMessage('', recipientPublicKey);
    const forSender = sealMessage('', myKey.publicKey);
    const { data } = await client.post('/messages', {
      to: selected.id,
      forRecipient,
      forSender,
      attachmentId,
    });
    recordActivityFromMessage(data.data);
    setMessages((prev) => {
      const id = String(data.data.id || data.data._id);
      if (prev.some((m) => String(m.id || m._id) === id)) return prev;
      return [...prev, decorate(data.data)];
    });
    playSendSound();
    showToast('File sent successfully', 'success', 3000);
    setTimeout(() => scrollToBottom('smooth'), 50);
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selected || selected.type !== 'dm') return;
    try {
      await sendAttachmentFile(file);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to send attachment', 'error');
    }
  }

  // Drag and drop events
  function handleDragEnter(e) {
    e.preventDefault();
    dragCountRef.current += 1;
    if (dragCountRef.current === 1) setIsDragging(true);
  }

  function handleDragLeave(e) {
    e.preventDefault();
    dragCountRef.current -= 1;
    if (dragCountRef.current === 0) setIsDragging(false);
  }

  function handleDragOver(e) {
    e.preventDefault();
  }

  function handleDrop(e) {
    e.preventDefault();
    dragCountRef.current = 0;
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      sendAttachmentFile(file).catch((err) => {
        showToast(err.message || 'File drop failed', 'error');
      });
    }
  }

  function clearRecordingResources({ keepChunks = false } = {}) {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    if (!keepChunks) recordChunksRef.current = [];
    setRecordSeconds(0);
    setRecording(false);
  }

  async function startVoiceRecording() {
    if (!selected || selected.type !== 'dm' || recording || sendingVoice) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast('Voice notes are not supported in this browser', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      mediaStreamRef.current = stream;
      const mimeType = pickRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recordChunksRef.current = [];
      recordStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) recordChunksRef.current.push(event.data);
      };

      recorder.onerror = () => {
        clearRecordingResources();
        showToast('Voice recording failed', 'error');
      };

      recorder.onstop = async () => {
        const chunks = recordChunksRef.current.slice();
        const type = (recorder.mimeType || mimeType || 'audio/webm').split(';')[0];
        clearRecordingResources();
        if (!chunks.length) {
          showToast('No audio captured — try again', 'error');
          return;
        }

        const blob = new Blob(chunks, { type: type || 'audio/webm' });
        if (blob.size < 256) {
          showToast('Recording too short — hold a bit longer', 'error');
          return;
        }

        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: type || 'audio/webm' });
        const plainBytes = new Uint8Array(await blob.arrayBuffer());

        setSendingVoice(true);
        try {
          await sendAttachmentFile(file, { plainBytes });
        } catch (err) {
          showToast(err.response?.data?.error || 'Failed to send voice note', 'error');
        } finally {
          setSendingVoice(false);
        }
      };

      recorder.start(200);
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordStartedAtRef.current) / 1000);
        setRecordSeconds(elapsed);
        if (elapsed >= MAX_VOICE_SECONDS) {
          stopVoiceRecording();
        }
      }, 200);
    } catch {
      clearRecordingResources();
      showToast('Microphone permission is required for voice notes', 'error');
    }
  }

  function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      clearRecordingResources();
      return;
    }
    try {
      if (recorder.state === 'recording') recorder.requestData();
    } catch {
      // ignore
    }
    recorder.stop();
  }

  function cancelVoiceRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null;
      recorder.onstop = () => clearRecordingResources();
      try {
        recorder.stop();
      } catch {
        clearRecordingResources();
      }
      return;
    }
    clearRecordingResources();
  }

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (mediaStreamRef.current) mediaStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function handleDeleteMessage(messageId) {
    if (!messageId) return;
    setConfirmDialog({
      type: 'delete',
      messageId,
      title: 'Delete message?',
      message: 'This removes the message for everyone. It will disappear for both of you with no trace.',
      confirmLabel: 'Delete',
      danger: true,
    });
  }

  async function executeDeleteMessage(messageId) {
    try {
      setConfirmBusy(true);
      await client.delete(`/messages/${messageId}`);
      setMessages((prev) => prev.filter((m) => String(m.id || m._id) !== String(messageId)));
      setConfirmDialog(null);
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to delete message', 'error');
      setConfirmDialog(null);
    } finally {
      setConfirmBusy(false);
    }
  }

  function closeConfirmDialog() {
    if (confirmBusy) return;
    setConfirmDialog(null);
  }

  async function handleConfirmDialog() {
    if (!confirmDialog) return;
    if (confirmDialog.type === 'block') {
      await executeBlockUser(confirmDialog.user);
      return;
    }
    if (confirmDialog.type === 'delete') {
      await executeDeleteMessage(confirmDialog.messageId);
    }
  }

  async function handleReactMessage(messageId, emoji) {
    if (!messageId || !emoji || !selected) return;
    try {
      const existing = messages.find((m) => String(m.id || m._id) === String(messageId));
      const myReaction = (existing?.reactions || []).find((r) => String(r.user) === String(user.id));
      if (myReaction?.emoji === emoji) {
        const { data } = await client.post(`/messages/${messageId}/reactions`, { clear: true });
        setMessages((prev) =>
          prev.map((m) => (String(m.id || m._id) === String(messageId) ? decorate(data.data) : m))
        );
        return;
      }

      const myKey = pickRandom(getCurrentKeySet(user.id));
      let recipientKeys = [];
      if (selected.type === 'group') {
        const group = selected.group || groups.find((g) => String(g.id) === String(selected.id));
        const targetId = String(existing?.from) === String(user.id)
          ? (group?.members || []).map((m) => String(m.id || m._id)).find((id) => id !== String(user.id))
          : existing?.from;
        const member = (group?.members || []).find((m) => String(m.id || m._id) === String(targetId));
        recipientKeys = (member?.publicKeys || []).filter(Boolean);
      } else {
        const peer = selected.peer || users.find((u) => String(u.id) === String(selected.id));
        recipientKeys = (peer?.publicKeys || []).filter(Boolean);
      }
      if (!myKey?.publicKey || recipientKeys.length === 0) {
        showToast('Missing encryption keys for this conversation', 'error');
        return;
      }
      const forRecipient = sealMessage(emoji, pickRandom(recipientKeys));
      const forSender = sealMessage(emoji, myKey.publicKey);
      const { data } = await client.post(`/messages/${messageId}/reactions`, { forRecipient, forSender });
      setMessages((prev) =>
        prev.map((m) => (String(m.id || m._id) === String(messageId) ? decorate(data.data) : m))
      );
    } catch (err) {
      showToast(err.response?.data?.error || 'Failed to add reaction', 'error');
    }
  }

  function insertEmoji(emoji) {
    setDraft((prev) => `${prev}${emoji}`);
    setShowEmojiPicker(false);
    textareaRef.current?.focus();
  }

  async function handleGenerateKeys() {
    try {
      const { keySet } = await regenerateKeys();
      const content = formatKeyFile({
        username: user.username,
        email: user.email,
        secretKeys: keySet.map((k) => k.secretKey),
      });
      downloadKeyFile(content);
      showToast('New keys generated and synchronized successfully', 'success');
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to generate keys');
      showToast('Failed to generate keys', 'error');
    }
  }

  async function handleImportKeyFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const secretKeys = parseKeyFile(text);
      importKeys(secretKeys);
      setImportError('');
      showToast('Encryption key file imported successfully', 'success');
    } catch (err) {
      setImportError(err.message || 'Failed to import keys.txt');
      showToast(err.message || 'Key import failed', 'error');
    }
  }

  function handleLogout() {
    setLogoutConfirmOpen(true);
  }

  function confirmLogout() {
    setLogoutConfirmOpen(false);
    logout();
  }

  const title = useMemo(() => {
    if (!selected) return 'Select a conversation';
    return selected.title || (selected.type === 'group' ? 'Group' : 'Chat');
  }, [selected]);

  const headerSubtitle = useMemo(() => {
    if (!selected) return null;
    if (selected.type === 'group') {
      const group = selected.group || groups.find((g) => String(g.id) === String(selected.id));
      const count = (group?.members || []).length;
      return count ? `${count} members` : 'Group chat';
    }
    const peer = selected.peer || users.find((u) => String(u.id) === String(selected.id));
    return formatLastSeen(peer?.lastLoginAt);
  }, [selected, groups, users]);

  const headerOnline = useMemo(() => {
    if (!selected || selected.type !== 'dm') return false;
    const peer = selected.peer || users.find((u) => String(u.id) === String(selected.id));
    return isRecentlyActive(peer?.lastLoginAt);
  }, [selected, users]);

  // Build message list with date separators
  const messagesWithSeparators = useMemo(() => {
    const items = [];
    messages.forEach((m, i) => {
      const prev = messages[i - 1];
      if (!prev || !isSameDay(prev.createdAt, m.createdAt)) {
        items.push({ type: 'separator', date: m.createdAt, key: `sep-${m.createdAt}` });
      }
      items.push({ type: 'message', data: m, key: m.id || m._id });
    });
    return items;
  }, [messages]);

  // Floating chat bubbles for empty state
  const floatingBubbles = useMemo(() => {
    const sizes = [28, 22, 32, 18, 26];
    return sizes.map((size, i) => (
      <div key={i} className="chat-empty-floater">
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
    ));
  }, []);

  return (
    <div className="chat-page">
      <div
        className={`sidebar-overlay ${sidebarOpen ? 'visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-username">{user.username}</div>
              <div className="sidebar-lastseen sidebar-status-online">online</div>
            </div>
          </div>
          <div className="sidebar-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ThemeSwitcher />
            <SidebarMenu onSettings={() => setShowSettings(true)} onLogout={handleLogout} />
          </div>
        </div>
        {canChat && (
          <>
            <StoriesRail currentUser={user} onError={setError} />
            <div className="sidebar-search">
              <input
                placeholder="Search conversations…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search conversations"
              />
            </div>
          </>
        )}
        {canChat ? (
          <ConversationList
            conversations={conversations}
            filter={filter}
            onFilterChange={setFilter}
            selectedKey={selected?.key}
            onSelect={handleSelectConversation}
            onCreateGroup={() => setShowCreateGroup(true)}
            onHide={handleHideChat}
            onBlock={handleBlockUser}
            loading={loadingUsers}
            searchQuery={search}
          />
        ) : (
          <p className="empty-hint">Set up your device key to see people.</p>
        )}
      </aside>

      <main
        className="chat-main"
        onDragEnter={canChat && selected && selected.type === 'dm' ? handleDragEnter : undefined}
        onDragLeave={canChat && selected && selected.type === 'dm' ? handleDragLeave : undefined}
        onDragOver={canChat && selected && selected.type === 'dm' ? handleDragOver : undefined}
        onDrop={canChat && selected && selected.type === 'dm' ? handleDrop : undefined}
      >
        {!canChat && (
          <div className="key-warning">
            <p>
              No private keys found on this device. Either you cleared local storage or this is a new device.
              If you saved a keys.txt backup when you signed up, import it to keep reading your existing
              messages. Otherwise you can generate a fresh 5-key set, but old messages will stay unreadable.
            </p>
            {importError && <div className="auth-error">{importError}</div>}
            <div className="key-warning-actions">
              <button onClick={() => keyFileInputRef.current?.click()}>Import keys.txt</button>
              <input ref={keyFileInputRef} type="file" accept=".txt" hidden onChange={handleImportKeyFile} />
              <button className="secondary-button" onClick={handleGenerateKeys}>
                Generate new key & download
              </button>
            </div>
          </div>
        )}

        {canChat && (
          <>
            <header className="chat-header">
              <div className="chat-header-left">
                <button
                  className="mobile-menu-btn"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open conversation sidebar"
                >
                  <Menu size={20} strokeWidth={2} aria-hidden="true" />
                </button>
                {selected ? (
                  <div className="chat-header-peer">
                    <span className={`avatar ${selected.type === 'group' ? 'group-avatar' : ''} chat-header-avatar`}>
                      {selected.type === 'group' ? (
                        <Users size={18} strokeWidth={2} aria-hidden="true" />
                      ) : (
                        <>
                          {(title || '?').slice(0, 2).toUpperCase()}
                          {headerOnline && <span className="online-dot" aria-hidden="true" />}
                        </>
                      )}
                    </span>
                    <div className="chat-header-text">
                      <span className="chat-header-title">{title}</span>
                      {headerSubtitle && (
                        <span className={`chat-header-status ${headerOnline ? 'status-online' : ''}`}>
                          {headerSubtitle}
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <span className="chat-header-title muted">{title}</span>
                )}
              </div>
              <div className="chat-header-actions">
                {selected && (
                  <button
                    className="chat-header-btn"
                    onClick={() => setSearchOpen(!searchOpen)}
                    title="Search messages (Ctrl+K)"
                    aria-label="Search messages"
                  >
                    <Search size={18} strokeWidth={2} aria-hidden="true" />
                  </button>
                )}
              </div>
            </header>

            {searchOpen && selected && (
              <MessageSearch
                messages={messages}
                onResultSelect={handleSearchResult}
                isOpen={searchOpen}
                onClose={() => setSearchOpen(false)}
              />
            )}

            {!selected ? (
              <div className="chat-empty-state">
                {floatingBubbles}
                <div className="chat-empty-icon">
                  <MessageSquare size={30} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <h2>No conversation selected</h2>
                <p>Choose a person or group from the sidebar, or create a new group</p>
              </div>
            ) : (
              <>
                {isDragging && (
                  <DragDropOverlay isVisible={true} onFileDrop={sendAttachmentFile} />
                )}

                <AnimatePresence mode="wait">
                  <motion.div
                    key={selected.key}
                    className="message-list"
                    ref={messageListRef}
                    onScroll={handleScroll}
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -12 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {loadingMessages ? (
                      <>
                        <div className="skeleton-message-bubble theirs skeleton" />
                        <div className="skeleton-message-bubble mine skeleton" />
                        <div className="skeleton-message-bubble theirs skeleton" style={{ width: '45%' }} />
                        <div className="skeleton-message-bubble mine skeleton" style={{ width: '35%' }} />
                      </>
                    ) : (
                      messagesWithSeparators.map((item, index) => {
                        if (item.type === 'separator') {
                          return <DateSeparator key={item.key} date={item.date} />;
                        }

                        const m = item.data;
                        const prevMsg = index > 0 && messagesWithSeparators[index - 1].type === 'message'
                          ? messagesWithSeparators[index - 1].data
                          : null;
                        const isGrouped =
                          prevMsg &&
                          String(prevMsg.from) === String(m.from) &&
                          new Date(m.createdAt) - new Date(prevMsg.createdAt) < 120000;

                        return (
                          <div key={item.key} id={`msg-${m.id || m._id}`}>
                            <MessageBubble
                              key={m.id || m._id}
                              message={m}
                              isMine={String(m.from) === String(user.id)}
                              currentUserId={user.id}
                              resolveSecretKey={resolveMySecretKey}
                              grouped={isGrouped}
                              senderLabel={
                                isGroupChat ? usernameById.get(String(m.from)) || 'Member' : undefined
                              }
                              replyPreview={
                                m.replyTo
                                  ? {
                                      label: usernameById.get(String(m.replyTo.from)) || 'Message',
                                      text: m.replyTo.text || '[encrypted]',
                                    }
                                  : null
                              }
                              onDelete={handleDeleteMessage}
                              onReact={handleReactMessage}
                              onReply={(msg) => {
                                setEditingMessage(null);
                                setReplyTo(msg);
                              }}
                              onEdit={(msg) => {
                                setReplyTo(null);
                                setEditingMessage(msg);
                                setDraft(msg.text || '');
                              }}
                            />
                          </div>
                        );
                      })
                    )}
                    <div ref={bottomRef} />
                  </motion.div>
                </AnimatePresence>

                {hasUnread && (
                  <button
                    className="scroll-bottom-pill"
                    onClick={() => scrollToBottom('smooth')}
                    aria-label="Scroll to bottom to view new messages"
                  >
                    <span>New messages</span>
                    <ArrowDown size={16} strokeWidth={2.5} aria-hidden="true" />
                  </button>
                )}

                {recording ? (
                  <div className="composer composer-recording">
                    <button
                      type="button"
                      className="attach-button voice-cancel-btn"
                      onClick={cancelVoiceRecording}
                      aria-label="Cancel voice note"
                    >
                      <X size={20} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <div className="voice-recording-status">
                      <span className="voice-recording-dot" />
                      <span>Recording {formatVoiceTimer(recordSeconds)}</span>
                      <span className="voice-recording-hint">max {MAX_VOICE_SECONDS}s</span>
                    </div>
                    <button
                      type="button"
                      className="send-button voice-stop-btn"
                      onClick={stopVoiceRecording}
                      aria-label="Send voice note"
                    >
                      <Square size={16} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <div className="composer-shell">
                    {showEmojiPicker && (
                      <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmojiPicker(false)} />
                    )}
                    {(replyTo || editingMessage) && (
                      <div className="composer-context">
                        <div className="composer-context-copy">
                          <strong>{editingMessage ? 'Editing message' : 'Replying to'}</strong>
                          <span>
                            {editingMessage
                              ? editingMessage.text || ''
                              : replyTo?.text || '[encrypted message]'}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="composer-context-close"
                          aria-label="Cancel"
                          onClick={() => {
                            setReplyTo(null);
                            setEditingMessage(null);
                            if (editingMessage) setDraft('');
                          }}
                        >
                          <X size={16} strokeWidth={2} aria-hidden="true" />
                        </button>
                      </div>
                    )}
                    <div className="composer-hint">
                      <span><kbd>Enter</kbd> send</span>
                      <span><kbd>Shift</kbd>+<kbd>Enter</kbd> new line</span>
                      <span><kbd>Ctrl</kbd>+<kbd>K</kbd> search</span>
                      <span style={{ marginLeft: 'auto', opacity: 0.6 }}>Max file: 15 MB</span>
                    </div>
                    <form className="composer" onSubmit={handleSend}>
                      {!isGroupChat && (
                        <button
                          type="button"
                          className="attach-button"
                          onClick={() => fileInputRef.current?.click()}
                          aria-label="Attach file to message"
                          disabled={sendingVoice}
                        >
                          <Paperclip size={20} strokeWidth={2} aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        className={`attach-button ${showEmojiPicker ? 'active' : ''}`}
                        onClick={() => setShowEmojiPicker((v) => !v)}
                        aria-label="Open emoji picker"
                        disabled={sendingVoice}
                      >
                        <Smile size={20} strokeWidth={2} aria-hidden="true" />
                      </button>
                      <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />
                      <textarea
                        ref={textareaRef}
                        placeholder={
                          sendingVoice
                            ? 'Sending voice note…'
                            : isGroupChat
                              ? 'Type an encrypted group message…'
                              : 'Type an encrypted message…'
                        }
                        value={draft}
                        onChange={handleDraftChange}
                        onInput={handleTextareaInput}
                        onKeyDown={handleTextareaKeyDown}
                        aria-label="Type message body"
                        disabled={sendingVoice}
                        rows={1}
                      />
                      {draft.trim() ? (
                        <button type="submit" className="send-button" aria-label="Send encrypted message" disabled={sendingVoice}>
                          <Send size={18} strokeWidth={2} aria-hidden="true" />
                        </button>
                      ) : isGroupChat ? (
                        <button type="submit" className="send-button" aria-label="Send encrypted message" disabled>
                          <Send size={18} strokeWidth={2} aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="send-button voice-mic-btn"
                          onClick={startVoiceRecording}
                          aria-label="Record voice note"
                          disabled={sendingVoice}
                        >
                          <Mic size={18} strokeWidth={2} aria-hidden="true" />
                        </button>
                      )}
                    </form>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <ConfirmDialog
        open={Boolean(confirmDialog)}
        title={confirmDialog?.title}
        message={confirmDialog?.message}
        confirmLabel={confirmDialog?.confirmLabel}
        danger={confirmDialog?.danger}
        busy={confirmBusy}
        onCancel={closeConfirmDialog}
        onConfirm={handleConfirmDialog}
      />

      {showCreateGroup && (
        <CreateGroupModal
          users={users}
          onClose={() => setShowCreateGroup(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {showSettings && (
        <SettingsModal
          user={user}
          onClose={() => setShowSettings(false)}
          onImportKeys={handleImportKeyFile}
          onGenerateKeys={handleGenerateKeys}
          onUserUpdated={updateSessionUser}
        />
      )}

      {logoutConfirmOpen && (
        <ConfirmDialog
          open={logoutConfirmOpen}
          title="Log out of QuantumChat?"
          message="Your encryption keys are stored in this browser's local storage. If you clear your browser data after logging out, you won't be able to decrypt your message history."
          confirmLabel="Log out"
          cancelLabel="Stay"
          danger={true}
          onConfirm={confirmLogout}
          onCancel={() => setLogoutConfirmOpen(false)}
        />
      )}
    </div>
  );
}
