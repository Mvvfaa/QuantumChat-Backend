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
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
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
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    photoPath: { type: String },
    photoMimeType: { type: String },
    inviteCode: {
      type: String,
      sparse: true,
      unique: true,
      index: true,
    },
    inviteEnabled: {
      type: Boolean,
      default: false,
    },
    pinnedMessageIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
      },
    ],
    onlyAdminsCanPost: {
      type: Boolean,
      default: false,
    },
    onlyAdminsCanAddMembers: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

groupSchema.index({ members: 1 });

groupSchema.methods.isMember = function isMember(userId) {
  return (this.members || []).some((m) => String(m._id || m) === String(userId));
};

groupSchema.methods.isAdmin = function isAdmin(userId) {
  const id = String(userId);
  const admins = this.admins || [];
  if (admins.length) return admins.some((a) => String(a._id || a) === id);
  return String(this.createdBy?._id || this.createdBy) === id;
};

groupSchema.methods.toPublicJSON = function toPublicJSON() {
  const createdBy = this.createdBy?._id || this.createdBy;
  let admins = (this.admins || []).map((a) => String(a._id || a));
  if (!admins.length && createdBy) admins = [String(createdBy)];

  return {
    id: this._id,
    name: this.name,
    description: this.description || '',
    createdBy,
    members: (this.members || []).map((m) => {
      if (m && typeof m === 'object' && m.toPublicJSON) return m.toPublicJSON();
      if (m && typeof m === 'object' && m._id) {
        return {
          id: m._id,
          username: m.username,
          email: m.email,
          publicKeys: m.publicKeys || [],
          lastLoginAt: m.lastLoginAt,
          hasAvatar: Boolean(m.avatarPath),
        };
      }
      return { id: m };
    }),
    admins,
    hasPhoto: Boolean(this.photoPath),
    inviteEnabled: Boolean(this.inviteEnabled && this.inviteCode),
    inviteCode: this.inviteEnabled ? this.inviteCode || null : null,
    pinnedMessageIds: (this.pinnedMessageIds || []).map((id) => String(id)),
    onlyAdminsCanPost: Boolean(this.onlyAdminsCanPost),
    onlyAdminsCanAddMembers: Boolean(this.onlyAdminsCanAddMembers),
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('Group', groupSchema, 'groups');
