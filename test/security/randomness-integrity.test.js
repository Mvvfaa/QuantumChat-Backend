// Security regression suite: randomness sanity checks. Sealed-box security
// depends on nonces and ephemeral keys never repeating — if the RNG behind
// them were ever broken, hardcoded, weakly seeded, or a caching bug made a
// value get reused, an attacker who spots two matching nonces under the
// same key can XOR the ciphertexts and recover information about both
// plaintexts, even without ever recovering a private key. This file never
// touches the network or a database — it exercises the crypto helper
// directly, so it stays fast regardless of how the other suites run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, generateKeySet, sealMessage } from '../helpers/crypto.js';

test('nonces are never repeated across many sealed messages to the same key', () => {
  const target = generateKeyPair().publicKey;
  const nonces = new Set();
  for (let i = 0; i < 500; i += 1) {
    nonces.add(sealMessage(`message ${i}`, target).nonce);
  }
  assert.equal(nonces.size, 500, 'every nonce generated must be unique');
});

test('ephemeral public keys are never repeated across many sealed messages', () => {
  const target = generateKeyPair().publicKey;
  const ephemeralKeys = new Set();
  for (let i = 0; i < 500; i += 1) {
    ephemeralKeys.add(sealMessage(`message ${i}`, target).ephemeralPublicKey);
  }
  assert.equal(ephemeralKeys.size, 500, 'every one-time ephemeral key must be unique — reuse would be catastrophic');
});

test('sealing the IDENTICAL plaintext to the IDENTICAL key still never produces the same ciphertext twice', () => {
  // If this ever failed, it would mean nonce/ephemeral generation had
  // silently collapsed to a fixed or low-entropy value.
  const target = generateKeyPair().publicKey;
  const ciphertexts = new Set();
  for (let i = 0; i < 200; i += 1) {
    ciphertexts.add(sealMessage('the exact same message every time', target).ciphertext);
  }
  assert.equal(ciphertexts.size, 200);
});

test('generated keypairs never repeat and public keys never equal their own private key', () => {
  const keySet = generateKeySet(200);
  const publicKeys = new Set(keySet.map((k) => k.publicKey));
  const secretKeys = new Set(keySet.map((k) => k.secretKey));
  assert.equal(publicKeys.size, 200, 'no two generated public keys collided');
  assert.equal(secretKeys.size, 200, 'no two generated private keys collided');
  for (const { publicKey, secretKey } of keySet) {
    assert.notEqual(publicKey, secretKey);
  }
});
