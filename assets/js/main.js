// TalkingApp — bootstrap and wiring
import {
  state, load, save, flush, createChannel, noteRemoteCommunity, removePeer, upsertPeer,
  receiveMessage, makeMessage, setPresence, setTyping, markRead, toast as storeToast,
  registerAllCommunities, persistNow, unreadEverywhere, selectChannel, selectServer,
  activeChannel, openDM, ensureDMChannelForUser, applyRemoteReaction, findMessage, editMessage,
  deleteMessage, networkKeyFor, addMessage, setMessageAttachment,
  touchMember, canModerateChannel, canPostInChannel, currentPlan,
} from './store.js';
import { initShared, flushPending, applyPendingForServer, cardFor, publishAllNow } from './shared.js';
import { defaultAvatar, ensureWireAvatar } from './avatar.js';
import { readAccount, writeAccount, readClaims, claimHandle, isClaimedLocally } from './account.js';
import { showLock, startNetworkForLock, setUnlockHandler } from './views/lock.js';
import { setSessionPassword, sessionPassword } from './session.js';
import { saveVaultToCloud, ingestVaultPacket, localVault } from './vault.js';
import { bus } from './bus.js';
import { net } from './net.js';
import { initShell, goToChannel, goToServer, toggleMembers } from './views/shell.js';
import { initMessages, openChannelView, scrollToMessage } from './views/messages.js';
import { initComposer, focusComposer } from './views/composer.js';
import { initOnboarding } from './views/onboarding.js';
import { CONFIG } from './config.js';
import { openSettings, openSearch } from './views/modals.js';
import { toast } from './ui/toast.js';
import { closeAllModals, isModalOpen } from './ui/modal.js';
import { startSim, stopSim, simulateReply } from './sim.js';
import { storage } from './util.js';
import { useAccountNamespace, snapshotState } from './store.js';

const joinedToasts = new Set();
let started = false;

/* --------------------------------- boot ---------------------------------- */

function applySettings() {
  const root = document.documentElement;
  root.dataset.theme = state.settings.theme || 'dark';
  root.dataset.accent = state.settings.accent || 'blurple';
  root.dataset.compact = String(Boolean(state.settings.compact));
  root.dataset.timestamps = String(state.settings.timestamps !== false);
  root.dataset.motion = state.settings.reduceMotion ? 'reduced' : 'full';
  document.body?.classList.toggle('compact', Boolean(state.settings.compact));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', state.settings.theme === 'light' ? '#ffffff' : state.settings.theme === 'midnight' ? '#141726' : '#1e1f22');
}

async function boot() {
  const bootScreen = document.getElementById('bootScreen');
  applySettings();
  const restored = load();

  bus.on('toast', ({ message, kind, action }) => toast(message, kind, { action }));

  // never leave someone staring at a dead screen: surface unexpected errors gently
  window.addEventListener('error', (event) => {
    if (event?.message && /Script error\./.test(event.message)) return;
    console.error('[TalkingApp]', event?.error || event?.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[TalkingApp] unhandled', event.reason);
  });

  // browsers only allow audio after a gesture — unlock on the first interaction
  const unlockAudio = () => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume().catch(() => {});
    } catch {}
    window.removeEventListener('pointerdown', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
  window.addEventListener('beforeunload', () => flush());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });

  const account = readAccount();
  const legacy = storage.get('ta.state.v2', null);
  document.getElementById('bootScreen')?.classList.add('hidden');

  wireAccountNetwork();
  initShared();
  setUnlockHandler(() => enterFromLock());

  if (account) {
    useAccountNamespace(account.handle);
    startNetworkForLock();
    showLock({ nextMode: 'unlock' });
  } else if (legacy?.self) {
    // an account from before passwords existed — keep the data, add the lock
    startNetworkForLock();
    showLock({ nextMode: 'secure' });
  } else {
    document.getElementById('onboarding')?.classList.remove('hidden');
    initOnboarding({ onDone: () => startApp() });
    startNetworkForLock();
  }

  setTimeout(() => {
    bootScreen?.setAttribute('data-leaving', 'true');
    setTimeout(() => bootScreen?.classList.add('hidden'), 420);
  }, restored ? 240 : 120);
}

