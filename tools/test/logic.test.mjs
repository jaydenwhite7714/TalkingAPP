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


/* ------------------------- blocking actually blocks ---------------------- */

const room = Object.values(store.state.servers).find((s) => s.name === 'Digest Room');
const roomCh = room.channelIds.map((id) => store.state.channels[id]).find((c) => c.name === 'general');
store.addMessage(roomCh.id, store.makeMessage({
  channelId: roomCh.id, userId: 'u_spam', displayName: 'Spammer', handle: 'spam',
  text: 'buy my thing', ts: Date.now(), network: true,
}));

await t.test('blocking hides their messages and unread count', () => {
  const before = store.visibleMessages(roomCh.id).length;
  if (!store.visibleMessages(roomCh.id).some((m) => m.text === 'buy my thing')) throw new Error('message should be visible first');
  const res = store.blockUser('u_spam', { displayName: 'Spammer', handle: 'spam' });
  if (!res.ok) throw new Error(res.error);
  const after = store.visibleMessages(roomCh.id);
  if (after.length !== before - 1) throw new Error(`expected one hidden message, ${before} → ${after.length}`);
  if (after.some((m) => m.userId === 'u_spam')) throw new Error('blocked message still listed');
  if (store.unreadCount(roomCh.id) !== 0) throw new Error('blocked messages still counted as unread');
});

await t.test('the messages are kept, so unblocking brings them back', () => {
  if (!(store.state.messages[roomCh.id] || []).some((m) => m.userId === 'u_spam')) throw new Error('blocking deleted the history');
  store.unblockUser('u_spam');
  if (!store.visibleMessages(roomCh.id).some((m) => m.text === 'buy my thing')) throw new Error('unblocking did not restore the message');
});

await t.test('blocking yourself, or nobody, is refused', () => {
  if (store.blockUser(store.state.self.id).ok) throw new Error('blocked myself');
  if (store.blockUser(null).ok) throw new Error('blocked nobody');
});

await t.test('the blocked list is saved with everything else', () => {
  store.blockUser('u_spam', { displayName: 'Spammer', handle: 'spam' });
  const snap = store.snapshotState();
  if (!snap.blocked?.u_spam) throw new Error('block missing from the snapshot');
  if (!store.blockedList().some((b) => b.id === 'u_spam')) throw new Error('blockedList is empty');
  store.unblockUser('u_spam');
  if (snap.blocked.u_spam === undefined) throw new Error('snapshot was mutated');
});

/* --------------------- permissions cannot be bypassed -------------------- */

await t.test('only the author may edit a message', () => {
  const server = Object.values(store.state.servers).find((s) => s.name === 'Digest Room');
  const ch = server.channelIds.map((id) => store.state.channels[id])[0];
  const theirs = store.makeMessage({ channelId: ch.id, userId: 'u_someone', displayName: 'Someone', handle: 'someone', text: 'original', network: true });
  store.addMessage(ch.id, theirs);
  const res = store.editMessage(ch.id, theirs.id, 'tampered');
  if (res) throw new Error('edited somebody else\'s message');
  const stored = store.state.messages[ch.id].find((m) => m.id === theirs.id);
  if (stored.text !== 'original') throw new Error('the text changed anyway');
});

/** A server I am only a plain member of, so moderation rules really apply. */
function foreignChannel() {
  const joined = store.joinByInvite({ key: 'p_foreignmembers1', name: 'Foreign Room', card: {
    key: 'p_foreignmembers1', name: 'Foreign Room', ownerId: 'u_owner', ownerName: 'Owner',
    savedAt: Date.now(), channels: [{ name: 'general', type: 'text' }],
    members: [{ id: 'u_owner', role: 'owner', name: 'Owner', handle: 'owner' }],
  } });
  if (!joined.ok) throw new Error(joined.error);
  const ch = joined.server.channelIds.map((id) => store.state.channels[id])[0];
  return { server: joined.server, ch };
}

