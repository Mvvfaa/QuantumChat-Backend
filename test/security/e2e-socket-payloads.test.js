// E2EE guard for realtime delivery: whatever the server pushes over sockets
// must contain only sealed envelopes, and only to the intended people.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { sealMessage } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;
let mallory;
const sockets = [];

const SOCKET_MARKER = 'SOCKET_PLAINTEXT_MARKER_b7e1';

// Connects, records every event received, resolves once connected.
function connectRecorder(token) {
  return new Promise((resolve, reject) => {
    const events = [];
    const socket = ioClient(ctx.origin, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
      timeout: 4000,
    });
    socket.onAny((event, ...args) => events.push({ event, args }));
    socket.on('connect', () => resolve({ socket, events }));
    socket.on('connect_error', (err) => reject(new Error(`socket connect failed: ${err.message}`)));
    sockets.push(socket);
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const asText = (events) => JSON.stringify(events);

async function sendDm(extra = {}) {
  const body = {
    to: bob.user.id,
    forRecipient: sealMessage('hello bob', bob.keySet[0].publicKey),
    forSender: sealMessage('hello bob', alice.keySet[0].publicKey),
    ...extra,
  };
  const res = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify(body),
  });
  assert.ok([200, 201].includes(res.status), `setup: send must succeed (${res.status})`);
  return body;
}

before(async () => {
  ctx = await startTestServer({ withSockets: true });
  alice = await registerUser(ctx.base, `alice_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_${Date.now()}`);
  mallory = await registerUser(ctx.base, `mallory_${Date.now()}`);
});

after(async () => {
  for (const s of sockets) s.close();
  await ctx.stop();
});

// --- 1. Delivery goes to the right person, as ciphertext -----------------

test('control: bob receives a realtime event when alice sends him a message', async () => {
  const bobConn = await connectRecorder(bob.token);
  await wait(300);
  await sendDm();
  await wait(700);
  assert.ok(bobConn.events.length > 0, 'bob received no socket events at all; see event names in src/socket');
});

test("bob's socket gets the sealed envelope and never any plaintext", async () => {
  const bobConn = await connectRecorder(bob.token);
  await wait(300);
  await sendDm({ content: SOCKET_MARKER, text: SOCKET_MARKER });
  await wait(700);
  assert.equal(asText(bobConn.events).includes(SOCKET_MARKER), false, 'plaintext was pushed over the socket');
});

test("mallory's socket receives nothing from a conversation she is not part of", async () => {
  const malloryConn = await connectRecorder(mallory.token);
  await wait(300);
  const sent = await sendDm();
  await wait(700);
  const text = asText(malloryConn.events);
  assert.equal(text.includes(sent.forRecipient.ciphertext), false, "bob's ciphertext reached mallory's socket");
  assert.equal(text.includes(sent.forSender.ciphertext), false, "alice's ciphertext reached mallory's socket");
  assert.equal(text.includes(alice.user.id) && text.includes(bob.user.id), false, 'conversation metadata reached mallory');
});

// --- 2. Secrets never travel over the socket ------------------------------

test('no login token or private key ever appears in events pushed to bob', async () => {
  const bobConn = await connectRecorder(bob.token);
  await wait(300);
  await sendDm();
  await wait(700);
  const text = asText(bobConn.events);
  for (const t of [alice.token, bob.token, mallory.token]) {
    assert.equal(text.includes(t), false, 'a login token appeared in a socket event');
  }
  for (const k of [...alice.keySet, ...bob.keySet, ...mallory.keySet]) {
    assert.equal(text.includes(k.secretKey), false, 'a private key appeared in a socket event');
  }
});

// --- 3. Connecting alone does not leak anything ---------------------------

test('a freshly connected socket receives no other user data on its own', async () => {
  await sendDm();
  const malloryConn = await connectRecorder(mallory.token);
  await wait(700);
  const text = asText(malloryConn.events);
  assert.equal(text.includes(alice.token), false);
  assert.equal(text.includes(bob.token), false);
  for (const k of [...alice.keySet, ...bob.keySet]) {
    assert.equal(text.includes(k.secretKey), false);
  }
});