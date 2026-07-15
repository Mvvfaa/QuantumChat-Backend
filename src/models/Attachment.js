import mongoose from 'mongoose';

const HEX_64 = /^[0-9a-f]{64}$/i;

const attachmentSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    // Recipient-sealed ciphertext on disk.
    storagePath: { type: String, required: true },
    nonce: { type: String, required: true },
    ephemeralPublicKey: { type: String, required: true, match: HEX_64 },
    targetPublicKey: { type: String, required: true, match: HEX_64 },
    // Optional second copy sealed to the sender's own key so they can replay
    // voice notes / files on this (or another) device later.
    forSenderStoragePath: { type: String },
    forSenderNonce: { type: String },
    forSenderEphemeralPublicKey: { type: String, match: HEX_64 },
    forSenderTargetPublicKey: { type: String, match: HEX_64 },
  },
  { timestamps: true }
);

export default mongoose.model('Attachment', attachmentSchema, 'attachments');
