import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, registerUser } from '../helpers/testServer.js';
import { authHeaders, fetchJson } from '../helpers/attacks.js';
import { sealForPublicKey } from '../../src/utils/sealedBox.js';

const RUN = `${Date.now()}`;
let ctx;
let userA;
let userB;
let userC;

before(async () => {
  ctx = await startTestServer();
  userA = await registerUser(ctx.base, `priv_${RUN}_a`);
  userB = await registerUser(ctx.base, `priv_${RUN}_b`);
  userC = await registerUser(ctx.base, `priv_${RUN}_c`);
});

after(async () => {
  await ctx.stop();
});

test('PATCH /users/me/privacy validates enum fields and updates partial settings', async () => {
  // Invalid enum
  const bad = await fetchJson(`${ctx.base}/users/me/privacy`, {
    method: 'PATCH',
    headers: authHeaders(userA.token),
    body: JSON.stringify({ lastSeen: 'invalid_value' }),
  });
  assert.equal(bad.status, 400);

  // Valid partial update
  const ok = await fetchJson(`${ctx.base}/users/me/privacy`, {
    method: 'PATCH',
    headers: authHeaders(userA.token),
    body: JSON.stringify({
      lastSeen: 'friends',
      readReceipts: 'nobody',
      whoCanMessage: 'friends',
      discoverable: 'nobody',
    }),
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.lastSeen, 'friends');
  assert.equal(ok.body.data.readReceipts, 'nobody');
  assert.equal(ok.body.data.whoCanMessage, 'friends');
  assert.equal(ok.body.data.discoverable, 'nobody');
});

test('whoCanMessage gate blocks messaging from unauthorized senders', async () => {
  // userA has whoCanMessage: 'friends'
  const pubKeyA = userA.user.publicKeys[0];
  const envA = sealForPublicKey('test msg', pubKeyA);

  // Non-friend userB tries to message userA -> expected 403
  const blocked = await fetchJson(`${ctx.base}/messages`, {
    method: 'POST',
    headers: authHeaders(userB.token),
    body: JSON.stringify({
      to: userA.user.id,
      forRecipient: envA,
      forSender: sealForPublicKey('test msg', userB.user.publicKeys[0]),
    }),
  });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body?.code, 'NOT_FRIENDS');
  assert.match(String(blocked.body?.error || ''), /accepting messages/i);

  // Add friend relationship between userA and userB
  const reqRes = await fetchJson(`${ctx.base}/users/friend-requests`, {
    method: 'POST',
    headers: authHeaders(userB.token),
    body: JSON.stringify({ to: userA.user.id }),
  });
  assert.equal(reqRes.status, 201);
  const reqId = reqRes.body.data.id;

  const acceptRes = await fetchJson(`${ctx.base}/users/friend-requests/${reqId}/accept`, {
    method: 'POST',
    headers: authHeaders(userA.token),
  });
  assert.equal(acceptRes.status, 200);

  // Now userB can message userA
  const allowed = await fetchJson(`${ctx.base}/messages`, {
    method: 'POST',
    headers: authHeaders(userB.token),
    body: JSON.stringify({
      to: userA.user.id,
      forRecipient: envA,
         forSender: sealForPublicKey('test msg', userB.user.publicKeys[0]),
    }),
  });
  assert.equal(allowed.status, 201);
});

test('discoverUsers excludes accounts set to discoverable: nobody', async () => {
  // userA has discoverable: 'nobody'
  const search = await fetchJson(`${ctx.base}/users/discover?q=priv_${RUN}_a`, {
    headers: authHeaders(userC.token),
  });
  assert.equal(search.status, 200);
  const found = (search.body.data || []).some((u) => String(u.id) === String(userA.user.id));
  assert.equal(found, false);
});

test('lastSeen is withheld from unauthorized viewers', async () => {
  // userA has lastSeen: 'friends'. userB is a friend, userC is not.
  const asC = await fetchJson(`${ctx.base}/users/${userA.user.id}`, {
    headers: authHeaders(userC.token),
  });
  assert.equal(asC.status, 200);
  assert.equal(asC.body.data.lastLoginAt, null);

  const asB = await fetchJson(`${ctx.base}/users/${userA.user.id}`, {
    headers: authHeaders(userB.token),
  });
  assert.equal(asB.status, 200);
  assert.ok('lastLoginAt' in asB.body.data);
});

