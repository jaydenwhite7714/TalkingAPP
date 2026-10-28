// Logic checks for roles, plans, shared history and server cards.
import { createHash } from 'node:crypto';
import { boot, reporter, ROOT } from './harness.mjs';

const { window } = await boot();
const t = reporter();

/* -------------------------------- perms ---------------------------------- */

const perms = await import('/home/user/TalkingAPP/assets/js/perms.js');

await t.test('owner can do everything, member cannot manage', () => {
  const server = { id: 's1', ownerId: 'me', members: { me: { role: 'owner' }, bob: { role: 'member' } } };
  if (!perms.can(server, 'me', perms.CAP.manageServer)) throw new Error('owner lost manageServer');
  if (!perms.can(server, 'me', perms.CAP.manageRoles)) throw new Error('owner lost manageRoles');
  if (perms.can(server, 'bob', perms.CAP.manageServer)) throw new Error('member could manage the server');
  if (perms.can(server, 'bob', perms.CAP.manageChannels)) throw new Error('member could manage channels');
  if (!perms.can(server, 'bob', perms.CAP.sendMessages)) throw new Error('member cannot talk');
});

await t.test('admin can run channels and roles but is not the owner', () => {
  const server = { id: 's1', ownerId: 'me', members: { me: { role: 'owner' }, ami: { role: 'admin' } } };
  if (!perms.can(server, 'ami', perms.CAP.manageChannels)) throw new Error('admin cannot manage channels');
  if (!perms.can(server, 'ami', perms.CAP.manageRoles)) throw new Error('admin cannot manage roles');
  if (perms.roleIdFor(server, 'ami') !== 'admin') throw new Error('admin role lost');
  const assignable = perms.assignableRoles(server, 'ami');
  if (assignable.includes('admin')) throw new Error('an admin could mint another admin');
});

await t.test('read-only members cannot post, staff can post in announcements', () => {
  const server = { id: 's1', ownerId: 'me', members: { me: { role: 'owner' }, rob: { role: 'readonly' }, mod: { role: 'moderator' } } };
  const text = { type: 'text' };
  const news = { type: 'announcement' };
  if (perms.canPostIn(server, text, 'rob')) throw new Error('read-only member could post');
  if (!perms.canPostIn(server, text, 'mod')) throw new Error('moderator cannot post normally');
  if (perms.canPostIn(server, news, 'rob')) throw new Error('read-only member could post an announcement');
  if (perms.canPostIn(server, news, 'mod') === false) throw new Error('moderator cannot post an announcement');
});

await t.test('a server nobody owns cannot be redesigned by anyone', () => {
  const starter = { id: 's0', ownerId: null, members: {} };
  if (perms.can(starter, 'anyone', perms.CAP.manageServer)) throw new Error('starter server is editable');
  if (!perms.can(starter, 'anyone', perms.CAP.sendMessages)) throw new Error('starter server is unreadable');
});

/* -------------------------------- plans ---------------------------------- */

const plans = await import('/home/user/TalkingAPP/assets/js/plans.js');

await t.test('plans get bigger with each tier', () => {
  if (!(plans.limitsFor('free').servers < plans.limitsFor('plus').servers)) throw new Error('plus is not bigger');
  if (!(plans.limitsFor('plus').servers <= plans.limitsFor('studio').servers)) throw new Error('studio is not the biggest');
  if (!(plans.maxUploadBytes('free') < plans.maxUploadBytes('studio'))) throw new Error('upload limits do not grow');
});

await t.test('free plan has no badge, paid plans do', () => {
  if (plans.planBadgeHTML('free')) throw new Error('free plan shows a badge');
  if (!plans.planBadgeHTML('plus').includes('PLUS')) throw new Error('plus badge missing');
});

/* --------------------------- store: roles & plans ------------------------ */

const store = await import('/home/user/TalkingAPP/assets/js/store.js');
store.useAccountNamespace('nova');
store.state.self = {
  id: 'me', displayName: 'Nova', handle: 'nova', avatar: { kind: 'color', color: '#5865f2' },
  accentColor: '#5865f2', plan: 'free', status: 'online', isSelf: true,
};
store.state.ready = true;
store.createServer({ name: 'Test Lab', channels: ['general', 'random'] });
store.state.settings.plan = 'free';

