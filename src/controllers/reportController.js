import mongoose from 'mongoose';
import Report, { REPORT_REASONS } from '../models/Report.js';
import User from '../models/User.js';
import { notifyUser } from '../services/pushService.js';

const FLAG_THRESHOLD = 3; // 3-4 reports → flagged for review
const BAN_WARNING_AT = 4; // exact 4th report → one-time "you may be banned" notice
const WARNING_THRESHOLD = 7; // 7-8+ reports → safety warning on incoming friend requests
const RESTRICT_THRESHOLD = 15; // >15 reports → restricted

function toObjectId(id) {
  return mongoose.isValidObjectId(id) ? new mongoose.Types.ObjectId(id) : null;
}

const MIN_ACCOUNT_AGE_MS = 24 * 60 * 60 * 1000;

export async function createReport(req, res) {
  try {
    const { userId, reason, details } = req.body || {};
    const reportedId = toObjectId(userId);
    if (!reportedId) {
      return res.status(400).json({ success: false, error: 'Invalid user id' });
    }
    if (String(reportedId) === String(req.user._id)) {
      return res.status(400).json({ success: false, error: 'Cannot report your own account' });
    }
    if (!REPORT_REASONS.includes(reason)) {
      return res.status(400).json({ success: false, error: `reason must be one of: ${REPORT_REASONS.join(', ')}` });
    }

    const reportedUser = await User.findById(reportedId).select('_id');
    if (!reportedUser) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const trusted = req.user.createdAt
      ? Date.now() - new Date(req.user.createdAt).getTime() >= MIN_ACCOUNT_AGE_MS
      : true;

    let report;
    try {
      report = await Report.create({
        reportedUser: reportedId,
        reporter: req.user._id,
        reason,
        details: typeof details === 'string' ? details.slice(0, 500) : '',
        trusted,
      });
    } catch (err) {
      if (err?.code === 11000) {
        return res.json({ success: true, data: { alreadyReported: true } });
      }
      throw err;
    }

    if (trusted) {
      const update = await User.findByIdAndUpdate(
        reportedId,
        {
          $inc: { 'moderation.reportCount': 1, [`moderation.reasonCounts.${reason}`]: 1 },
          $set: { 'moderation.lastReportedAt': new Date() },
        },
        { new: true }
      );

      const count = update.moderation.reportCount;
      let nextStatus = update.moderation.status;
      if (count > RESTRICT_THRESHOLD) nextStatus = 'restricted';
      else if (count >= FLAG_THRESHOLD && nextStatus === 'none') nextStatus = 'flagged';

      if (nextStatus !== update.moderation.status) {
        await User.updateOne({ _id: reportedId }, { $set: { 'moderation.status': nextStatus } });
      }

      // One-time notice at exactly the 4th report — not >=, so this never
      // re-fires on the 5th, 6th, etc. This is a direct, private warning to
      // the reported account itself (never visible to anyone else),
      // separate from the friend-request-facing safety warning at 7+ and
      // the actual restriction enforced at 15+.
      if (count === BAN_WARNING_AT) {
        notifyUser(reportedId, {
          title: 'QuantumChat',
          body: 'Your account has received multiple reports. Continued violations of community guidelines may result in restrictions on your account.',
          kind: 'moderation',
        }).catch(() => {});
      }
    }

    res.status(201).json({ success: true, data: { id: report._id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}
