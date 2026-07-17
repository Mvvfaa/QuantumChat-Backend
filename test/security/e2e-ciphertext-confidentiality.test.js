// E2E ciphertext confidentiality gate for QuantumChat.
//
// Spins up 5 temporary users, has them exchange sealed DMs, then attacks
// those conversations from the server/DB/JWT perspective. If CI recovers
// any known plaintext WITHOUT the intended private key, this suite fails
// (red X / "got Cross") — treat that as a critical encryption regression.
//
// Pass (green) = ciphertext stays opaque to the server; only correct keys
// from the in-process harness open the envelopes. Temporary users and
// messages are deleted before the in-memory Mongo instance is stopped.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { generateKeySet, sealMessage, unsealMessage } from '../helpers/crypto.js';

const RUN_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const USER_COUNT = 5;

/** @type {{ base: string, stop: () => Promise<void> }} */
let ctx;
/** @type {Array<{ keySet: Array<{ publicKey: string, secretKey: string }>, token: string, user: { id: string }, username: string }>} */
let users = [];
/** @type {Array<{ id: string, fromIndex: number, toIndex: number, plaintext: string, doc: object }>} */
let conversations = [];

function secretMarker(fromIndex, toIndex) {
  return `SECRET_E2E_u${fromIndex}_to_u${toIndex}_${RUN_ID}`;
}

function documentContainsPlaintext(doc, plaintext) {
  const json = JSON.stringify(doc);
  if (json.includes(plaintext)) return true;
  const plainB64 = Buffer.from(plaintext, 'utf8').toString('base64');
  return json.includes(plainB64);
}

function envelopeContainsPlaintextBytes(envelope, plaintext) {
  if (!envelope?.ciphertext) return false;
  if (envelope.ciphertext === Buffer.from(plaintext, 'utf8').toString('base64')) return true;
  const cipherBytes = Buffer.from(envelope.ciphertext, 'base64');
  const plainBytes = Buffer.from(plaintext, 'utf8');
  return cipherBytes.includes(plainBytes);
}

async function sendSealedDm(from, to, plaintext) {
  const recipientPublicKey = to.keySet[from.user.id.length % 5].publicKey;
  const senderPublicKey = from.keySet[(to.user.id.length + 1) % 5].publicKey;
  const forRecipient = sealMessage(plaintext, recipientPublicKey);
  const forSender = sealMessage(plaintext, senderPublicKey);

  const sendRes = await fetch(`${ctx.base}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${from.token}`,
    },
    body: JSON.stringify({ to: to.user.id, forRecipient, forSender }),
  }).then((r) => r.json());

  assert.equal(sendRes.success, true, `setup: DM must send (${sendRes.error})`);
  const messageId = sendRes.data.id || sendRes.data._id;
  const doc = await mongoose.connection.db
    .collection('messages')
    .findOne({ _id: new mongoose.Types.ObjectId(messageId) });
  assert.ok(doc, 'setup: message must exist in MongoDB');
  return { id: String(messageId), doc, forRecipient, forSender };
}

before(async () => {
  ctx = await startTestServer();

  for (let i = 0; i < USER_COUNT; i += 1) {
    const username = `e2e_${RUN_ID}_u${i}`;
    const registered = await registerUser(ctx.base, username);
    users.push({ ...registered, username });
  }

  // Ring: u0→u1 … u4→u0
  const pairs = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 0],
    // Cross edges
    [0, 2],
    [1, 3],
  ];

  for (const [fromIndex, toIndex] of pairs) {
    const plaintext = secretMarker(fromIndex, toIndex);
    const sent = await sendSealedDm(users[fromIndex], users[toIndex], plaintext);
    conversations.push({
      id: sent.id,
      fromIndex,
      toIndex,
      plaintext,
      doc: sent.doc,
    });
  }
});

