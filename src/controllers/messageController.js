import fs from 'fs';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import Attachment from '../models/Attachment.js';
import { areUsersBlocked } from './userController.js';
import { resolveUploadPath } from '../middleware/upload.js';

const HEX_64 = /^[0-9a-f]{64}$/i;
const ATTACHMENT_POPULATE =
  'filename mimetype size nonce ephemeralPublicKey targetPublicKey forSenderNonce forSenderEphemeralPublicKey forSenderTargetPublicKey';

function validateEnvelope(envelope) {
  return (
    envelope &&
    typeof envelope.ciphertext === 'string' &&
    typeof envelope.nonce === 'string' &&
    HEX_64.test(envelope.ephemeralPublicKey || '') &&
    HEX_64.test(envelope.targetPublicKey || '')
  );
}

function normalizeEnvelope(envelope) {
  return {
    ...envelope,
    ephemeralPublicKey: String(envelope.ephemeralPublicKey).toLowerCase(),
    targetPublicKey: String(envelope.targetPublicKey).toLowerCase(),
  };
}

function toClientMessage(doc) {
  const message = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  message.id = message._id;
  if (message.attachment && typeof message.attachment === 'object') {
    message.attachment = {
      ...message.attachment,
      id: message.attachment._id || message.attachment.id,
    };
  }
  if (message.group) message.group = message.group._id || message.group;
  if (message.replyTo && typeof message.replyTo === 'object') {
    message.replyTo = {
      ...message.replyTo,
      id: message.replyTo._id || message.replyTo.id,
      from: message.replyTo.from?.toString?.() || message.replyTo.from,
    };
  } else if (message.replyTo) {
    message.replyTo = { id: message.replyTo };
  }
  message.reactions = (message.reactions || []).map((r) => ({
    user: r.user?.toString?.() || String(r.user),
    forRecipient: r.forRecipient,
    forSender: r.forSender,
    emoji: r.emoji || undefined,
    createdAt: r.createdAt,
  }));
  if (Array.isArray(message.envelopes)) {
    message.envelopes = message.envelopes.map((e) => ({
      ...e,
      user: e.user?.toString?.() || String(e.user),
    }));
  }
  return message;
}

function emitToParticipants(io, message, event, payload) {
  if (!io || !message) return;
  const from = message.from?.toString?.() || String(message.from);
  const to = message.to ? message.to.toString() : null;
  io.to(from).emit(event, payload);
  if (to && to !== from) io.to(to).emit(event, payload);
}

async function removeAttachmentFiles(attachmentId) {
  if (!attachmentId) return;
  const attachment = await Attachment.findById(attachmentId);
  if (!attachment) return;
  try {
    fs.unlink(resolveUploadPath(attachment.storagePath), () => {});
    if (attachment.forSenderStoragePath) {
      fs.unlink(resolveUploadPath(attachment.forSenderStoragePath), () => {});
    }
  } catch {
    // best-effort
  }
  await Attachment.deleteOne({ _id: attachment._id });
}

async function assertReplyAllowed(req, replyToId, { to, groupId }) {
  if (!replyToId) return undefined;
  if (!mongoose.isValidObjectId(replyToId)) {
    const err = new Error('Invalid replyTo id');
    err.status = 400;
    throw err;
  }
  const parent = await Message.findById(replyToId);
  if (!parent) {
    const err = new Error('Reply target not found');
    err.status = 404;
    throw err;
  }
  const uid = req.user._id.toString();
  if (groupId) {
    if (String(parent.group || '') !== String(groupId)) {
      const err = new Error('Reply must be in the same group');
      err.status = 400;
      throw err;
    }
  } else {
    const peers = [parent.from.toString(), parent.to?.toString()].filter(Boolean);
    if (!peers.includes(uid) || !peers.includes(String(to))) {
      const err = new Error('Reply must be in the same conversation');
      err.status = 400;
      throw err;
    }
  }
  return parent._id;
}

