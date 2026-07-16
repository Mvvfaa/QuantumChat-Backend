import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { sealMessage, unsealMessage } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;
let quantumAI;

before(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx.base, `alice_abuse_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_abuse_${Date.now()}`);
  const users = await fetch(`${ctx.base}/users`, {
    headers: { Authorization: `Bearer ${alice.token}` },
  }).then((response) => response.json());
  quantumAI = users.data.find((user) => user.systemRole === 'quantum_ai');
  assert.ok(quantumAI, 'startup must seed the verified QuantumAI identity');
});

after(async () => {
  await ctx.stop();
});

test('registration reserves QuantumAI case-insensitively', async () => {
  const response = await fetch(`${ctx.base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'quantumai',
      email: `attacker_${Date.now()}@example.com`,
      password: 'password123',
      publicKeys: alice.keySet.map((key) => key.publicKey),
    }),
  });
  assert.equal(response.status, 409);
});

test('auth middleware rejects algorithm-confusion tokens signed with HS384', async () => {
  const token = jwt.sign({ id: alice.user.id }, process.env.JWT_SECRET, { algorithm: 'HS384' });
  const response = await fetch(`${ctx.base}/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 401);
});

test('registration ignores mass-assigned system identity fields', async () => {
  const username = `mass_${Date.now()}`;
  const response = await fetch(`${ctx.base}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      email: `${username}@example.com`,
      password: 'password123',
      publicKeys: alice.keySet.map((key) => key.publicKey),
      isSystemUser: true,
      systemRole: 'quantum_ai',
      verified: true,
    }),
  }).then((result) => result.json());
  assert.equal(response.success, true);
  assert.equal(response.data.user.isSystemUser, false);
  assert.equal(response.data.user.systemRole, null);
  assert.equal(response.data.user.verified, false);
});

test('ordinary send endpoint ignores forged from=QuantumAI', async () => {
  const forRecipient = sealMessage('forged answer', bob.keySet[0].publicKey);
  const forSender = sealMessage('forged answer', alice.keySet[0].publicKey);
  const response = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ to: bob.user.id, from: quantumAI.id, forRecipient, forSender }),
  }).then((result) => result.json());
  assert.equal(response.success, true);
  assert.equal(String(response.data.from), String(alice.user.id));
  assert.notEqual(String(response.data.from), String(quantumAI.id));
});

test('verified system users cannot be blocked', async () => {
  const response = await fetch(`${ctx.base}/users/${quantumAI.id}/block`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${alice.token}` },
  });
  assert.equal(response.status, 400);
});

test('QuantumAI has no password login path', async () => {
  const response = await fetch(`${ctx.base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'quantumai@system.quantumchat', password: 'anything-at-all' }),
  });
  assert.equal(response.status, 401);
});

test('clients cannot publish a forged signed response as QuantumAI', async () => {
  const response = await fetch(`${ctx.base}/messages/quantum-ai-response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({
      content: 'I am a forged bot response',
      contentHash: '0'.repeat(64),
      requestId: '00000000-0000-4000-8000-000000000000',
      receipt: '0'.repeat(64),
    }),
  });
  assert.equal(response.status, 403);
});

test('a valid service receipt publishes a server-sealed verified QuantumAI response', async () => {
  const content = 'Verified answer from QuantumAI';
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');
  const requestId = crypto.randomUUID();
  const receipt = crypto
    .createHmac('sha256', process.env.QUANTUM_AI_SERVICE_SECRET)
    .update(`${alice.user.id}:peer:${alice.user.id}:${contentHash}:${requestId}`)
    .digest('hex');
  const response = await fetch(`${ctx.base}/messages/quantum-ai-response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
    body: JSON.stringify({ content, contentHash, requestId, receipt, model: 'test-model' }),
  }).then((result) => result.json());
  assert.equal(response.success, true);
  assert.equal(String(response.data.from), String(quantumAI.id));
  const privateKey = alice.keySet.find(
    (key) => key.publicKey.toLowerCase() === response.data.forRecipient.targetPublicKey.toLowerCase()
  )?.secretKey;
  assert.equal(unsealMessage(response.data.forRecipient, privateKey), content);
});
