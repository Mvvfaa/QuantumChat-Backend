// Envelope validation: the server must reject envelopes that are malformed
// or sealed to keys that do not belong to the intended person.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { sealMessage } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;
let mallory;

before(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx.base, `alice_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_${Date.now()}`);
  mallory = await registerUser(ctx.base, `mallory_${Date.now()}`);
});

after(async () => {
  await ctx.stop();
});

function validBody() {
  return {
    to: bob.user.id,
    forRecipient: sealMessage('hello', bob.keySet[0].publicKey),
    forSender: sealMessage('hello', alice.keySet[0].publicKey),
  };
}

async function send(body) {
  const res = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify(body),
  });
  return res.status;
}

function assertRejected(status, what) {
  assert.ok(status >= 400 && status < 500, `${what}: expected a 4xx rejection, got ${status}`);
}

test('control: a correctly sealed message is accepted', async () => {
  const status = await send(validBody());
  assert.ok([200, 201].includes(status), `expected 200/201, got ${status}`);
});

// --- 1. Malformed fields --------------------------------------------------

test('ephemeralPublicKey of the wrong length is rejected', async () => {
  const body = validBody();
  body.forRecipient.ephemeralPublicKey = 'abcd';
  assertRejected(await send(body), 'short ephemeralPublicKey');
});

test('non-hex ephemeralPublicKey is rejected', async () => {
  const body = validBody();
  body.forRecipient.ephemeralPublicKey = 'z'.repeat(64);
  assertRejected(await send(body), 'non-hex ephemeralPublicKey');
});

test('targetPublicKey of the wrong length is rejected', async () => {
  const body = validBody();
  body.forRecipient.targetPublicKey = 'abcd';
  assertRejected(await send(body), 'short targetPublicKey');
});

test('nonce of the wrong length is rejected', async () => {
  const body = validBody();
  body.forRecipient.nonce = 'AAAA';
  assertRejected(await send(body), 'short nonce');
});

test('empty ciphertext is rejected', async () => {
  const body = validBody();
  body.forRecipient.ciphertext = '';
  assertRejected(await send(body), 'empty ciphertext');
});

test('ciphertext that is not base64 is rejected', async () => {
  const body = validBody();
  body.forRecipient.ciphertext = '!!!not base64!!!';
  assertRejected(await send(body), 'non-base64 ciphertext');
});

// --- 2. Type confusion ----------------------------------------------------

for (const field of ['ciphertext', 'nonce', 'ephemeralPublicKey', 'targetPublicKey']) {
  test(`NoSQL-operator object as ${field} is rejected`, async () => {
    const body = validBody();
    body.forRecipient[field] = { $ne: null };
    assertRejected(await send(body), `object as ${field}`);
  });
}

test('envelope sent as an array is rejected', async () => {
  const body = validBody();
  body.forRecipient = [body.forRecipient];
  assertRejected(await send(body), 'array envelope');
});

test('envelope sent as a string is rejected', async () => {
  const body = validBody();
  body.forRecipient = 'plain text instead of an envelope';
  assertRejected(await send(body), 'string envelope');
});

// --- 3. Sealed to the wrong person's key ---------------------------------

test("recipient envelope sealed to a key bob does not own is rejected", async () => {
  const body = validBody();
  body.forRecipient = sealMessage('hello', mallory.keySet[0].publicKey);
  assertRejected(await send(body), "envelope targeting mallory's key sent to bob");
});

test("sender copy sealed to a key alice does not own is rejected", async () => {
  const body = validBody();
  body.forSender = sealMessage('hello', mallory.keySet[0].publicKey);
  assertRejected(await send(body), "sender copy targeting mallory's key");
});

test('a random, unregistered public key as the target is rejected', async () => {
  const body = validBody();
  body.forRecipient.targetPublicKey = 'ab'.repeat(32);
  assertRejected(await send(body), 'unregistered target key');
});