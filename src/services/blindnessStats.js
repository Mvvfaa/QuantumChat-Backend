/**
 * In-memory server-blindness counters.
 * Relayed ciphertext count only — plaintext is never held.
 */

let ciphertextsRelayed = 0;

export function incrementCiphertextsRelayed() {
  ciphertextsRelayed += 1;
}

export function getBlindnessReport() {
  return {
    ciphertextsRelayed,
    plaintextHeld: 0,
    searchableMessageIndex: false,
    note:
      'QuantumChat relays and stores sealed ciphertext only. Message bodies are never held in plaintext, and the server does not build a searchable index over chat content.',
  };
}
