import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const HEX_64 = /^[0-9a-f]{64}$/i;

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    // Public half of the user's current X25519 keypair (32 bytes, hex-encoded
    // = 64 chars). The client rotates this every 30 minutes; the matching
    // private key never leaves the device (kept in a local keyring).
    publicKey: {
      type: String,
      required: true,
      match: HEX_64,
    },
    // When this publicKey was last rotated in, for visibility/debugging.
    keyRotatedAt: {
      type: Date,
      default: Date.now,
    },
    lastLoginAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    username: this.username,
    email: this.email,
    publicKey: this.publicKey,
    keyRotatedAt: this.keyRotatedAt,
    lastLoginAt: this.lastLoginAt,
  };
};

export default mongoose.model('User', userSchema);
