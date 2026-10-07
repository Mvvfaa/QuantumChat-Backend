// E2EE guard for direct messages: the server must only ever store and return
// sealed envelopes, and must reject anything that isn't properly sealed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { sealMessage, unsealMessage } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;
let mallory;

const SECRET = 'MSG_PLAINTEXT_MARKER_7c1d';

before(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx.base, `alice_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_${Date.now()}`);
  mallory = await registerUser(ctx.base, `mallory_${Date.now()}`);
});

after(async () => {
  await ctx.stop();
});

function postMessage(token, body) {
  return fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function sealedBody(text = SECRET) {
  return {
    to: bob.user.id,
    forRecipient: sealMessage(text, bob.keySet[1].publicKey),
    forSender: sealMessage(text, alice.keySet[1].publicKey),
  };
}

// --- 1. What the server stores and returns -------------------------------

test('send response never echoes the plaintext', async () => {
  const res = await postMessage(alice.token, sealedBody());
  const text = await res.text();
  assert.ok([200, 201].includes(res.status), text);
  assert.equal(text.includes(SECRET), false);
});

test('raw MongoDB message document never contains the plaintext', async () => {
  const res = await postMessage(alice.token, sealedBody());
  const body = await res.json();
  const id = body.data.id || body.data._id;
  const doc = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(id) });
  assert.ok(doc, 'message document must exist');
  assert.equal(JSON.stringify(doc).includes(SECRET), false);
});

test('fetching the conversation returns only envelopes, never plaintext, and bob can decrypt', async () => {
  await postMessage(alice.token, sealedBody());
  const res = await fetch(`${ctx.base}/messages/${alice.user.id}`, {
    headers: { Authorization: `Bearer ${bob.token}` },
  });
  const raw = await res.text();
  assert.equal(res.status, 200);
  assert.equal(raw.includes(SECRET), false, 'API response must not contain plaintext');

  const list = JSON.parse(raw).data;
  const mine = list.find((m) => m.forRecipient && unsealMessage(m.forRecipient, bob.keySet[1].secretKey) === SECRET);
  assert.ok(mine, 'bob must be able to decrypt at least one returned message');
});

test('a third party fetching the conversation never receives the ciphertext of other users', async () => {
  await postMessage(alice.token, sealedBody());
  const res = await fetch(`${ctx.base}/messages/${bob.user.id}`, {
    headers: { Authorization: `Bearer ${mallory.token}` },
  });
  const list = (await res.json()).data;
  for (const m of list) {
    assert.equal(unsealMessage(m.forRecipient, bob.keySet[1].secretKey), null);
  }
});

// --- 2. Validation: unsealed or malformed messages are rejected ----------

test('[VIOLATION] plaintext-only message (no envelopes) is rejected', async () => {
  const res = await postMessage(alice.token, { to: bob.user.id, content: SECRET });
  assert.equal(res.status, 400);
});

for (const field of ['forRecipient', 'forSender']) {
  test(`[VIOLATION] message without ${field} is rejected`, async () => {
    const body = sealedBody();
    delete body[field];
    const res = await postMessage(alice.token, body);
    assert.equal(res.status, 400);
  });
}

for (const field of ['ciphertext', 'nonce', 'ephemeralPublicKey', 'targetPublicKey']) {
  test(`[VIOLATION] envelope missing ${field} is rejected`, async () => {
    const body = sealedBody();
    delete body.forRecipient[field];
    const res = await postMessage(alice.token, body);
    assert.equal(res.status, 400);
  });
}

test('[VIOLATION] extra plaintext "content" field next to valid envelopes is not stored', async () => {
  const res = await postMessage(alice.token, { ...sealedBody(), content: SECRET });
  const text = await res.text();
  if ([200, 201].includes(res.status)) {
    const id = JSON.parse(text).data.id || JSON.parse(text).data._id;
    const doc = await mongoose.connection.db
      .collection('messages')
      .findOne({ _id: new mongoose.Types.ObjectId(id) });
    assert.equal(JSON.stringify(doc).includes(SECRET), false, 'server must drop the plaintext field');
  } else {
    assert.equal(res.status, 400);
  }
});

test('message without a login token is rejected', async () => {
  const res = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sealedBody()),
  });
  assert.equal(res.status, 401);
});

test('oversized ciphertext is rejected', async () => {
  const body = sealedBody();
  body.forRecipient.ciphertext = Buffer.alloc(20 * 1024 * 1024, 1).toString('base64');
  const res = await postMessage(alice.token, body);
  assert.ok([400, 413].includes(res.status), `expected 400/413, got ${res.status}`);
});

// --- 3. Randomness --------------------------------------------------------

test('the same message sent twice is stored with different ciphertext', async () => {
  const a = await (await postMessage(alice.token, sealedBody())).json();
  const b = await (await postMessage(alice.token, sealedBody())).json();
  const docs = await mongoose.connection.db
    .collection('messages')
    .find({ _id: { $in: [a.data.id || a.data._id, b.data.id || b.data._id].map((i) => new mongoose.Types.ObjectId(i)) } })
    .toArray();
  assert.equal(docs.length, 2);
  assert.notEqual(docs[0].forRecipient.ciphertext, docs[1].forRecipient.ciphertext);
  assert.notEqual(docs[0].forRecipient.nonce, docs[1].forRecipient.nonce);
});