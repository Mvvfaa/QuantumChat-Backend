import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nacl from 'tweetnacl';
import Message from '../../src/models/Message.js';
import Attachment from '../../src/models/Attachment.js';
import User from '../../src/models/User.js';
import {
  generateKeyPair,
  generateKeySet,
  sealBytes,
  sealMessage,
  unsealBytes,
  unsealMessage,
} from '../helpers/crypto.js';

test('sealed boxes provide confidentiality and authenticated tamper rejection', () => {
  const recipient = generateKeyPair();
  const attacker = generateKeyPair();
  const envelope = sealMessage('classified lesson plan', recipient.publicKey);
  assert.equal(unsealMessage(envelope, recipient.secretKey), 'classified lesson plan');
  assert.equal(unsealMessage(envelope, attacker.secretKey), null);

  const bytes = Buffer.from(envelope.ciphertext, 'base64');
  bytes[0] ^= 1;
  assert.equal(
    unsealMessage({ ...envelope, ciphertext: bytes.toString('base64') }, recipient.secretKey),
    null
  );
});

test('nonce and ephemeral-key generation remains collision free at scale', () => {
  const target = generateKeyPair().publicKey;
  const nonces = new Set();
  const ephemeralKeys = new Set();
  const ciphertexts = new Set();
  for (let index = 0; index < 2_000; index += 1) {
    const envelope = sealMessage('identical plaintext', target);
    nonces.add(envelope.nonce);
    ephemeralKeys.add(envelope.ephemeralPublicKey);
    ciphertexts.add(envelope.ciphertext);
  }
  assert.equal(nonces.size, 2_000);
  assert.equal(ephemeralKeys.size, 2_000);
  assert.equal(ciphertexts.size, 2_000);
});

test('keypair generation has no collisions and never aliases public/private keys', () => {
  const keys = generateKeySet(500);
  assert.equal(new Set(keys.map((key) => key.publicKey)).size, 500);
  assert.equal(new Set(keys.map((key) => key.secretKey)).size, 500);
  keys.forEach((key) => assert.notEqual(key.publicKey, key.secretKey));
});

test('sealed attachment bytes reject wrong keys, nonce changes, and truncation', () => {
  const recipient = generateKeyPair();
  const attacker = generateKeyPair();
  const original = Buffer.from('binary attachment payload');
  const sealed = sealBytes(original, recipient.publicKey);
  assert.deepEqual(Buffer.from(unsealBytes(sealed.cipherBytes, sealed, recipient.secretKey)), original);
  assert.equal(unsealBytes(sealed.cipherBytes, sealed, attacker.secretKey), null);
  assert.equal(unsealBytes(sealed.cipherBytes.subarray(1), sealed, recipient.secretKey), null);
  const wrongNonce = { ...sealed, nonce: Buffer.alloc(nacl.box.nonceLength, 7).toString('base64') };
  assert.equal(unsealBytes(sealed.cipherBytes, wrongNonce, recipient.secretKey), null);
});

test('group secretbox rejects wrong key, wrong nonce, tampering, and truncation', () => {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  const wrongKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const plaintext = Buffer.from('group-only context');
  const cipher = nacl.secretbox(plaintext, nonce, key);
  assert.deepEqual(Buffer.from(nacl.secretbox.open(cipher, nonce, key)), plaintext);
  assert.equal(nacl.secretbox.open(cipher, nonce, wrongKey), null);
  assert.equal(nacl.secretbox.open(cipher, nacl.randomBytes(nacl.secretbox.nonceLength), key), null);
  const tampered = Uint8Array.from(cipher);
  tampered[0] ^= 1;
  assert.equal(nacl.secretbox.open(tampered, nonce, key), null);
  assert.equal(nacl.secretbox.open(cipher.subarray(1), nonce, key), null);
});

test('bcrypt hashes passwords with an adequate cost and rejects wrong passwords', async () => {
  const password = 'correct horse battery staple';
  const hash = await bcrypt.hash(password, 10);
  assert.notEqual(hash, password);
  assert.equal(await bcrypt.compare(password, hash), true);
  assert.equal(await bcrypt.compare(`${password}!`, hash), false);
  assert.ok(bcrypt.getRounds(hash) >= 10);
});

test('JWT verification pins HS256 and rejects none, HS384, and wrong secrets', () => {
  const secret = 'test-secret-that-is-long-enough';
  const verify = (token) => jwt.verify(token, secret, { algorithms: ['HS256'] });
  assert.equal(verify(jwt.sign({ id: 'user' }, secret, { algorithm: 'HS256' })).id, 'user');
  assert.throws(() => verify(jwt.sign({ id: 'user' }, secret, { algorithm: 'HS384' })));
  assert.throws(() => verify(jwt.sign({ id: 'user' }, 'different-long-test-secret')));
  const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from('{"id":"user"}').toString('base64url')}.`;
  assert.throws(() => verify(unsigned));
});

test('database schemas never expose private or secret key fields', () => {
  const suspicious = /(private|secret).*(key)|(^|\.)(privateKey|secretKey)$/i;
  for (const model of [Message, Attachment, User]) {
    const bad = Object.keys(model.schema.paths).filter((path) => suspicious.test(path));
    assert.deepEqual(bad, [], `${model.modelName} contains secret-key-shaped fields`);
  }
});
