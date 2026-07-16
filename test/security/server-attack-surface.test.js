// Security regression suite: everything that needs a real running server +
// database, consolidated into ONE process/ONE MongoMemoryServer instance
// (previously split across two files, each spinning up its own mongod —
// reliable in isolation but slow and occasionally hung when the test
// runner tried to spawn multiple real mongod child processes back to back
// in this environment). Covers two attacker categories against the same
// shared alice/bob/mallory setup:
//
//   1. Crypto attacks — trying to decrypt the raw MongoDB document with
//      every key except the correct one (wrong accounts, wrong keys within
//      the right account, tampered ciphertext/nonce, brute force).
//   2. API-layer attacks — no auth, forged/tampered JWTs, cross-user data
//      access, and NoSQL injection payloads.
//
// Pass (green check) = every attack was correctly rejected.
// Fail (red X) = something got through — treat as a critical break, not a
// flaky test.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { generateKeySet, sealMessage, unsealMessage, sealBytes, unsealBytes } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;
let mallory;
let plaintext;
let storedMessage;
let sharedAttachmentId;

before(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx.base, `alice_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_${Date.now()}`);
  mallory = await registerUser(ctx.base, `mallory_${Date.now()}`); // unrelated attacker account

  plaintext = 'The vault combination is 41-27-19 — do not share this.';

  // A real client picks a random one of the recipient's 5 keys, not always
  // the same one — pick non-first indices so the test isn't accidentally
  // only ever exercising index 0.
  const recipientPublicKey = bob.keySet[2].publicKey;
  const senderPublicKey = alice.keySet[3].publicKey;
  const forRecipient = sealMessage(plaintext, recipientPublicKey);
  const forSender = sealMessage(plaintext, senderPublicKey);

  const sendRes = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ to: bob.user.id, forRecipient, forSender }),
  }).then((r) => r.json());
  assert.equal(sendRes.success, true, `setup: message must send successfully (${sendRes.error})`);

  const messageId = sendRes.data.id || sendRes.data._id;
  // Read the RAW document straight out of MongoDB, bypassing the API
  // entirely — this is the actual attack surface being tested.
  storedMessage = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(messageId) });
  assert.ok(storedMessage, 'setup: message document must exist in MongoDB');

  const sealedFile = sealBytes(Buffer.from('a file only alice and bob should see'), bob.keySet[0].publicKey);
  const form = new FormData();
  form.append('file', new Blob([sealedFile.cipherBytes]), 'secret.txt');
  form.append('recipientId', bob.user.id);
  form.append('nonce', sealedFile.nonce);
  form.append('ephemeralPublicKey', sealedFile.ephemeralPublicKey);
  form.append('targetPublicKey', sealedFile.targetPublicKey);
  const uploadRes = await fetch(`${ctx.base}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${alice.token}` },
    body: form,
  }).then((r) => r.json());
  assert.equal(uploadRes.success, true, `setup: attachment upload must succeed (${uploadRes.error})`);
  sharedAttachmentId = uploadRes.data.id;

  // Stash for the attachment decrypt test below.
  ctx.sealedFile = sealedFile;
});

after(async () => {
  await ctx.stop();
});

// --- 1. Crypto attacks: decrypt the raw MongoDB document -----------------

test('control: the real recipient decrypts their envelope with their own private key', () => {
  const recipientKey = bob.keySet.find((k) => k.publicKey === storedMessage.forRecipient.targetPublicKey);
  assert.ok(recipientKey, "bob's keyring must contain the key this envelope targets");
  assert.equal(unsealMessage(storedMessage.forRecipient, recipientKey.secretKey), plaintext);
});

test('control: the sender decrypts their own sent copy with their own private key', () => {
  const senderKey = alice.keySet.find((k) => k.publicKey === storedMessage.forSender.targetPublicKey);
  assert.ok(senderKey, "alice's keyring must contain the key this envelope targets");
  assert.equal(unsealMessage(storedMessage.forSender, senderKey.secretKey), plaintext);
});

test('the raw stored ciphertext does not trivially contain the plaintext', () => {
  const cipherBytes = Buffer.from(storedMessage.forRecipient.ciphertext, 'base64');
  const plainBytes = Buffer.from(plaintext, 'utf8');
  assert.notEqual(
    storedMessage.forRecipient.ciphertext,
    Buffer.from(plaintext, 'utf8').toString('base64'),
    'ciphertext must not just be the plaintext re-encoded as base64'
  );
  assert.equal(cipherBytes.includes(plainBytes), false, 'ciphertext bytes must not contain the plaintext bytes as a substring');
});

