import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import Attachment from '../models/Attachment.js';
import Group from '../models/Group.js';
import Message from '../models/Message.js';
import PendingAttachmentUpload from '../models/PendingAttachmentUpload.js';
import { getStorage, getStorageProviderName, newObjectName, MAX_ATTACHMENT_SIZE } from '../middleware/upload.js';
import { areUsersBlocked } from './userController.js';

function chunkTempPath(pendingId, slot) {
  return path.join(os.tmpdir(), `qc-upload-${pendingId}-${slot}.part`);
}

const HEX_64 = /^[0-9a-f]{64}$/i;
/** Storage keys are opaque alnum/-/_ strings; this just rejects garbage input. */
const PLAUSIBLE_STORAGE_KEY = /^[\w-]{5,200}$/;

async function deleteKey(key) {
  if (!key) return;
  try {
    await getStorage().delete(key);
  } catch {
    // best-effort
  }
}

/**
 * Validates recipient/group + crypto metadata and hands back an upload
 * target for the ciphertext bytes: a proxy endpoint on us that forwards
 * the bytes to Cloudinary.
 */
export async function initAttachmentUpload(req, res) {
  try {
    const {
      recipientId,
      groupId,
      filename,
      mimetype,
      size,
      secretboxNonce,
      nonce,
      ephemeralPublicKey,
      targetPublicKey,
      forSenderNonce,
      forSenderEphemeralPublicKey,
      forSenderTargetPublicKey,
    } = req.body;

    if (!filename || typeof filename !== 'string') {
      return res.status(400).json({ success: false, error: 'filename is required' });
    }
    const numericSize = Number(size);
    if (!Number.isFinite(numericSize) || numericSize <= 0) {
      return res.status(400).json({ success: false, error: 'A valid size is required' });
    }
    if (numericSize > MAX_ATTACHMENT_SIZE) {
      return res.status(400).json({ success: false, error: 'File too large' });
    }

    const storage = getStorage();
    const pending = new PendingAttachmentUpload({
      owner: req.user._id,
      filename,
      mimetype: mimetype || 'application/octet-stream',
      size: numericSize,
    });

    if (groupId) {
      if (!mongoose.isValidObjectId(groupId)) {
        return res.status(400).json({ success: false, error: 'Valid groupId is required' });
      }
      if (!secretboxNonce || typeof secretboxNonce !== 'string') {
        return res.status(400).json({ success: false, error: 'secretboxNonce is required for group files' });
      }
      const group = await Group.findById(groupId);
      if (!group || !group.isMember(req.user._id)) {
        return res.status(403).json({ success: false, error: 'Not a group member' });
      }

      pending.group = groupId;
      pending.secretboxNonce = secretboxNonce;
    } else {
      if (!recipientId || !mongoose.isValidObjectId(recipientId)) {
        return res.status(400).json({ success: false, error: 'Valid recipientId is required' });
      }
      if (!nonce || !HEX_64.test(ephemeralPublicKey || '') || !HEX_64.test(targetPublicKey || '')) {
        return res.status(400).json({
          success: false,
          error: 'nonce, ephemeralPublicKey and targetPublicKey are required',
        });
      }

      const hasSenderCopy = Boolean(forSenderNonce || forSenderEphemeralPublicKey || forSenderTargetPublicKey);
      if (hasSenderCopy) {
        if (
          !forSenderNonce ||
          !HEX_64.test(forSenderEphemeralPublicKey || '') ||
          !HEX_64.test(forSenderTargetPublicKey || '')
        ) {
          return res.status(400).json({
            success: false,
            error: 'forSenderNonce, forSenderEphemeralPublicKey and forSenderTargetPublicKey are required together',
          });
        }
      }

      if (await areUsersBlocked(req.user._id, recipientId)) {
        return res.status(403).json({ success: false, error: 'Cannot send attachments to a blocked user' });
      }

      pending.recipient = recipientId;
      pending.nonce = nonce;
      pending.ephemeralPublicKey = ephemeralPublicKey.toLowerCase();
      pending.targetPublicKey = targetPublicKey.toLowerCase();
      if (hasSenderCopy) {
        pending.forSenderNonce = forSenderNonce;
        pending.forSenderEphemeralPublicKey = forSenderEphemeralPublicKey.toLowerCase();
        pending.forSenderTargetPublicKey = forSenderTargetPublicKey.toLowerCase();
      }
    }

    const recipientObjectName = newObjectName('', '.enc');
    const recipientTarget = await storage.createUploadTarget(
      recipientObjectName,
      pending.mimetype,
      numericSize,
      req.user._id
    );
    pending.storageMode = recipientTarget.mode;
    pending.recipientObjectName = recipientObjectName;

    const data = {
      recipient: { mode: recipientTarget.mode, uploadUrl: recipientTarget.uploadUrl },
    };

    if (pending.forSenderNonce) {
      const senderObjectName = newObjectName('', '.enc');
      const senderTarget = await storage.createUploadTarget(
        senderObjectName,
        pending.mimetype,
        numericSize,
        req.user._id
      );
      pending.senderObjectName = senderObjectName;
      data.sender = { mode: senderTarget.mode, uploadUrl: senderTarget.uploadUrl };
    }

    await pending.save();
    data.pendingUploadId = pending._id;

    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * Receives the ciphertext bytes staged by initAttachmentUpload and forwards
 * them to the configured storage provider (Cloudinary in production; local
 * disk or in-memory storage in dev/test).
 */
export async function uploadPendingAttachmentBytes(req, res) {
  try {
    const slot = req.query.slot === 'sender' ? 'sender' : 'recipient';
    const pending = await PendingAttachmentUpload.findById(req.params.id);
    if (!pending || pending.owner.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, error: 'Pending upload not found' });
    }
    if (pending.storageMode !== 'proxy') {
      return res.status(400).json({ success: false, error: 'This upload does not use the proxy path' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ success: false, error: 'file is required' });
    }

    const objectName = slot === 'sender' ? pending.senderObjectName : pending.recipientObjectName;
    if (!objectName) {
      return res.status(400).json({ success: false, error: `No ${slot} upload was requested for this session` });
    }

    const stored = await getStorage().put(req.file.buffer, objectName, pending.mimetype, req.user._id);
    if (slot === 'sender') {
      pending.senderStoragePath = stored.key;
    } else {
      pending.recipientStoragePath = stored.key;
    }
    await pending.save();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * One chunk of a large (video) upload. Chunks are appended in order to a
 * scratch file in /tmp; once the last chunk lands, the assembled file is
 * handed to getStorage().put() — the exact same call the small-file path
 * (uploadPendingAttachmentBytes above) already uses. Same durable result
 * either way; this just avoids ever putting a huge buffer in one request
 * body, which Vercel's serverless functions reject.
 */
export async function uploadPendingAttachmentChunk(req, res) {
  try {
    const slot = req.query.slot === 'sender' ? 'sender' : 'recipient';
    const chunkIndex = Number(req.query.chunkIndex);
    const totalChunks = Number(req.query.totalChunks);

    if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
      return res.status(400).json({ success: false, error: 'Valid chunkIndex is required' });
    }
    if (!Number.isInteger(totalChunks) || totalChunks < 1) {
      return res.status(400).json({ success: false, error: 'Valid totalChunks is required' });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ success: false, error: 'Chunk body is required' });
    }

    const pending = await PendingAttachmentUpload.findById(req.params.id);
    if (!pending || pending.owner.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, error: 'Pending upload not found' });
    }
    if (pending.storageMode !== 'proxy') {
      return res.status(400).json({ success: false, error: 'This upload does not use the proxy path' });
    }

    const objectName = slot === 'sender' ? pending.senderObjectName : pending.recipientObjectName;
    if (!objectName) {
      return res.status(400).json({ success: false, error: `No ${slot} upload was requested for this session` });
    }

    const receivedField = slot === 'sender' ? 'senderChunksReceived' : 'recipientChunksReceived';
    const totalField = slot === 'sender' ? 'senderTotalChunks' : 'recipientTotalChunks';
    const tempPathField = slot === 'sender' ? 'senderTempPath' : 'recipientTempPath';
    const storagePathField = slot === 'sender' ? 'senderStoragePath' : 'recipientStoragePath';

    const tempPath = pending[tempPathField] || chunkTempPath(pending._id, slot);
    await fs.appendFile(tempPath, req.body);

    // Atomic compare-and-swap on THIS slot's counter only. The recipient
    // and sender slots can now be written concurrently (Chat.jsx uploads
    // both at once), and a plain pending.save() relies on Mongoose's
    // shared __v version counter — two concurrent saves on the same
    // document (even touching different fields) can collide and drop an
    // update. findOneAndUpdate here touches only this slot's fields and
    // doesn't depend on __v at all, so the two slots can never step on
    // each other.
    const updated = await PendingAttachmentUpload.findOneAndUpdate(
      { _id: pending._id, [receivedField]: chunkIndex },
      {
        $set: {
          [receivedField]: chunkIndex + 1,
          [totalField]: totalChunks,
          [tempPathField]: tempPath,
        },
      },
      { new: true },
    );

    if (!updated) {
      // No document matched our expected chunkIndex for this slot — a
      // retry raced ahead, or this chunk arrived twice. Report where the
      // slot actually is so the client can resume correctly.
      const current = await PendingAttachmentUpload.findById(pending._id);
      return res.status(409).json({
        success: false,
        error: 'Chunk out of order',
        data: { expectedIndex: current?.[receivedField] ?? 0 },
      });
    }

    const isComplete = updated[receivedField] >= totalChunks;
    if (!isComplete) {
      return res.json({
        success: true,
        data: { complete: false, chunksReceived: updated[receivedField], totalChunks },
      });
    }

    const assembled = await fs.readFile(tempPath);
    if (assembled.length > MAX_ATTACHMENT_SIZE) {
      await fs.unlink(tempPath).catch(() => {});
      return res.status(400).json({ success: false, error: 'File too large' });
    }

    const stored = await getStorage().put(assembled, objectName, updated.mimetype, req.user._id);
    await fs.unlink(tempPath).catch(() => {});

    await PendingAttachmentUpload.findByIdAndUpdate(pending._id, {
      $set: { [storagePathField]: stored.key },
      $unset: { [tempPathField]: 1 },
    });

    res.json({ success: true, data: { complete: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function finalizeAttachmentUpload(req, res) {
  const { pendingUploadId, recipientDirectUploadId, senderDirectUploadId } = req.body;
  let pending;
  try {
    if (!pendingUploadId || !mongoose.isValidObjectId(pendingUploadId)) {
      return res.status(400).json({ success: false, error: 'Valid pendingUploadId is required' });
    }
    pending = await PendingAttachmentUpload.findById(pendingUploadId);
    if (!pending || pending.owner.toString() !== req.user._id.toString()) {
      return res.status(404).json({ success: false, error: 'Pending upload not found or expired' });
    }

    const resolveStoragePath = (mode, directUploadId, proxyPath, label) => {
      if (mode === 'direct') {
        if (!directUploadId || !PLAUSIBLE_STORAGE_KEY.test(directUploadId)) {
          throw Object.assign(new Error(`A valid ${label} upload id is required`), { status: 400 });
        }
        return directUploadId;
      }
      if (!proxyPath) {
        throw Object.assign(new Error(`${label} bytes were not uploaded`), { status: 400 });
      }
      return proxyPath;
    };

    const recipientStoragePath = resolveStoragePath(
      pending.storageMode,
      recipientDirectUploadId,
      pending.recipientStoragePath,
      'recipient'
    );
    const senderStoragePath = pending.senderObjectName
      ? resolveStoragePath(pending.storageMode, senderDirectUploadId, pending.senderStoragePath, 'sender')
      : undefined;

    const storageProvider = getStorageProviderName();

    if (pending.group) {
      const group = await Group.findById(pending.group);
      if (!group || !group.isMember(req.user._id)) {
        return res.status(403).json({ success: false, error: 'Not a group member' });
      }

      const attachment = await Attachment.create({
        owner: req.user._id,
        group: pending.group,
        filename: pending.filename,
        mimetype: pending.mimetype,
        size: pending.size,
        storagePath: recipientStoragePath,
        storageProvider,
        encryption: 'secretbox',
        secretboxNonce: pending.secretboxNonce,
      });

      await pending.deleteOne();
      return res.status(201).json({
        success: true,
        data: {
          id: attachment._id,
          filename: attachment.filename,
          mimetype: attachment.mimetype,
          size: attachment.size,
          encryption: 'secretbox',
          secretboxNonce: attachment.secretboxNonce,
          group: pending.group,
        },
      });
    }

    if (await areUsersBlocked(req.user._id, pending.recipient)) {
      return res.status(403).json({ success: false, error: 'Cannot send attachments to a blocked user' });
    }

    const attachment = await Attachment.create({
      owner: req.user._id,
      recipient: pending.recipient,
      filename: pending.filename,
      mimetype: pending.mimetype,
      size: pending.size,
      storagePath: recipientStoragePath,
      storageProvider,
      nonce: pending.nonce,
      ephemeralPublicKey: pending.ephemeralPublicKey,
      targetPublicKey: pending.targetPublicKey,
      encryption: 'sealed',
      ...(senderStoragePath
        ? {
            forSenderStoragePath: senderStoragePath,
            forSenderNonce: pending.forSenderNonce,
            forSenderEphemeralPublicKey: pending.forSenderEphemeralPublicKey,
            forSenderTargetPublicKey: pending.forSenderTargetPublicKey,
          }
        : {}),
    });

    await pending.deleteOne();
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
    // Direct-mode bytes already landed with the storage provider under the
    // browser's control; best-effort clean them up since no Attachment
    // record will reference them.
    if (pending?.storageMode === 'direct') {
      await Promise.all([deleteKey(recipientDirectUploadId), deleteKey(senderDirectUploadId)]);
    }
    const status = err.status || 500;
    res.status(status).json({ success: false, error: err.message });
  }
}

export async function downloadAttachment(req, res) {
  try {
    const attachment = await Attachment.findById(req.params.id);
    if (!attachment) {
      return res.status(404).json({ success: false, error: 'Attachment not found' });
    }

    // View-once media must not be re-fetched after it has been opened.
    const linked = await Message.findOne({
      attachment: attachment._id,
      viewOnce: true,
      viewOnceOpenedAt: { $ne: null },
    }).select('_id');
    if (linked) {
      return res.status(404).json({ success: false, error: 'Attachment not found' });
    }

    const userId = req.user._id.toString();
    const isOwner = attachment.owner.toString() === userId;

    if (attachment.group) {
      const group = await Group.findById(attachment.group);
      if (!group || !group.isMember(req.user._id)) {
        return res.status(403).json({ success: false, error: 'Not authorized to access this attachment' });
      }
      const bytes = await getStorage().read(attachment.storagePath);
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.send(bytes);
    }

    const isRecipient = attachment.recipient?.toString() === userId;
    if (!isOwner && !isRecipient) {
      return res.status(403).json({ success: false, error: 'Not authorized to access this attachment' });
    }

    const storagePath =
      isOwner && attachment.forSenderStoragePath ? attachment.forSenderStoragePath : attachment.storagePath;

    const bytes = await getStorage().read(storagePath);
    res.setHeader('Content-Type', 'application/octet-stream');
    return res.send(bytes);
  } catch (err) {
    if (!res.headersSent) {
      res.status(404).json({ success: false, error: 'Encrypted file not found' });
    }
  }
}
