// TalkingApp — application state, persistence and mutations
import { bus } from './bus.js';
import { storage, uid, randId, debounce, validateHandle, validateDisplayName, validateServerName, validateChannelName, colorFromString } from './util.js';
import { defaultAvatar, AVATAR_COLORS } from './avatar.js';

export const STORAGE_KEY = 'ta.state.v2';
export const PROFILE_KEY = 'ta.profile';
const MAX_MSGS = 120;

const DEFAULT_SETTINGS = {
  theme: 'dark',
  accent: 'blurple',
  compact: false,
  showMembers: true,
  sounds: true,
  desktopNotifs: false,
  timestamps: true,
  enterToSend: true,
  reduceMotion: false,
  showTyping: true,
  simulated: false,
  onboardingSeen: false,
};

/* --------------------------------- state --------------------------------- */

export const state = {
  ready: false,
  self: null,
  users: {},        // id -> public profile
  servers: {},      // id -> server
  channels: {},     // id -> channel
  messages: {},     // channelId -> message[]
  reads: {},        // channelId -> ts
  typing: {},       // channelId -> { userId: {name, until} }
  presence: {},     // userId -> 'online'|'idle'|'dnd'|'offline'
  network: {},      // networkKey -> { key, name, topic, peers:Set(ids), channels:Set }
  peers: {},        // peerId -> { id, user, status, communities }
  settings: { ...DEFAULT_SETTINGS },
  ui: {
    activeServerId: null,
    activeChannelId: null,
    lastChannelByServer: {},
    membersOpen: true,
    sidebarOpen: false,
    replyTo: null,
    editingId: null,
    searchOpen: false,
    connection: 'connecting', // connecting | online | offline
    exploreOpen: false,
    unreadNetwork: {},
    drafts: {},
  },
  dmChannels: {},   // userId -> channelId
  blocked: {},
  typingUsers: {},
};

/* ------------------------------- persistence ------------------------------ */

const persist = debounce(save, 500);

export function save() {
  if (!state.self) return;
  const messages = {};
  for (const [cid, list] of Object.entries(state.messages)) {
    const msgs = list.filter((m) => !m.pending);
    if (!msgs.length) continue;
    messages[cid] = msgs.slice(-MAX_MSGS).map((m) => ({
      ...m,
      avatar: m.avatar?.kind === 'image' && m.avatar.src?.length > 90000 ? defaultAvatar(m.displayName) : m.avatar,
    }));
  }
  const self = { ...state.self };
  const payload = {
    v: 2,
    self,
    users: Object.fromEntries(Object.entries(state.users).filter(([id]) => id !== self.id).slice(0, 200)),
    servers: state.servers,
    channels: state.channels,
    messages,
    reads: state.reads,
    dmChannels: state.dmChannels,
    settings: state.settings,
    blocked: state.blocked,
    ui: { activeServerId: state.ui.activeServerId, activeChannelId: state.ui.activeChannelId, lastChannelByServer: state.ui.lastChannelByServer },
    savedAt: Date.now(),
  };
  const ok = storage.set(STORAGE_KEY, payload);
  if (!ok) {
    // most likely quota — trim the heaviest part and retry once
    payload.messages = Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, v.slice(-30)]));
    storage.set(STORAGE_KEY, payload);
  }
  storage.set(PROFILE_KEY, self);
}

/** Persist immediately (used before unload). */
export function flush() {
  persist.cancel();
  save();
}

/* --------------------------------- events -------------------------------- */

export function toast(message, kind = 'info', opts = {}) {
  bus.emit('toast', { message, kind, ...opts });
}

/* --------------------------------- boot ---------------------------------- */

