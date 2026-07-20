import mongoose from 'mongoose';

const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
    },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: {
      type: String,
      default: '',
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: false }
);

pushSubscriptionSchema.index({ user: 1, endpoint: 1 }, { unique: true });
pushSubscriptionSchema.index({ endpoint: 1 }, { unique: true });

export default mongoose.model('PushSubscription', pushSubscriptionSchema, 'push_subscriptions');
