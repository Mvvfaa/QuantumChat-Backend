import mongoose from 'mongoose';

const HEX_64 = /^[0-9a-f]{64}$/i;

const messageSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Server only ever sees ciphertext + nonce, both produced client-side via nacl.box.
    // It cannot decrypt messages — it has no private keys.
    ciphertext: { type: String, required: true },
    nonce: { type: String, required: true },
    // Snapshots of both parties' public keys at send time. Keys rotate every
    // 30 minutes, so decrypting later requires knowing exactly which keypair
    // version was used for this specific message — the "current" public key
    // on the User doc may have moved on since.
    senderPublicKey: { type: String, required: true, match: HEX_64 },
    recipientPublicKey: { type: String, required: true, match: HEX_64 },
    attachment: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment' },
  },
  { timestamps: true }
);

messageSchema.index({ from: 1, to: 1, createdAt: 1 });

export default mongoose.model('Message', messageSchema);
