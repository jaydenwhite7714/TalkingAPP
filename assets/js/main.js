// TalkingApp — bootstrap and wiring
import {
  state, load, save, flush, createChannel, noteRemoteCommunity, removePeer, upsertPeer,
  receiveMessage, makeMessage, setPresence, setTyping, markRead, toast as storeToast,
  registerAllCommunities, persistNow, unreadEverywhere, selectChannel, selectServer,
  activeChannel, openDM, ensureDMChannelForUser, applyRemoteReaction, findMessage, editMessage,
  deleteMessage, networkKeyFor, addMessage,
} from './store.js';
import { defaultAvatar } from './avatar.js';
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
  window.addEventListener('beforeunload', () => flush());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });

  if (restored && state.self) {
    await startApp();
  } else {
    document.getElementById('bootScreen')?.classList.add('hidden');
    document.getElementById('onboarding')?.classList.remove('hidden');
    initOnboarding({ onDone: () => startApp() });
    // connect early so the "live network" pill on the hero is truthful
    const pendingProfile = storageProfile();
    if (pendingProfile) {
      net.init({ profile: pendingProfile, communities: [] });
      net.start();
    }
  }

  setTimeout(() => {
    bootScreen?.setAttribute('data-leaving', 'true');
    setTimeout(() => bootScreen?.classList.add('hidden'), 420);
  }, restored ? 240 : 120);
}

function storageProfile() {
  try {
    const raw = localStorage.getItem('ta.state.v2');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.self?.id) return null;
    return parsed.self;
  } catch { return null; }
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
  installShortcuts();
  handleInviteLink();
  updateTitle();
  setTimeout(() => focusComposer(), 500);
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
  const res = joinNetworkCommunity({ name: invite.name.replace(/-/g, ' '), key: invite.key, channels: ['general'] });
  if (res.ok) {
    setTimeout(() => {
      goToServer(res.server.id);
      toast(`You joined ${res.server.name}`, 'party', { duration: 3200 });
      net.requestHistory({ serverKey: invite.key });
    }, 900);
  }
  // keep the URL clean so a refresh doesn't re-trigger the join
  const url = new URL(location.href);
  url.searchParams.delete('join');
  url.searchParams.delete('name');
  history.replaceState(null, '', url.pathname + url.search + location.hash);
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
  bus.on('self:changed', () => {
    net.updateProfile(state.self);
    document.dispatchEvent(new CustomEvent('ta:self-changed'));
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
    if (!state.users[from.id]) state.users[from.id] = from;
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
    receiveMessage({ channelId: ch.id, msg });
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
    receiveMessage({ channelId: ch.id, msg });
    bus.emit('dms:changed');
    if (ch.id === state.ui.activeChannelId && !document.hidden) markRead(ch.id);
    notifyIncoming(ch, msg);
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
    m.text = p.text;
    m.editedTs = p.ts;
    persistNow();
    bus.emit('message:updated', { channelId: m.channelId, message: m });
  });

  bus.on('net:delete', (p) => {
    if (p.to && p.to !== state.self?.id) return;
    const m = p.key === '@dm' ? findMessage(p.msgId) : null;
    const ch = m ? state.channels[m.channelId] : (p.key !== '@dm' ? resolveIncomingChannel(p, { create: false }) : null);
    if (!ch) return;
    deleteMessage(ch.id, p.msgId);
  });

  bus.on('net:status', ({ status, transports, peers }) => {
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


  bus.on('settings:changed', ({ key }) => {
    applySettings();
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
  document.addEventListener('ta:theme-changed', () => applySettings());
  document.addEventListener('ta:settings-applied', () => applySettings());
  document.addEventListener('ta:edit-profile', () => openSettings('account'));

  window.addEventListener('hashchange', handleHash);
  setInterval(updateTitle, 4000);
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
    } else if (c?.key) {
      noteRemoteCommunity({ key: c.key, name: c.name, topic: c.topic, channels: c.channels, peerId: u.id });
    }
  }
  bus.emit('presence:changed');
  bus.emit('net:presence-applied');
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
  const isActive = ch.id === state.ui.activeChannelId && !document.hidden;
  const mentioned = new RegExp(`@${state.self?.handle}\\b`, 'i').test(msg.text || '') || /@everyone\b/i.test(msg.text || '');
  if (!isActive && state.settings.sounds) playPop();
  if (!isActive && mentioned) {
    const where = ch.type === 'dm' ? 'a direct message' : `#${ch.name}`;
    toast(`${msg.displayName} mentioned you in ${where}`, 'info', {
      duration: 6000,
      action: { label: 'Jump', onClick: () => goToChannel(ch.id) },
    });
  }
  if (document.hidden) {
    const label = ch.type === 'dm' ? msg.displayName : `#${ch.name} · ${msg.displayName}`;
    if (mentioned || ch.type === 'dm' || state.settings.desktopNotifs) {
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

bus.on('active:changed', () => {
  const ch = activeChannel();
  if (ch) {
    openChannelView(ch.id);
    history.replaceState(null, '', `#/channel/${ch.id}`);
    if (window.matchMedia('(max-width: 860px)').matches) {
      document.getElementById('messagesScroll')?.scrollTo({ top: 0 });
    }
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
