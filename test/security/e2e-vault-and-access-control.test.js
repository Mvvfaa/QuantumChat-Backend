// E2EE guard: vaults are private per user, and message sender identity
// cannot be forged by the client.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { sealMessage } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;
let mallory;

const VAULT_MARKER = 'ALICE_VAULT_CIPHERTEXT_MARKER_55aa';

before(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx.base, `alice_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_${Date.now()}`);
  mallory = await registerUser(ctx.base, `mallory_${Date.now()}`);
});

after(async () => {
  await ctx.stop();
});

function putVault(token, extra = {}) {
  return fetch(`${ctx.base}/users/me/vault`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      ciphertext: VAULT_MARKER,
      nonce: 'opaque-nonce',
      salt: 'opaque-salt',
      kdf: 'pbkdf2',
      ...extra,
    }),
  });
}

async function vaultCollectionName() {
  const cols = await mongoose.connection.db.listCollections().toArray();
  const name = cols.map((c) => c.name).find((n) => /vault/i.test(n));
  assert.ok(name, `vault collection missing: ${cols.map((c) => c.name).join(',')}`);
  return name;
}

// --- 1. Vault privacy -----------------------------------------------------

test('vault update without a login token is rejected', async () => {
  const res = await fetch(`${ctx.base}/users/me/vault`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ciphertext: VAULT_MARKER, nonce: 'n', salt: 's', kdf: 'pbkdf2' }),
  });
  assert.equal(res.status, 401);
});

test("mass assignment: alice cannot write a vault into bob's account via a 'user' field", async () => {
  const res = await putVault(alice.token, { user: bob.user.id, userId: bob.user.id, owner: bob.user.id });
  assert.ok([200, 201].includes(res.status), `setup: vault save must succeed (${res.status})`);

  const col = await vaultCollectionName();
  const bobDoc = await mongoose.connection.db
    .collection(col)
    .findOne({ user: new mongoose.Types.ObjectId(bob.user.id) });
  const leaked = bobDoc ? JSON.stringify(bobDoc).includes(VAULT_MARKER) : false;
  assert.equal(leaked, false, "alice's vault data must never end up under bob's account");
});

test("bob cannot read alice's vault data", async () => {
  await putVault(alice.token);
  const res = await fetch(`${ctx.base}/users/me/vault`, {
    headers: { Authorization: `Bearer ${bob.token}` },
  });
  const text = await res.text();
  assert.equal(text.includes(VAULT_MARKER), false, "alice's vault ciphertext was returned to bob");
});

test('vault data never appears in the public users list', async () => {
  await putVault(alice.token);
  const res = await fetch(`${ctx.base}/users`, { headers: { Authorization: `Bearer ${mallory.token}` } });
  const text = await res.text();
  assert.equal(text.includes(VAULT_MARKER), false);
});

test('vault update is rejected when required fields are missing', async () => {
  const res = await fetch(`${ctx.base}/users/me/vault`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ ciphertext: VAULT_MARKER }),
  });
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
});

// --- 2. Sender identity cannot be forged ----------------------------------

test("alice cannot send a message that looks like it came from mallory", async () => {
  const res = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({
      to: bob.user.id,
      forRecipient: sealMessage('hi', bob.keySet[0].publicKey),
      forSender: sealMessage('hi', alice.keySet[0].publicKey),
      from: mallory.user.id,
      sender: mallory.user.id,
      senderId: mallory.user.id,
    }),
  });
  const body = await res.json();
  assert.ok([200, 201].includes(res.status), `setup: send must succeed (${res.status})`);

  const id = body.data.id || body.data._id;
  const doc = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(id) });
  const asText = JSON.stringify(doc);
  assert.equal(asText.includes(alice.user.id), true, 'stored message must be attributed to the authenticated sender');
  assert.equal(asText.includes(mallory.user.id), false, 'a client-supplied sender id must be ignored');
});

test('a user cannot read a conversation that two other users share', async () => {
  await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({
      to: bob.user.id,
      forRecipient: sealMessage('private', bob.keySet[0].publicKey),
      forSender: sealMessage('private', alice.keySet[0].publicKey),
    }),
  });
  const res = await fetch(`${ctx.base}/messages/${bob.user.id}`, {
    headers: { Authorization: `Bearer ${mallory.token}` },
  }).then((r) => r.json());
  const text = JSON.stringify(res);
  assert.equal(text.includes(alice.user.id), false, "alice's id appeared in mallory's view of bob's conversation");
});

// --- 3. Registration does not hand back secrets ---------------------------

test('registered user object has no password or private key field', () => {
  const asText = JSON.stringify(alice.user);
  assert.equal(/password|hash|secretKey|privateKey/i.test(asText), false, `user object leaks: ${asText}`);
});