test('an unrelated account (any of its 5 real, valid private keys) cannot decrypt', () => {
  for (const key of mallory.keySet) {
    assert.equal(
      unsealMessage(storedMessage.forRecipient, key.secretKey),
      null,
      "an attacker's own legitimate private key must never open someone else's envelope"
    );
  }
});

test("the wrong one of the recipient's own 5 keys cannot decrypt", () => {
  const wrongBobKeys = bob.keySet.filter((k) => k.publicKey !== storedMessage.forRecipient.targetPublicKey);
  assert.equal(wrongBobKeys.length, 4);
  for (const key of wrongBobKeys) {
    assert.equal(unsealMessage(storedMessage.forRecipient, key.secretKey), null);
  }
});

test('a public key placed in the private-key argument slot cannot decrypt (structural guarantee)', () => {
  assert.equal(unsealMessage(storedMessage.forRecipient, storedMessage.forRecipient.targetPublicKey), null);
  assert.equal(unsealMessage(storedMessage.forRecipient, storedMessage.forRecipient.ephemeralPublicKey), null);
});

test("crossing envelopes — bob's key against alice's own-copy envelope, and vice versa — fails", () => {
  const bobKey = bob.keySet.find((k) => k.publicKey === storedMessage.forRecipient.targetPublicKey);
  const aliceKey = alice.keySet.find((k) => k.publicKey === storedMessage.forSender.targetPublicKey);
  assert.equal(unsealMessage(storedMessage.forSender, bobKey.secretKey), null);
  assert.equal(unsealMessage(storedMessage.forRecipient, aliceKey.secretKey), null);
});

test('tampering with a single ciphertext byte breaks decryption (authenticated encryption)', () => {
  const recipientKey = bob.keySet.find((k) => k.publicKey === storedMessage.forRecipient.targetPublicKey);
  const tampered = Buffer.from(storedMessage.forRecipient.ciphertext, 'base64');
  tampered[0] ^= 0xff;
  const tamperedEnvelope = { ...storedMessage.forRecipient, ciphertext: tampered.toString('base64') };
  assert.equal(unsealMessage(tamperedEnvelope, recipientKey.secretKey), null);
});

test('using the wrong nonce, even with the right key, breaks decryption', () => {
  const recipientKey = bob.keySet.find((k) => k.publicKey === storedMessage.forRecipient.targetPublicKey);
  const swappedNonce = { ...storedMessage.forRecipient, nonce: storedMessage.forSender.nonce };
  assert.equal(unsealMessage(swappedNonce, recipientKey.secretKey), null);
});

test('brute-forcing random private keys never succeeds (256-bit keyspace sanity check)', () => {
  for (let i = 0; i < 500; i += 1) {
    const randomKey = generateKeySet(1)[0].secretKey;
    assert.equal(unsealMessage(storedMessage.forRecipient, randomKey), null);
  }
});

test('sealMessage() has no parameter for a secret/private key at all', () => {
  assert.equal(sealMessage.length, 2, 'sealMessage(plaintext, targetPublicKey) must take exactly 2 arguments');
});

test('the Message and Attachment Mongoose schemas define no secret/private-key-shaped field', async () => {
  const { default: Message } = await import('../../src/models/Message.js');
  const { default: Attachment } = await import('../../src/models/Attachment.js');
  // Requires "key" immediately after secret/private — matches secretKey,
  // privateKey, secret_key, etc, but not incidental uses of "secret" like
  // secretboxNonce (nacl.secretbox is a legitimate symmetric-encryption
  // primitive used for group messages; its nonce is meant to be public,
  // same as any other nonce — see the root README on what a nonce is for).
  const suspicious = /(secret|private)[-_]?key/i;
  for (const [name, Model] of [
    ['Message', Message],
    ['Attachment', Attachment],
  ]) {
    const bad = Object.keys(Model.schema.paths).filter((p) => suspicious.test(p));
    assert.deepEqual(bad, [], `${name} schema must not define a secret/private-key field: found [${bad.join(', ')}]`);
  }
});

test('attachments: an unrelated account cannot decrypt an uploaded encrypted file', async () => {
  const rawRes = await fetch(`${ctx.base}/attachments/${sharedAttachmentId}/raw`, {
    headers: { Authorization: `Bearer ${bob.token}` },
  });
  const cipherBytes = new Uint8Array(await rawRes.arrayBuffer());

  const recipientKey = bob.keySet.find((k) => k.publicKey === ctx.sealedFile.targetPublicKey);
  const opened = unsealBytes(cipherBytes, ctx.sealedFile, recipientKey.secretKey);
  assert.equal(Buffer.from(opened).toString('utf8'), 'a file only alice and bob should see');

  for (const key of mallory.keySet) {
    assert.equal(unsealBytes(cipherBytes, ctx.sealedFile, key.secretKey), null, "an attacker's key must not open the file");
  }
});