export function load() {
  const saved = storage.get(STORAGE_KEY, null);
  if (!saved || !saved.self?.id) return false;

  state.self = normalizeSelf(saved.self);
  state.servers = saved.servers || {};
  state.channels = saved.channels || {};
  state.messages = saved.messages || {};
  state.reads = saved.reads || {};
  state.dmChannels = saved.dmChannels || {};
  state.blocked = saved.blocked || {};
  state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
  state.users = saved.users || {};
  state.users[state.self.id] = state.self;

  // hydrate server/channel integrity
  for (const s of Object.values(state.servers)) {
    s.channelIds = (s.channelIds || []).filter((id) => state.channels[id]);
    if (!s.channelIds.length) {
      const ch = createChannelRecord(s.id, 'general', 'Say hello — this is where it all starts.');
      state.channels[ch.id] = ch;
      s.channelIds.push(ch.id);
    }
    s.defaultChannelId = s.channelIds.includes(s.defaultChannelId) ? s.defaultChannelId : s.channelIds[0];
    s.networkKey = s.networkKey || networkKeyFor(s.name);
  }
  state.ui.activeServerId = state.servers[saved.ui?.activeServerId] ? saved.ui.activeServerId : null;
  state.ui.activeChannelId = state.channels[saved.ui?.activeChannelId] ? saved.ui.activeChannelId : null;
  state.ui.lastChannelByServer = saved.ui?.lastChannelByServer || {};
  state.ui.membersOpen = state.settings.showMembers;

  if (!state.ui.activeServerId) {
    const first = firstServerId();
    if (first) state.ui.activeServerId = first;
  }
  if (!state.ui.activeChannelId && state.ui.activeServerId) {
    state.ui.activeChannelId = state.servers[state.ui.activeServerId].defaultChannelId;
  }

  for (const m of Object.values(state.messages)) {
    for (const msg of m) if (msg.pending) msg.pending = false;
  }

  state.ready = true;
  return true;
}

function normalizeSelf(self) {
  return {
    id: self.id || uid(10),
    displayName: self.displayName || 'You',
    handle: (self.handle || 'you').toLowerCase(),
    avatar: self.avatar || defaultAvatar(self.displayName),
    accentColor: self.accentColor || AVATAR_COLORS[0],
    bio: self.bio || '',
    status: self.status || 'online',
    createdAt: self.createdAt || Date.now(),
    isSelf: true,
  };
}

let channelSeq = 0;
function createChannelRecord(serverId, name, topic = '', type = 'text') {
  return {
    id: `ch_${randId(10)}`,
    serverId,
    name,
    topic,
    type,
    createdAt: Date.now(),
    position: channelSeq++,
  };
}

export function networkKeyFor(name = '') {
  return String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'server';
}

/* -------------------------------- identity ------------------------------- */

export function createProfile({ displayName, handle, avatar, accentColor }) {
  const nameRes = validateDisplayName(displayName);
  if (!nameRes.ok) return { ok: false, error: nameRes.error };
  const handleRes = validateHandle(handle);
  if (!handleRes.ok) return { ok: false, error: handleRes.error };

  const self = {
    id: `u_${randId(12)}`,
    displayName: nameRes.value,
    handle: handleRes.value,
    avatar: avatar || defaultAvatar(nameRes.value, accentColor || AVATAR_COLORS[0]),
    accentColor: accentColor || AVATAR_COLORS[0],
    bio: '',
    status: 'online',
    createdAt: Date.now(),
    isSelf: true,
  };
  state.self = self;
  state.users[self.id] = self;
  state.settings = { ...DEFAULT_SETTINGS, theme: state.settings.theme, accent: state.settings.accent };

  bootstrapServers();
  persistNow();
  state.ready = true;
  bus.emit('identity:created', self);
  return { ok: true, self };
}

export function updateSelf(patch) {
  if (!state.self) return;
  if (patch.displayName != null) {
    const r = validateDisplayName(patch.displayName);
    if (!r.ok) return { ok: false, error: r.error };
    patch.displayName = r.value;
  }
  if (patch.handle != null) {
    const r = validateHandle(patch.handle);
    if (!r.ok) return { ok: false, error: r.error };
    patch.handle = r.value;
  }
  if (patch.bio != null) patch.bio = String(patch.bio).slice(0, 190);
  Object.assign(state.self, patch);
  state.users[state.self.id] = state.self;
  persistNow();
  bus.emit('self:changed', state.self);
  bus.emit('presence:changed');
  bus.emit('profile:network', state.self);
  return { ok: true, self: state.self };
}

export function signOut() {
  flush();
  storage.remove(STORAGE_KEY);
  storage.remove(PROFILE_KEY);
  location.reload();
}

/* -------------------------------- servers -------------------------------- */

const STARTER_SERVERS = [
  {
    name: 'TalkingApp',
    desc: 'The official community. Everyone who opens TalkingApp lands here.',
    networkKey: 'talkingapp',
    color: '#5865f2',
    emoji: '💬',
    channels: [
      ['welcome', 'Start here — how TalkingApp works.'],
      ['general', 'Talk about anything with everyone online.'],
      ['introductions', 'New here? Say hi and tell us who you are.'],
      ['off-topic', 'Memes, music, side quests.'],
    ],
  },
  {
    name: 'The Lounge',
    desc: 'A laid-back room for hanging out and chatting about nothing in particular.',
    networkKey: 'the-lounge',
    color: '#22c55e',
    emoji: '🛋️',
    channels: [
      ['general', 'Pull up a chair.'],
      ['music', 'Share what you are listening to.'],
      ['gaming', 'Squad up.'],
    ],
  },
];

