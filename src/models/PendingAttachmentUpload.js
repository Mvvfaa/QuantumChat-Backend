import mongoose from 'mongoose';

const HEX_64 = /^[0-9a-f]{64}$/i;

/**
 * Short-lived bridge between POST /attachments/init and /attachments/finalize.
 * Holds everything needed to create the real Attachment once the ciphertext
 * bytes land in storage (proxied through us to Cloudinary, local disk, or
 * in-memory test storage). Auto-expires via TTL index so abandoned uploads
 * don't linger.
 */
const pendingAttachmentUploadSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clientUploadId: { type: String, trim: true, maxlength: 100 },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },

  filename: { type: String, required: true },
  mimetype: { type: String, required: true },
  size: { type: Number, required: true },

  // Storage mode + object names chosen at init time.
  storageMode: { type: String, enum: ['direct', 'proxy'], required: true },
  recipientObjectName: { type: String, required: true },
  senderObjectName: { type: String },
  // Populated once proxy-mode bytes have actually been written (local/dev only).
  recipientStoragePath: { type: String },
  senderStoragePath: { type: String },
  recipientChunks: {
    type: [{ index: { type: Number, min: 0 }, key: { type: String, required: true } }],
    default: undefined,
  },
  senderChunks: {
    type: [{ index: { type: Number, min: 0 }, key: { type: String, required: true } }],
    default: undefined,
  },

  // Chunked-upload progress (large files only — see attachmentRoutes.js
  // PUT /pending/:id/chunk). Absent/0 for the existing single-shot path.
  recipientChunksReceived: { type: Number, default: 0 },
  recipientTotalChunks: { type: Number },
  recipientTempPath: { type: String },
  senderChunksReceived: { type: Number, default: 0 },
  senderTotalChunks: { type: Number },
  senderTempPath: { type: String },

  // DM sealed-box fields
  nonce: { type: String },
  ephemeralPublicKey: { type: String, match: HEX_64 },
  targetPublicKey: { type: String, match: HEX_64 },
  forSenderNonce: { type: String },
  forSenderEphemeralPublicKey: { type: String, match: HEX_64 },
  forSenderTargetPublicKey: { type: String, match: HEX_64 },

  // Group secretbox field
  secretboxNonce: { type: String },

  createdAt: { type: Date, default: Date.now, expires: 30 * 60 },
});

pendingAttachmentUploadSchema.index(
  { owner: 1, clientUploadId: 1 },
  { unique: true, partialFilterExpression: { clientUploadId: { $type: 'string' } } },
);

export default mongoose.model('PendingAttachmentUpload', pendingAttachmentUploadSchema, 'pendingattachmentuploads');
