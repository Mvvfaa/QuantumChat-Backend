import mongoose from 'mongoose';

const keyVaultSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    // Opaque passphrase-wrapped ciphertext — never plaintext keys
    ciphertext: {
      type: String,
      required: true,
    },
    nonce: {
      type: String,
      required: true,
    },
    salt: {
      type: String,
      required: true,
    },
    kdf: {
      type: String,
      default: 'pbkdf2',
    },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

keyVaultSchema.methods.toJSON = function toJSON() {
  return {
    ciphertext: this.ciphertext,
    nonce: this.nonce,
    salt: this.salt,
    kdf: this.kdf || 'pbkdf2',
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model('KeyVault', keyVaultSchema);