after(async () => {
  try {
    const userIds = users.map((u) => new mongoose.Types.ObjectId(u.user.id));
    if (userIds.length) {
      await mongoose.connection.db.collection('messages').deleteMany({
        $or: [{ from: { $in: userIds } }, { to: { $in: userIds } }],
      });
      await mongoose.connection.db.collection('users').deleteMany({
        _id: { $in: userIds },
      });
    }
  } finally {
    if (ctx) await ctx.stop();
  }
});

test('setup: five temporary users and sealed conversation mesh exist', () => {
  assert.equal(users.length, USER_COUNT);
  assert.ok(conversations.length >= 7);
  for (const user of users) {
    assert.ok(user.token);
    assert.equal(user.keySet.length, 5);
    assert.match(user.username, /^e2e_/);
  }
});

// --- Controls: correct keys MUST decrypt (prove crypto is real) ----------

test('control: every recipient opens forRecipient with the matching private key', () => {
  for (const conv of conversations) {
    const recipient = users[conv.toIndex];
    const key = recipient.keySet.find((k) => k.publicKey === conv.doc.forRecipient.targetPublicKey);
    assert.ok(key, `u${conv.toIndex} keyring must contain the targeted public key`);
    assert.equal(
      unsealMessage(conv.doc.forRecipient, key.secretKey),
      conv.plaintext,
      `control failed for ${conv.plaintext}`
    );
  }
});

test('control: every sender opens forSender with the matching private key', () => {
  for (const conv of conversations) {
    const sender = users[conv.fromIndex];
    const key = sender.keySet.find((k) => k.publicKey === conv.doc.forSender.targetPublicKey);
    assert.ok(key, `u${conv.fromIndex} keyring must contain the targeted public key`);
    assert.equal(unsealMessage(conv.doc.forSender, key.secretKey), conv.plaintext);
  }
});

test('control: wrong key slots within the same recipient keySet cannot open the envelope', () => {
  for (const conv of conversations) {
    const recipient = users[conv.toIndex];
    const wrong = recipient.keySet.filter((k) => k.publicKey !== conv.doc.forRecipient.targetPublicKey);
    assert.equal(wrong.length, 4);
    for (const key of wrong) {
      assert.equal(unsealMessage(conv.doc.forRecipient, key.secretKey), null);
    }
  }
});

// --- Attacks: any plaintext recovery without the intended key = FAIL -----

test('ATTACK FAIL GATE: raw Mongo documents must not contain any SECRET_E2E plaintext', () => {
  for (const conv of conversations) {
    assert.equal(
      documentContainsPlaintext(conv.doc, conv.plaintext),
      false,
      `CI decoded plaintext from Mongo for ${conv.plaintext} — encryption confidentiality broken`
    );
    assert.equal(
      envelopeContainsPlaintextBytes(conv.doc.forRecipient, conv.plaintext),
      false,
      `forRecipient ciphertext trivially embeds plaintext for ${conv.plaintext}`
    );
    assert.equal(
      envelopeContainsPlaintextBytes(conv.doc.forSender, conv.plaintext),
      false,
      `forSender ciphertext trivially embeds plaintext for ${conv.plaintext}`
    );
  }
});

test('ATTACK FAIL GATE: other users\' private keys cannot decrypt a conversation', () => {
  for (const conv of conversations) {
    for (let i = 0; i < users.length; i += 1) {
      if (i === conv.fromIndex || i === conv.toIndex) continue;
      for (const key of users[i].keySet) {
        assert.equal(
          unsealMessage(conv.doc.forRecipient, key.secretKey),
          null,
          `outsider u${i} opened forRecipient for ${conv.plaintext}`
        );
        assert.equal(
          unsealMessage(conv.doc.forSender, key.secretKey),
          null,
          `outsider u${i} opened forSender for ${conv.plaintext}`
        );
      }
    }
  }
});

test('ATTACK FAIL GATE: public / ephemeral keys stuffed as secrets cannot decrypt', () => {
  for (const conv of conversations) {
    const env = conv.doc.forRecipient;
    assert.equal(unsealMessage(env, env.targetPublicKey), null);
    assert.equal(unsealMessage(env, env.ephemeralPublicKey), null);
    assert.equal(unsealMessage(env, String(conv.doc.from)), null);
    assert.equal(unsealMessage(env, String(conv.doc.to)), null);
  }
});

