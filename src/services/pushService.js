import webpush from 'web-push';
import PushSubscription from '../models/PushSubscription.js';
import { toObjectId } from '../utils/toObjectId.js';

let vapidPublicKey = null;
let pushReady = false;

function initFromEnv() {
  if (vapidPublicKey !== null) return;

  let publicKey = process.env.VAPID_PUBLIC_KEY;
  let privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@quantumchat.local';

  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
    console.warn(
      '[push] VAPID keys missing. Generated temporary keys — set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and VAPID_SUBJECT in .env for production.\n' +
        `VAPID_PUBLIC_KEY=${publicKey}\n` +
        `VAPID_PRIVATE_KEY=${privateKey}\n` +
        `VAPID_SUBJECT=${subject}`
    );
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
    vapidPublicKey = publicKey;
    pushReady = true;
  } catch (err) {
    console.warn('[push] Failed to initialize web-push:', err.message);
    vapidPublicKey = publicKey || '';
    pushReady = false;
  }
}

initFromEnv();

export function getVapidPublicKey() {
  initFromEnv();
  return vapidPublicKey || '';
}

export async function saveSubscription(userId, sub) {
  const endpoint = String(sub?.endpoint || '').trim();
  const p256dh = String(sub?.keys?.p256dh || '').trim();
  const auth = String(sub?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) {
    const err = new Error('endpoint and keys.p256dh / keys.auth are required');
    err.status = 400;
    throw err;
  }

  await PushSubscription.findOneAndUpdate(
    { endpoint },
    {
      user: userId,
      endpoint,
      keys: { p256dh, auth },
      userAgent: String(sub?.userAgent || '').slice(0, 512),
      createdAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function removeSubscription(userId, endpoint) {
  const ep = String(endpoint || '').trim();
  if (!ep) {
    const err = new Error('endpoint is required');
    err.status = 400;
    throw err;
  }
  await PushSubscription.deleteOne({ user: userId, endpoint: ep });
}

export async function notifyUser(userId, payload) {
  initFromEnv();
  if (!pushReady) return;

  const uid = toObjectId(userId);
  if (!uid) return;

  const subs = await PushSubscription.find({ user: uid });
  if (!subs.length) return;

  const body = JSON.stringify({
    title: payload?.title || 'QuantumChat',
    body: payload?.body || 'New notification',
    ...payload,
  });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.keys.p256dh,
              auth: sub.keys.auth,
            },
          },
          body
        );
      } catch (err) {
        const status = err?.statusCode || err?.status;
        if (status === 404 || status === 410) {
          await PushSubscription.deleteOne({ _id: sub._id }).catch(() => {});
        }
      }
    })
  );
}
