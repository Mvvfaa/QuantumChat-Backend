import mongoose from 'mongoose';

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
      },
    ],
  },
  { timestamps: true }
);

groupSchema.index({ members: 1 });

groupSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    name: this.name,
    createdBy: this.createdBy?._id || this.createdBy,
    members: (this.members || []).map((m) => {
      if (m && typeof m === 'object' && m.toPublicJSON) return m.toPublicJSON();
      if (m && typeof m === 'object' && m._id) {
        return {
          id: m._id,
          username: m.username,
          email: m.email,
          publicKeys: m.publicKeys || [],
          lastLoginAt: m.lastLoginAt,
        };
      }
      return { id: m };
    }),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('Group', groupSchema, 'groups');
