import fs from 'fs';
import mongoose from 'mongoose';
import Attachment from '../models/Attachment.js';
import { resolveUploadPath } from '../middleware/upload.js';
import { areUsersBlocked } from './userController.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

function cleanupFiles(files = []) {
  for (const file of files) {
    if (file?.path) fs.unlink(file.path, () => {});
  }
}

// Dual-sealed upload: `file` is sealed to the recipient; optional `senderFile`
// is sealed to the sender so they can decrypt their own attachments later.
export async function uploadAttachment(req, res) {
  const recipientFile = req.files?.file?.[0] || req.file;
  const senderFile = req.files?.senderFile?.[0];

  try {
    if (!recipientFile) {
      cleanupFiles([senderFile]);
      return res.status(400).json({ success: false, error: 'file is required' });
    }

    const {
      recipientId,
      nonce,
      ephemeralPublicKey,
      targetPublicKey,
      forSenderNonce,
      forSenderEphemeralPublicKey,
      forSenderTargetPublicKey,
    } = req.body;

    if (!recipientId || !mongoose.isValidObjectId(recipientId)) {
      cleanupFiles([recipientFile, senderFile]);
      return res.status(400).json({ success: false, error: 'Valid recipientId is required' });
    }
    if (!nonce || !HEX_64.test(ephemeralPublicKey || '') || !HEX_64.test(targetPublicKey || '')) {
      cleanupFiles([recipientFile, senderFile]);
      return res.status(400).json({
        success: false,
        error: 'nonce, ephemeralPublicKey and targetPublicKey are required',
      });
    }

    const hasSenderCopy = Boolean(senderFile);
    if (hasSenderCopy) {
      if (
        !forSenderNonce ||
        !HEX_64.test(forSenderEphemeralPublicKey || '') ||
        !HEX_64.test(forSenderTargetPublicKey || '')
      ) {
        cleanupFiles([recipientFile, senderFile]);
        return res.status(400).json({
          success: false,
          error: 'forSenderNonce, forSenderEphemeralPublicKey and forSenderTargetPublicKey are required with senderFile',
        });
      }
    }

    if (await areUsersBlocked(req.user._id, recipientId)) {
      cleanupFiles([recipientFile, senderFile]);
      return res.status(403).json({ success: false, error: 'Cannot send attachments to a blocked user' });
    }

    const attachment = await Attachment.create({
      owner: req.user._id,
      recipient: recipientId,
      filename: recipientFile.originalname,
      mimetype: recipientFile.mimetype || 'application/octet-stream',
      size: recipientFile.size,
      storagePath: recipientFile.filename,
      nonce,
      ephemeralPublicKey: ephemeralPublicKey.toLowerCase(),
      targetPublicKey: targetPublicKey.toLowerCase(),
      ...(hasSenderCopy
        ? {
            forSenderStoragePath: senderFile.filename,
            forSenderNonce,
            forSenderEphemeralPublicKey: forSenderEphemeralPublicKey.toLowerCase(),
            forSenderTargetPublicKey: forSenderTargetPublicKey.toLowerCase(),
          }
        : {}),
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
    cleanupFiles([recipientFile, senderFile]);
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function downloadAttachment(req, res) {
  const attachment = await Attachment.findById(req.params.id);
  if (!attachment) {
    return res.status(404).json({ success: false, error: 'Attachment not found' });
  }

  const userId = req.user._id.toString();
  const isOwner = attachment.owner.toString() === userId;
  const isRecipient = attachment.recipient.toString() === userId;
  if (!isOwner && !isRecipient) {
    return res.status(403).json({ success: false, error: 'Not authorized to access this attachment' });
  }

  // Sender gets their own sealed copy when present; recipient gets the main copy.
  const storagePath =
    isOwner && attachment.forSenderStoragePath ? attachment.forSenderStoragePath : attachment.storagePath;

  res.setHeader('Content-Type', 'application/octet-stream');
  res.sendFile(resolveUploadPath(storagePath), (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ success: false, error: 'Encrypted file not found on disk' });
    }
  });
}
