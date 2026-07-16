// Self-contained mirror of frontend/src/crypto/keys.js's sealed-box
// implementation. Deliberately duplicated rather than imported: backend and
// frontend are separate GitHub repos, and this test suite must run as a
// standalone CI job in the backend repo alone, with no sibling frontend
// checkout available. If the real algorithm in frontend/src/crypto/keys.js
// ever changes, this must be updated to match, or these tests silently stop
// reflecting what real clients actually do.
import nacl from 'tweetnacl';

function toHex(bytes) {
  return Buffer.from(bytes).toString('hex');
}

function fromHex(hex) {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export function generateKeyPair() {
  const { publicKey, secretKey } = nacl.box.keyPair();
  return { publicKey: toHex(publicKey), secretKey: toHex(secretKey) };
}

export function generateKeySet(size = 5) {
  return Array.from({ length: size }, () => generateKeyPair());
}

export function sealMessage(plaintext, targetPublicKeyHex) {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = new TextEncoder().encode(plaintext);
  const cipher = nacl.box(messageBytes, nonce, fromHex(targetPublicKeyHex), ephemeral.secretKey);
  return {
    ciphertext: Buffer.from(cipher).toString('base64'),
    nonce: Buffer.from(nonce).toString('base64'),
    ephemeralPublicKey: toHex(ephemeral.publicKey),
    targetPublicKey: targetPublicKeyHex.toLowerCase(),
  };
}

// Returns the decrypted string, or null if decryption/authentication fails
// for any reason (wrong key, tampered ciphertext, wrong nonce, etc).
export function unsealMessage(envelope, myPrivateKeyHex) {
  if (!myPrivateKeyHex || !envelope) return null;
  try {
    const cipher = Buffer.from(envelope.ciphertext, 'base64');
    const nonce = Buffer.from(envelope.nonce, 'base64');
    const plain = nacl.box.open(cipher, nonce, fromHex(envelope.ephemeralPublicKey), fromHex(myPrivateKeyHex));
    if (!plain) return null;
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export function sealBytes(bytes, targetPublicKeyHex) {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const cipherBytes = nacl.box(bytes, nonce, fromHex(targetPublicKeyHex), ephemeral.secretKey);
  return {
    cipherBytes: Buffer.from(cipherBytes),
    nonce: Buffer.from(nonce).toString('base64'),
    ephemeralPublicKey: toHex(ephemeral.publicKey),
    targetPublicKey: targetPublicKeyHex.toLowerCase(),
  };
}

export function unsealBytes(cipherBytes, envelope, myPrivateKeyHex) {
  if (!myPrivateKeyHex || !envelope) return null;
  try {
    const nonce = Buffer.from(envelope.nonce, 'base64');
    return nacl.box.open(cipherBytes, nonce, fromHex(envelope.ephemeralPublicKey), fromHex(myPrivateKeyHex));
  } catch {
    return null;
  }
}