test('call signal invitations enforce privacy settings', async () => {
  const dummyEnvelope = {
    ciphertext: 'dGVzdA==',
    nonce: 'dGVzdG5vbmNl',
    ephemeralPublicKey: 'a'.repeat(64),
    targetPublicKey: 'b'.repeat(64),
  };

  // userC is not a friend of userA (userA has whoCanMessage: 'friends').
  const callRes = await fetchJson(`${ctx.base}/call-signals`, {
    method: 'POST',
    headers: authHeaders(userC.token),
    body: JSON.stringify({
      to: userA.user.id,
      callId: 'call-priv-test-1',
      event: 'call:invite',
      envelope: dummyEnvelope,
    }),
  });
  assert.equal(callRes.status, 403);

  // userB is a friend of userA, so call invitation is permitted.
  const callResB = await fetchJson(`${ctx.base}/call-signals`, {
    method: 'POST',
    headers: authHeaders(userB.token),
    body: JSON.stringify({
      to: userA.user.id,
      callId: 'call-priv-test-2',
      event: 'call:invite',
      envelope: dummyEnvelope,
    }),
  });
  assert.equal(callResB.status, 201);
});

test('extended privacy settings validate enums and enforce profile, birthday, and group permissions', async () => {
  // 1. Enum validation for new settings
  const badSetting = await fetchJson(`${ctx.base}/users/me/privacy`, {
    method: 'PATCH',
    headers: authHeaders(userA.token),
    body: JSON.stringify({ profileVisibility: 'invalid_enum' }),
  });
  assert.equal(badSetting.status, 400);

  // 2. Set userA extended privacy: profileVisibility: 'friends', birthdayVisibility: 'onlyMe'
  const updateRes = await fetchJson(`${ctx.base}/users/me/privacy`, {
    method: 'PATCH',
    headers: authHeaders(userA.token),
    body: JSON.stringify({
      profileVisibility: 'friends',
      birthdayVisibility: 'onlyMe',
      whoCanCreateGroupsWithMe: 'friends',
      whoCanAddToGroups: 'friends',
      whoCanInviteViaGroupLink: 'nobody',
    }),
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.data.profileVisibility, 'friends');
  assert.equal(updateRes.body.data.birthdayVisibility, 'onlyMe');

  // 3. userB (friend) views userA -> profile bio visible, birthday hidden (onlyMe)
  const getB = await fetchJson(`${ctx.base}/users/${userA.user.id}`, {
    headers: authHeaders(userB.token),
  });
  assert.equal(getB.status, 200);
  assert.equal(getB.body.data.birthday, null);

  // userC (non-friend) views userA -> bio hidden (friends only)
  const getC = await fetchJson(`${ctx.base}/users/${userA.user.id}`, {
    headers: authHeaders(userC.token),
  });
  assert.equal(getC.status, 200);
  assert.equal(getC.body.data.bio, '');

  // 4. Group creation with userA by non-friend userC -> should be rejected (403)
  const createGroupC = await fetchJson(`${ctx.base}/groups`, {
    method: 'POST',
    headers: authHeaders(userC.token),
    body: JSON.stringify({
      name: 'Blocked Group Creation',
      memberIds: [userA.user.id],
    }),
  });
  assert.equal(createGroupC.status, 403);

  // Group creation with userA by friend userB -> succeeds (201)
  const createGroupB = await fetchJson(`${ctx.base}/groups`, {
    method: 'POST',
    headers: authHeaders(userB.token),
    body: JSON.stringify({
      name: 'Allowed Group Creation',
      memberIds: [userA.user.id],
    }),
  });
  assert.equal(createGroupB.status, 201);
  const groupId = createGroupB.body.data.id;

  // 5. non-friend userC trying to add userA to another group -> rejected (403)
  const createGroupC2 = await fetchJson(`${ctx.base}/groups`, {
    method: 'POST',
    headers: authHeaders(userC.token),
    body: JSON.stringify({ name: 'Group C2' }),
  });
  assert.equal(createGroupC2.status, 201);
  const groupC2Id = createGroupC2.body.data.id;

  const addRes = await fetchJson(`${ctx.base}/groups/${groupC2Id}/members`, {
    method: 'POST',
    headers: authHeaders(userC.token),
    body: JSON.stringify({ memberIds: [userA.user.id] }),
  });
  assert.equal(addRes.status, 403);

  // 6. userA joining via link when whoCanInviteViaGroupLink: 'nobody' -> rejected (403)
  // Enable invite link on groupC2
  const inviteRes = await fetchJson(`${ctx.base}/groups/${groupC2Id}/invite`, {
    method: 'POST',
    headers: authHeaders(userC.token),
    body: JSON.stringify({ enabled: true }),
  });
  assert.equal(inviteRes.status, 200);
  const code = inviteRes.body.data.inviteCode;

  const joinRes = await fetchJson(`${ctx.base}/groups/join`, {
    method: 'POST',
    headers: authHeaders(userA.token),
    body: JSON.stringify({ code }),
  });
  assert.equal(joinRes.status, 403);
});