await t.test('a plain member cannot delete somebody else\'s message', () => {
  const { ch } = foreignChannel();
  const theirs = store.makeMessage({ channelId: ch.id, userId: 'u_stranger', displayName: 'Stranger', handle: 'stranger', text: 'keep me', network: true });
  store.addMessage(ch.id, theirs);
  store.deleteMessage(ch.id, theirs.id);
  if (!store.state.messages[ch.id].some((m) => m.id === theirs.id)) throw new Error('a plain member deleted it');
  // the network layer already checked the sender, so its deletes go through
  store.deleteMessage(ch.id, theirs.id, { remote: true });
  if (store.state.messages[ch.id].some((m) => m.id === theirs.id)) throw new Error('a checked remote delete was refused');
});

await t.test('a member can delete their own message', () => {
  const { ch } = foreignChannel();
  const mine = store.makeMessage({ channelId: ch.id, userId: store.state.self.id, displayName: 'Me', handle: 'me', text: 'mine', isSelf: true });
  store.addMessage(ch.id, mine);
  store.deleteMessage(ch.id, mine.id);
  if (store.state.messages[ch.id].some((m) => m.id === mine.id)) throw new Error('could not delete my own message');
});

await t.test('pinning needs to be the author or a moderator', () => {
  const { ch } = foreignChannel();
  const theirs = store.makeMessage({ channelId: ch.id, userId: 'u_stranger', displayName: 'Stranger', handle: 'stranger', text: 'pin me', network: true });
  store.addMessage(ch.id, theirs);
  store.togglePin(ch.id, theirs.id);
  const stored = store.state.messages[ch.id].find((m) => m.id === theirs.id);
  if (stored.pinned) throw new Error('a member pinned somebody else\'s message');
  const mine = store.makeMessage({ channelId: ch.id, userId: store.state.self.id, displayName: 'Me', handle: 'me', text: 'mine', isSelf: true });
  store.addMessage(ch.id, mine);
  if (!store.togglePin(ch.id, mine.id)) throw new Error('could not pin my own message');
});

/* ------------------- invite-only servers are really private -------------- */

await t.test('an invite-only server gets a random key, a public one gets its name', () => {
  const open = store.createServer({ name: 'Open House', channels: ['general'] });
  const priv = store.createServer({ name: 'Secret Lair', visibility: 'invite', channels: ['general'] });
  if (!open.ok || !priv.ok) throw new Error(open.error || priv.error);
  if (open.server.networkKey !== 'open-house') throw new Error(`public key is ${open.server.networkKey}`);
  if (priv.server.networkKey.includes('secret')) throw new Error(`private key leaks the name: ${priv.server.networkKey}`);
  if (!/^p_[a-z0-9]{10,}$/i.test(priv.server.networkKey)) throw new Error(`unexpected private key ${priv.server.networkKey}`);
  if (store.isListed(priv.server)) throw new Error('private server counts as listed');
  if (!store.isListed(open.server)) throw new Error('public server is not listed');
});

await t.test('private servers stay out of Explore', () => {
  const priv = Object.values(store.state.servers).find((s) => s.name === 'Secret Lair');
  if (store.state.network[priv.networkKey]) throw new Error('private server registered itself for discovery');
});

await t.test('a private server publishes neither history nor a card', async () => {
  const priv = Object.values(store.state.servers).find((s) => s.name === 'Secret Lair');
  const ch = priv.channelIds.map((id) => store.state.channels[id])[0];
  store.addMessage(ch.id, store.makeMessage({ channelId: ch.id, userId: store.state.self.id, displayName: 'Me', handle: 'me', text: 'secret plans', isSelf: true }));

  const seen = [];
  const realLog = net.publishChannelLog;
  const realCard = net.publishServerCard;
  net.publishChannelLog = (d) => { seen.push(['log', d.key]); return 1; };
  net.publishServerCard = (c) => { seen.push(['card', c.key]); return 1; };

  shared.publishChannelLogNow(ch.id);
  shared.scheduleServerCard(priv);
  await new Promise((r) => setTimeout(r, 1800));

  net.publishChannelLog = realLog;
  net.publishServerCard = realCard;

  if (seen.some(([kind, key]) => key === priv.networkKey)) {
    throw new Error(`private server leaked: ${JSON.stringify(seen)}`);
  }
  // ...while a public server still does publish
  const open = Object.values(store.state.servers).find((s) => s.name === 'Open House');
  const openCh = open.channelIds.map((id) => store.state.channels[id])[0];
  store.addMessage(openCh.id, store.makeMessage({ channelId: openCh.id, userId: store.state.self.id, displayName: 'Me', handle: 'me', text: 'hello world', isSelf: true }));
  net.publishChannelLog = (d) => { seen.push(['log', d.key]); return 1; };
  shared.publishChannelLogNow(openCh.id);
  net.publishChannelLog = realLog;
  if (!seen.some(([kind, key]) => kind === 'log' && key === open.networkKey)) throw new Error('public history stopped publishing');
});