export async function sendMessage(req, res) {
  try {
    const { to, forRecipient, forSender, attachmentId, replyTo, forwardedFrom } = req.body;
    if (!to || !validateEnvelope(forRecipient) || !validateEnvelope(forSender)) {
      return res.status(400).json({
        success: false,
        error: 'to, forRecipient and forSender (each a sealed-box envelope) are all required',
      });
    }
    if (!mongoose.isValidObjectId(to)) {
      return res.status(400).json({ success: false, error: 'Invalid recipient id' });
    }
    if (attachmentId && !mongoose.isValidObjectId(attachmentId)) {
      return res.status(400).json({ success: false, error: 'Invalid attachment id' });
    }
    if (await areUsersBlocked(req.user._id, to)) {
      return res.status(403).json({ success: false, error: 'Cannot message a blocked user' });
    }

    const replyToId = await assertReplyAllowed(req, replyTo, { to });

    const created = await Message.create({
      from: req.user._id,
      to,
      forRecipient: normalizeEnvelope(forRecipient),
      forSender: normalizeEnvelope(forSender),
      attachment: attachmentId || undefined,
      replyTo: replyToId,
      forwardedFrom:
        forwardedFrom && typeof forwardedFrom === 'object'
          ? {
              username: String(forwardedFrom.username || '').slice(0, 64) || undefined,
              messageId: mongoose.isValidObjectId(forwardedFrom.messageId)
                ? forwardedFrom.messageId
                : undefined,
            }
          : undefined,
    });

    const message = await Message.findById(created._id)
      .populate('attachment', ATTACHMENT_POPULATE)
      .populate('replyTo', 'from forRecipient forSender envelopes group createdAt');
    const payload = toClientMessage(message);

    const io = req.app.get('io');
    if (io) io.to(to.toString()).emit('message:new', payload);
    if (io) io.to(req.user._id.toString()).emit('message:new', payload);

    res.status(201).json({ success: true, data: payload });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

export async function getConversation(req, res) {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user id' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 80, 1), 200);
    const before = req.query.before ? new Date(req.query.before) : null;
    const markRead = req.query.markRead !== '0';

    const filter = {
      $or: [
        { from: req.user._id, to: userId },
        { from: userId, to: req.user._id },
      ],
    };
    if (before && !Number.isNaN(before.getTime())) {
      filter.createdAt = { $lt: before };
    }

    const rows = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .populate('attachment', ATTACHMENT_POPULATE)
      .populate('replyTo', 'from forRecipient forSender envelopes group createdAt');

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    page.reverse();

    const now = new Date();
    const deliveredIds = [];
    const readIds = [];
    for (const msg of page) {
      if (String(msg.from) === String(userId) && String(msg.to) === String(req.user._id)) {
        if (!msg.deliveredAt) {
          msg.deliveredAt = now;
          deliveredIds.push(msg._id);
        }
        if (markRead && !msg.readAt) {
          msg.readAt = now;
          msg.deliveredAt = msg.deliveredAt || now;
          readIds.push(msg._id);
        }
      }
    }
    if (deliveredIds.length || readIds.length) {
      const ops = [];
      if (deliveredIds.length) {
        ops.push(
          Message.updateMany(
            { _id: { $in: deliveredIds }, deliveredAt: null },
            { $set: { deliveredAt: now } }
          )
        );
      }
      if (readIds.length) {
        ops.push(
          Message.updateMany({ _id: { $in: readIds } }, { $set: { deliveredAt: now, readAt: now } })
        );
      }
      await Promise.all(ops);

      const io = req.app.get('io');
      if (io) {
        for (const msg of page) {
          if (
            String(msg.from) === String(userId) &&
            (deliveredIds.some((id) => String(id) === String(msg._id)) ||
              readIds.some((id) => String(id) === String(msg._id)))
          ) {
            const payload = {
              id: msg._id.toString(),
              deliveredAt: msg.deliveredAt,
              readAt: msg.readAt || null,
            };
            io.to(String(userId)).emit('message:status', payload);
          }
        }
      }
    }

    res.json({
      success: true,
      data: page.map(toClientMessage),
      meta: {
        hasMore,
        nextBefore: page.length ? page[0].createdAt : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function markConversationRead(req, res) {
  try {
    const { userId } = req.params;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user id' });
    }
    const now = new Date();
    const result = await Message.updateMany(
      { from: userId, to: req.user._id, readAt: null },
      { $set: { deliveredAt: now, readAt: now } }
    );
    const io = req.app.get('io');
    if (io && result.modifiedCount > 0) {
      io.to(String(userId)).emit('message:status', {
        conversationWith: req.user._id.toString(),
        readAt: now,
        bulk: true,
      });
    }
    res.json({ success: true, data: { updated: result.modifiedCount } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function deleteMessage(req, res) {
  try {
    const { messageId } = req.params;
    if (!mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({ success: false, error: 'Invalid message id' });
    }

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, error: 'Message not found' });

    const uid = req.user._id.toString();
    if (message.from.toString() !== uid) {
      return res.status(403).json({ success: false, error: 'Only the sender can delete this message for everyone' });
    }

    const payload = {
      id: message._id.toString(),
      from: message.from.toString(),
      to: message.to ? message.to.toString() : undefined,
      group: message.group ? message.group.toString() : undefined,
    };

    await removeAttachmentFiles(message.attachment);
    await Message.deleteOne({ _id: message._id });

    const io = req.app.get('io');
    if (message.group) {
      const Group = (await import('../models/Group.js')).default;
      const group = await Group.findById(message.group);
      if (group && io) {
        for (const memberId of group.members) {
          io.to(memberId.toString()).emit('message:deleted', payload);
        }
      }
    } else {
      emitToParticipants(io, message, 'message:deleted', payload);
    }

    res.json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function reactToMessage(req, res) {
  try {
    const { messageId } = req.params;
    const { forRecipient, forSender, clear } = req.body;
    if (!mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({ success: false, error: 'Invalid message id' });
    }

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, error: 'Message not found' });

    const uid = req.user._id.toString();
    let isParty = false;
    let groupMemberIds = null;
    if (message.group) {
      const Group = (await import('../models/Group.js')).default;
      const group = await Group.findById(message.group);
      if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
      groupMemberIds = group.members.map((m) => m.toString());
      isParty = groupMemberIds.includes(uid);
    } else if (message.to) {
      isParty = [message.from.toString(), message.to.toString()].includes(uid);
    }
    if (!isParty) return res.status(403).json({ success: false, error: 'Not authorized' });

    if (clear) {
      message.reactions = message.reactions.filter((r) => r.user.toString() !== uid);
    } else {
      if (!validateEnvelope(forRecipient) || !validateEnvelope(forSender)) {
        return res.status(400).json({
          success: false,
          error: 'forRecipient and forSender sealed-box envelopes are required',
        });
      }
      const nextReaction = {
        user: req.user._id,
        forRecipient: normalizeEnvelope(forRecipient),
        forSender: normalizeEnvelope(forSender),
        createdAt: new Date(),
      };
      const idx = message.reactions.findIndex((r) => r.user.toString() === uid);
      if (idx >= 0) message.reactions[idx] = nextReaction;
      else message.reactions.push(nextReaction);
      message.markModified('reactions');
    }

    await message.save();
    const populated = await Message.findById(message._id)
      .populate('attachment', ATTACHMENT_POPULATE)
      .populate('replyTo', 'from forRecipient forSender envelopes group createdAt');
    const payload = toClientMessage(populated);

    const io = req.app.get('io');
    if (groupMemberIds) {
      for (const memberId of groupMemberIds) io?.to(memberId).emit('message:reaction', payload);
    } else {
      emitToParticipants(io, message, 'message:reaction', payload);
    }

    res.json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function editMessage(req, res) {
  try {
    const { messageId } = req.params;
    const { forRecipient, forSender, envelopes } = req.body;
    if (!mongoose.isValidObjectId(messageId)) {
      return res.status(400).json({ success: false, error: 'Invalid message id' });
    }

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, error: 'Message not found' });
    if (message.from.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Only the sender can edit this message' });
    }

    if (message.group) {
      if (!Array.isArray(envelopes) || envelopes.length < 2) {
        return res.status(400).json({ success: false, error: 'Group edit requires envelopes for each member' });
      }
      message.envelopes = envelopes.map((item) => ({
        user: item.user,
        ...normalizeEnvelope(item),
      }));
      message.markModified('envelopes');
    } else {
      if (!validateEnvelope(forRecipient) || !validateEnvelope(forSender)) {
        return res.status(400).json({
          success: false,
          error: 'forRecipient and forSender sealed-box envelopes are required',
        });
      }
      message.forRecipient = normalizeEnvelope(forRecipient);
      message.forSender = normalizeEnvelope(forSender);
    }

    message.editedAt = new Date();
    await message.save();

    const populated = await Message.findById(message._id)
      .populate('attachment', ATTACHMENT_POPULATE)
      .populate('replyTo', 'from forRecipient forSender envelopes group createdAt');
    const payload = toClientMessage(populated);

    const io = req.app.get('io');
    if (message.group) {
      const Group = (await import('../models/Group.js')).default;
      const group = await Group.findById(message.group);
      if (group && io) {
        for (const memberId of group.members) {
          io.to(memberId.toString()).emit('message:edited', payload);
        }
      }
    } else {
      emitToParticipants(io, message, 'message:edited', payload);
    }

    res.json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
