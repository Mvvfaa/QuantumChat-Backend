import mongoose from 'mongoose';

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'inappropriate_content',
  'impersonation',
  'scam_or_fraud',
  'other',
];

const reportSchema = new mongoose.Schema(
  {
    reportedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, trim: true, maxlength: 500, default: '' },
    trusted: { type: Boolean, default: true },
  },
  { timestamps: true }
);

reportSchema.index({ reporter: 1, reportedUser: 1 }, { unique: true });

export default mongoose.model('Report', reportSchema);
