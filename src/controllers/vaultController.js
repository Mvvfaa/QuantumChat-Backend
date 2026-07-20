import KeyVault from '../models/KeyVault.js';

export async function getVault(req, res) {
  try {
    const vault = await KeyVault.findOne({ user: req.user._id });
    if (!vault) {
      return res.status(404).json({ success: false, error: 'No vault backup found' });
    }
    res.json({ success: true, data: vault.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function putVault(req, res) {
  try {
    const { ciphertext, nonce, salt, kdf } = req.body || {};
    if (!ciphertext || !nonce || !salt) {
      return res.status(400).json({
        success: false,
        error: 'ciphertext, nonce, and salt are required',
      });
    }
    if (typeof ciphertext !== 'string' || typeof nonce !== 'string' || typeof salt !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'ciphertext, nonce, and salt must be strings',
      });
    }

    const vault = await KeyVault.findOneAndUpdate(
      { user: req.user._id },
      {
        ciphertext,
        nonce,
        salt,
        kdf: typeof kdf === 'string' && kdf.trim() ? kdf.trim() : 'pbkdf2',
        updatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, data: vault.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function deleteVault(req, res) {
  try {
    const result = await KeyVault.findOneAndDelete({ user: req.user._id });
    if (!result) {
      return res.status(404).json({ success: false, error: 'No vault backup found' });
    }
    res.json({ success: true, data: { message: 'Vault deleted' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
