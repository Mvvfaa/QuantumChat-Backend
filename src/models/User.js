import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const HEX_64 = /^[0-9a-f]{64}$/i;
export const KEY_SET_SIZE = 5;

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
    // Pool of 5 X25519 public keys (32 bytes, hex-encoded = 64 chars each).
    // Senders pick one at random per message, so the same conversation
    // spreads ciphertext across multiple keys instead of always the same
    // one. The whole set of 5 is replaced on every login and every 30-minute
    // rotation; matching private keys never leave the device (kept in a
    // local keyring so history under retired keys stays decryptable).
    publicKeys: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length === KEY_SET_SIZE && arr.every((k) => HEX_64.test(k)),
        message: `publicKeys must contain exactly ${KEY_SET_SIZE} 64-character hex public keys`,
      },
    },
    // When this publicKeys set was last rotated in, for visibility/debugging.
    keyRotatedAt: {
      type: Date,
      default: Date.now,
    },
    lastLoginAt: {
      type: Date,
    },
    // Users this account has blocked. Bidirectional send checks use this
    // list so neither side can deliver new messages after a block.
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    avatarPath: {
      type: String,
      default: null,
    },
    avatarMimeType: {
      type: String,
      default: null,
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
  let publicKeys = Array.isArray(this.publicKeys) ? this.publicKeys.filter(Boolean) : [];
  if (publicKeys.length === 0 && this.publicKey) {
    publicKeys = [this.publicKey];
  }

  return {
    id: this._id,
    username: this.username,
    email: this.email,
    publicKeys: publicKeys.map((k) => String(k).toLowerCase()),
    keyRotatedAt: this.keyRotatedAt,
    lastLoginAt: this.lastLoginAt,
    hasAvatar: Boolean(this.avatarPath),
  };
};

userSchema.methods.toSelfJSON = function toSelfJSON() {
  return {
    ...this.toPublicJSON(),
    blockedUsers: Array.isArray(this.blockedUsers) ? this.blockedUsers.map((id) => String(id)) : [],
  };
};

export default mongoose.model('User', userSchema, 'users');