const lab = Object.values(store.state.servers).find((s) => s.name === 'Test Lab');
const general = lab.channelIds.map((id) => store.state.channels[id]).find((c) => c.name === 'general');

await t.test('the creator is recorded as owner with the owner role', () => {
  if (lab.ownerId !== 'me') throw new Error('ownerId not set');
  if (store.roleOf(lab, 'me') !== 'owner') throw new Error(`role is ${store.roleOf(lab, 'me')}`);
  if (store.memberList(lab).length !== 1) throw new Error('creator missing from members');
});

await t.test('roles gate who can change a server', () => {
  store.state.users.bob = { id: 'bob', displayName: 'Bob', handle: 'bob', avatar: { kind: 'color', color: '#eb459e' } };
  lab.members.bob = { id: 'bob', name: 'Bob', handle: 'bob', role: 'member', since: Date.now() };
  if (store.canManageServer(lab, store.state.users.bob)) throw new Error('member can manage');
  const res = store.setMemberRole(lab.id, 'bob', 'moderator');
  if (!res.ok) throw new Error(res.error);
  if (store.roleOf(lab, 'bob') !== 'moderator') throw new Error('role did not stick');
  if (store.canModerateChannel(general.id, store.state.users.bob) !== true) throw new Error('moderator cannot moderate');
  const promote = store.setMemberRole(lab.id, 'bob', 'owner');
  if (promote.ok) throw new Error('somebody was made owner');
});

await t.test('read-only members are stopped at the store, not just the UI', () => {
  lab.members.bob.role = 'readonly';
  const asOwner = store.sendMessage(general.id, 'owner speaking');
  if (!asOwner) throw new Error('the owner was blocked from their own channel');
  const mine = store.state.self;
  store.state.self = store.state.users.bob;
  const sent = store.sendMessage(general.id, 'sneaky');
  store.state.self = mine;
  if (sent) throw new Error('read-only member sent a message');
  lab.members.bob.role = 'member';
  const after = store.sendMessage(general.id, 'promoted again');
  if (!after) throw new Error('member could not talk after promotion');
});

await t.test('a free account cannot make unlimited servers', () => {
  const limit = plans.limitsFor('free').servers;
  let made = Object.values(store.state.servers).filter((s) => s.ownerId === 'me').length;
  while (made < limit) {
    const res = store.createServer({ name: `Filler ${made}`, channels: ['general'] });
    if (!res.ok) throw new Error(`could not create filler server: ${res.error}`);
    made++;
  }
  const blocked = store.createServer({ name: 'One Too Many', channels: ['general'] });
  if (blocked.ok) throw new Error('server limit was not enforced');
  if (!/plan/i.test(blocked.error)) throw new Error('limit error does not mention plans');
  store.setPlan('plus');
  const allowed = store.createServer({ name: 'Now Allowed', channels: ['general'] });
  if (!allowed.ok) throw new Error(`plus plan still blocked: ${allowed.error}`);
});

await t.test('plan choice is saved and restores on another device', async () => {
  store.setPlan('studio');
  const snap = store.snapshotState();
  if (snap.settings.plan !== 'studio') throw new Error('plan missing from snapshot');
  const { sealSnapshot, openSealed } = await import('/home/user/TalkingAPP/assets/js/vault.js');
  const account = await import('/home/user/TalkingAPP/assets/js/account.js');
  const reg = await account.registerAccount({ handle: 'nova', displayName: 'Nova', password: 'correct horse battery' });
  if (!reg.ok) throw new Error(`register failed: ${reg.error}`);
  if (!account.readAccount()) throw new Error('account not readable right after registering');
  const sealed = await sealSnapshot('correct horse battery');
  const opened = await openSealed('correct horse battery', sealed);
  if (opened.settings.plan !== 'studio') throw new Error('plan did not survive the vault');
});

store.setPlan('studio');