/** Called once the lock screen has verified the password and loaded state. */
function enterFromLock() {
  document.getElementById('onboarding')?.classList.add('hidden');
  document.getElementById('lockScreen')?.classList.add('hidden');
  document.body.classList.remove('locked');
  queueMicrotask(() => startApp());
}

/* -------------------------------- start app ------------------------------- */

async function startApp() {
  if (started) return;
  started = true;

  document.getElementById('app')?.classList.remove('hidden');
  document.getElementById('onboarding')?.classList.add('hidden');

  if (!state.ui.activeServerId) {
    const first = Object.keys(state.servers)[0];
    if (first) state.ui.activeServerId = first;
  }
  if (!state.ui.activeChannelId && state.ui.activeServerId && state.servers[state.ui.activeServerId]) {
    state.ui.activeChannelId = state.servers[state.ui.activeServerId].defaultChannelId;
  }
  state.ui.membersOpen = state.settings.showMembers !== false && !window.matchMedia('(max-width: 1060px)').matches;

  initShell();
  initMessages();
  initComposer();
  registerAllCommunities();
  applySettings();

  if (state.ui.activeChannelId) openChannelView(state.ui.activeChannelId);
  handleHash();

  startNetwork();
  if (state.settings.simulated) startSim();

  wireEvents();
  // The lock screen connects before the app is listening, so anything it already
  // heard (peers, presence) is replayed here — nobody is invisible on arrival.
  for (const peer of net.peers.values()) applyPeer(peer);
  flushPending();
  // tell everyone what our public servers look like, and re-send our history
  setTimeout(() => { if (net.status() === 'online') publishAllNow(); }, 1600);
  installShortcuts();
  handleInviteLink();
  updateTitle();
  setTimeout(() => focusComposer(), 500);

  // brand-new accounts land in their own server: offer the invite link right away
  if (window.__taOpenInviteAfterBoot) {
    const server = state.servers[window.__taOpenInviteAfterBoot];
    window.__taOpenInviteAfterBoot = null;
    if (server) {
      setTimeout(() => {
        toast(`“${server.name}” is ready — invite someone in`, 'ok', {
          duration: 9000,
          action: {
            label: 'Invite',
            onClick: async () => {
              const { openInvite } = await import('./views/modals.js');
              openInvite(server);
            },
          },
        });
      }, 900);
    }
  }
}

async function handleInviteLink() {
  const invite = CONFIG.invite;
  if (!invite?.key) return;
  const existing = Object.values(state.servers).find((s) => s.networkKey === invite.key);
  if (existing) {
    setTimeout(() => goToServer(existing.id), 700);
    return;
  }
  const { joinNetworkCommunity } = await import('./store.js');
  const res = joinNetworkCommunity({
    name: invite.name.replace(/-/g, ' '),
    key: invite.key,
    channels: ['general'],
    card: cardFor(invite.key),
  });
  if (res.ok) {
    const recovered = applyPendingForServer(invite.key);
    setTimeout(() => {
      goToServer(res.server.id);
      toast(`You joined ${res.server.name}${recovered ? ` — ${recovered} message${recovered === 1 ? '' : 's'} of history` : ''}`, 'party', { duration: 3200 });
      net.requestHistory({ serverKey: invite.key });
    }, 900);
  }
  // keep the URL clean so a refresh doesn't re-trigger the join
  const url = new URL(location.href);
  url.searchParams.delete('join');
  url.searchParams.delete('name');
  try { window.history.replaceState(null, '', url.pathname + url.search + location.hash); } catch {}
}

function startNetwork() {
  if (!state.self) return;
  const communities = Object.values(state.servers)
    .filter((s) => s.isPublic)
    .map((s) => ({
      key: s.networkKey,
      name: s.name,
      topic: s.desc,
      channels: s.channelIds.map((id) => state.channels[id]?.name).filter(Boolean),
    }));
  net.init({ profile: state.self, communities });
  net.start();
}

function refreshCommunities() {
  net.updateProfile(state.self, Object.values(state.servers)
    .filter((s) => s.isPublic)
    .map((s) => ({
      key: s.networkKey,
      name: s.name,
      topic: s.desc,
      channels: s.channelIds.map((id) => state.channels[id]?.name).filter(Boolean),
    })));
}

/* ------------------------------- net wiring ------------------------------- */

function communityKeyOf(channelId) {
  const ch = state.channels[channelId];
  if (!ch) return null;
  const s = state.servers[ch.serverId];
  return s ? s.networkKey : null;
}

