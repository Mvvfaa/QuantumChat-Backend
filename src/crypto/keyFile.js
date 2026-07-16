// Human-readable backup format for a user's private keys. Deliberately
// plain text, not JSON — it's meant to be opened, read, and trusted by a
// person, not just machine-parsed.
export function formatKeyFile({ username, email, secretKeys }) {
  return [
    'QuantumChat Private Keys',
    `Account: ${email} (${username})`,
    `Generated: ${new Date().toISOString()}`,
    '',
    'KEEP THIS FILE SECRET. Anyone who has it can read your messages.',
    'To use QuantumChat on another device or browser, log in there and',
    'upload this file when asked for your private keys.',
    '',
    ...secretKeys,
    '',
  ].join('\n');
}

// Deliberately permissive: pulls out every 64-char hex run regardless of
// surrounding text/formatting, so pasting the whole file (headers and all)
// works the same as pasting just the five key lines.
export function parseKeyFile(text) {
  const matches = text.match(/\b[0-9a-f]{64}\b/gi) || [];
  return matches.map((k) => k.toLowerCase());
}

export function downloadKeyFile(content, filename = 'keys.txt') {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
