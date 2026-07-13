import mongoose from 'mongoose';
import Message from '../models/Message.js';
import { areUsersBlocked } from './userController.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

function validateEnvelope(envelope) {
  return (
    envelope &&
    typeof envelope.ciphertext === 'string' &&
    typeof envelope.nonce === 'string' &&
    HEX_64.test(envelope.ephemeralPublicKey || '') &&
    HEX_64.test(envelope.targetPublicKey || '')
  );
}

export async function sendMessage(req, res) {
  try {
    const { to, forRecipient, forSender, attachmentId } = req.body;
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

    const message = await Message.create({
      from: req.user._id,
      to,
      forRecipient: { ...forRecipient, targetPublicKey: forRecipient.targetPublicKey.toLowerCase() },
      forSender: { ...forSender, targetPublicKey: forSender.targetPublicKey.toLowerCase() },
      attachment: attachmentId || undefined,
    });

    // Not present in serverless deployments (e.g. Vercel), which can't hold
    // the persistent connections Socket.IO needs — REST send/fetch still
    // works there, just without the instant push.
    const io = req.app.get('io');
    if (io) io.to(to.toString()).emit('message:new', message);

    res.status(201).json({ success: true, data: message });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function getConversation(req, res) {
  const { userId } = req.params;
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ success: false, error: 'Invalid user id' });
  }

  const messages = await Message.find({
    $or: [
      { from: req.user._id, to: userId },
      { from: userId, to: req.user._id },
    ],
  })
    .sort({ createdAt: 1 })
    .populate('attachment', 'filename mimetype size nonce ephemeralPublicKey targetPublicKey');

  res.json({ success: true, data: messages });
}
