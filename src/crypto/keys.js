import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const { encodeBase64, decodeBase64 } = naclUtil;

function toHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// X25519 keypair: 32-byte public + 32-byte private key, hex-encoded to
// exactly 64 characters each. The private half must never leave the device.
export function generateKeyPair() {
  const { publicKey, secretKey } = nacl.box.keyPair();
  return { publicKey: toHex(publicKey), secretKey: toHex(secretKey) };
}

export const KEY_SET_SIZE = 5;

// A pool of 5 independent keypairs instead of one. Senders pick a random
// entry from the recipient's current pool per message (see pickRandom), so
// a single conversation's ciphertext is spread across multiple keys rather
// than always the same one.
export function generateKeySet(size = KEY_SET_SIZE) {
  return Array.from({ length: size }, () => generateKeyPair());
}

export function pickRandom(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// Recovers the public half of a private key. Used to validate an imported
// keys.txt file against an account's actual published public keys before
// trusting it — X25519 secret keys deterministically produce one specific
// public key, so this either matches or the file is wrong/tampered/stale.
export function derivePublicKey(secretKeyHex) {
  const { publicKey } = nacl.box.keyPair.fromSecretKey(fromHex(secretKeyHex));
  return toHex(publicKey);
}

// --- Sealed-box encryption ------------------------------------------------
// A long-term public key is only ever an input to sealMessage(), never to
// unsealMessage(); a long-term private key is only ever an input to
// unsealMessage(), never to sealMessage(). This isn't a policy choice
// enforced by convention — the functions are structurally incapable of the
// other operation: sealMessage() doesn't take a secret key argument at all,
// so there is nothing to encrypt "as" the caller's own identity.
//
// This is the standard "sealed box" construction (as in libsodium's
// crypto_box_seal): to encrypt, generate a one-time-use ephemeral keypair,
// box the plaintext with (ephemeral secret key, recipient's long-term public
// key), then discard the ephemeral secret key and attach the ephemeral
// public key to the envelope so the recipient can redo the Diffie-Hellman
// on their end with their own long-term private key. The tradeoff versus
// mutual-key boxing is that the ciphertext no longer cryptographically
// proves who sent it (there's no sender private key in the computation at
// all) — this app already authenticates the sender at the API layer via the
// JWT on every /messages POST, so that isn't a loss in practice here.
export function sealMessage(plaintext, targetPublicKeyHex) {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const messageBytes = new TextEncoder().encode(plaintext);
  const cipher = nacl.box(messageBytes, nonce, fromHex(targetPublicKeyHex), ephemeral.secretKey);
  return {
    ciphertext: encodeBase64(cipher),
    nonce: encodeBase64(nonce),
    ephemeralPublicKey: toHex(ephemeral.publicKey),
    targetPublicKey: targetPublicKeyHex.toLowerCase(),
  };
}

// envelope: { ciphertext, nonce, ephemeralPublicKey }. myPrivateKeyHex must
// be the private half of whichever public key the envelope was sealed to
// (envelope.targetPublicKey) — look it up from the local keyring.
export function unsealMessage(envelope, myPrivateKeyHex) {
  const cipher = decodeBase64(envelope.ciphertext);
  const nonce = decodeBase64(envelope.nonce);
  const plainBytes = nacl.box.open(cipher, nonce, fromHex(envelope.ephemeralPublicKey), fromHex(myPrivateKeyHex));
  if (!plainBytes) return null;
  return new TextDecoder().decode(plainBytes);
}

// Raw-byte variants for attachments — TextEncoder/TextDecoder would corrupt
// arbitrary binary data, so files are sealed directly instead of going
// through the string-based helpers above.
export function sealBytes(bytes, targetPublicKeyHex) {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const cipherBytes = nacl.box(bytes, nonce, fromHex(targetPublicKeyHex), ephemeral.secretKey);
  return {
    cipherBytes,
    nonce: encodeBase64(nonce),
    ephemeralPublicKey: toHex(ephemeral.publicKey),
    targetPublicKey: targetPublicKeyHex.toLowerCase(),
  };
}

export function unsealBytes(cipherBytes, envelope, myPrivateKeyHex) {
  const nonce = decodeBase64(envelope.nonce);
  return nacl.box.open(cipherBytes, nonce, fromHex(envelope.ephemeralPublicKey), fromHex(myPrivateKeyHex));
}