await t.test('rotating the link locks out the old one and existing members follow', () => {
  const priv = Object.values(store.state.servers).find((s) => s.name === 'Secret Lair');
  const oldKey = priv.networkKey;
  const res = store.rotateInviteLink(priv.id);
  if (!res.ok) throw new Error(res.error);
  if (res.nextKey === oldKey) throw new Error('key did not change');
  // another member still holding the old key gets moved over
  const member = store.joinByInvite({ key: oldKey, name: 'Secret Lair' });
  if (!member.ok) throw new Error(member.error);
  const applied = store.applyRekey({ oldKey, nextKey: res.nextKey });
  if (!applied.ok) throw new Error('member did not follow the rekey');
  if (applied.server.networkKey !== res.nextKey) throw new Error('member kept the old key');
  if (store.isListed(applied.server)) throw new Error('rekey made the server public');
});

await t.test('joining by invite needs a plausible key', () => {
  const bad = store.joinByInvite({ key: 'x', name: 'Nope' });
  if (bad.ok) throw new Error('a one-character key was accepted');
  const good = store.joinByInvite({ key: 'p_abcdefghijklmnop', name: 'Somebody Else' });
  if (!good.ok) throw new Error(good.error);
  if (good.server.visibility !== 'invite') throw new Error('joined server is not invite-only');
  if (store.isListed(good.server)) throw new Error('joined server is listed');
});

await t.test('a card can never make a private server public', () => {
  const priv = Object.values(store.state.servers).find((s) => s.name === 'Somebody Else');
  const res = store.ingestServerCard({
    key: priv.networkKey, name: 'Somebody Else', ownerId: 'u_owner', savedAt: Date.now(),
    channels: [{ name: 'general', type: 'text' }], members: [{ id: 'u_owner', role: 'owner', name: 'Owner', handle: 'owner' }],
  });
  if (!res.ok) throw new Error('card was refused entirely');
  if (store.isListed(priv)) throw new Error('a card turned a private server public');
});

/* ---------------------------- threads, for real --------------------------- */

await t.test('a thread keeps its replies out of the channel', () => {
  const parent = store.sendMessage(general.id, 'should we take this to a thread?');
  if (!parent) throw new Error('could not post the parent message');
  const res = store.createThread({ channelId: general.id, messageId: parent.id });
  if (!res.ok) throw new Error(res.error);
  const thread = res.thread;
  if (lab.channelIds.includes(thread.id)) throw new Error('the thread leaked into the channel list');
  if (!lab.threadIds.includes(thread.id)) throw new Error('the server does not know about its thread');
  if (store.threadParent(thread)?.id !== general.id) throw new Error('the thread lost its parent');

  store.sendMessage(thread.id, 'first reply');
  store.sendMessage(thread.id, 'second reply');
  if (store.threadReplyCount(thread.id) !== 2) throw new Error(`reply count is ${store.threadReplyCount(thread.id)}`);
  if (store.state.messages[general.id].some((m) => m.text === 'first reply')) {
    throw new Error('a thread reply showed up in the channel');
  }
  if (store.threadsForChannel(general.id).length !== 1) throw new Error('the sidebar would not show the thread once');
});

await t.test('opening the same thread twice reuses it', () => {
  const parent = store.state.messages[general.id].find((m) => m.text === 'should we take this to a thread?');
  const again = store.createThread({ channelId: general.id, messageId: parent.id });
  if (!again.ok) throw new Error(again.error);
  if (!again.existing) throw new Error('a second thread was created on the same message');
  if (store.threadsForChannel(general.id).length !== 1) throw new Error('duplicate threads appeared');
});

await t.test('deleting a thread takes its replies with it', () => {
  const parent = store.sendMessage(general.id, 'temporary thread');
  const { thread } = store.createThread({ channelId: general.id, messageId: parent.id });
  store.sendMessage(thread.id, 'gone soon');
  const res = store.deleteThread(thread.id);
  if (!res.ok) throw new Error(res.error || 'could not delete');
  if (store.state.channels[thread.id]) throw new Error('the thread channel survived');
  if (store.state.messages[thread.id]) throw new Error('the replies survived');
  if (lab.threadIds.includes(thread.id)) throw new Error('the server still lists it');
});

