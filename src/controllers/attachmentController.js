import fs from 'fs';
import mongoose from 'mongoose';
import Attachment from '../models/Attachment.js';
import { resolveUploadPath } from '../middleware/upload.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

// The uploaded file is already nacl.box ciphertext produced client-side.
// The server just stores opaque encrypted bytes on disk plus the metadata
// (nonce, both parties' public keys at encryption time) needed by whichever
// end later has the matching private key.
export async function uploadAttachment(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'file is required' });
    }
    const { recipientId, nonce, senderPublicKey, recipientPublicKey } = req.body;

    if (!recipientId || !mongoose.isValidObjectId(recipientId)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, error: 'Valid recipientId is required' });
    }
    if (!nonce || !HEX_64.test(senderPublicKey || '') || !HEX_64.test(recipientPublicKey || '')) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, error: 'nonce, senderPublicKey and recipientPublicKey are required' });
    }

    const attachment = await Attachment.create({
      owner: req.user._id,
      recipient: recipientId,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      storagePath: req.file.filename,
      nonce,
      senderPublicKey: senderPublicKey.toLowerCase(),
      recipientPublicKey: recipientPublicKey.toLowerCase(),
    });

    res.status(201).json({
      success: true,
      data: {
        id: attachment._id,
        filename: attachment.filename,
        mimetype: attachment.mimetype,
        size: attachment.size,
      },
    });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function downloadAttachment(req, res) {
  const attachment = await Attachment.findById(req.params.id);
  if (!attachment) {
    return res.status(404).json({ success: false, error: 'Attachment not found' });
  }

  const isParty = [attachment.owner.toString(), attachment.recipient.toString()].includes(req.user._id.toString());
  if (!isParty) {
    return res.status(403).json({ success: false, error: 'Not authorized to access this attachment' });
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(resolveUploadPath(attachment.storagePath), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ success: false, error: 'Encrypted file not found on disk' });
    }
  });
}