await t.test('a huge history is trimmed to fit the cloud copy instead of failing', async () => {
  const big = store.createServer({
    name: 'Archive',
    channels: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
  });
  store.setPlan('free');
  // a real culprit: lots of pictures. Data-URL base64 barely compresses.
  // real high-entropy base64: hashes, so the payload cannot be compressed away
  const randomB64 = (n, salt = 'x') => {
    let out = '';
    for (let i = 0; out.length < n; i++) out += createHash('sha512').update(`${salt}-${i}`).digest('base64');
    return out.slice(0, n);
  };

  for (const cid of big.server.channelIds) {
    const list = [];
    for (let i = 0; i < 6; i++) {
      const msg = store.makeMessage({ channelId: cid, userId: 'me', displayName: 'Nova', handle: 'nova', text: `picture ${i}`, isSelf: true });
      msg.attachment = { kind: 'image', name: 'pic.png', src: 'data:image/png;base64,' + randomB64(120000, `${cid}-${i}`), width: 1200, height: 800 };
      list.push(msg);
    }
    store.state.messages[cid] = list;
  }

  const { sealSnapshot, openSealed } = await import('/home/user/TalkingAPP/assets/js/vault.js');
  const sealed = await sealSnapshot('correct horse battery');
  store.setPlan('studio');
  const size = JSON.stringify(sealed).length;
  const budget = plans.limitsFor('free').cloudChunks * 11000;
  if (size > budget) throw new Error(`sealed copy is ${size} chars, over the ${budget} budget`);
  if (!sealed.trimmed) throw new Error('snapshot was not marked as trimmed');
  const opened = await openSealed('correct horse battery', sealed);
  const kept = Object.values(opened.messages || {}).reduce((n, list) => n + list.length, 0);
  if (!kept) throw new Error('trimmed copy lost every message');
  if (!opened.servers) throw new Error('trimmed copy lost the server list');
});

await t.test('paid plans keep more of the history than free', async () => {
  if (!(plans.limitsFor('plus').cloudChunks > plans.limitsFor('free').cloudChunks)) throw new Error('plus stores no more than free');
  if (!(plans.limitsFor('studio').cloudKB > plans.limitsFor('plus').cloudKB)) throw new Error('studio stores no more than plus');
});

/* ------------------------- shared history & cards ------------------------ */

const shared = await import('/home/user/TalkingAPP/assets/js/shared.js');
const { net } = await import('/home/user/TalkingAPP/assets/js/net.js');

await t.test('a channel digest carries history into an empty channel', () => {
  const other = store.createServer({ name: 'Digest Room', channels: ['general'] });
  const ch = other.server.channelIds.map((id) => store.state.channels[id])[0];
  const entries = [
    { id: 'x1', u: 'bob', n: 'Bob', h: 'bob', t: 'first from another device', ts: Date.now() - 5000, pin: 0, e: 0, a: 1 },
    { id: 'x2', u: 'bob', n: 'Bob', h: 'bob', t: 'second from another device', ts: Date.now() - 4000, pin: 1, e: 0, a: 1 },
  ];
  const res = store.mergeRemoteEntries({ key: other.server.networkKey, channel: 'general', entries, removed: [] });
  if (!res.ok) throw new Error(res.reason || 'merge refused');
  if (res.added !== 2) throw new Error(`expected 2 added, got ${res.added}`);
  const texts = store.state.messages[ch.id].map((m) => m.text);
  if (!texts.includes('first from another device')) throw new Error('history not applied');
  if (!store.state.messages[ch.id].find((m) => m.id === 'x2')?.pinned) throw new Error('pin state lost');
});

await t.test('the same digest twice does not duplicate messages', () => {
  const server = Object.values(store.state.servers).find((s) => s.name === 'Digest Room');
  const entries = [{ id: 'x1', u: 'bob', n: 'Bob', h: 'bob', t: 'first from another device', ts: Date.now() - 5000, a: 1 }];
  const res = store.mergeRemoteEntries({ key: server.networkKey, channel: 'general', entries, removed: [] });
  if (res.added !== 0) throw new Error('duplicate message added');
});