await t.test('thread history arriving from the network rebuilds the thread', () => {
  // a server I am only a member of: the owner's thread has to be recreated here
  const { server: foreign, ch: parent } = foreignChannel();
  const before = store.threadsForChannel(parent.id).length;
  const res = store.mergeRemoteEntries({
    key: foreign.networkKey,
    channel: 'thread-th_remotethread1',
    thread: { id: 'th_remotethread1', name: 'From the relay', parentChannel: parent.name },
    entries: [{ id: 'm_remote1', u: 'u_owner', n: 'Owner', h: 'owner', t: 'hello from another device', ts: Date.now() - 1000 }],
  });
  if (!res.ok) throw new Error(res.reason || 'thread history was refused');
  const thread = store.state.channels['th_remotethread1'];
  if (!thread) throw new Error('the thread was not created');
  if (thread.parentChannelId !== parent.id) throw new Error('the thread landed in the wrong channel');
  if (store.threadsForChannel(parent.id).length !== before + 1) throw new Error('the thread is not attached to the channel');
  if (!store.state.messages[thread.id].some((m) => m.text === 'hello from another device')) {
    throw new Error('the history did not land');
  }

  // my own server is never rewritten by a stray log packet
  const mine = store.mergeRemoteEntries({
    key: lab.networkKey,
    channel: 'thread-th_stranger01',
    thread: { id: 'th_stranger01', name: 'Not mine', parentChannel: general.name },
    entries: [{ id: 'm_remote2', u: 'u_x', n: 'X', h: 'x', t: 'injected', ts: Date.now() }],
  });
  if (mine.ok) throw new Error('a remote packet created a thread on my own server');
});

await t.test('a thread inherits the slowmode of its channel', () => {
  const ch = lab.channelIds.map((id) => store.state.channels[id]).find((c) => c.name === 'random') || general;
  const parent = store.sendMessage(ch.id, 'slow parent message');
  if (!parent) throw new Error('could not seed the parent');
  ch.slowmode = 10;
  const { thread } = store.createThread({ channelId: ch.id, messageId: parent.id });
  if (store.slowmodeFor(thread.id) !== 10) throw new Error('the thread ignored the slowmode');
  ch.slowmode = 0;

  // a plain member feels it, a moderator does not
  const { ch: memberChannel } = foreignChannel();
  for (const m of store.state.messages[memberChannel.id] || []) {
    if (m.userId === store.state.self.id) m.ts -= 600000;
  }
  memberChannel.slowmode = 30;
  const first = store.sendMessage(memberChannel.id, 'first');
  if (!first) throw new Error('the first message was blocked');
  const second = store.sendMessage(memberChannel.id, 'second');
  if (second) throw new Error('slowmode let a second message through');
  const foreign = store.state.servers[memberChannel.serverId];
  foreign.members[store.state.self.id].role = 'moderator';
  const third = store.sendMessage(memberChannel.id, 'staff speaking');
  if (!third) throw new Error('slowmode blocked a moderator');
  foreign.members[store.state.self.id].role = 'member';
  const left = store.slowmodeRemaining(memberChannel.id);
  if (!(left > 0 && left <= 30)) throw new Error(`countdown looks wrong: ${left}`);
  memberChannel.slowmode = 0;
});

await t.test('only the offered slowmode values are accepted', () => {
  const res = store.updateChannel(general.id, { slowmode: 7 });
  if (res.ok) throw new Error('an invented slowmode was accepted');
  const good = store.updateChannel(general.id, { slowmode: 30 });
  if (!good.ok) throw new Error(good.error);
  if (store.state.channels[general.id].slowmode !== 30) throw new Error('slowmode did not stick');
  store.updateChannel(general.id, { slowmode: 0 });
});

/* -------------------------------- audit log ------------------------------ */

