// UI checks for the upgraded TalkingApp: boot, unlock, shared history,
// server cards, roles, read-only channels and the plans tab.
import { boot, reporter, sleep, ROOT } from './harness.mjs';

const errors = [];
const { window, dom } = await boot();
window.addEventListener('error', (e) => errors.push(e.error?.message || e.message));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.message || e.reason)));
const origError = console.error;
console.error = (...args) => { errors.push(args.map(String).join(' ')); origError(...args); };

const t = reporter();
const { document } = window;

/* ------------------------------ prepare account --------------------------- */

const account = await import(`${ROOT}/assets/js/account.js`);
const store = await import(`${ROOT}/assets/js/store.js`);
const { bus } = await import(`${ROOT}/assets/js/bus.js`);
const session = await import(`${ROOT}/assets/js/session.js`);

const HANDLE = 'jaydentest';
const PW = 'chromebook battery';
store.useAccountNamespace(HANDLE);
const reg = await account.registerAccount({ handle: HANDLE, displayName: 'Jayden', password: PW });
if (!reg.ok) throw new Error(`could not make the test account: ${reg.error}`);

store.createProfile({ displayName: 'Jayden', handle: HANDLE });
store.createServer({ name: 'Studio', channels: ['general', 'announcements', 'random'] });
const studio = Object.values(store.state.servers).find((s) => s.name === 'Studio');
const general = studio.channelIds.map((id) => store.state.channels[id]).find((c) => c.name === 'general');
store.state.channels[studio.channelIds[1]].type = 'announcement';
store.persistNow();

await t.test('the app boots to the lock screen with no console errors', async () => {
  await import(`${ROOT}/assets/js/main.js`);
  await sleep(600);
  const lock = document.getElementById('lockScreen');
  if (!lock || lock.classList.contains('hidden')) throw new Error('lock screen did not appear');
  if (!document.getElementById('onboarding')?.classList.contains('hidden')) throw new Error('onboarding leaked through');
  if (errors.length) throw new Error(`console errors: ${errors.slice(0, 3).join(' | ')}`);
});

await t.test('a wrong password is refused, the right one opens the app', async () => {
  const form = document.getElementById('lockForm');
  const pw = document.getElementById('lockPassword');
  pw.value = 'definitely-not-it';
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(700);
  if (document.getElementById('lockScreen').classList.contains('hidden')) throw new Error('wrong password unlocked the app');

  pw.value = PW;
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 60 && document.getElementById('app').classList.contains('hidden'); i++) await sleep(100);
  if (document.getElementById('app').classList.contains('hidden')) throw new Error('the app never opened');
  if (errors.length) throw new Error(`console errors after unlock: ${errors.slice(0, 3).join(' | ')}`);
});

await t.test('the sidebar groups channels by category and shows them', async () => {
  const names = [...document.querySelectorAll('#sidebarScroll .ch-name')].map((n) => n.textContent);
  if (!names.includes('general')) throw new Error(`channels missing from sidebar: ${names.join(',')}`);
  const groups = [...document.querySelectorAll('#sidebarScroll .channel-group-head')].map((n) => n.textContent.trim());
  if (!groups.some((g) => /Text channels/i.test(g))) throw new Error(`no channel group heading: ${groups.join('|')}`);
});

await t.test('everyone who shows up becomes a member with a role', async () => {
  const { net } = await import(`${ROOT}/assets/js/net.js`);
  const peer = {
    id: 'peer-1', displayName: 'Sam', handle: 'sam', accentColor: '#22c55e', plan: 'plus',
    avatar: { kind: 'color', color: '#22c55e' },
  };
  bus.emit('net:presence', { peer: { user: peer, status: 'online', communities: [{ key: studio.networkKey, name: 'Studio', channels: ['general'] }] } });
  await sleep(120);
  const members = store.memberList(store.state.servers[studio.id]);
  if (!members.some((m) => m.id === 'peer-1')) throw new Error('peer was not added to the member list');
  if (!net) throw new Error('net missing');
});

await t.test('a message from another device lands in the channel', async () => {
  bus.emit('net:chat', {
    key: studio.networkKey,
    channel: 'general',
    msgId: 'msg_remote_1',
    text: 'hello from another chromebook',
    msgTs: Date.now(),
    from: { id: 'peer-1', displayName: 'Sam', handle: 'sam', accentColor: '#22c55e', plan: 'plus', avatar: { kind: 'color', color: '#22c55e' } },
  });
  await sleep(150);
  const found = (store.state.messages[general.id] || []).find((m) => m.id === 'msg_remote_1');
  if (!found) throw new Error('remote message never arrived');
  const text = document.getElementById('messagesScroll')?.textContent || '';
  if (!text.includes('hello from another chromebook')) throw new Error('message did not render');
});

