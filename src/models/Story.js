import mongoose from 'mongoose';

const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_DURATION_MS = 60 * 1000;

const storySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mediaType: { type: String, enum: ['image', 'video', 'audio'], required: true },
    filename: { type: String, required: true },
    mimetype: { type: String, required: true },
    size: { type: Number, required: true },
    storagePath: { type: String, required: true },
    durationMs: { type: Number, default: 0, max: MAX_DURATION_MS },
    caption: { type: String, maxlength: 200, default: '' },
    expiresAt: { type: Date, required: true, index: true },
    sealed: { type: Boolean, default: false },
    envelopeNonce: { type: String, default: undefined },
    envelopeEphemeralPublicKey: { type: String, default: undefined },
    envelopeTargetHint: { type: String, default: undefined },
  },
  { timestamps: true }
);

storySchema.statics.ttlMs = STORY_TTL_MS;
storySchema.statics.maxDurationMs = MAX_DURATION_MS;

storySchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    user: this.user?._id || this.user,
    mediaType: this.mediaType,
    filename: this.filename,
    mimetype: this.mimetype,
    size: this.size,
    durationMs: this.durationMs || 0,
    caption: this.caption || '',
    createdAt: this.createdAt,
    expiresAt: this.expiresAt,
    sealed: Boolean(this.sealed),
    envelopeNonce: this.envelopeNonce || undefined,
    envelopeEphemeralPublicKey: this.envelopeEphemeralPublicKey || undefined,
    envelopeTargetHint: this.envelopeTargetHint || undefined,
  };
};

export default mongoose.model('Story', storySchema, 'stories');
