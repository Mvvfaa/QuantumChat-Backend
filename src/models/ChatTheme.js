import mongoose from 'mongoose';

const chatThemeSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Exactly one of `peer` (1:1 DM) or `group` (group chat) is set.
    peer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null, index: true },

    presetId: { type: String },
    bubbleColorId: { type: String, required: true, default: 'default' },
    wallpaperId: { type: String, required: true, default: 'none' },

    wallpaperPath: { type: String, default: null },
    wallpaperStorageProvider: { type: String, default: null },
    wallpaperMimeType: { type: String, default: null },
  },
  { timestamps: true }
);

chatThemeSchema.pre('validate', function enforceExactlyOneScope(next) {
  const hasPeer = Boolean(this.peer);
  const hasGroup = Boolean(this.group);
  if (hasPeer === hasGroup) {
    return next(new Error('ChatTheme requires exactly one of peer or group'));
  }
  next();
});

// One theme doc per (owner, peer) and, separately, per (owner, group).
// Partial indexes so a DM row (group: null) never collides with a group
// row (peer: null) under a single compound unique index.
chatThemeSchema.index(
  { owner: 1, peer: 1 },
  { unique: true, partialFilterExpression: { peer: { $type: 'objectId' } } }
);
chatThemeSchema.index(
  { owner: 1, group: 1 },
  { unique: true, partialFilterExpression: { group: { $type: 'objectId' } } }
);

chatThemeSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    peer: this.peer || null,
    group: this.group || null,
    presetId: this.presetId || null,
    bubbleColorId: this.bubbleColorId,
    wallpaperId: this.wallpaperId,
    hasCustomWallpaper: Boolean(this.wallpaperPath),
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('ChatTheme', chatThemeSchema, 'chat_themes');