// --- 2. API-layer attacks: no auth, forged JWTs, cross-user data, injection ---

test('no Authorization header at all is rejected on every protected endpoint', async () => {
  const endpoints = [
    ['GET', '/users'],
    ['GET', `/messages/${bob.user.id}`],
    ['GET', `/attachments/${sharedAttachmentId}/raw`],
  ];
  for (const [method, path] of endpoints) {
    const res = await fetch(`${ctx.base}${path}`, { method });
    assert.equal(res.status, 401, `${method} ${path} without a token must be 401`);
  }

  const sendRes = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: bob.user.id, forRecipient: {}, forSender: {} }),
  });
  assert.equal(sendRes.status, 401, 'POST /messages without a token must be 401');
});

test('a token forged with the wrong secret (blind forgery) is rejected', async () => {
  const forged = jwt.sign({ id: alice.user.id }, 'a-guessed-wrong-secret', { expiresIn: '1h' });
  const res = await fetch(`${ctx.base}/users`, { headers: { Authorization: `Bearer ${forged}` } });
  assert.equal(res.status, 401);
});

test('a legitimately-issued token tampered to impersonate another user is rejected', async () => {
  const [header, payload, signature] = mallory.token.split('.');
  const decodedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const tamperedPayload = Buffer.from(JSON.stringify({ ...decodedPayload, id: alice.user.id })).toString('base64url');
  const tamperedToken = `${header}.${tamperedPayload}.${signature}`;

  const res = await fetch(`${ctx.base}/users`, { headers: { Authorization: `Bearer ${tamperedToken}` } });
  assert.equal(res.status, 401, 'a token with a tampered payload must fail signature verification');
});

test('a correctly-signed token for a since-deleted/nonexistent user id is rejected', async () => {
  const fakeId = '507f1f77bcf86cd799439011'; // well-formed ObjectId, no such user
  const validlySignedButUnknown = jwt.sign({ id: fakeId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  const res = await fetch(`${ctx.base}/users`, { headers: { Authorization: `Bearer ${validlySignedButUnknown}` } });
  assert.equal(res.status, 401);
});

test('an expired token is rejected even though it was validly signed', async () => {
  const expired = jwt.sign({ id: alice.user.id }, process.env.JWT_SECRET, { expiresIn: '-10s' });
  const res = await fetch(`${ctx.base}/users`, { headers: { Authorization: `Bearer ${expired}` } });
  assert.equal(res.status, 401);
});

test('a third party cannot pull up a conversation between two other users', async () => {
  const res = await fetch(`${ctx.base}/messages/${bob.user.id}`, {
    headers: { Authorization: `Bearer ${mallory.token}` },
  }).then((r) => r.json());
  assert.equal(res.success, true);
  const leaked = res.data.some((m) => (m.id || m._id) === (storedMessage._id.toString ? storedMessage._id.toString() : storedMessage._id));
  assert.equal(leaked, false, "alice and bob's message must not appear in mallory's conversation with bob");
});

test('a third party is refused (403) when requesting raw attachment bytes for a file they are not party to', async () => {
  const res = await fetch(`${ctx.base}/attachments/${sharedAttachmentId}/raw`, {
    headers: { Authorization: `Bearer ${mallory.token}` },
  });
  assert.equal(res.status, 403, "the server must refuse to hand mallory alice and bob's encrypted file at all");
});

test('the legitimate recipient (bob) IS allowed to fetch the raw attachment bytes', async () => {
  const res = await fetch(`${ctx.base}/attachments/${sharedAttachmentId}/raw`, {
    headers: { Authorization: `Bearer ${bob.token}` },
  });
  assert.equal(res.status, 200, 'control: the real recipient must not be collaterally blocked');
});

test('a NoSQL injection payload as the message "to" field is safely rejected, not executed', async () => {
  const forRecipient = sealMessage('x', bob.keySet[0].publicKey);
  const forSender = sealMessage('x', alice.keySet[0].publicKey);
  const res = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ to: { $ne: null }, forRecipient, forSender }),
  });
  assert.equal(res.status, 400, 'an object must be rejected as invalid, not matched as a Mongo query operator');
});

test('a NoSQL-injection-shaped string as a route parameter is safely rejected, not executed', async () => {
  const res = await fetch(`${ctx.base}/messages/${encodeURIComponent('{"$ne":null}')}`, {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.equal(res.status, 400);
});

test('a MongoDB-operator-shaped string in the "to" field does not corrupt the query layer', async () => {
  const res = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({
      to: '$where:1==1',
      forRecipient: sealMessage('x', bob.keySet[0].publicKey),
      forSender: sealMessage('x', alice.keySet[0].publicKey),
    }),
  });
  assert.equal(res.status, 400);
});
