import crypto from 'crypto';
import User, { KEY_SET_SIZE } from '../models/User.js';

export const QUANTUM_AI_USERNAME = 'QuantumAI';
export const QUANTUM_AI_EMAIL = 'quantumai@system.quantumchat';

export async function ensureQuantumAIUser() {
  const existing = await User.findOne({ systemRole: 'quantum_ai' });
  if (existing) return existing;

  const collision = await User.findOne({
    $or: [{ username: { $regex: /^QuantumAI$/i } }, { email: QUANTUM_AI_EMAIL }],
  });
  if (collision) {
    const suffix = String(collision._id).slice(-6);
    await User.updateOne(
      { _id: collision._id, isSystemUser: { $ne: true } },
      {
        $set: {
          username: `QuantumAI-legacy-${suffix}`,
          ...(collision.email === QUANTUM_AI_EMAIL
            ? { email: `quantumai-legacy-${suffix}@system.quantumchat` }
            : {}),
        },
      }
    );
  }

  try {
    return await User.create({
      username: QUANTUM_AI_USERNAME,
      displayName: 'QuantumAI',
      email: QUANTUM_AI_EMAIL,
      emailVerified: true,
      publicKeys: Array.from({ length: KEY_SET_SIZE }, () => crypto.randomBytes(32).toString('hex')),
      isSystemUser: true,
      systemRole: 'quantum_ai',
      verified: true,
      privacy: { lastSeen: 'nobody', online: 'nobody', readReceipts: false },
    });
  } catch (error) {
    if (error?.code === 11000) {
      const raced = await User.findOne({ systemRole: 'quantum_ai' });
      if (raced) return raced;
    }
    throw error;
  }
}