function resolveIncomingChannel(p, { create = true } = {}) {
  const key = p.key;
  if (!key) return null;
  let server = Object.values(state.servers).find((s) => s.networkKey === key);
  if (!server) return null;
  const name = String(p.channel || 'general').toLowerCase();
  let ch = server.channelIds.map((id) => state.channels[id]).find((c) => c.name === name);
  if (!ch && create) {
    const res = createChannel(server.id, name, '');
    if (res.ok) ch = res.channel;
  }
  return ch || null;
}

/** Network handlers that must exist before the app is unlocked (vault, usernames). */
function wireAccountNetwork() {
  bus.on('net:vault', (p) => ingestVaultPacket(p));

  bus.on('net:vault-request', (p) => {
    const account = readAccount();
    if (!account || String(p.handle).toLowerCase() !== account.handle) return;
    const pw = sessionPassword();
    if (pw) saveVaultToCloud(pw).catch(() => {});
  });

  bus.on('net:handle-check', (p) => {
    const account = readAccount();
    if (!account) return;
    if (String(p.handle).toLowerCase() !== account.handle) return;
    net.publish({ kind: 'handle-taken', handle: account.handle, system: true }, { noDedupe: true });
  });
}

function wireEvents() {
  /* ---- outgoing ---- */
  bus.on('message:out', ({ channelId, message }) => {
    const ch = state.channels[channelId];
    if (!ch) return;
    if (ch.type === 'dm') {
      const peerUser = state.users[ch.dmUserId];
      if (peerUser) {
        const sent = net.sendDM({ to: ch.dmUserId, message });
        message.queued = !sent;
        if (message.attachment?.src) {
          net.sendMedia({ serverKey: '@dm', channel: '@dm', msgId: message.id, attachment: message.attachment, to: ch.dmUserId });
        }
        if (message.queued) bus.emit('message:updated', { channelId, message });
      }
      return;
    }
    const s = state.servers[ch.serverId];
    if (!s) return;
    const sent = net.sendChat({
      serverKey: s.networkKey,
      serverName: s.name,
      serverTopic: s.desc,
      channels: s.channelIds.map((id) => state.channels[id]?.name).filter(Boolean),
      channel: ch.name,
      message,
    });
    message.queued = !sent;
    if (message.attachment?.src) {
      net.sendMedia({ serverKey: s.networkKey, channel: ch.name, msgId: message.id, attachment: message.attachment });
    }
    if (message.queued) bus.emit('message:updated', { channelId, message });
  });

  bus.on('message:editOut', ({ channelId, message }) => {
    const ch = state.channels[channelId];
    if (!ch) return;
    if (ch.type === 'dm') net.sendEdit({ serverKey: '@dm', channel: '@dm', msgId: message.id, text: message.text, to: ch.dmUserId });
    else net.sendEdit({ serverKey: communityKeyOf(channelId), channel: ch.name, msgId: message.id, text: message.text });
  });

  bus.on('message:deleteOut', ({ channelId, messageId }) => {
    const ch = state.channels[channelId];
    if (!ch) return;
    if (ch.type === 'dm') net.sendDelete({ serverKey: '@dm', channel: '@dm', msgId: messageId, to: ch.dmUserId });
    else net.sendDelete({ serverKey: communityKeyOf(channelId), channel: ch.name, msgId: messageId });
  });

  bus.on('reaction:out', ({ channelId, message, emoji, op }) => {
    const ch = state.channels[channelId];
    if (!ch) return;
    if (ch.type === 'dm') net.sendReaction({ serverKey: '@dm', channel: '@dm', msgId: message.id, emoji, op, to: ch.dmUserId });
    else net.sendReaction({ serverKey: communityKeyOf(channelId), channel: ch.name, msgId: message.id, emoji, op });
  });

  bus.on('composer:typing', ({ channelId }) => {
    const ch = state.channels[channelId];
    if (!ch) return;
    if (ch.type === 'dm') return;
    const s = state.servers[ch.serverId];
    if (!s) return;
    net.sendTyping({ serverKey: s.networkKey, channel: ch.name });
  });

  bus.on('composer:sent', ({ channelId }) => {
    const ch = state.channels[channelId];
    if (!ch || ch.type === 'dm') return;
    if (state.settings.simulated) simulateReply(channelId, state.messages[channelId]?.at(-1)?.text || '');
  });

  bus.on('servers:changed', refreshCommunities);
  bus.on('server:updated', refreshCommunities);
  bus.on('channels:changed', refreshCommunities);

  // keep the encrypted cloud copy reasonably fresh
  for (const evt of ['servers:changed', 'server:updated', 'channels:changed', 'dms:changed', 'settings:changed', 'identity:created']) {
    bus.on(evt, queueVaultSave);
  }
  setInterval(() => { if (vaultDirty) pushVault(); }, 45_000);
  bus.on('message:new', () => { if (document.visibilityState === 'visible') queueVaultSave(); });
  bus.on('self:changed', async () => {
    if (state.self?.avatar?.kind === 'image' && !state.self.avatar.wire) {
      state.self.avatar = await ensureWireAvatar(state.self.avatar);
      persistNow();
    }
    net.updateProfile(state.self);
    document.dispatchEvent(new CustomEvent('ta:self-changed'));
    queueVaultSave();
  });

  /* ---- incoming ---- */
  // the network layer re-emits envelopes as net:<kind>; connect them to the handlers below
  bus.on('net:peer', ({ peer }) => applyPeer(peer));
  bus.on('net:join', ({ peer }) => applyPeer(peer));
  bus.on('net:leave', ({ userId }) => {
    removePeer(userId);
    delete state.presence[userId];
    removeTypingFor(userId);
    bus.emit('presence:changed');
  });
  bus.on('net:tick', expireTyping);
  bus.on('net:presence', ({ peer }) => applyPeer(peer));

  bus.on('net:chat', (p) => {
    const ch = resolveIncomingChannel(p);
    const from = p.from;
    state.users[from.id] = { ...(state.users[from.id] || {}), ...from };
    if (!ch) {
      noteRemoteCommunity({ key: p.key, name: p.serverName, topic: p.serverTopic, channels: [p.channel], peerId: from.id });
      promptJoin(p);
      return;
    }
    if (ch.id === state.ui.activeChannelId && !document.hidden) markRead(ch.id);
    const msg = makeMessage({
      channelId: ch.id,
      userId: from.id,
      displayName: from.displayName,
      handle: from.handle,
      avatar: from.avatar || defaultAvatar(from.displayName),
      accentColor: from.accentColor,
      text: p.text,
      ts: p.msgTs || p.ts,
      replyTo: null,
      network: true,
    });
    msg.id = p.msgId || msg.id;
    if (p.replyTo) {
      msg.replyToName = p.replyTo.name;
      msg.replyToText = p.replyTo.text;
    }
    if (p.att) {
      msg.attachmentPending = true;
      msg.attachmentMeta = p.att;
      // the picture itself arrives in a moment, in chunks
      setTimeout(() => { if (msg.attachmentPending) msg.attachmentPending = false; }, 12000);
    }
    receiveMessage({ channelId: ch.id, msg });
    if (ch.serverId) touchMember(ch.serverId, from);
    notifyIncoming(ch, msg);
  });

  bus.on('net:dm', (p) => {
    if (p.to !== state.self?.id) return;
    const from = p.from;
    const user = { ...from, id: from.id };
    state.users[from.id] = { ...(state.users[from.id] || {}), ...user };
    const ch = ensureDMChannelForUser({ id: from.id, displayName: from.displayName, handle: from.handle });
    ch.name = from.displayName;
    const msg = makeMessage({
      channelId: ch.id,
      userId: from.id,
      displayName: from.displayName,
      handle: from.handle,
      avatar: from.avatar || defaultAvatar(from.displayName),
      accentColor: from.accentColor,
      text: p.text,
      ts: p.msgTs || p.ts,
      network: true,
    });
    msg.id = p.msgId || msg.id;
    if (p.att) {
      msg.attachmentPending = true;
      msg.attachmentMeta = p.att;
      setTimeout(() => { if (msg.attachmentPending) msg.attachmentPending = false; }, 12000);
    }
    receiveMessage({ channelId: ch.id, msg });
    bus.emit('dms:changed');
    if (ch.id === state.ui.activeChannelId && !document.hidden) markRead(ch.id);
    notifyIncoming(ch, msg);
  });

  /* ---- pictures & GIFs (arrive in chunks) ---- */
  const mediaInbox = new Map();
  const receiveMedia = (p) => {
    if (!p?.msgId || p.part == null) return;
    const entry = mediaInbox.get(p.msgId) || { parts: new Map(), total: p.total, meta: p.meta || {} };
    entry.total = p.total || entry.total;
    entry.meta = { ...entry.meta, ...(p.meta || {}) };
    entry.parts.set(Number(p.part), p.data || '');
    mediaInbox.set(p.msgId, entry);
    if (entry.parts.size < entry.total) return;
    let data = '';
    for (let i = 0; i < entry.total; i++) {
      const piece = entry.parts.get(i);
      if (piece == null) return;            // still missing a chunk
      data += piece;
    }
    mediaInbox.delete(p.msgId);
    landMedia(p.msgId, { ...entry.meta, src: data, bytes: data.length }, 0);
  };
  const landMedia = (msgId, attachment, attempt) => {
    const m = findMessage(msgId);
    if (!m) {
      if (attempt < 6) setTimeout(() => landMedia(msgId, attachment, attempt + 1), 700);
      return;
    }
    setMessageAttachment(m.channelId, msgId, attachment);
  };

  bus.on('net:media', receiveMedia);
  bus.on('net:media-dm', (p) => {
    if (p.to && p.to !== state.self?.id) return;
    receiveMedia(p);
  });

  /* ---- lightweight history sync ---- */
  bus.on('community:joined', ({ server }) => {
    if (!server) return;
    setTimeout(() => net.requestHistory({ serverKey: server.networkKey }), 900);
  });

  bus.on('net:sync', (p) => {
    if (!p.key) return;
    const server = Object.values(state.servers).find((s) => s.networkKey === p.key);
    if (!server) return;
    const entriesFor = (ch) => (state.messages[ch.id] || [])
      .filter((m) => !m.system && !m.queued)
      .slice(-20)
      .map((m) => ({ id: m.id, userId: m.userId, displayName: m.displayName, handle: m.handle, avatar: m.avatar?.kind === 'image' ? null : m.avatar, text: m.text, ts: m.ts }));
    const channels = server.channelIds.map((id) => state.channels[id]).filter(Boolean);
    const total = channels.reduce((n, ch) => n + (state.messages[ch.id]?.length || 0), 0);
    if (!total) return;
    // stagger the replies a little so several peers answering at once stay gentle
    channels.forEach((ch, i) => {
      const entries = entriesFor(ch);
      if (!entries.length) return;
      setTimeout(() => net.sendHistory({ serverKey: server.networkKey, channel: ch.name, entries, to: p.from.id }), 120 * i);
    });
  });

  bus.on('net:history', (p) => {
    if (p.to && p.to !== state.self?.id) return;
    const server = Object.values(state.servers).find((s) => s.networkKey === p.key);
    if (!server) return;
    const ch = resolveIncomingChannel(p, { create: true });
    if (!ch) return;
    let added = 0;
    for (const entry of p.entries || []) {
      if (!entry?.id || !entry.text) continue;
      const exists = (state.messages[ch.id] || []).some((m) => m.id === entry.id);
      if (exists) continue;
      const msg = makeMessage({
        channelId: ch.id,
        userId: entry.userId,
        displayName: entry.displayName,
        handle: entry.handle,
        avatar: entry.avatar || defaultAvatar(entry.displayName),
        text: entry.text,
        ts: entry.ts,
        network: true,
      });
      msg.id = entry.id;
      (state.messages[ch.id] ||= []).push(msg);
      added++;
    }
    if (added) {
      state.messages[ch.id].sort((x, y) => x.ts - y.ts);
      persistNow();
      if (ch.id === state.ui.activeChannelId) openChannelView(ch.id);
      else bus.emit('reads:changed', ch.id);
      bus.emit('messages:synced', { channelId: ch.id });
    }
  });

  bus.on('net:typing', (p) => {
    if (!state.settings.showTyping) return;
    const ch = resolveIncomingChannel(p, { create: false });
    if (!ch) return;
    if (p.from.id === state.self?.id) return;
    setTyping(ch.id, p.from.id, p.from.displayName);
  });

  bus.on('net:reaction', (p) => {
    if (p.to && p.to !== state.self?.id) return;
    let ch = null;
    if (p.key === '@dm') {
      const m = findMessage(p.msgId);
      if (m) ch = state.channels[m.channelId];
    } else {
      ch = resolveIncomingChannel(p, { create: false });
    }
    if (!ch) return;
    applyRemoteReaction({ channelId: ch.id, msgId: p.msgId, emoji: p.emoji, op: p.op, userId: p.from.id });
  });

  bus.on('net:edit', (p) => {
    if (p.to && p.to !== state.self?.id) return;
    const m = p.key === '@dm' ? findMessage(p.msgId) : (resolveIncomingChannel(p, { create: false }) ? findMessage(p.msgId, resolveIncomingChannel(p, { create: false }).id) : null);
    if (!m) return;
    // An edit is only honoured from the person who wrote the message, or from
    // the owner of the server it lives in. Nobody else can rewrite history.
    if (!mayRewrite(m, p)) return;
    editMessage(m.channelId, m.id, p.text, { broadcast: false });
  });

  bus.on('net:delete', (p) => {
    if (p.to && p.to !== state.self?.id) return;
    const ch = p.key === '@dm'
      ? (() => { const m = findMessage(p.msgId); return m ? state.channels[m.channelId] : null; })()
      : resolveIncomingChannel(p, { create: false });
    if (!ch) return;
    const m = findMessage(p.msgId, ch.id);
    if (!m) return;
    if (!mayRewrite(m, p)) return;
    deleteMessage(ch.id, p.msgId, { broadcast: false });
  });

  bus.on('net:status', ({ status, transports, peers }) => {
    if (status === 'online' && started && sessionPassword()) queueVaultSave();
    const prev = state.ui.connection;
    state.ui.connection = status;
    bus.emit('connection:changed', { status, transports, peers });
    if (prev !== status && status === 'online' && prev !== 'connecting' && started) {
      toast('Network reconnected', 'ok', { duration: 1800 });
    }
    if (status === 'offline' && prev === 'online') {
      toast('Lost connection — retrying in the background', 'warn', { duration: 4000 });
    }
  });


  bus.on('settings:changed', ({ key } = {}) => {
    applySettings();
    // a plan change is part of who you are: let everyone see the new badge
    if (key === 'plan' && state.self) {
      state.self.plan = state.settings.plan;
      net.updateProfile(state.self);
      persistNow();
    }
    if (key === 'desktopNotifs' && state.settings.desktopNotifs && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  });
  bus.on('channel:unread', () => updateTitle());

  document.addEventListener('ta:reconnect', () => {
    net.stop();
    setTimeout(() => { startNetwork(); toast('Reconnecting…', 'info', { duration: 1500 }); }, 250);
  });
  document.addEventListener('ta:sim-toggle', (e) => {
    if (e.detail?.on) startSim(); else stopSim();
  });
  document.addEventListener('ta:test-notification', () => {
    playPop();
    showNotification('TalkingApp', 'This is what a notification looks like.');
    toast('Test notification sent', 'ok');
  });
  document.addEventListener('ta:new-account', () => {
    document.getElementById('app')?.classList.add('hidden');
    const ob = document.getElementById('onboarding');
    ob?.classList.remove('hidden');
    if (!window.__taOnboardingReady) {
      window.__taOnboardingReady = true;
      initOnboarding({ onDone: () => startApp() });
    }
    document.getElementById('signupForm')?.scrollIntoView({ block: 'center' });
  });

  document.addEventListener('ta:lock', () => {
    flush();
    location.reload();
  });
  document.addEventListener('ta:theme-changed', () => applySettings());
  document.addEventListener('ta:settings-applied', () => applySettings());
  document.addEventListener('ta:edit-profile', () => openSettings('account'));

  window.addEventListener('hashchange', handleHash);
  setInterval(updateTitle, 4000);
}

/* ------------------------------ cloud autosave ---------------------------- */

let vaultTimer = null;
let vaultDirty = false;

function queueVaultSave() {
  if (!sessionPassword()) return;
  vaultDirty = true;
  clearTimeout(vaultTimer);
  vaultTimer = setTimeout(pushVault, 6500);
}

async function pushVault() {
  if (!vaultDirty || !sessionPassword()) return;
  if (net.status() !== 'online') { queueVaultSave(); return; }
  vaultDirty = false;
  try {
    await saveVaultToCloud(sessionPassword());
    bus.emit('vault:state', { state: 'saved', at: Date.now() });
  } catch (err) {
    vaultDirty = true;
    bus.emit('vault:state', { state: 'error', message: err.message });
  }
}

function clearQueuedFlags() {
  let cleared = 0;
  for (const [channelId, list] of Object.entries(state.messages)) {
    for (const m of list) {
      if (m.queued) {
        m.queued = false;
        cleared++;
        bus.emit('message:updated', { channelId, message: m });
      }
    }
  }
  if (cleared) persistNow();
}

function applyPeer(peer) {
  if (!peer?.user?.id) return;
  const u = peer.user;
  if (u.id === state.self?.id) return;
  state.users[u.id] = { ...(state.users[u.id] || {}), ...u, simulated: false };
  state.presence[u.id] = peer.status || 'online';
  upsertPeer({
    id: u.id,
    user: state.users[u.id],
    status: peer.status || 'online',
    communities: (peer.communities || []).map((c) => (typeof c === 'string' ? c : c?.key)).filter(Boolean),
    lastSeen: Date.now(),
    transport: peer.transport,
  });
  for (const c of peer.communities || []) {
    if (typeof c === 'string') {
      noteRemoteCommunity({ key: c, name: c, channels: [], peerId: u.id });
      const srv = Object.values(state.servers).find((x) => x.networkKey === c);
      if (srv) touchMember(srv.id, u);
    } else if (c?.key) {
      noteRemoteCommunity({ key: c.key, name: c.name, topic: c.topic, channels: c.channels, peerId: u.id });
      const srv = Object.values(state.servers).find((x) => x.networkKey === c.key);
      if (srv) touchMember(srv.id, u);
    }
  }
  bus.emit('presence:changed');
  bus.emit('net:presence-applied');
}

/** Only the author or the server owner may edit or delete a message remotely. */
function mayRewrite(message, packet) {
  const fromId = packet?.from?.id;
  if (!message || !fromId) return false;
  if (message.userId === fromId) return true;
  const ch = state.channels[message.channelId];
  const server = ch?.serverId ? state.servers[ch.serverId] : null;
  return Boolean(server?.ownerId && server.ownerId === fromId);
}

function expireTyping() {
  const now = Date.now();
  for (const [cid, map] of Object.entries(state.typing)) {
    for (const [uid, v] of Object.entries(map)) {
      if (v.until <= now) {
        delete map[uid];
        bus.emit('typing:changed', cid);
      }
    }
  }
}

function removeTypingFor(userId) {
  for (const [cid, map] of Object.entries(state.typing)) {
    if (map[userId]) {
      delete map[userId];
      bus.emit('typing:changed', cid);
    }
  }
}

function promptJoin(p) {
  const key = p.key;
  if (!key || joinedToasts.has(key)) return;
  joinedToasts.add(key);
  const name = p.serverName || key;
  const community = state.network[key];
  toast(`${p.from.displayName} is talking in “${name}”`, 'info', {
    duration: 7000,
    action: {
      label: 'Join',
      onClick: () => {
        import('./store.js').then(({ joinNetworkCommunity }) => {
          const res = joinNetworkCommunity({ name, key, topic: community?.topic, channels: [...(community?.channels || [])] });
          if (res.ok) {
            goToServer(res.server.id);
            toast(`Joined ${res.server.name}`, 'party');
          }
        });
      },
    },
  });
}

/* -------------------------------- notices -------------------------------- */

function notifyIncoming(ch, msg) {
  if (!msg || msg.isSelf) return;
  const server = ch.serverId ? state.servers[ch.serverId] : null;
  const level = ch.type === 'dm' ? 'all' : (server?.notify || 'all');
  const isActive = ch.id === state.ui.activeChannelId && !document.hidden;
  const mentioned = new RegExp(`@${state.self?.handle}\\b`, 'i').test(msg.text || '') || /@everyone\b/i.test(msg.text || '');
  if (level === 'none') { updateTitle(); return; }
  const wantsSound = level === 'all' || mentioned || ch.type === 'dm';
  if (!isActive && state.settings.sounds && wantsSound) playPop();
  if (!isActive && mentioned) {
    const where = ch.type === 'dm' ? 'a direct message' : `#${ch.name}`;
    toast(`${msg.displayName} mentioned you in ${where}`, 'info', {
      duration: 6000,
      action: { label: 'Jump', onClick: () => goToChannel(ch.id) },
    });
  }
  if (document.hidden) {
    const label = ch.type === 'dm' ? msg.displayName : `#${ch.name} · ${msg.displayName}`;
    const wantsDesktop = level === 'all' ? (state.settings.desktopNotifs || mentioned) : mentioned;
    if (mentioned || ch.type === 'dm' || wantsDesktop) {
      showNotification(label, msg.text.slice(0, 120) || 'New message');
      updateTitle(true);
    }
  } else if (!isActive) {
    updateTitle(true);
  }
  updateTitle();
}

function showNotification(title, body) {
  if (!state.settings.desktopNotifs) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: 'assets/img/favicon.svg', silent: true, tag: 'talkingapp' });
  } catch {}
}