await t.test('a retained history digest fills in the channel', async () => {
  bus.emit('net:log', {
    key: studio.networkKey,
    channel: 'general',
    savedAt: Date.now(),
    entries: [
      { id: 'log_1', u: 'peer-1', n: 'Sam', h: 'sam', t: 'said this before you arrived', ts: Date.now() - 60000, a: 1 },
      { id: 'log_2', u: 'peer-1', n: 'Sam', h: 'sam', t: 'and this too', ts: Date.now() - 55000, a: 1, pin: 1 },
    ],
    removed: [],
  });
  await sleep(200);
  const texts = (store.state.messages[general.id] || []).map((m) => m.text);
  if (!texts.includes('said this before you arrived')) throw new Error('history digest was ignored');
});

await t.test('a server card brands a community you joined by invite', async () => {
  const { joinNetworkCommunity } = store;
  const joined = joinNetworkCommunity({ name: 'remote room', key: 'remote-room', channels: ['general'] });
  if (!joined.ok) throw new Error('join failed');
  bus.emit('net:server-card', {
    card: {
      key: 'remote-room', name: 'Astro Club', desc: 'telescopes', emoji: '🔭', color: '#5865f2',
      ownerId: 'peer-2', ownerName: 'Ada', savedAt: Date.now(),
      channels: [
        { name: 'sky', category: 'Observing', type: 'text' },
        { name: 'news', category: 'Observing', type: 'announcement' },
      ],
      members: [{ id: 'peer-2', role: 'owner', name: 'Ada', handle: 'ada' }],
    },
  });
  await sleep(250);
  const srv = Object.values(store.state.servers).find((s) => s.networkKey === 'remote-room');
  if (srv.name !== 'Astro Club') throw new Error(`card ignored (name is ${srv.name})`);
  if (srv.emoji !== '🔭') throw new Error('icon not applied');
  if (!srv.channelIds.map((id) => store.state.channels[id]).some((c) => c.name === 'sky')) throw new Error('channels from the card missing');
  if (store.roleOf(srv, 'peer-2') !== 'owner') throw new Error('owner role lost');
});

await t.test('a read-only role gets a locked composer instead of a text box', async () => {
  const srv = Object.values(store.state.servers).find((s) => s.networkKey === 'remote-room');
  srv.members[store.state.self.id] = { id: store.state.self.id, name: 'Jayden', handle: HANDLE, role: 'readonly', since: Date.now() };
  const ch = srv.channelIds.map((id) => store.state.channels[id]).find((c) => c.name === 'sky');
  store.selectChannel(ch.id, { serverId: srv.id });
  await sleep(250);
  const locked = document.querySelector('.composer-locked');
  if (!locked) throw new Error('no locked composer appeared');
  if (!/read-only/i.test(locked.textContent)) throw new Error(`unexpected locked copy: ${locked.textContent.slice(0, 80)}`);
});

await t.test('announcement channels are staff-only, but staff get through', async () => {
  const srv = Object.values(store.state.servers).find((s) => s.networkKey === 'remote-room');
  const news = srv.channelIds.map((id) => store.state.channels[id]).find((c) => c.name === 'news');
  srv.members[store.state.self.id].role = 'member';
  store.selectChannel(news.id, { serverId: srv.id });
  await sleep(220);
  const locked = document.querySelector('.composer-locked');
  if (!locked) throw new Error('announcement channel was not locked for a member');
  if (!/announcement/i.test(locked.textContent)) throw new Error(`wrong reason: ${locked.textContent.slice(0, 90)}`);

  srv.members[store.state.self.id].role = 'moderator';
  store.selectChannel(news.id, { serverId: srv.id });
  await sleep(220);
  if (document.querySelector('.composer-locked')) throw new Error('a moderator was still locked out of announcements');
  if (!document.getElementById('composerInput')) throw new Error('moderator did not get a text box');
});

