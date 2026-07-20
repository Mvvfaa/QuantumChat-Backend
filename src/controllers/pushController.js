import {
  getVapidPublicKey,
  saveSubscription,
  removeSubscription,
} from '../services/pushService.js';

export async function getPushVapidPublicKey(req, res) {
  try {
    const publicKey = getVapidPublicKey();
    if (!publicKey) {
      return res.status(503).json({ success: false, error: 'Push notifications are not configured' });
    }
    res.json({ success: true, data: { publicKey } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

export async function subscribePush(req, res) {
  try {
    const { endpoint, keys } = req.body || {};
    await saveSubscription(req.user._id, {
      endpoint,
      keys,
      userAgent: req.headers['user-agent'] || '',
    });
    res.status(201).json({ success: true, data: { subscribed: true } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
}

export async function unsubscribePush(req, res) {
  try {
    const { endpoint } = req.body || {};
    await removeSubscription(req.user._id, endpoint);
    res.json({ success: true, data: { unsubscribed: true } });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
}