let audioCtx = null;
function playPop() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + 0.09);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.11, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.22);
  } catch {}
}

function updateTitle(flash = false) {
  const base = 'TalkingApp';
  const unread = unreadEverywhere();
  document.title = unread ? `(${unread > 99 ? '99+' : unread}) ${base}` : flash ? `• ${base}` : base;
}

/* -------------------------------- routing -------------------------------- */

function handleHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (!hash) return;
  const parts = hash.split('/');
  if (parts[0] === 'channel' && parts[1]) {
    const ch = state.channels[parts[1]];
    if (ch) {
      selectChannel(ch.id);
      openChannelView(ch.id);
      if (parts[2]) setTimeout(() => scrollToMessage(parts[2]), 320);
    }
  } else if (parts[0] === 'server' && parts[1] && state.servers[parts[1]]) {
    goToServer(parts[1]);
  }
}

/* ------------------------------ shortcuts -------------------------------- */

function installShortcuts() {
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
      return;
    }
    if (meta && e.key === ',') {
      e.preventDefault();
      openSettings();
      return;
    }
    if (meta && e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      toggleMembers(!state.ui.membersOpen);
      return;
    }
    if (meta && e.shiftKey && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      const s = Object.values(state.servers)[0];
      const ch = s?.channelIds.map((id) => state.channels[id]).find((c) => c?.name === 'general');
      if (ch) goToChannel(ch.id);
      return;
    }
    if (e.key === 'Escape' && !isModalOpen() && !e.target.closest('.menu, .popover')) {
      closeAllModals();
      if (state.ui.replyTo || state.ui.editingId) {
        state.ui.replyTo = null;
        document.dispatchEvent(new CustomEvent('ta:escape'));
      }
    }
  });
}

