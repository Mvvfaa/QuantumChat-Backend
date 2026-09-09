import mongoose from 'mongoose';

const highlightItemSchema = new mongoose.Schema(
  {
    mediaType: { type: String, enum: ['image', 'video', 'audio'], required: true },
    filename: String,
    mimetype: String,
    size: Number,
    storagePath: { type: String, required: true },
    storageProvider: String,
    durationMs: { type: Number, default: 0 },
    caption: { type: String, default: '', maxlength: 200 },
    sourceStoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story' },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const highlightSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 40 },
    order: { type: Number, default: 0 },
    // Cover is independent of items once a user uploads a custom one —
    // coverIsCustom stops item add/delete from silently replacing it.
    coverStoragePath: { type: String, default: '' },
    coverMimeType: { type: String, default: '' },
    coverStorageProvider: { type: String, default: '' },
    coverIsCustom: { type: Boolean, default: false },
    items: [highlightItemSchema],
  },
  { timestamps: true }
);

highlightSchema.index({ owner: 1, createdAt: 1 });

highlightSchema.statics.maxItems = 100;
highlightSchema.statics.maxPerUser = 50;

highlightSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: String(this._id),
    owner: String(this.owner),
    name: this.name,
    order: this.order,
    itemCount: this.items?.length || 0,
    hasCover: Boolean(this.coverStoragePath),
    items: (this.items || []).map((item) => ({
      id: String(item._id),
      mediaType: item.mediaType,
      mimetype: item.mimetype,
      size: item.size,
      durationMs: item.durationMs,
      caption: item.caption,
      sourceStoryId: item.sourceStoryId ? String(item.sourceStoryId) : null,
      addedAt: item.addedAt,
    })),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('Highlight', highlightSchema);