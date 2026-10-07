// Abuse cases for the attachment upload flow: size lies, replays,
// dangerous filenames/content types, and bad recipients.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { sealBytes } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;

before(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx.base, `alice_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_${Date.now()}`);
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

function authJson(token) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function init(sealed, overrides) {
  const res = await fetch(`${ctx.base}/attachments/init`, {
    method: 'POST',
    headers: authJson(alice.token),
    body: JSON.stringify(initBody(sealed, overrides)),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function putBytes(pendingId, bytes, filename = 'file.bin') {
  const form = new FormData();
  form.append('file', new Blob([bytes]), filename);
  const res = await fetch(`${ctx.base}/attachments/pending/${pendingId}/bytes?slot=recipient`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${alice.token}` },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function finalize(pendingId) {
  const res = await fetch(`${ctx.base}/attachments/finalize`, {
    method: 'POST',
    headers: authJson(alice.token),
    body: JSON.stringify({ pendingUploadId: pendingId }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const sealSmall = () => sealBytes(Buffer.from('small file'), bob.keySet[0].publicKey);

// --- 1. Size and replay ---------------------------------------------------

test('uploading far more bytes than declared at init does not succeed end to end', async () => {
  const small = sealSmall();
  const { body } = await init(small, { size: 10 });
  assert.equal(body.success, true, `setup: init must succeed (${body.error})`);
  const pendingId = body.data.pendingUploadId;

  const big = sealBytes(Buffer.alloc(3 * 1024 * 1024, 7), bob.keySet[0].publicKey);
  const up = await putBytes(pendingId, big.cipherBytes);
  const fin = await finalize(pendingId);
  const bothOk = up.body.success === true && fin.body.success === true;
  assert.equal(bothOk, false, 'declared size must be enforced: a 3MB upload was accepted for a 10-byte declaration');
});

test('finalizing the same pending upload twice does not create two attachments', async () => {
  const sealed = sealSmall();
  const { body } = await init(sealed);
  const pendingId = body.data.pendingUploadId;
  const up = await putBytes(pendingId, sealed.cipherBytes);
  assert.equal(up.body.success, true, `setup: bytes upload must succeed (${up.body.error})`);

  const first = await finalize(pendingId);
  assert.equal(first.body.success, true, `setup: first finalize must succeed (${first.body.error})`);
  const second = await finalize(pendingId);
  assert.equal(second.body.success === true && second.body.data?.id !== first.body.data.id, false, 'a second finalize created a second attachment');
});

// --- 2. Recipients --------------------------------------------------------

test('init with a nonexistent recipient is rejected', async () => {
  const { status } = await init(sealSmall(), { recipientId: '507f1f77bcf86cd799439011' });
  assert.ok(status >= 400 && status < 500, `expected 4xx, got ${status}`);
});

test('init with a NoSQL-operator recipientId is rejected', async () => {
  const { status } = await init(sealSmall(), { recipientId: { $ne: null } });
  assert.equal(status, 400);
});

// --- 3. Dangerous filenames and content types -----------------------------

test('path-traversal filename is never stored as-is', async () => {
  const sealed = sealSmall();
  const { body } = await init(sealed, { filename: '../../../etc/passwd' });
  if (body.success !== true) return; // rejecting it outright is also fine
  const pendingId = body.data.pendingUploadId;
  await putBytes(pendingId, sealed.cipherBytes);
  const fin = await finalize(pendingId);
  if (fin.body.success !== true) return;
  const { default: Attachment } = await import('../../src/models/Attachment.js');
  const doc = await Attachment.collection.findOne({ _id: new mongoose.Types.ObjectId(fin.body.data.id) });
  assert.equal(JSON.stringify(doc).includes('../'), false, 'traversal sequence was stored in the attachment record');
});

test('a stored file claiming to be HTML is not served as renderable HTML', async () => {
  const sealed = sealSmall();
  const { body } = await init(sealed, { filename: 'page.html', mimetype: 'text/html' });
  if (body.success !== true) return; // rejecting active content types is also fine
  const pendingId = body.data.pendingUploadId;
  await putBytes(pendingId, sealed.cipherBytes, 'page.html');
  const fin = await finalize(pendingId);
  if (fin.body.success !== true) return;

  const res = await fetch(`${ctx.base}/attachments/${fin.body.data.id}/raw`, {
    headers: { Authorization: `Bearer ${bob.token}` },
  });
  const type = (res.headers.get('content-type') || '').toLowerCase();
  assert.equal(/text\/html|image\/svg|application\/xhtml/.test(type), false, `raw endpoint served active content type: ${type}`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});
// --- 4. Chunked upload path (used for larger files such as video) ---------

async function putChunk(pendingId, bytes, chunkIndex, totalChunks) {
  const res = await fetch(
    `${ctx.base}/attachments/pending/${pendingId}/chunk?slot=recipient&chunkIndex=${chunkIndex}&totalChunks=${totalChunks}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${alice.token}`, 'Content-Type': 'application/octet-stream' },
      body: bytes,
    }
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

test('control: a chunked upload of exactly the declared size succeeds and finalizes', async () => {
  const sealed = sealSmall();
  const { body } = await init(sealed);
  assert.equal(body.success, true, `setup: init must succeed (${body.error})`);
  const pendingId = body.data.pendingUploadId;

  const chunk = await putChunk(pendingId, sealed.cipherBytes, 0, 1);
  assert.equal(chunk.body.success, true, `chunk upload must succeed (status ${chunk.status}, ${chunk.body.error})`);
  const fin = await finalize(pendingId);
  assert.equal(fin.body.success, true, `finalize must succeed (${fin.body.error})`);
});

test('a single chunk larger than the declared size is rejected', async () => {
  const sealed = sealSmall();
  const { body } = await init(sealed, { size: 10 });
  assert.equal(body.success, true, `setup: init must succeed (${body.error})`);
  const res = await putChunk(body.data.pendingUploadId, Buffer.alloc(4096, 1), 0, 1);
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});

test('chunks that add up to more than the declared size are rejected', async () => {
  const sealed = sealSmall();
  const { body } = await init(sealed, { size: 100 });
  assert.equal(body.success, true, `setup: init must succeed (${body.error})`);
  const pendingId = body.data.pendingUploadId;

  const first = await putChunk(pendingId, Buffer.alloc(60, 1), 0, 2);
  assert.equal(first.body.success, true, `first chunk is within the limit (${first.body.error})`);
  const second = await putChunk(pendingId, Buffer.alloc(60, 2), 1, 2);
  assert.equal(second.status, 400, `second chunk pushes past the declared size, expected 400, got ${second.status}`);
});

test('an upload that finishes smaller than the declared size is rejected', async () => {
  const sealed = sealSmall();
  const { body } = await init(sealed, { size: 100 });
  assert.equal(body.success, true, `setup: init must succeed (${body.error})`);
  const res = await putChunk(body.data.pendingUploadId, Buffer.alloc(50, 1), 0, 1);
  assert.equal(res.status, 400, `expected 400, got ${res.status}`);
});