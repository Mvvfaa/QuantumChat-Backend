import nacl from 'tweetnacl';

function fromHex(hex) {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export function sealForPublicKey(plaintext, targetPublicKey) {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const cipher = nacl.box(
    new TextEncoder().encode(plaintext),
    nonce,
    fromHex(targetPublicKey),
    ephemeral.secretKey
  );
  return {
    ciphertext: Buffer.from(cipher).toString('base64'),
    nonce: Buffer.from(nonce).toString('base64'),
    ephemeralPublicKey: Buffer.from(ephemeral.publicKey).toString('hex'),
    targetPublicKey: String(targetPublicKey).toLowerCase(),
  };
}
