import mongoose from 'mongoose';

const HEX_64 = /^[0-9a-f]{64}$/i;

const attachmentSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    // Path to the encrypted bytes on disk. The server never has the key to
    // open them — nacl.box ciphertext in, nacl.box ciphertext out.
    storagePath: { type: String, required: true },
    nonce: { type: String, required: true },
    senderPublicKey: { type: String, required: true, match: HEX_64 },
    recipientPublicKey: { type: String, required: true, match: HEX_64 },
  },
  { timestamps: true }
);

export default mongoose.model('Attachment', attachmentSchema);
