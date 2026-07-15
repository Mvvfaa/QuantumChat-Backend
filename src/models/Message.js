import mongoose from 'mongoose';

const HEX_64 = /^[0-9a-f]{64}$/i;

const envelopeSchema = new mongoose.Schema(
  {
    ciphertext: { type: String, required: true },
    nonce: { type: String, required: true },
    ephemeralPublicKey: { type: String, required: true, match: HEX_64 },
    targetPublicKey: { type: String, required: true, match: HEX_64 },
  },
  { _id: false }
);

const reactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    forRecipient: { type: envelopeSchema },
    forSender: { type: envelopeSchema },
    emoji: { type: String, maxlength: 16 },
  },
  { _id: false, timestamps: { createdAt: true, updatedAt: false } }
);

const memberEnvelopeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    ciphertext: { type: String, required: true },
    nonce: { type: String, required: true },
    ephemeralPublicKey: { type: String, required: true, match: HEX_64 },
    targetPublicKey: { type: String, required: true, match: HEX_64 },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    forRecipient: { type: envelopeSchema },
    forSender: { type: envelopeSchema },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', index: true },
    envelopes: { type: [memberEnvelopeSchema], default: undefined },
    attachment: { type: mongoose.Schema.Types.ObjectId, ref: 'Attachment' },
    reactions: { type: [reactionSchema], default: [] },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
    editedAt: { type: Date },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    // Optional display metadata when this message was forwarded (plaintext was re-sealed).
    forwardedFrom: {
      username: { type: String },
      messageId: { type: mongoose.Schema.Types.ObjectId },
    },
  },
  { timestamps: true }
);

messageSchema.index({ from: 1, to: 1, createdAt: 1 });
messageSchema.index({ group: 1, createdAt: 1 });

messageSchema.pre('validate', function ensureShape(next) {
  const isGroup = Boolean(this.group);
  if (isGroup) {
    if (!Array.isArray(this.envelopes) || this.envelopes.length < 2) {
      return next(new Error('Group messages require envelopes for each member'));
    }
    this.to = undefined;
    this.forRecipient = undefined;
    this.forSender = undefined;
  } else {
    if (!this.to || !this.forRecipient || !this.forSender) {
      return next(new Error('DM messages require to, forRecipient and forSender'));
    }
    this.group = undefined;
    this.envelopes = undefined;
  }
  next();
});

export default mongoose.model('Message', messageSchema, 'messages');