function bootstrapServers() {
  for (const def of STARTER_SERVERS) {
    const server = {
      id: `s_${randId(10)}`,
      name: def.name,
      desc: def.desc,
      color: def.color,
      emoji: def.emoji,
      networkKey: def.networkKey,
      ownerId: state.self.id,
      isPublic: true,
      isStarter: true,
      createdAt: Date.now(),
      channelIds: [],
      defaultChannelId: null,
      members: 1,
      roles: {},
    };
    for (const [name, topic] of def.channels) {
      const ch = createChannelRecord(server.id, name, topic);
      state.channels[ch.id] = ch;
      server.channelIds.push(ch.id);
    }
    server.defaultChannelId = server.channelIds[0];
    state.servers[server.id] = server;
  }
  const first = firstServerId();
  const general = state.servers[first].channelIds[1] || state.servers[first].defaultChannelId;
  state.ui.activeServerId = first;
  state.ui.activeChannelId = general;
  state.ui.lastChannelByServer[first] = general;

  seedWelcomeMessages(first);
}

function seedWelcomeMessages(serverId) {
  const srv = state.servers[serverId];
  const welcomeCh = srv.channelIds[0];
  const genCh = srv.channelIds[1];
  const now = Date.now();
  const help = [
    {
      id: `sys_${randId(10)}`,
      channelId: welcomeCh,
      userId: 'talkingapp',
      displayName: 'TalkingApp',
      handle: 'talkingapp',
      avatar: { kind: 'color', color: '#5865f2', color2: '#8b6ff5' },
      text: '**Welcome to TalkingApp** 👋\n\nThis whole app runs in your browser — no accounts, no downloads. Open this link on another device and start talking; messages appear in real time.',
      ts: now - 1000 * 60 * 8,
      system: true,
      pinned: true,
      reactions: { '👋': [] },
    },
    {
      id: `sys_${randId(10)}`,
      channelId: welcomeCh,
      userId: 'talkingapp',
      displayName: 'TalkingApp',
      handle: 'talkingapp',
      avatar: { kind: 'color', color: '#5865f2', color2: '#8b6ff5' },
      text: '**Quick start**\n• Type in a channel and hit Enter\n• Create your own server with the **+** button in the sidebar rail\n• Click a name to see a profile, right-click a message for actions\n• Try `markdown`: **bold**, *italic*, `code`, ||spoiler|| and :tada: emoji',
      ts: now - 1000 * 60 * 7,
      system: true,
      reactions: { '🔥': [] },
    },
  ];
  state.messages[welcomeCh] = help;
  const gen = [
    {
      id: `sys_${randId(10)}`,
      channelId: genCh,
      userId: 'talkingapp',
      displayName: 'TalkingApp',
      handle: 'talkingapp',
      avatar: { kind: 'color', color: '#5865f2', color2: '#8b6ff5' },
      text: 'This is **#general** for the TalkingApp community. It is quiet until someone opens the link — be the first to say something. 💬',
      ts: now - 1000 * 60 * 6,
      system: true,
      reactions: {},
    },
  ];
  state.messages[genCh] = gen;
}

export function firstServerId() {
  return Object.keys(state.servers)[0] || null;
}

export function getServer(id) {
  return state.servers[id] || null;
}