test('ATTACK FAIL GATE: random private keys never open sealed DMs', () => {
  for (const conv of conversations) {
    for (let i = 0; i < 64; i += 1) {
      const randomKey = generateKeySet(1)[0].secretKey;
      assert.equal(unsealMessage(conv.doc.forRecipient, randomKey), null);
      assert.equal(unsealMessage(conv.doc.forSender, randomKey), null);
    }
  }
});

test('ATTACK FAIL GATE: JWT alone does not reveal plaintext via conversation API', async () => {
  for (const conv of conversations) {
    const from = users[conv.fromIndex];
    const to = users[conv.toIndex];

    const asSender = await fetch(`${ctx.base}/messages/${to.user.id}`, {
      headers: { Authorization: `Bearer ${from.token}` },
    }).then((r) => r.json());
    assert.equal(asSender.success, true);
    const bodyText = JSON.stringify(asSender);
    assert.equal(
      bodyText.includes(conv.plaintext),
      false,
      `participant JWT response leaked plaintext for ${conv.plaintext}`
    );

    // Envelopes may be present — but must still require private keys to open.
    const listed = (asSender.data || []).find((m) => String(m.id || m._id) === conv.id);
    assert.ok(listed, 'control: sender must see their own sealed message metadata');
    if (listed.forRecipient) {
      assert.equal(unsealMessage(listed.forRecipient, from.token), null);
    }
  }
});

test('ATTACK FAIL GATE: outsider cannot IDOR into another pair\'s conversation', async () => {
  // u4 should not see u0↔u1 / u0↔u2 messages when polling those peers incorrectly.
  const outsider = users[4];
  const targetPair = conversations.find((c) => c.fromIndex === 0 && c.toIndex === 1);
  assert.ok(targetPair);

  const res = await fetch(`${ctx.base}/messages/${users[1].user.id}`, {
    headers: { Authorization: `Bearer ${outsider.token}` },
  }).then((r) => r.json());
  assert.equal(res.success, true);
  const leaked = (res.data || []).some((m) => String(m.id || m._id) === targetPair.id);
  assert.equal(leaked, false, 'outsider must not receive another pair\'s message via IDOR');
  assert.equal(
    JSON.stringify(res).includes(targetPair.plaintext),
    false,
    'outsider API body must not contain the secret marker'
  );
});

test('ATTACK FAIL GATE: User documents expose publicKeys only — no private material', async () => {
  for (const user of users) {
    const doc = await mongoose.connection.db
      .collection('users')
      .findOne({ _id: new mongoose.Types.ObjectId(user.user.id) });
    assert.ok(doc);
    const json = JSON.stringify(doc);
    assert.equal(/secretKey|privateKey|secret_key|private_key/i.test(json), false);
    for (const key of user.keySet) {
      assert.equal(json.includes(key.secretKey), false, 'private key must never be persisted');
    }
    // Public keys are expected and must not open envelopes alone.
    for (const conv of conversations) {
      for (const pub of doc.publicKeys || []) {
        assert.equal(unsealMessage(conv.doc.forRecipient, pub), null);
      }
    }
  }
});

test('cleanup: temporary e2e users can be deleted from the database', async () => {
  const userIds = users.map((u) => new mongoose.Types.ObjectId(u.user.id));
  const msgResult = await mongoose.connection.db.collection('messages').deleteMany({
    $or: [{ from: { $in: userIds } }, { to: { $in: userIds } }],
  });
  const userResult = await mongoose.connection.db.collection('users').deleteMany({
    _id: { $in: userIds },
  });
  assert.ok(msgResult.deletedCount >= conversations.length);
  assert.equal(userResult.deletedCount, USER_COUNT);

  const remaining = await mongoose.connection.db.collection('users').countDocuments({
    username: new RegExp(`^e2e_${RUN_ID}_`),
  });
  assert.equal(remaining, 0);
});
