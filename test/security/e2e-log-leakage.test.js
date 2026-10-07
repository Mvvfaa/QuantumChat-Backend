// E2EE guard: plaintext must never be written to server logs, including
// when a request fails validation or fails to parse.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { sealMessage } from '../helpers/crypto.js';

let ctx;
let alice;
let bob;

const LOG_MARKER = 'LOG_PLAINTEXT_MARKER_c0ffee42';

before(async () => {
  ctx = await startTestServer();
  alice = await registerUser(ctx.base, `alice_${Date.now()}`);
  bob = await registerUser(ctx.base, `bob_${Date.now()}`);
});

after(async () => {
  await ctx.stop();
});

// Records everything written to the console and stdout/stderr while `fn`
// runs, then restores the originals. Output still passes through.
async function captureLogs(fn) {
  const chunks = [];
  const originals = {};
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'];
  for (const m of consoleMethods) {
    originals[m] = console[m];
    console[m] = (...args) => {
      chunks.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      originals[m](...args);
    };
  }
  const outWrite = process.stdout.write.bind(process.stdout);
  const errWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (c, ...rest) => {
    chunks.push(String(c));
    return outWrite(c, ...rest);
  };
  process.stderr.write = (c, ...rest) => {
    chunks.push(String(c));
    return errWrite(c, ...rest);
  };
  try {
    await fn();
    // let async logging finish
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    for (const m of consoleMethods) console[m] = originals[m];
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
  return chunks.join('\n');
}

function post(path, token, rawBody) {
  return fetch(`${ctx.base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: rawBody,
  });
}

function sealedBody(extra = {}) {
  return JSON.stringify({
    to: bob.user.id,
    forRecipient: sealMessage('hello', bob.keySet[0].publicKey),
    forSender: sealMessage('hello', alice.keySet[0].publicKey),
    ...extra,
  });
}

test('malformed JSON containing plaintext is not written to the logs', async () => {
  const logs = await captureLogs(async () => {
    await post('/messages', alice.token, `{"to": "${LOG_MARKER}", bad json`);
  });
  assert.equal(logs.includes(LOG_MARKER), false, 'request body text was logged by the error handler');
});

test('a rejected plaintext message is not written to the logs', async () => {
  const logs = await captureLogs(async () => {
    await post('/messages', alice.token, JSON.stringify({ to: bob.user.id, content: LOG_MARKER }));
  });
  assert.equal(logs.includes(LOG_MARKER), false, 'rejected plaintext message was logged');
});

test('an accepted message with an extra plaintext field is not written to the logs', async () => {
  const logs = await captureLogs(async () => {
    await post('/messages', alice.token, sealedBody({ content: LOG_MARKER }));
  });
  assert.equal(logs.includes(LOG_MARKER), false, 'extra plaintext field was logged');
});

test('a rejected vault update with key-shaped fields does not log the key values', async () => {
  const logs = await captureLogs(async () => {
    await fetch(`${ctx.base}/users/me/vault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.token}` },
      body: JSON.stringify({ secretKey: LOG_MARKER, privateKey: LOG_MARKER }),
    });
  });
  assert.equal(logs.includes(LOG_MARKER), false, 'private key field values were logged');
});

test('login tokens are not written to the logs during normal requests', async () => {
  const logs = await captureLogs(async () => {
    await fetch(`${ctx.base}/users`, { headers: { Authorization: `Bearer ${alice.token}` } });
  });
  assert.equal(logs.includes(alice.token), false, 'a login token was logged');
});