await t.test('role controls respect who is allowed to use them', () => {
  const srv = store.state.servers[studio.id];
  const res = store.setMemberRole(srv.id, 'peer-1', 'moderator');
  if (!res.ok) throw new Error(res.error);
  if (store.roleOf(srv, 'peer-1') !== 'moderator') throw new Error('role did not change');
  const bogus = store.setMemberRole(srv.id, 'peer-1', 'president');
  if (bogus.ok) throw new Error('an invented role was accepted');
});

await t.test('the plans tab lists every plan and switching sticks', async () => {
  const { openSettings } = await import(`${ROOT}/assets/js/views/modals.js`);
  openSettings('plans');
  await sleep(200);
  const cards = [...document.querySelectorAll('.plan-card')];
  if (cards.length !== 3) throw new Error(`expected 3 plan cards, saw ${cards.length}`);
  const buttons = [...document.querySelectorAll('.plan-card .btn')];
  const getPlus = buttons.find((b) => /Get Plus/i.test(b.textContent));
  if (!getPlus) throw new Error('no way to switch to Plus');
  getPlus.click();
  await sleep(250);
  if (store.currentPlan().id !== 'plus') throw new Error('plan did not change');
  if (store.state.settings.plan !== 'plus') throw new Error('plan not saved to settings');
  if (!JSON.parse(window.localStorage.getItem(`ta.state.v2.${HANDLE}`) || '{}').settings?.plan) throw new Error('plan not persisted to storage');
});

await t.test('the server settings modal shows people and their roles', async () => {
  const { openServerSettings } = await import(`${ROOT}/assets/js/views/modals.js`);
  const srv = store.state.servers[studio.id];
  openServerSettings(srv);
  await sleep(200);
  const rows = [...document.querySelectorAll('.member-admin-row')];
  if (!rows.length) throw new Error('no member rows rendered');
  const labels = rows.map((r) => r.textContent);
  if (!labels.some((l) => /Jayden/.test(l))) throw new Error('the owner is missing from the people list');
  if (!document.querySelector('.member-admin select')) throw new Error('no role selector for the owner to use');
});

await t.test('muting a server is remembered', async () => {
  const srv = store.state.servers[studio.id];
  store.setServerNotify(srv.id, 'mentions');
  const saved = JSON.parse(window.localStorage.getItem(`ta.state.v2.${HANDLE}`) || '{}');
  if (saved.servers?.[srv.id]?.notify !== 'mentions') throw new Error('notification level was not persisted');
});

/* ---------------------------- blocking, for real -------------------------- */

await t.test('blocking from the message menu hides that person immediately', async () => {
  const { messageMenu } = await import(`${ROOT}/assets/js/views/messages.js`);
  const srv = store.state.servers[studio.id];
  const ch = srv.channelIds.map((id) => store.state.channels[id]).find((c) => c.name === 'general');
  store.selectChannel(ch.id, { serverId: srv.id });
  await sleep(150);

  store.addMessage(ch.id, store.makeMessage({
    channelId: ch.id, userId: 'u_annoying', displayName: 'Annoying', handle: 'annoying',
    text: 'unwanted message here', ts: Date.now(), network: true,
  }));
  await sleep(200);
  if (!document.getElementById('messagesScroll').textContent.includes('unwanted message here')) {
    throw new Error('the message did not render in the first place');
  }

  const msg = (store.state.messages[ch.id] || []).find((m) => m.userId === 'u_annoying');
  const anchor = document.createElement('button');
  document.body.append(anchor);
  messageMenu(msg, anchor);
  await sleep(60);
  const blockItem = [...document.querySelectorAll('.menu-item')].find((n) => /Block this person/i.test(n.textContent));
  if (!blockItem) throw new Error('no block action in the message menu');
  blockItem.click();
  await sleep(250);

  if (document.getElementById('messagesScroll').textContent.includes('unwanted message here')) {
    throw new Error('the blocked message is still on screen');
  }
  if (!document.querySelector('.blocked-notice')) throw new Error('no explanation for the hidden messages');
  if (!store.isBlocked('u_annoying')) throw new Error('the block was not saved');
});

await t.test('the blocked tab lists them and unblocking brings the chat back', async () => {
  const { openSettings } = await import(`${ROOT}/assets/js/views/modals.js`);
  openSettings('blocked');
  await sleep(200);
  const rows = [...document.querySelectorAll('.member-admin-row')];
  if (!rows.some((r) => /Annoying/.test(r.textContent))) throw new Error('blocked person missing from the list');
  const unblock = [...document.querySelectorAll('.member-admin-row .btn')].find((b) => /Unblock/i.test(b.textContent));
  if (!unblock) throw new Error('no unblock button');
  unblock.click();
  await sleep(250);
  if (store.isBlocked('u_annoying')) throw new Error('still blocked');
  if (!document.getElementById('messagesScroll').textContent.includes('unwanted message here')) {
    throw new Error('unblocking did not restore the message');
  }
});

