// E2EE guard: the server must never return or embed private key material,
// password hashes, or internals (stack traces) in any response or token.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { sealMessage } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;

const FORBIDDEN_FIELDS = /"(password|passwordHash|hashedPassword|secretKey|secretKeys|privateKey|privateKeys)"\s*:/i;

before(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx.base, `alice_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_${Date.now()}`);

  // Make sure there is at least one message in the system to inspect.
  await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({
      to: bob.user.id,
      forRecipient: sealMessage('hello', bob.keySet[0].publicKey),
      forSender: sealMessage('hello', alice.keySet[0].publicKey),
    }),
  });
});

after(async () => {
  await ctx.stop();
});

function allSecretKeys() {
  return [...alice.keySet, ...bob.keySet].map((k) => k.secretKey);
}

// --- 1. API responses never contain private keys or password fields ------

test('GET /users has no password or private-key fields', async () => {
  const res = await fetch(`${ctx.base}/users`, { headers: { Authorization: `Bearer ${alice.token}` } });
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.equal(FORBIDDEN_FIELDS.test(text), false, 'users list must not expose password/private-key fields');
});

test('GET /users never contains any real private key value', async () => {
  const res = await fetch(`${ctx.base}/users`, { headers: { Authorization: `Bearer ${alice.token}` } });
  const text = await res.text();
  for (const secret of allSecretKeys()) {
    assert.equal(text.includes(secret), false, 'a private key value appeared in /users');
  }
});

test('GET /messages/:id never contains any real private key value or forbidden field', async () => {
  const res = await fetch(`${ctx.base}/messages/${alice.user.id}`, {
    headers: { Authorization: `Bearer ${bob.token}` },
  });
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.equal(FORBIDDEN_FIELDS.test(text), false);
  for (const secret of allSecretKeys()) {
    assert.equal(text.includes(secret), false, 'a private key value appeared in /messages');
  }
});

// --- 2. The login token carries no secrets --------------------------------

test('JWT payload contains no key material or password data', () => {
  const payload = jwt.decode(alice.token);
  assert.ok(payload, 'token must decode');
  const asText = JSON.stringify(payload);
  assert.equal(/secret|private|password|hash/i.test(asText), false, `token payload leaks something: ${asText}`);
  for (const secret of allSecretKeys()) {
    assert.equal(asText.includes(secret), false);
  }
});

// --- 3. Error responses do not leak internals ----------------------------

const NO_LEAK = /node_modules|\bat\s+[\w$.<>]+\s+\(.*:\d+:\d+\)|MongoServerError|MongooseError|CastError/;

test('malformed id in a route returns a clean error, no stack trace or DB internals', async () => {
  const res = await fetch(`${ctx.base}/messages/not-a-valid-id`, {
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  const text = await res.text();
  assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
  assert.equal(NO_LEAK.test(text), false, `error response leaks internals: ${text.slice(0, 200)}`);
});

test('invalid JSON body returns a clean error, no stack trace', async () => {
  const res = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: '{"to": bad json',
  });
  const text = await res.text();
  assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
  assert.equal(NO_LEAK.test(text), false, `error response leaks internals: ${text.slice(0, 200)}`);
});

test('unauthorized response does not leak internals', async () => {
  const res = await fetch(`${ctx.base}/users`, { headers: { Authorization: 'Bearer garbage.token.value' } });
  const text = await res.text();
  assert.equal(res.status, 401);
  assert.equal(NO_LEAK.test(text), false, `401 response leaks internals: ${text.slice(0, 200)}`);
});

// --- 4. Responses do not expose another user's private data --------------

test("one user's profile data in /users never includes another user's token", async () => {
  const res = await fetch(`${ctx.base}/users`, { headers: { Authorization: `Bearer ${alice.token}` } });
  const text = await res.text();
  assert.equal(text.includes(bob.token), false, "bob's login token appeared in alice's /users response");
});