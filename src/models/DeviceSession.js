import mongoose from 'mongoose';

const deviceSessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    label: {
      type: String,
      trim: true,
      maxlength: 200,
      default: '',
    },
    userAgent: {
      type: String,
      trim: true,
      maxlength: 512,
      default: '',
    },
    ip: {
      type: String,
      trim: true,
      maxlength: 64,
      default: '',
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

deviceSessionSchema.index({ user: 1, revokedAt: 1 });

deviceSessionSchema.methods.toJSON = function toJSON() {
  return {
    id: this._id,
    sessionId: this.sessionId,
    label: this.label || '',
    userAgent: this.userAgent || '',
    ip: this.ip || '',
    createdAt: this.createdAt,
    lastSeenAt: this.lastSeenAt,
    revokedAt: this.revokedAt,
  };
};

export default mongoose.model('DeviceSession', deviceSessionSchema);
