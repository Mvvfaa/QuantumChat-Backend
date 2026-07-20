import AiCapsuleReceipt from '../models/AiCapsuleReceipt.js';

const HEX_64 = /^[0-9a-f]{64}$/i;

export async function createAiCapsule(req, res) {
  try {
    const { contentHash, messageCount, purpose, conversationType, conversationId } = req.body || {};

    if (!HEX_64.test(contentHash || '')) {
      return res.status(400).json({ success: false, error: 'contentHash must be a sha256 hex string' });
    }
    const count = Number(messageCount);
    if (!Number.isFinite(count) || count < 0 || !Number.isInteger(count)) {
      return res.status(400).json({ success: false, error: 'messageCount must be a non-negative integer' });
    }
    if (typeof purpose !== 'string' || !purpose.trim() || purpose.trim().length > 200) {
      return res.status(400).json({ success: false, error: 'purpose is required (max 200 chars)' });
    }

    const receipt = await AiCapsuleReceipt.create({
      user: req.user._id,
      contentHash: String(contentHash).toLowerCase(),
      messageCount: count,
      purpose: purpose.trim().slice(0, 200),
      conversationType:
        typeof conversationType === 'string' ? conversationType.trim().slice(0, 32) : '',
      conversationId:
        conversationId != null && conversationId !== ''
          ? String(conversationId).trim().slice(0, 64)
          : '',
    });

    res.status(201).json({ success: true, data: receipt.toJSON() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function listAiCapsules(req, res) {
  try {
    const receipts = await AiCapsuleReceipt.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json({ success: true, data: receipts.map((r) => r.toJSON()) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