await t.test('tombstones remove messages from the shared log', () => {
  const server = Object.values(store.state.servers).find((s) => s.name === 'Digest Room');
  const res = store.mergeRemoteEntries({ key: server.networkKey, channel: 'general', entries: [], removed: ['x1'] });
  if (!res.removed) throw new Error('nothing removed');
  const ch = server.channelIds.map((id) => store.state.channels[id])[0];
  if (store.state.messages[ch.id].some((m) => m.id === 'x1')) throw new Error('deleted message stayed');
});

await t.test('a server card brands a mirror but never edits my own server', () => {
  const mine = Object.values(store.state.servers).find((s) => s.name === 'Test Lab');
  const tamper = store.ingestServerCard({
    key: mine.networkKey, name: 'Hijacked', ownerId: 'mallory', savedAt: Date.now(),
    channels: [{ name: 'evil', category: '', type: 'text' }], members: [{ id: 'mallory', role: 'owner', name: 'Mallory' }],
  });
  if (tamper.ok && tamper.changed) throw new Error('a stranger rewrote my server');
  if (mine.name !== 'Test Lab') throw new Error('server was renamed by a card');

  const joined = store.joinNetworkCommunity({
    name: 'Remote Place', key: 'remote-place',
    card: {
      key: 'remote-place', name: 'Remote Place', desc: 'somewhere else', emoji: '🚀', color: '#22c55e',
      ownerId: 'alice', ownerName: 'Alice', savedAt: Date.now(),
      channels: [{ name: 'rules', category: 'Start here', type: 'announcement' }, { name: 'chat', category: 'Talk', type: 'text' }],
      members: [{ id: 'alice', role: 'owner', name: 'Alice', handle: 'alice' }],
    },
  });
  if (!joined.ok) throw new Error('join failed');
  const srv = joined.server;
  if (srv.name !== 'Remote Place' || srv.emoji !== '🚀') throw new Error('card branding not applied on join');
  if (srv.ownerId !== 'alice') throw new Error('owner unknown');
  const rules = srv.channelIds.map((id) => store.state.channels[id]).find((c) => c.name === 'rules');
  if (rules.type !== 'announcement' || rules.category !== 'Start here') throw new Error('channel shape not applied');
  if (store.roleOf(srv, 'me') !== 'member') throw new Error('joiner should be a member');
});

await t.test('digests publish a compact, text-only snapshot', () => {
  const server = Object.values(store.state.servers).find((s) => s.name === 'Digest Room');
  const ch = server.channelIds.map((id) => store.state.channels[id])[0];
  store.addMessage(ch.id, store.makeMessage({ channelId: ch.id, userId: 'me', displayName: 'Nova', handle: 'nova', text: 'hello digest', isSelf: true }));
  const entries = store.logEntriesFor(ch.id);
  if (!entries.some((e) => e.t === 'hello digest')) throw new Error('message missing from digest');
  if (entries.some((e) => typeof e.avatar?.src === 'string' && e.avatar.src.length > 500)) throw new Error('digest carries image bytes');
  const card = store.serverCardFor(server);
  if (!card.channels.length || card.key !== server.networkKey) throw new Error('card is malformed');
});

await t.test('shared module is wired and exposes the caches', () => {
  shared.initShared();
  const cached = shared.cardFor('remote-place');
  if (cached !== null && typeof cached !== 'object') throw new Error('card cache is malformed');
  if (shared.cardFor('never-heard-of-it') !== null) throw new Error('unknown card should be null');
  if (typeof shared.applyPendingForServer('remote-place') !== 'number') throw new Error('applyPendingForServer broken');
  if (!net.publishChannelLog || !net.publishServerCard) throw new Error('net publishers missing');
  const packed = net.packRetained({ kind: 'log', key: 'k', channel: 'c', entries: new Array(400).fill({ id: 'x', t: 'y'.repeat(600) }) });
  if (packed.length > 96000) throw new Error(`digest not trimmed: ${packed.length}`);
});

const failed = t.finish('logic checks');
window.close();
process.exit(failed ? 1 : 0);