export function createServer({ name, desc = '', color = null, emoji = '💬', isPublic = true, channels = ['general'] }) {
  const r = validateServerName(name);
  if (!r.ok) return { ok: false, error: r.error };
  const server = {
    id: `s_${randId(10)}`,
    name: r.value,
    desc: String(desc).slice(0, 180),
    color: color || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    emoji: emoji || null,
    networkKey: networkKeyFor(r.value),
    ownerId: state.self.id,
    isPublic: Boolean(isPublic),
    createdAt: Date.now(),
    channelIds: [],
    defaultChannelId: null,
    members: 1,
    roles: {},
    isStarter: false,
  };
  const names = channels.length ? channels : ['general'];
  for (const raw of names) {
    const cr = validateChannelName(raw);
    if (!cr.ok) continue;
    const ch = createChannelRecord(server.id, cr.value, '');
    state.channels[ch.id] = ch;
    server.channelIds.push(ch.id);
  }
  if (!server.channelIds.length) {
    const ch = createChannelRecord(server.id, 'general', '');
    state.channels[ch.id] = ch;
    server.channelIds.push(ch.id);
  }
  server.defaultChannelId = server.channelIds[0];
  state.servers[server.id] = server;
  state.users[state.self.id] = state.self;

  if (isPublic) registerNetworkCommunity(server);

  persistNow();
  bus.emit('servers:changed');
  bus.emit('network:changed');
  bus.emit('server:created', server);
  selectServer(server.id, { channelId: server.channelIds[0], force: true });
  return { ok: true, server };
}

/** Join a community discovered on the network (creates a mirror locally). */
export function joinNetworkCommunity({ name, key, channels = [] }) {
  const existing = Object.values(state.servers).find((s) => s.networkKey === key);
  if (existing) return { ok: true, server: existing, existing: true };
  const r = validateServerName(name);
  const safeName = r.ok ? r.value : name.slice(0, 32);
  const net = state.network[key];
  const server = {
    id: `s_${randId(10)}`,
    name: safeName,
    desc: net?.topic || `A community on the TalkingApp network.`,
    color: colorFromString(key, 55),
    emoji: null,
    networkKey: key,
    ownerId: null,
    isPublic: true,
    isRemote: true,
    createdAt: Date.now(),
    channelIds: [],
    defaultChannelId: null,
    members: 1,
    roles: {},
  };
  const names = (channels.length ? channels : net?.channels?.length ? [...net.channels] : ['general'])
    .map((n) => String(n).toLowerCase())
    .filter((n) => /^[a-z0-9_-]{1,28}$/.test(n));
  for (const n of names.slice(0, 12)) {
    const ch = createChannelRecord(server.id, n, '');
    state.channels[ch.id] = ch;
    server.channelIds.push(ch.id);
  }
  if (!server.channelIds.length) {
    const ch = createChannelRecord(server.id, 'general', '');
    state.channels[ch.id] = ch;
    server.channelIds.push(ch.id);
  }
  server.defaultChannelId = server.channelIds[0];
  state.servers[server.id] = server;
  persistNow();
  bus.emit('servers:changed');
  bus.emit('explore:changed');
  selectServer(server.id, { channelId: server.defaultChannelId, force: true });
  return { ok: true, server };
}

export function updateServer(id, patch) {
  const s = state.servers[id];
  if (!s) return { ok: false, error: 'Server not found.' };
  if (patch.name != null) {
    const r = validateServerName(patch.name);
    if (!r.ok) return { ok: false, error: r.error };
    s.name = r.value;
  }
  if (patch.desc != null) s.desc = String(patch.desc).slice(0, 180);
  if (patch.color != null) s.color = patch.color;
  if (patch.emoji !== undefined) s.emoji = patch.emoji;
  if (patch.isPublic != null) s.isPublic = Boolean(patch.isPublic);
  persistNow();
  bus.emit('servers:changed');
  bus.emit('server:updated', s);
  return { ok: true, server: s };
}

export function deleteServer(id) {
  const s = state.servers[id];
  if (!s) return;
  for (const cid of s.channelIds) {
    delete state.channels[cid];
    delete state.messages[cid];
    delete state.reads[cid];
    delete state.typing[cid];
  }
  delete state.servers[id];
  if (state.ui.activeServerId === id) {
    const next = firstServerId();
    if (next) selectServer(next, { force: true });
    else {
      state.ui.activeServerId = null;
      state.ui.activeChannelId = null;
    }
  }
  persistNow();
  bus.emit('servers:changed');
  bus.emit('network:changed');
  bus.emit('active:changed');
}

export function leaveServer(id) {
  const s = state.servers[id];
  if (!s) return;
  deleteServer(id);
  toast(`You left ${s.name}`, 'info');
}

/* -------------------------------- channels ------------------------------- */

export function createChannel(serverId, name, topic = '') {
  const s = state.servers[serverId];
  if (!s) return { ok: false, error: 'Server not found.' };
  const r = validateChannelName(name);
  if (!r.ok) return { ok: false, error: r.error };
  if (s.channelIds.some((cid) => state.channels[cid].name === r.value)) {
    return { ok: false, error: 'This server already has a channel with that name.' };
  }
  const ch = createChannelRecord(serverId, r.value, String(topic).slice(0, 140));
  state.channels[ch.id] = ch;
  s.channelIds.push(ch.id);
  persistNow();
  bus.emit('channels:changed', serverId);
  bus.emit('servers:changed');
  return { ok: true, channel: ch };
}

