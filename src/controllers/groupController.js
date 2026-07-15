import mongoose from 'mongoose';
import Group from '../models/Group.js';
import User from '../models/User.js';
import Message from '../models/Message.js';

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
  if (message.group) {
    message.group = message.group._id || message.group;
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

function emitToMembers(io, memberIds, event, payload) {
  if (!io) return;
  for (const id of memberIds) {
    io.to(String(id)).emit(event, payload);
  }
}

export async function createGroup(req, res) {
  try {
    const { name, memberIds } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ success: false, error: 'Group name must be at least 2 characters' });
    }
    if (!Array.isArray(memberIds) || memberIds.length < 1) {
      return res.status(400).json({ success: false, error: 'Select at least one other member' });
    }

    const uniqueIds = [...new Set(memberIds.map(String))].filter((id) => id !== req.user._id.toString());
    if (uniqueIds.length < 1) {
      return res.status(400).json({ success: false, error: 'Select at least one other member' });
    }
    if (uniqueIds.some((id) => !mongoose.isValidObjectId(id))) {
      return res.status(400).json({ success: false, error: 'Invalid member id' });
    }

    const found = await User.find({ _id: { $in: uniqueIds } }).select('_id');
    if (found.length !== uniqueIds.length) {
      return res.status(400).json({ success: false, error: 'One or more members were not found' });
    }

    const members = [req.user._id, ...uniqueIds];
    const group = await Group.create({
      name: name.trim(),
      createdBy: req.user._id,
      members,
    });

    const populated = await Group.findById(group._id).populate(
      'members',
      'username email publicKeys lastLoginAt keyRotatedAt'
    );

    const payload = populated.toPublicJSON();
    const io = req.app.get('io');
    emitToMembers(io, members, 'group:new', payload);

    res.status(201).json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function listGroups(req, res) {
  try {
    const groups = await Group.find({ members: req.user._id })
      .sort({ updatedAt: -1 })
      .populate('members', 'username email publicKeys lastLoginAt keyRotatedAt');
    res.json({ success: true, data: groups.map((g) => g.toPublicJSON()) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getGroup(req, res) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, error: 'Invalid group id' });
    }
    const group = await Group.findById(req.params.id).populate(
      'members',
      'username email publicKeys lastLoginAt keyRotatedAt'
    );
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    if (!group.members.some((m) => String(m._id || m) === req.user._id.toString())) {
      return res.status(403).json({ success: false, error: 'Not a group member' });
    }
    res.json({ success: true, data: group.toPublicJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function sendGroupMessage(req, res) {
  try {
    const { groupId } = req.params;
    const { envelopes, attachmentId, replyTo } = req.body;
    if (!mongoose.isValidObjectId(groupId)) {
      return res.status(400).json({ success: false, error: 'Invalid group id' });
    }

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    if (!group.members.some((m) => m.toString() === req.user._id.toString())) {
      return res.status(403).json({ success: false, error: 'Not a group member' });
    }

    let replyToId;
    if (replyTo) {
      if (!mongoose.isValidObjectId(replyTo)) {
        return res.status(400).json({ success: false, error: 'Invalid replyTo id' });
      }
      const parent = await Message.findById(replyTo);
      if (!parent || String(parent.group || '') !== String(groupId)) {
        return res.status(400).json({ success: false, error: 'Reply must be in the same group' });
      }
      replyToId = parent._id;
    }

    if (!Array.isArray(envelopes) || envelopes.length < 2) {
      return res.status(400).json({
        success: false,
        error: 'envelopes must include a sealed-box copy for each member',
      });
    }

    const memberSet = new Set(group.members.map((m) => m.toString()));
    const normalized = [];
    for (const item of envelopes) {
      const userId = item?.user != null ? String(item.user) : '';
      if (!memberSet.has(userId) || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ success: false, error: 'Envelope user must be a group member' });
      }
      if (!validateEnvelope(item)) {
        return res.status(400).json({ success: false, error: 'Each envelope must be a valid sealed box' });
      }
      normalized.push({
        user: userId,
        ...normalizeEnvelope(item),
      });
    }

    const covered = new Set(normalized.map((e) => String(e.user)));
    for (const memberId of memberSet) {
      if (!covered.has(memberId)) {
        return res.status(400).json({ success: false, error: 'Missing sealed envelope for a group member' });
      }
    }

    if (attachmentId && !mongoose.isValidObjectId(attachmentId)) {
      return res.status(400).json({ success: false, error: 'Invalid attachment id' });
    }

    const created = await Message.create({
      from: req.user._id,
      group: group._id,
      envelopes: normalized,
      attachment: attachmentId || undefined,
      replyTo: replyToId,
    });

    group.updatedAt = new Date();
    await group.save();

    const message = await Message.findById(created._id)
      .populate('attachment', ATTACHMENT_POPULATE)
      .populate('replyTo', 'from forRecipient forSender envelopes group createdAt');
    const payload = toClientMessage(message);
    const io = req.app.get('io');
    emitToMembers(io, [...memberSet], 'message:new', payload);

    res.status(201).json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getGroupMessages(req, res) {
  try {
    const { groupId } = req.params;
    if (!mongoose.isValidObjectId(groupId)) {
      return res.status(400).json({ success: false, error: 'Invalid group id' });
    }
    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    if (!group.members.some((m) => m.toString() === req.user._id.toString())) {
      return res.status(403).json({ success: false, error: 'Not a group member' });
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 80, 1), 200);
    const before = req.query.before ? new Date(req.query.before) : null;
    const filter = { group: groupId };
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

//New functions to add members, change group name, remove members e.t.c:
// groupController.js additions

export async function renameGroup(req, res) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid group id' });
    }
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
      return res.status(400).json({ success: false, error: 'Group name must be 2-60 characters' });
    }
    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    if (!group.members.some((m) => m.toString() === req.user._id.toString())) {
      return res.status(403).json({ success: false, error: 'Not a group member' });
    }
    group.name = name.trim();
    await group.save();
    const populated = await group.populate('members', 'username email publicKeys lastLoginAt keyRotatedAt');
    const payload = populated.toPublicJSON();
    emitToMembers(req.app.get('io'), group.members, 'group:updated', payload);
    res.json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function addMembers(req, res) {
  try {
    const { id } = req.params;
    const { memberIds } = req.body;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid group id' });
    }
    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    if (!group.members.some((m) => m.toString() === req.user._id.toString())) {
      return res.status(403).json({ success: false, error: 'Not a group member' });
    }
    const existing = new Set(group.members.map(String));
    const toAdd = [...new Set((memberIds || []).map(String))].filter(
      (id) => !existing.has(id) && mongoose.isValidObjectId(id)
    );
    if (toAdd.length === 0) {
      return res.status(400).json({ success: false, error: 'No new members to add' });
    }
    const found = await User.find({ _id: { $in: toAdd } }).select('_id');
    if (found.length !== toAdd.length) {
      return res.status(400).json({ success: false, error: 'One or more members were not found' });
    }
    group.members.push(...toAdd);
    await group.save();
    const populated = await group.populate('members', 'username email publicKeys lastLoginAt keyRotatedAt');
    const payload = populated.toPublicJSON();
    emitToMembers(req.app.get('io'), group.members, 'group:updated', payload);
    res.json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function removeMember(req, res) {
  // only createdBy can remove someone else; anyone can remove themselves (= leave)
  try {
    const { id, memberId } = req.params;
    if (!mongoose.isValidObjectId(id) || !mongoose.isValidObjectId(memberId)) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }
    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    const isSelf = memberId === req.user._id.toString();
    const isCreator = group.createdBy.toString() === req.user._id.toString();
    if (!isSelf && !isCreator) {
      return res.status(403).json({ success: false, error: 'Only the creator can remove other members' });
    }
    const before = group.members.map(String);
    group.members = group.members.filter((m) => m.toString() !== memberId);
    if (group.members.length === 0) {
      await group.deleteOne();
      emitToMembers(req.app.get('io'), before, 'group:deleted', { id });
      return res.json({ success: true, data: { id, deleted: true } });
    }
    await group.save();
    const populated = await group.populate('members', 'username email publicKeys lastLoginAt keyRotatedAt');
    const payload = populated.toPublicJSON();
    emitToMembers(req.app.get('io'), before, 'group:updated', payload);
    res.json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function deleteGroup(req, res) {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid group id' });
    }
    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ success: false, error: 'Group not found' });
    if (group.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, error: 'Only the creator can delete the group' });
    }
    const members = group.members.map(String);
    await group.deleteOne();
    await Message.deleteMany({ group: id }); // orphaned messages
    emitToMembers(req.app.get('io'), members, 'group:deleted', { id });
    res.json({ success: true, data: { id, deleted: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}