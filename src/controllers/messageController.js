import mongoose from 'mongoose';
import Message from '../models/Message.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

export async function sendMessage(req, res) {
  try {
    const { to, ciphertext, nonce, senderPublicKey, recipientPublicKey, attachmentId } = req.body;
    if (!to || !ciphertext || !nonce || !senderPublicKey || !recipientPublicKey) {
      return res.status(400).json({
        success: false,
        error: 'to, ciphertext, nonce, senderPublicKey and recipientPublicKey are all required',
      });
    }
    if (!mongoose.isValidObjectId(to)) {
      return res.status(400).json({ success: false, error: 'Invalid recipient id' });
    }
    if (!HEX_64.test(senderPublicKey) || !HEX_64.test(recipientPublicKey)) {
      return res.status(400).json({ success: false, error: 'senderPublicKey/recipientPublicKey must be 64-char hex' });
    }
    if (attachmentId && !mongoose.isValidObjectId(attachmentId)) {
      return res.status(400).json({ success: false, error: 'Invalid attachment id' });
    }

    const message = await Message.create({
      from: req.user._id,
      to,
      ciphertext,
      nonce,
      senderPublicKey: senderPublicKey.toLowerCase(),
      recipientPublicKey: recipientPublicKey.toLowerCase(),
      attachment: attachmentId || undefined,
    });

    const io = req.app.get('io');
    io.to(to.toString()).emit('message:new', message);

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
    .populate('attachment', 'filename mimetype size nonce senderPublicKey recipientPublicKey');

  res.json({ success: true, data: messages });
}