/* -------------------------------- listeners ------------------------------- */

/** Channels can look empty on a fresh device until someone replays history. */
const historyRequested = new Map();
function askForHistoryIfQuiet(ch) {
  if (!ch || !ch.serverId) return;
  const server = state.servers[ch.serverId];
  if (!server) return;
  const visible = (state.messages[ch.id] || []).filter((m) => !m.system).length;
  if (visible > 1) return;
  const last = historyRequested.get(ch.id) || 0;
  if (Date.now() - last < 15000) return;
  historyRequested.set(ch.id, Date.now());
  net.requestHistory({ serverKey: server.networkKey });
}

bus.on('active:changed', () => {
  const ch = activeChannel();
  openChannelView(ch ? ch.id : null);
  if (ch && net.status() === 'online') setTimeout(() => askForHistoryIfQuiet(ch), 700);
  if (ch) {
    try { window.history.replaceState(null, '', `#/channel/${ch.id}`); } catch {}
    if (window.matchMedia('(max-width: 860px)').matches) {
      document.getElementById('messagesScroll')?.scrollTo({ top: 0 });
    }
  } else {
    try { window.history.replaceState(null, '', location.pathname); } catch {}
  }
  updateTitle();
});

bus.on('servers:changed', updateTitle);
bus.on('message:new', updateTitle);

// keep the rail home "unread" state fresh
setInterval(() => { if (started) updateTitle(); }, 8000);

/* --------------------------- debug handle (dev) --------------------------- */
window.__ta = {
  state, net, bus, config: CONFIG,
  addMessage, makeMessage, receiveMessage, selectChannel, selectServer, persistNow,
  revealChannel: (id) => selectChannel(id),
};

/* ------------------------------- kick off -------------------------------- */

boot().catch((err) => {
  console.error('[TalkingApp] boot failed', err);
  document.getElementById('bootScreen')?.setAttribute('data-leaving', 'true');
});