export function updateChannel(channelId, patch) {
  const ch = state.channels[channelId];
  if (!ch) return { ok: false, error: 'Channel not found.' };
  if (patch.name != null) {
    const r = validateChannelName(patch.name);
    if (!r.ok) return { ok: false, error: r.error };
    ch.name = r.value;
  }
  if (patch.topic != null) ch.topic = String(patch.topic).slice(0, 140);
  persistNow();
  bus.emit('channels:changed', ch.serverId);
  bus.emit('channel:updated', ch);
  return { ok: true, channel: ch };
}

export function deleteChannel(channelId) {
  const ch = state.channels[channelId];
  if (!ch) return;
  const s = state.servers[ch.serverId];
  if (!s) return;
  const remaining = s.channelIds.filter((id) => id !== channelId);
  if (!remaining.length) return { ok: false, error: 'A server needs at least one channel.' };
  s.channelIds = remaining;
  if (s.defaultChannelId === channelId) s.defaultChannelId = remaining[0];
  delete state.channels[channelId];
  delete state.messages[channelId];
  delete state.reads[channelId];
  if (state.ui.activeChannelId === channelId) selectChannel(remaining[0]);
  persistNow();
  bus.emit('channels:changed', ch.serverId);
  bus.emit('servers:changed');
  return { ok: true };
}

export function reorderChannels(serverId, orderedIds) {
  const s = state.servers[serverId];
  if (!s) return;
  const valid = orderedIds.filter((id) => state.channels[id]?.serverId === serverId);
  const extra = s.channelIds.filter((id) => !valid.includes(id));
  s.channelIds = [...valid, ...extra];
  persistNow();
  bus.emit('channels:changed', serverId);
}

/* -------------------------------- messages ------------------------------- */

let msgSeq = 0;
export function makeMessage({ channelId, userId, displayName, handle, avatar, accentColor, text, ts = Date.now(), replyTo = null, system = false, pending = false, isSelf = false, network = false, reactions = {} }) {
  return {
    id: `m_${randId(12)}_${msgSeq++}`,
    channelId,
    userId,
    displayName: displayName || 'Unknown',
    handle: handle || 'user',
    avatar: avatar || defaultAvatar(displayName || ''),
    accentColor: accentColor || null,
    text,
    ts,
    editedTs: null,
    replyTo,
    reactions: reactions || {},
    pinned: false,
    system,
    pending,
    failed: false,
    isSelf,
    network,
  };
}

export function addMessage(channelId, msg, { persist: shouldPersist = true } = {}) {
  if (!state.messages[channelId]) state.messages[channelId] = [];
  state.messages[channelId].push(msg);
  if (state.messages[channelId].length > MAX_MSGS * 2) state.messages[channelId].splice(0, state.messages[channelId].length - MAX_MSGS * 2);
  if (shouldPersist) persist();
  bus.emit('message:new', { channelId, message: msg });
  const isActive = state.ui.activeChannelId === channelId && !document.hidden;
  if (!isActive) bus.emit('channel:unread', { channelId, message: msg });
  return msg;
}

export function sendMessage(channelId, text, { replyTo = null } = {}) {
  const ch = state.channels[channelId];
  if (!ch || !state.self) return null;
  const body = String(text || '').replace(/\s+$/, '');
  if (!body.trim()) return null;
  const msg = makeMessage({
    channelId,
    userId: state.self.id,
    displayName: state.self.displayName,
    handle: state.self.handle,
    avatar: state.self.avatar,
    accentColor: state.self.accentColor,
    text: body.slice(0, 2000),
    replyTo,
    isSelf: true,
    pending: ch.type === 'dm' ? Boolean(ch.dmUserId) : false,
  });
  addMessage(channelId, msg);
  markRead(channelId);
  bus.emit('message:out', { channelId, message: msg });
  return msg;
}

export function receiveMessage({ channelId, msg }) {
  if (!state.messages[channelId]) state.messages[channelId] = [];
  const existing = state.messages[channelId].find((m) => m.id === msg.id);
  if (existing) return existing;
  addMessage(channelId, msg);
  return msg;
}

