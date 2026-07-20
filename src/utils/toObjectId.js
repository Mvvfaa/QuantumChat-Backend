import mongoose from 'mongoose';

/**
 * Validate and cast to ObjectId so taint analyzers (CodeQL) treat the
 * value as sanitized before it reaches Mongoose query sinks.
 * @returns {mongoose.Types.ObjectId|null}
 */
export function toObjectId(value) {
  const raw = value == null ? '' : String(value);
  if (!mongoose.isValidObjectId(raw)) return null;
  return new mongoose.Types.ObjectId(raw);
}