await t.test('staff actions land in the audit log, newest first', () => {
  store.state.settings.plan = 'studio';
  const made = store.createChannel(lab.id, 'audit-room', 'for the log');
  if (!made.ok) throw new Error(made.error);
  const top = store.auditLog(lab.id)[0];
  if (top?.action !== 'channel.create') throw new Error(`newest entry is ${top?.action}`);
  if (!top.actorId) throw new Error('the entry has no actor');
  store.deleteChannel(made.channel.id);
  if (store.auditLog(lab.id)[0].action !== 'channel.delete') throw new Error('the delete was not recorded');
  if (!/'audit-room'|audit-room/.test(store.auditLog(lab.id)[0].detail)) throw new Error('the entry does not say what was deleted');
});

await t.test('role changes and invite rotations are recorded too', () => {
  store.setMemberRole(lab.id, 'bob', 'admin');
  const roleEntry = store.auditLog(lab.id).find((e) => e.action === 'member.role');
  if (!roleEntry) throw new Error('a role change was not logged');
  const priv = store.createServer({ name: 'Audited Vault', visibility: 'invite', channels: ['general'] });
  store.rotateInviteLink(priv.server.id);
  if (!store.auditLog(priv.server.id).some((e) => e.action === 'server.rekey')) throw new Error('the rotated link was not logged');
});

await t.test('moderator deletions are logged, self-deletions are not', () => {
  const { ch } = foreignChannel();
  const theirs = store.makeMessage({ channelId: ch.id, userId: 'u_stranger2', displayName: 'Stranger', handle: 'stranger', text: 'delete me', network: true });
  store.addMessage(ch.id, theirs);
  const foreign = store.state.servers[ch.serverId];
  foreign.members[store.state.self.id].role = 'moderator';
  const before = store.auditLog(foreign.id).length;
  store.deleteMessage(ch.id, theirs.id);
  if (store.auditLog(foreign.id).length <= before) throw new Error('the moderator delete was not logged');
  if (!store.auditLog(foreign.id)[0].detail.includes('Stranger')) throw new Error('the log does not name the author');
  foreign.members[store.state.self.id].role = 'member';
});

await t.test('the audit log travels with a backup', () => {
  const snap = store.snapshotState();
  if (!snap.audit?.[lab.id]?.length) throw new Error('the audit log is missing from the snapshot');
  snap.blocked = snap.blocked || {};
  const before = store.auditLog(lab.id).length;
  store.applySnapshot(snap, { replaceLocal: false });
  if (store.auditLog(lab.id).length !== before) throw new Error('restoring lost audit entries');
});

/* ----------------------------- saved messages ---------------------------- */

await t.test('a saved message keeps a copy you can get back to', () => {
  const msg = store.sendMessage(general.id, 'this one is worth keeping');
  if (!msg) throw new Error('could not post');
  const on = store.toggleSaved(msg);
  if (!on.ok || !on.saved) throw new Error('saving did nothing');
  if (!store.isSaved(msg.id)) throw new Error('isSaved disagrees');
  const entry = store.savedList().find((x) => x.msgId === msg.id);
  if (entry.text !== 'this one is worth keeping') throw new Error('the saved copy lost its text');
  if (entry.channelId !== general.id) throw new Error('the saved copy lost its channel');

  const off = store.toggleSaved(msg);
  if (!off.ok || off.saved) throw new Error('unsaving did nothing');
  if (store.isSaved(msg.id)) throw new Error('it is still saved');

  store.toggleSaved(msg);
});

await t.test('saved messages survive a snapshot and a wipe of the screen', () => {
  const msg = store.state.messages[general.id].find((m) => m.text === 'this one is worth keeping');
  if (!msg) throw new Error('lost the message');
  if (!store.isSaved(msg.id)) throw new Error('the message was not saved');
  const snap = store.snapshotState();
  if (!snap.saved.some((x) => x.msgId === msg.id)) throw new Error('the snapshot dropped it');
  store.removeSaved(msg.id);
  if (store.isSaved(msg.id)) throw new Error('removing did nothing');
});

await t.test('system notices cannot be saved', () => {
  const notice = store.makeMessage({ channelId: general.id, userId: 'talkingapp', displayName: 'TalkingApp', handle: 'app', text: 'a system note', system: true });
  store.addMessage(general.id, notice);
  const res = store.toggleSaved(notice);
  if (res.ok) throw new Error('a system notice was bookmarked');
});

const failed = t.finish('logic checks');
window.close();
process.exit(failed ? 1 : 0);