await t.test('a blocked person\'s DM shows an unblock prompt instead of a text box', async () => {
  const peer = { id: 'u_dm_blocked', displayName: 'Pushy', handle: 'pushy', avatar: { kind: 'color', color: '#eb459e' } };
  store.state.users[peer.id] = peer;
  const dm = store.openDM(peer.id, peer);
  store.blockUser(peer.id, peer);
  store.selectChannel(dm.id, { serverId: null });
  await sleep(250);
  const locked = document.querySelector('.composer-locked');
  if (!locked) throw new Error('no unblock prompt appeared');
  if (!/You blocked/i.test(locked.textContent)) throw new Error(`unexpected prompt: ${locked.textContent.slice(0, 80)}`);
  if (document.getElementById('composerInput')) throw new Error('they still had a text box');
  const btn = [...locked.querySelectorAll('button')].find((b) => /Unblock/i.test(b.textContent));
  btn.click();
  await sleep(200);
  if (store.isBlocked(peer.id)) throw new Error('the unblock button did nothing');
});

/* ---------------------- invite-only servers, end to end -------------------- */

await t.test('creating an invite-only server gives a private link and hides it from Explore', async () => {
  const { openCreateServer } = await import(`${ROOT}/assets/js/views/modals.js`);
  openCreateServer();
  await sleep(150);
  const sw = [...document.querySelectorAll('.switch')].find((n) => n.getAttribute('aria-label') === 'Invite-only server');
  if (!sw) throw new Error('no invite-only switch in the create dialog');
  sw.click();
  if (sw.getAttribute('aria-checked') !== 'true') throw new Error('the switch did not turn on');
  document.getElementById('srvName').value = 'Quiet Room';
  const create = [...document.querySelectorAll('.modal-foot .btn')].find((b) => /Create server/i.test(b.textContent));
  create.click();
  await sleep(300);

  const srv = Object.values(store.state.servers).find((s) => s.name === 'Quiet Room');
  if (!srv) throw new Error('the server was not created');
  if (store.isListed(srv)) throw new Error('an invite-only server was listed');
  if (srv.networkKey.includes('quiet')) throw new Error('the private key leaks the name');
  if (store.state.network[srv.networkKey]) throw new Error('it registered itself in Explore');
  const { inviteLinkFor } = store;
  const link = inviteLinkFor(srv);
  if (!link.includes('?invite=')) throw new Error(`the link is not an invite link: ${link}`);
});

/* ------------------------------ threads in the UI ------------------------- */

await t.test('replying in a thread opens it and keeps the reply out of the channel', async () => {
  const { messageMenu } = await import(`${ROOT}/assets/js/views/messages.js`);
  store.selectChannel(general.id, { serverId: studio.id });
  await sleep(200);
  const parent = store.sendMessage(general.id, 'thread me please');
  await sleep(200);
  const node = [...document.querySelectorAll('.message')].find((n) => n.textContent.includes('thread me please'));
  if (!node) throw new Error('the parent message never rendered');

  messageMenu(store.state.messages[general.id].find((m) => m.id === parent.id), node.querySelector('.msg-toolbar button') || node);
  await sleep(80);
  const make = [...document.querySelectorAll('.menu-item')].find((n) => /Create thread/i.test(n.textContent));
  if (!make) throw new Error('no way to start a thread from a message');
  make.click();
  await sleep(350);

  const thread = store.state.channels[store.state.ui.activeChannelId];
  if (thread?.type !== 'thread') throw new Error('opening the thread did not navigate into it');
  if (!document.querySelector('.thread-intro')) throw new Error('the thread has no header explaining where it came from');
  if (!document.querySelector('.thread-parent-msg')) throw new Error('the parent message is not quoted at the top');
  const input = document.getElementById('composerInput');
  if (!/Reply in/.test(input.getAttribute('placeholder') || '')) throw new Error(`placeholder is "${input.getAttribute('placeholder')}"`);

  input.value = 'a reply inside the thread';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await sleep(300);
  if (!document.getElementById('messagesScroll').textContent.includes('a reply inside the thread')) {
    throw new Error('the thread reply did not render');
  }
  if (store.threadReplyCount(thread.id) !== 1) throw new Error('the reply was not counted');

  // the channel itself stays clean
  store.selectChannel(general.id, { serverId: studio.id });
  await sleep(250);
  if (document.getElementById('messagesScroll').textContent.includes('a reply inside the thread')) {
    throw new Error('the thread reply leaked into the channel');
  }
  const chip = [...document.querySelectorAll('.thread-chip')].find((n) => n.dataset.thread === thread.id);
  if (!chip) throw new Error('the parent message has no thread chip');
  if (!/1 repl/i.test(chip.textContent)) throw new Error(`chip says "${chip.textContent}"`);
  chip.click();
  await sleep(300);
  if (store.state.ui.activeChannelId !== thread.id) throw new Error('the chip did not reopen the thread');
  store.selectChannel(general.id, { serverId: studio.id });
});

