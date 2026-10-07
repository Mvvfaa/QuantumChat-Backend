// E2EE guard for attachments (files / video). Every test here must stay green:
// the server may only ever see and store ciphertext, and only the intended
// recipient may decrypt it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { sealBytes, unsealBytes } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;
let mallory;

const MARKER = 'TOP_SECRET_PLAINTEXT_MARKER_9f3a';

before(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx.base, `alice_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_${Date.now()}`);
  mallory = await registerUser(ctx.base, `mallory_${Date.now()}`);
});

after(async () => {
  await ctx.stop();
});

function initBody(sealed, overrides = {}) {
  return {
    recipientId: bob.user.id,
    filename: 'file.bin',
    mimetype: 'application/octet-stream',
    size: sealed.cipherBytes.length,
    nonce: sealed.nonce,
    ephemeralPublicKey: sealed.ephemeralPublicKey,
    targetPublicKey: sealed.targetPublicKey,
    ...overrides,
  };
}

// Same 3-step flow as server-attack-surface.test.js: init -> bytes -> finalize
async function uploadSealed(sealed, { filename = 'file.bin', mimetype = 'application/octet-stream' } = {}) {
  const initRes = await fetch(`${ctx.base}/attachments/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify(initBody(sealed, { filename, mimetype })),
  }).then((r) => r.json());
  assert.equal(initRes.success, true, `init failed: ${initRes.error}`);

  const form = new FormData();
  form.append('file', new Blob([sealed.cipherBytes]), filename);
  const bytesRes = await fetch(
    `${ctx.base}/attachments/pending/${initRes.data.pendingUploadId}/bytes?slot=recipient`,
    { method: 'PUT', headers: { Authorization: `Bearer ${alice.token}` }, body: form }
  ).then((r) => r.json());
  assert.equal(bytesRes.success, true, `bytes upload failed: ${bytesRes.error}`);

  const fin = await fetch(`${ctx.base}/attachments/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ pendingUploadId: initRes.data.pendingUploadId }),
  }).then((r) => r.json());
  assert.equal(fin.success, true, `finalize failed: ${fin.error}`);
  return fin.data;
}

async function fetchRaw(attachmentId, token) {
  const res = await fetch(`${ctx.base}/attachments/${attachmentId}/raw`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}

// --- 1. Crypto properties for file bytes ---------------------------------

test('sealed file bytes do not contain the plaintext', () => {
  const sealed = sealBytes(Buffer.from(MARKER.repeat(100)), bob.keySet[0].publicKey);
  assert.equal(sealed.cipherBytes.includes(Buffer.from(MARKER)), false);
});

test('sealing the same file twice gives different ciphertext and nonces', () => {
  const plain = Buffer.from(MARKER);
  const a = sealBytes(plain, bob.keySet[0].publicKey);
  const b = sealBytes(plain, bob.keySet[0].publicKey);
  assert.equal(a.cipherBytes.equals(b.cipherBytes), false);
  assert.notEqual(a.nonce, b.nonce);
});

test('tampering with a single byte of a sealed file breaks decryption', () => {
  const sealed = sealBytes(Buffer.from(MARKER), bob.keySet[0].publicKey);
  const tampered = Buffer.from(sealed.cipherBytes);
  tampered[tampered.length - 1] ^= 0x01;
  assert.equal(unsealBytes(tampered, sealed, bob.keySet[0].secretKey), null);
});

test('truncated sealed file fails to decrypt', () => {
  const sealed = sealBytes(Buffer.from(MARKER.repeat(10)), bob.keySet[0].publicKey);
  const truncated = sealed.cipherBytes.subarray(0, sealed.cipherBytes.length - 5);
  assert.equal(unsealBytes(truncated, sealed, bob.keySet[0].secretKey), null);
});

// --- 2. What the server actually stores ----------------------------------

test('server stores only ciphertext: raw bytes never contain the plaintext, recipient can decrypt', async () => {
  const original = Buffer.from(MARKER.repeat(50));
  const sealed = sealBytes(original, bob.keySet[0].publicKey);
  const att = await uploadSealed(sealed, { filename: 'doc.bin' });

  const { status, bytes } = await fetchRaw(att.id, bob.token);
  assert.equal(status, 200);
  assert.equal(bytes.includes(Buffer.from(MARKER)), false, 'stored bytes must not contain plaintext');
  assert.ok(bytes.equals(sealed.cipherBytes), 'stored bytes must be exactly what the client uploaded');

  const opened = unsealBytes(bytes, sealed, bob.keySet[0].secretKey);
  assert.ok(Buffer.from(opened).equals(original), 'recipient must recover the identical file');
});

test('the attachment document in MongoDB never contains the plaintext', async () => {
  const sealed = sealBytes(Buffer.from(MARKER.repeat(50)), bob.keySet[0].publicKey);
  const att = await uploadSealed(sealed, { filename: 'doc2.bin' });
  const { default: Attachment } = await import('../../src/models/Attachment.js');
  const doc = await Attachment.collection.findOne({ _id: new mongoose.Types.ObjectId(att.id) });
  assert.ok(doc, 'attachment document must exist');
  assert.equal(JSON.stringify(doc).includes(MARKER), false);
});

// --- 3. Upload validation ------------------------------------------------

for (const field of ['nonce', 'ephemeralPublicKey', 'targetPublicKey']) {
  test(`[VIOLATION] attachment init without ${field} is rejected`, async () => {
    const sealed = sealBytes(Buffer.from(MARKER), bob.keySet[0].publicKey);
    const body = initBody(sealed);
    delete body[field];
    const res = await fetch(`${ctx.base}/attachments/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400);
  });
}

test('attachment init without a login token is rejected', async () => {
  const sealed = sealBytes(Buffer.from(MARKER), bob.keySet[0].publicKey);
  const res = await fetch(`${ctx.base}/attachments/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initBody(sealed)),
  });
  assert.equal(res.status, 401);
});