export function findMessage(msgId, channelId = null) {
  if (channelId) return state.messages[channelId]?.find((m) => m.id === msgId) || null;
  for (const list of Object.values(state.messages)) {
    const m = list.find((x) => x.id === msgId);
    if (m) return m;
  }
  return null;
}

export function editMessage(channelId, msgId, text) {
  const m = state.messages[channelId]?.find((x) => x.id === msgId);
  if (!m) return null;
  m.text = String(text).slice(0, 2000);
  m.editedTs = Date.now();
  persist();
  bus.emit('message:updated', { channelId, message: m });
  bus.emit('message:editOut', { channelId, message: m });
  return m;
}

export function deleteMessage(channelId, msgId) {
  const list = state.messages[channelId];
  if (!list) return;
  const i = list.findIndex((m) => m.id === msgId);
  if (i === -1) return;
  list.splice(i, 1);
  persist();
  bus.emit('message:deleted', { channelId, messageId: msgId });
  bus.emit('message:deleteOut', { channelId, messageId: msgId });
}

export function toggleReaction(channelId, msgId, emoji, userId = state.self?.id) {
  const m = state.messages[channelId]?.find((x) => x.id === msgId);
  if (!m || !userId) return;
  m.reactions = m.reactions || {};
  const users = m.reactions[emoji] || [];
  const i = users.indexOf(userId);
  if (i >= 0) users.splice(i, 1); else users.push(userId);
  if (users.length) m.reactions[emoji] = users; else delete m.reactions[emoji];
  persist();
  bus.emit('message:updated', { channelId, message: m });
  if (userId === state.self?.id) bus.emit('reaction:out', { channelId, message: m, emoji, op: i >= 0 ? 'remove' : 'add' });
  return m;
}

export function applyRemoteReaction({ channelId, msgId, emoji, op, userId }) {
  const m = state.messages[channelId]?.find((x) => x.id === msgId);
  if (!m) return;
  m.reactions = m.reactions || {};
  const users = new Set(m.reactions[emoji] || []);
  if (op === 'add') users.add(userId);
  else users.delete(userId);
  if (users.size) m.reactions[emoji] = [...users];
  else delete m.reactions[emoji];
  persist();
  bus.emit('message:updated', { channelId, message: m });
}

export function togglePin(channelId, msgId) {
  const m = state.messages[channelId]?.find((x) => x.id === msgId);
  if (!m) return;
  m.pinned = !m.pinned;
  persist();
  bus.emit('message:updated', { channelId, message: m });
  bus.emit('pins:changed', channelId);
  return m.pinned;
}

export function pinnedMessages(channelId) {
  return (state.messages[channelId] || []).filter((m) => m.pinned);
}

/* --------------------------------- reads --------------------------------- */

export function markRead(channelId) {
  const last = state.messages[channelId]?.at(-1);
  state.reads[channelId] = last ? last.ts : Date.now();
  bus.emit('reads:changed', channelId);
  persist();
}

export function unreadCount(channelId) {
  const read = state.reads[channelId] || 0;
  return (state.messages[channelId] || []).filter((m) => m.ts > read && !m.isSelf && !m.system).length;
}

export function mentionCount(channelId) {
  if (!state.self) return 0;
  const read = state.reads[channelId] || 0;
  const handle = state.self.handle;
  return (state.messages[channelId] || []).filter(
    (m) => m.ts > read && !m.isSelf && (new RegExp(`@${handle}\\b`, 'i').test(m.text) || /@everyone\b/i.test(m.text)),
  ).length;
}

export function unreadEverywhere() {
  let total = 0;
  for (const [cid, list] of Object.entries(state.messages)) {
    const read = state.reads[cid] || 0;
    total += list.filter((m) => m.ts > read && !m.isSelf && !m.system).length;
  }
  return total;
}

/* --------------------------------- typing -------------------------------- */

export function setTyping(channelId, userId, name, ms = 6000) {
  if (!state.typing[channelId]) state.typing[channelId] = {};
  state.typing[channelId][userId] = { name, until: Date.now() + ms };
  bus.emit('typing:changed', channelId);
}

export function typingNames(channelId) {
  const t = state.typing[channelId] || {};
  return Object.entries(t).filter(([, v]) => v.until > Date.now()).map(([, v]) => v.name);
}