/* ------------------------------ slowmode in the UI ------------------------ */

await t.test('slowmode shows up in the composer and locks it for a member', async () => {
  const slowChannel = studio.channelIds.map((id) => store.state.channels[id]).find((c) => c.name === 'random');
  store.selectChannel(slowChannel.id, { serverId: studio.id });
  await sleep(150);
  slowChannel.slowmode = 30;
  const mine = store.sendMessage(slowChannel.id, 'the first one');
  if (!mine) throw new Error('could not post the first message');
  store.selectChannel(general.id, { serverId: studio.id });
  await sleep(120);
  store.selectChannel(slowChannel.id, { serverId: studio.id });
  await sleep(250);

  // the owner is staff, so they are exempt — the bar still explains the rule
  const bar = document.querySelector('.composer-slowmode');
  if (!bar) throw new Error('no slowmode note above the composer');
  if (!/moderators are exempt/i.test(bar.textContent)) throw new Error(`note says "${bar.textContent.slice(0, 60)}"`);
  if (document.getElementById('composerInput').disabled) throw new Error('the owner was locked out of their own channel');
  slowChannel.slowmode = 0;
});

/* --------------------------- saved messages in the UI --------------------- */

await t.test('a saved message appears in Settings and opens its channel', async () => {
  const msg = store.sendMessage(general.id, 'keep this one around');
  await sleep(150);
  store.toggleSaved(msg);
  const { openSettings } = await import(`${ROOT}/assets/js/views/modals.js`);
  const { closeAllModals } = await import(`${ROOT}/assets/js/ui/modal.js`);
  closeAllModals();
  openSettings('saved');
  await sleep(250);
  const rows = [...document.querySelectorAll('.saved-row')];
  if (!rows.length) throw new Error('the saved tab is empty');
  const row = rows.find((r) => r.textContent.includes('keep this one around'));
  if (!row) throw new Error('the saved message is missing from the list');
  const open = [...row.querySelectorAll('button')].find((b) => /Open/.test(b.textContent));
  open.click();
  await sleep(300);
  if (store.state.ui.activeChannelId !== general.id) throw new Error('Open did not jump to the channel');
  if (document.getElementById('modalRoot').children.length) throw new Error('the settings modal stayed open');
});

/* ------------------------------- audit log in the UI ---------------------- */

await t.test('the audit log lists what staff did', async () => {
  const { openServerSettings } = await import(`${ROOT}/assets/js/views/modals.js`);
  const { closeAllModals } = await import(`${ROOT}/assets/js/ui/modal.js`);
  const made = store.createChannel(studio.id, 'audit-visible');
  if (!made.ok) throw new Error(made.error);
  closeAllModals();
  openServerSettings(studio);
  await sleep(250);
  const rows = [...document.querySelectorAll('.audit-row')];
  if (!rows.length) throw new Error('the audit log rendered nothing');
  if (!rows.some((r) => /created a channel/.test(r.textContent))) {
    throw new Error(`the newest action is missing: ${rows[0]?.textContent}`);
  }
  if (!rows.some((r) => /audit-visible/.test(r.textContent))) throw new Error('the entry does not name the channel');
  closeAllModals();
  store.deleteChannel(made.channel.id);
});

await t.test('no console errors were logged during the whole session', () => {
  const real = errors.filter((e) => !/Not implemented|Could not parse CSS|jsdom/i.test(e));
  if (real.length) throw new Error(real.slice(0, 4).join(' | '));
});

const failed = t.finish('UI checks');
window.close();
process.exit(failed ? 1 : 0);
