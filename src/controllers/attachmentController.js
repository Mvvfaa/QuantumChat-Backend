import fs from 'fs';
import mongoose from 'mongoose';
import Attachment from '../models/Attachment.js';
import { resolveUploadPath } from '../middleware/upload.js';
import { areUsersBlocked } from './userController.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

// The uploaded file is already sealed-box ciphertext produced client-side
// (see sealBytes in frontend/src/crypto/keys.js): encrypted with a one-time
// ephemeral keypair against the recipient's public key. The server stores
// the opaque bytes plus that envelope's metadata — it never has, and the
// sealing operation never used, any long-term private key.
export async function uploadAttachment(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'file is required' });
    }
    const { recipientId, nonce, ephemeralPublicKey, targetPublicKey } = req.body;

    if (!recipientId || !mongoose.isValidObjectId(recipientId)) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, error: 'Valid recipientId is required' });
    }
    if (!nonce || !HEX_64.test(ephemeralPublicKey || '') || !HEX_64.test(targetPublicKey || '')) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, error: 'nonce, ephemeralPublicKey and targetPublicKey are required' });
    }
    if (await areUsersBlocked(req.user._id, recipientId)) {
      fs.unlink(req.file.path, () => {});
      return res.status(403).json({ success: false, error: 'Cannot send attachments to a blocked user' });
    }

    const attachment = await Attachment.create({
      owner: req.user._id,
      recipient: recipientId,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      storagePath: req.file.filename,
      nonce,
      ephemeralPublicKey: ephemeralPublicKey.toLowerCase(),
      targetPublicKey: targetPublicKey.toLowerCase(),
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