export function pruneTyping() {
  const now = Date.now();
  let changed = false;
  for (const [cid, map] of Object.entries(state.typing)) {
    for (const [uid2, v] of Object.entries(map)) {
      if (v.until <= now) { delete map[uid2]; changed = true; bus.emit('typing:changed', cid); }
    }
  }
  return changed;
}

/* -------------------------------- presence ------------------------------- */

export function setPresence(userId, status) {
  if (!state.presence[userId] === status) return;
  state.presence[userId] = status;
  bus.emit('presence:changed');
}

export function onlineUsers() {
  return Object.entries(state.presence).filter(([, s]) => s === 'online').map(([id]) => id);
}

export function peersForServer(serverId) {
  const s = state.servers[serverId];
  if (!s) return [];
  const ids = new Set();
  for (const peer of Object.values(state.peers)) {
    if (peer.communities?.some((c) => c === s.networkKey)) ids.add(peer.id);
  }
  return [...ids];
}

/* ------------------------------ network registry ------------------------- */

export function registerNetworkCommunity(server) {
  const key = server.networkKey;
  if (!key) return;
  if (!state.network[key]) state.network[key] = { key, name: server.name, topic: server.desc, peers: new Set(), channels: new Set(), local: true };
  const entry = state.network[key];
  entry.name = server.name;
  entry.topic = server.desc || entry.topic;
  entry.local = true;
  if (!entry.channels) entry.channels = new Set();
  for (const cid of server.channelIds) entry.channels.add(state.channels[cid]?.name);
  bus.emit('network:changed');
}

export function registerAllCommunities() {
  for (const s of Object.values(state.servers)) {
    if (s.isPublic) registerNetworkCommunity(s);
  }
}

export function noteRemoteCommunity({ key, name, topic, channels, peerId }) {
  if (!key) return;
  let entry = state.network[key];
  if (!entry) {
    entry = state.network[key] = { key, name, topic, peers: new Set(), channels: new Set(), local: false };
    bus.emit('network:changed');
  }
  if (name) entry.name = name;
  if (topic) entry.topic = topic;
  if (!(entry.peers instanceof Set)) entry.peers = new Set();
  entry.peers.add(peerId);
  if (!(entry.channels instanceof Set)) entry.channels = new Set();
  for (const c of channels || []) entry.channels.add(c);
  bus.emit('explore:changed');
}

export function removePeer(peerId) {
  delete state.peers[peerId];
  for (const entry of Object.values(state.network)) {
    entry.peers?.delete?.(peerId);
  }
  bus.emit('presence:changed');
  bus.emit('explore:changed');
}

export function upsertPeer(peer) {
  state.peers[peer.id] = { ...state.peers[peer.id], ...peer };
  if (peer.user) state.users[peer.user.id || peer.id] = peer.user;
  bus.emit('presence:changed');
}

/* ---------------------------------- dms ---------------------------------- */

export function openDM(userId, user) {
  if (!userId || userId === state.self?.id) return null;
  let channelId = state.dmChannels[userId];
  if (channelId && state.channels[channelId]) {
    selectChannel(channelId, { serverId: null });
    return state.channels[channelId];
  }
  const ch = {
    id: `dm_${randId(10)}`,
    serverId: null,
    type: 'dm',
    dmUserId: userId,
    name: user?.displayName || 'Direct message',
    handle: user?.handle || 'user',
    topic: '',
    createdAt: Date.now(),
    position: 0,
  };
  state.channels[ch.id] = ch;
  state.dmChannels[userId] = ch.id;
  state.messages[ch.id] = state.messages[ch.id] || [];
  state.ui.activeServerId = '@me';
  state.ui.activeChannelId = ch.id;
  persistNow();
  bus.emit('servers:changed');
  bus.emit('active:changed');
  bus.emit('dms:changed');
  return ch;
}

export function dmList() {
  return Object.values(state.dmChannels)
    .map((cid) => state.channels[cid])
    .filter(Boolean)
    .sort((a, b) => {
      const at = state.messages[a.id]?.at(-1)?.ts || a.createdAt;
      const bt = state.messages[b.id]?.at(-1)?.ts || b.createdAt;
      return bt - at;
    });
}

export function ensureDMChannelForUser(user) {
  const existing = state.dmChannels[user.id];
  if (existing && state.channels[existing]) return state.channels[existing];
  const ch = {
    id: `dm_${randId(10)}`,
    serverId: null,
    type: 'dm',
    dmUserId: user.id,
    name: user.displayName || 'Direct message',
    handle: user.handle || 'user',
    createdAt: Date.now(),
    position: 0,
  };
  state.channels[ch.id] = ch;
  state.dmChannels[user.id] = ch.id;
  if (!state.messages[ch.id]) state.messages[ch.id] = [];
  bus.emit('dms:changed');
  return ch;
}

