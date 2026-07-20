import mongoose from 'mongoose';

const HEX_64 = /^[0-9a-f]{64}$/i;

const aiCapsuleReceiptSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // SHA-256 of client-side canonical capsule JSON — never plaintext content
    contentHash: {
      type: String,
      required: true,
      match: HEX_64,
      lowercase: true,
    },
    messageCount: {
      type: Number,
      required: true,
      min: 0,
    },
    purpose: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    conversationType: {
      type: String,
      trim: true,
      maxlength: 32,
      default: '',
    },
    conversationId: {
      type: String,
      trim: true,
      maxlength: 64,
      default: '',
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

aiCapsuleReceiptSchema.index({ user: 1, createdAt: -1 });

aiCapsuleReceiptSchema.methods.toJSON = function toJSON() {
  return {
    id: this._id,
    contentHash: this.contentHash,
    messageCount: this.messageCount,
    purpose: this.purpose,
    conversationType: this.conversationType || '',
    conversationId: this.conversationId || '',
    createdAt: this.createdAt,
  };
};

export default mongoose.model('AiCapsuleReceipt', aiCapsuleReceiptSchema);