test('an absurdly large declared size is rejected at init', async () => {
  const sealed = sealBytes(Buffer.from(MARKER), bob.keySet[0].publicKey);
  const res = await fetch(`${ctx.base}/attachments/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify(initBody(sealed, { size: 10 * 1024 * 1024 * 1024, filename: 'huge.mp4', mimetype: 'video/mp4' })),
  });
  assert.ok([400, 413].includes(res.status), `expected 400/413, got ${res.status}`);
});

// --- 4. Video-sized upload stays encrypted, and stays private ------------
// Keep VIDEO_MB below your attachment size limit (currently 15MB).
// After you raise the limit for video, you can increase it.

test('multi-MB video upload is stored as ciphertext, decrypts identically, and is private', async () => {
  const VIDEO_MB = 5;
  const fakeVideo = Buffer.alloc(VIDEO_MB * 1024 * 1024, MARKER);
  const sealed = sealBytes(fakeVideo, bob.keySet[0].publicKey);
  const att = await uploadSealed(sealed, { filename: 'clip.mp4', mimetype: 'video/mp4' });

  const asBob = await fetchRaw(att.id, bob.token);
  assert.equal(asBob.status, 200);
  assert.equal(asBob.bytes.includes(Buffer.from(MARKER)), false, 'stored video must not contain plaintext');
  const opened = unsealBytes(asBob.bytes, sealed, bob.keySet[0].secretKey);
  assert.ok(Buffer.from(opened).equals(fakeVideo), 'recipient must recover the identical video');

  const asMallory = await fetchRaw(att.id, mallory.token);
  assert.equal(asMallory.status, 403, 'a third party must not be served the video at all');
  for (const key of mallory.keySet) {
    assert.equal(unsealBytes(asBob.bytes, sealed, key.secretKey), null);
  }
});

// --- 5. Upload-flow hijacking ---------------------------------------------

async function startPendingUpload(sealed) {
  const initRes = await fetch(`${ctx.base}/attachments/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify(initBody(sealed)),
  }).then((r) => r.json());
  assert.equal(initRes.success, true, `init failed: ${initRes.error}`);
  return initRes.data.pendingUploadId;
}

test('a third party cannot upload bytes into someone else\'s pending upload', async () => {
  const sealed = sealBytes(Buffer.from(MARKER), bob.keySet[0].publicKey);
  const pendingId = await startPendingUpload(sealed);

  const form = new FormData();
  form.append('file', new Blob([Buffer.from('attacker bytes')]), 'evil.bin');
  const res = await fetch(`${ctx.base}/attachments/pending/${pendingId}/bytes?slot=recipient`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${mallory.token}` },
    body: form,
  });
  assert.ok([401, 403, 404].includes(res.status), `expected 401/403/404, got ${res.status}`);
});

test('a third party cannot finalize someone else\'s pending upload', async () => {
  const sealed = sealBytes(Buffer.from(MARKER), bob.keySet[0].publicKey);
  const pendingId = await startPendingUpload(sealed);

  const res = await fetch(`${ctx.base}/attachments/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mallory.token}` },
    body: JSON.stringify({ pendingUploadId: pendingId }),
  });
  assert.ok([401, 403, 404].includes(res.status), `expected 401/403/404, got ${res.status}`);
});

test('finalize with a nonexistent pendingUploadId is rejected', async () => {
  const res = await fetch(`${ctx.base}/attachments/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ pendingUploadId: '507f1f77bcf86cd799439011' }),
  });
  assert.ok([400, 404].includes(res.status), `expected 400/404, got ${res.status}`);
});

test('finalize without uploading any bytes is rejected', async () => {
  const sealed = sealBytes(Buffer.from(MARKER), bob.keySet[0].publicKey);
  const pendingId = await startPendingUpload(sealed);
  const res = await fetch(`${ctx.base}/attachments/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ pendingUploadId: pendingId }),
  });
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
});

test('NoSQL-injection payload as pendingUploadId is rejected', async () => {
  const res = await fetch(`${ctx.base}/attachments/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ pendingUploadId: { $ne: null } }),
  });
  assert.equal(res.status, 400);
});