/* -------------------------------- selection ------------------------------ */

export function selectServer(serverId, { channelId = null, force = false } = {}) {
  if (serverId !== '@me' && !state.servers[serverId]) return;
  const prev = state.ui.activeServerId;
  if (prev !== serverId && prev) {
    const prevCh = state.channels[state.ui.activeChannelId];
    if (prevCh?.serverId === prev) state.ui.lastChannelByServer[prev] = prevCh.id;
  }
  state.ui.activeServerId = serverId;
  state.ui.exploreOpen = false;
  if (state.ui.replyTo) state.ui.replyTo = null;

  if (serverId === '@me') {
    const dms = dmList();
    const preferred = channelId && state.channels[channelId] ? channelId : dmList().find((c) => c.id === state.ui.activeChannelId)?.id || dms[0]?.id || null;
    state.ui.activeChannelId = preferred;
    if (preferred) markRead(preferred);
    persist();
    bus.emit('active:changed');
    return;
  }

  const s = state.servers[serverId];
  let target = channelId && s.channelIds.includes(channelId) ? channelId : state.ui.lastChannelByServer[serverId];
  if (!target || !s.channelIds.includes(target)) target = s.defaultChannelId;
  state.ui.activeChannelId = target;
  if (target) markRead(target);
  persist();
  bus.emit('active:changed');
  if (window.matchMedia('(max-width: 860px)').matches) {
    state.ui.sidebarOpen = false;
    bus.emit('drawer:changed');
  }
}

export function selectChannel(channelId, { serverId } = {}) {
  const ch = state.channels[channelId];
  if (!ch) return;
  const srvId = serverId !== undefined ? serverId : ch.serverId ?? (ch.type === 'dm' ? '@me' : null);
  state.ui.activeServerId = srvId;
  state.ui.activeChannelId = channelId;
  state.ui.exploreOpen = false;
  state.ui.replyTo = null;
  state.ui.editingId = null;
  if (srvId && srvId !== '@me') state.ui.lastChannelByServer[srvId] = channelId;
  markRead(channelId);
  persist();
  bus.emit('active:changed');
  if (window.matchMedia('(max-width: 860px)').matches) {
    state.ui.sidebarOpen = false;
    bus.emit('drawer:changed');
  }
}

export function activeChannel() {
  return state.channels[state.ui.activeChannelId] || null;
}

export function activeServer() {
  return state.servers[state.ui.activeServerId] || null;
}

/* -------------------------------- settings ------------------------------- */

export function setSetting(key, value) {
  state.settings[key] = value;
  if (key === 'showMembers') state.ui.membersOpen = value;
  persist();
  bus.emit('settings:changed', { key, value });
}

export function setTheme(theme) {
  setSetting('theme', theme);
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#ffffff' : '#1e1f22');
}

export function setAccent(accent) {
  setSetting('accent', accent);
  document.documentElement.dataset.accent = accent;
}

/* ------------------------------- utilities ------------------------------- */

export function searchAll(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return { channels: [], messages: [] };
  const channels = [];
  for (const ch of Object.values(state.channels)) {
    if (ch.type !== 'dm' && ch.name.toLowerCase().includes(q)) channels.push(ch);
    if (ch.type === 'dm' && (ch.name || '').toLowerCase().includes(q)) channels.push(ch);
  }
  const messages = [];
  for (const [cid, list] of Object.entries(state.messages)) {
    if (!state.channels[cid]) continue;
    for (let i = list.length - 1; i >= 0 && messages.length < 40; i--) {
      const m = list[i];
      if (m.text.toLowerCase().includes(q)) messages.push({ ...m, channelId: cid });
    }
  }
  messages.sort((a, b) => b.ts - a.ts);
  const servers = Object.values(state.servers).filter((s) => s.name.toLowerCase().includes(q) || (s.desc || '').toLowerCase().includes(q));
  return { channels, messages: messages.slice(0, 25), servers };
}

export function persistNow() {
  persist.cancel();
  save();
}

export function resetEverything() {
  storage.remove(STORAGE_KEY);
  storage.remove(PROFILE_KEY);
  location.reload();
}

export { DEFAULT_SETTINGS, createChannelRecord };
