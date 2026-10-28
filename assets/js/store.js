// TalkingApp — application state, persistence and mutations
import { bus } from './bus.js';
import { storage, uid, randId, debounce, validateHandle, validateDisplayName, validateServerName, validateChannelName, colorFromString } from './util.js';
import { defaultAvatar, AVATAR_COLORS } from './avatar.js';
import { CAP, ROLES, can, canPostIn, roleIdFor, roleRecord, assignableRoles, isRoleId } from './perms.js';
import { limitsFor, planOf, serverSlotsLeft, DEFAULT_PLAN, isPlanId } from './plans.js';

export const STORAGE_KEY = 'ta.state.v2';
export const PROFILE_KEY = 'ta.profile';

// Every account keeps its own copy of the state, so switching usernames on one
// device never mixes two people's servers together.
let CURRENT_KEY = STORAGE_KEY;
let CURRENT_PROFILE_KEY = PROFILE_KEY;
let CURRENT_HANDLE = null;

export function accountStateKey(handle) {
  return handle ? `${STORAGE_KEY}.${String(handle).toLowerCase()}` : STORAGE_KEY;
}

export function useAccountNamespace(handle) {
  CURRENT_HANDLE = handle ? String(handle).toLowerCase() : null;
  CURRENT_KEY = accountStateKey(CURRENT_HANDLE);
  CURRENT_PROFILE_KEY = CURRENT_HANDLE ? `${PROFILE_KEY}.${CURRENT_HANDLE}` : PROFILE_KEY;
  return CURRENT_KEY;
}

export function currentNamespace() {
  return { handle: CURRENT_HANDLE, stateKey: CURRENT_KEY, profileKey: CURRENT_PROFILE_KEY };
}
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
  plan: 'free',
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
  const ok = storage.set(CURRENT_KEY, payload);
  if (!ok) {
    // most likely quota — trim the heaviest part and retry once
    payload.messages = Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, v.slice(-30)]));
    storage.set(CURRENT_KEY, payload);
  }
  storage.set(CURRENT_PROFILE_KEY, self);
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
  let saved = storage.get(CURRENT_KEY, null);
  // one-time migration from the pre-account single-slot format
  if (!saved && CURRENT_HANDLE) {
    const legacy = storage.get(STORAGE_KEY, null);
    if (legacy?.self && String(legacy.self.handle).toLowerCase() === CURRENT_HANDLE) saved = legacy;
  }
  if (!saved || !saved.self?.id) return false;

  state.self = normalizeSelf(saved.self);
  state.servers = saved.servers || {};
  state.channels = saved.channels || {};
  state.messages = saved.messages || {};
  state.reads = saved.reads || {};
  state.dmChannels = saved.dmChannels || {};
  state.blocked = saved.blocked || {};
  state.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
  state.self.plan = isPlanId(state.settings.plan) ? state.settings.plan : DEFAULT_PLAN;
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
    s.notify = ['all', 'mentions', 'none'].includes(s.notify) ? s.notify : 'all';
    s.inviteCode = s.inviteCode || `inv_${randId(9)}`;
    s.visibility = s.visibility === 'invite' || s.isPublic === false ? 'invite' : 'public';
    s.isPublic = s.visibility === 'public';
    s.members = s.members && typeof s.members === 'object' ? s.members : {};
    if (s.ownerId === state.self.id && s.members[state.self.id]) s.members[state.self.id].role = 'owner';
  }
  const savedServer = saved.ui?.activeServerId;
  state.ui.activeServerId = savedServer === '@me' ? '@me' : (state.servers[savedServer] ? savedServer : null);
  state.ui.activeChannelId = state.channels[saved.ui?.activeChannelId] ? saved.ui.activeChannelId : null;
  state.ui.lastChannelByServer = saved.ui?.lastChannelByServer || {};
  state.ui.membersOpen = state.settings.showMembers;

  if (!state.ui.activeServerId) {
    const first = firstServerId();
    if (first) state.ui.activeServerId = first;
  }
  if (!state.ui.activeChannelId && state.ui.activeServerId && state.ui.activeServerId !== '@me') {
    state.ui.activeChannelId = state.servers[state.ui.activeServerId]?.defaultChannelId || null;
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
    plan: isPlanId(self.plan) ? self.plan : DEFAULT_PLAN,
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
    plan: DEFAULT_PLAN,
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

/** Lock the app. Your account, data and cloud copy all stay put. */
export function signOut() {
  flush();
  location.reload();
}

/** Remove this device's copy of everything, including the account. */
export function wipeDevice() {
  for (const key of [CURRENT_KEY, CURRENT_PROFILE_KEY, STORAGE_KEY, PROFILE_KEY, 'ta.account.v1', 'ta.vault.v1', 'ta.claims.v1']) {
    storage.remove(key);
  }
  location.reload();
}

/* -------------------------- membership & ownership ------------------------ */

/** Everyone with a role in this server, including me. */
export function ensureMember(server, user = state.self) {
  if (!server || !user?.id) return null;
  if (!server.members || typeof server.members !== 'object') server.members = {};
  const existing = server.members[user.id];
  if (existing) {
    // keep names fresh so member lists never show yesterday's display name
    existing.name = user.displayName || existing.name;
    existing.handle = user.handle || existing.handle;
    return existing;
  }
  const member = {
    id: user.id,
    name: user.displayName || 'Member',
    handle: user.handle || 'member',
    role: server.ownerId && server.ownerId === user.id ? 'owner' : 'member',
    plan: user.plan || DEFAULT_PLAN,
    since: Date.now(),
  };
  server.members[user.id] = member;
  return member;
}

/** Note that somebody is a member (they spoke, or they showed up online). */
export function touchMember(serverId, user) {
  const server = state.servers[serverId];
  if (!server || !user?.id || user.id === state.self?.id) return;
  const made = !server.members?.[user.id];
  const member = ensureMember(server, user);
  if (member) member.plan = user.plan || member.plan || DEFAULT_PLAN;
  if (made) {
    persist();
    bus.emit('members:changed', serverId);
  }
}

export function memberList(server) {
  if (!server?.members) return [];
  return Object.values(server.members)
    .map((m) => ({ ...m, role: roleIdFor(server, m.id) }))
    .sort((a, b) => (ROLES[b.role]?.rank || 0) - (ROLES[a.role]?.rank || 0) || String(a.name).localeCompare(String(b.name)));
}

export function roleOf(serverId, userId = state.self?.id) {
  const server = typeof serverId === 'string' ? state.servers[serverId] : serverId;
  return roleIdFor(server, userId);
}

export function isServerOwner(server) {
  if (!server) return false;
  if (!server.ownerId) return false;
  return server.ownerId === state.self?.id;
}

/** Servers you can reshape: yours, or one where you were made an admin. */
export function canManageServer(server, user = state.self) {
  if (!server || !user) return false;
  return can(server, user.id, CAP.manageServer);
}

export function canManageChannel(channelId, user = state.self) {
  const ch = state.channels[channelId];
  if (!ch) return false;
  if (ch.type === 'dm') return false;
  return canManageServer(state.servers[ch.serverId], user);
}

/** Can I delete or pin other people's messages here? */
export function canModerateChannel(channelId, user = state.self) {
  const ch = state.channels[channelId];
  if (!ch) return false;
  if (ch.type === 'dm') return false;
  return can(state.servers[ch.serverId], user?.id, CAP.manageMessages);
}

/** Can I post in this channel? Announcements are staff-only, roles can be muted. */
export function canPostInChannel(channelId, user = state.self) {
  const ch = state.channels[channelId];
  if (!ch) return false;
  if (ch.type === 'dm') return true;
  return canPostIn(state.servers[ch.serverId], ch, user?.id);
}

export function canAssignRolesIn(server) {
  return assignableRoles(server, state.self?.id).length > 0;
}

/** Give somebody a role — owner can promote to admin, admins stop below themselves. */
export function setMemberRole(serverId, userId, role) {
  const server = state.servers[serverId];
  if (!server) return { ok: false, error: 'Server not found.' };
  if (!isRoleId(role) || role === 'owner') return { ok: false, error: 'That is not a role you can hand out.' };
  if (!assignableRoles(server, state.self?.id).includes(role)) {
    return { ok: false, error: `Only ${server.ownerId === state.self?.id ? 'you' : 'the owner'} can give out that role.` };
  }
  if (userId === server.ownerId) return { ok: false, error: 'The owner keeps the owner role.' };
  const existing = server.members?.[userId];
  const user = state.users[userId];
  const member = existing || ensureMember(server, { id: userId, displayName: user?.displayName || 'Member', handle: user?.handle || 'member' });
  if (!member) return { ok: false, error: 'That person is not in this server.' };
  member.role = role;
  persistNow();
  bus.emit('members:changed', serverId);
  bus.emit('server:sync', server);
  return { ok: true, member, role: roleRecord(role) };
}

/**
 * Is this server meant to be discoverable?
 *   public — listed in Explore, advertised to everyone online
 *   invite — unlisted, reachable only with a link that carries its secret key
 */
export function isListed(server) {
  if (!server) return false;
  if (server.visibility === 'invite') return false;
  return server.isPublic !== false;
}

export function serverVisibility(server) {
  return isListed(server) ? 'public' : 'invite';
}

/** Secret key for a private server: not derivable from its name. */
export function privateNetworkKey() {
  return `p_${randId(20)}`;
}

export function inviteLinkFor(server) {
  if (!server) return location.origin + location.pathname;
  const base = `${location.origin}${location.pathname}`;
  const param = isListed(server) ? 'join' : 'invite';
  return `${base}?${param}=${encodeURIComponent(server.networkKey)}&name=${encodeURIComponent(server.name)}`;
}

function ownershipError(what = 'server') {
  return { ok: false, error: `Only the owner can change this ${what}.` };
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
      ownerId: null,
      isPublic: true,
      isStarter: true,
      createdAt: Date.now(),
      channelIds: [],
      defaultChannelId: null,
      members: {},
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

/** A fresh server starts with one pinned welcome note from the app account. */
function seedNewServerGreeting(server) {
  const chId = server.channelIds[0];
  const ch = state.channels[chId];
  const note = {
    id: `sys_${randId(10)}`,
    channelId: chId,
    userId: 'talkingapp',
    displayName: 'TalkingApp',
    handle: 'talkingapp',
    avatar: { kind: 'color', color: '#5865f2', color2: '#8b6ff5' },
    text: `**${server.name} is live** 🎉\n\nThis is **#${ch?.name || 'general'}**. Hit **Invite** in the sidebar and send that link to anyone — they land in this server, and its name, icon and channels come with it.\n\n• **Server settings** → give people roles: admin, moderator, member or read-only\n• **Announcement channels** are read-only for everyone except staff\n• Messages stay in the shared log, so a new device sees the history\n• **Ctrl/⌘ K** finds any message`,
    ts: Date.now(),
    system: true,
    pinned: true,
    reactions: { '🎉': [] },
  };
  state.messages[chId] = [note];
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
      text: '**Welcome to TalkingApp** 👋\n\nEverything runs in your browser. Sign in with your username and password on another Chromebook and your servers, channels, messages and settings follow you.',
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
      text: '**Quick start**\n• Type in a channel and hit Enter\n• Create your own server with the **+** button in the sidebar rail\n• Settings → **Plans** for bigger uploads and more servers\n• Settings → **Backup & sync** keeps everything safe on another device\n• Try `markdown`: **bold**, *italic*, `code`, ||spoiler|| and :tada: emoji',
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

export function createServer({ name, desc = '', color = null, emoji = '💬', isPublic = true, visibility = null, channels = ['general'] }) {
  const r = validateServerName(name);
  if (!r.ok) return { ok: false, error: r.error };
  const owned = Object.values(state.servers).filter((srv) => srv.ownerId === state.self.id).length;
  const plan = currentPlan();
  if (serverSlotsLeft(plan.id, owned) <= 0) {
    return {
      ok: false,
      error: `Your ${plan.name} plan covers ${limitsFor(plan.id).servers} servers. You can leave one, or switch plans in Settings → Plans.`,
      planLimit: true,
    };
  }
  const listed = visibility ? visibility === 'public' : Boolean(isPublic);
  const server = {
    id: `s_${randId(10)}`,
    name: r.value,
    desc: String(desc).slice(0, 180),
    color: color || AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    emoji: emoji || null,
    // A private server's key is random, so nobody can join by guessing its name.
    networkKey: listed ? networkKeyFor(r.value) : privateNetworkKey(),
    ownerId: state.self.id,
    isPublic: listed,
    visibility: listed ? 'public' : 'invite',
    createdAt: Date.now(),
    channelIds: [],
    defaultChannelId: null,
    members: {},
    roles: {},
    memberRole: 'member',
    notify: 'all',
    inviteCode: `inv_${randId(9)}`,
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
  ensureMember(server, state.self);
  if (server.members[state.self.id]) server.members[state.self.id].role = 'owner';
  seedNewServerGreeting(server);

  if (isListed(server)) registerNetworkCommunity(server);

  persistNow();
  bus.emit('servers:changed');
  bus.emit('network:changed');
  bus.emit('server:created', server);
  selectServer(server.id, { channelId: server.channelIds[0], force: true });
  return { ok: true, server };
}

/**
 * Join a server from an invite link. The link carries the server's secret key,
 * so this works even when nobody from that server is online.
 */
export function joinByInvite({ key, name = '', card = null }) {
  const clean = String(key || '').trim();
  if (!/^[a-z0-9_-]{4,48}$/i.test(clean)) return { ok: false, error: 'That invite link looks broken.' };
  const existing = Object.values(state.servers).find((s) => s.networkKey === clean);
  if (existing) return { ok: true, server: existing, existing: true };
  const r = validateServerName(card?.name || name || 'Invited server');
  const server = {
    id: `s_${randId(10)}`,
    name: r.ok ? r.value : 'Invited server',
    desc: String(card?.desc || 'An invite-only server.').slice(0, 180),
    color: card?.color || colorFromString(clean, 55),
    emoji: card?.emoji ?? null,
    networkKey: clean,
    ownerId: card?.ownerId || null,
    ownerName: card?.ownerName || null,
    isPublic: false,
    visibility: 'invite',
    isRemote: true,
    createdAt: Date.now(),
    channelIds: [],
    defaultChannelId: null,
    members: 1,
    roles: {},
    memberRole: 'member',
    notify: 'all',
    categories: [],
  };
  const ch = createChannelRecord(server.id, 'general', '');
  state.channels[ch.id] = ch;
  server.channelIds.push(ch.id);
  server.defaultChannelId = ch.id;
  state.servers[server.id] = server;
  ensureMember(server, state.self);
  seedNewServerGreeting(server);
  if (card) ingestServerCard(card);
  persistNow();
  bus.emit('servers:changed');
  selectServer(server.id, { channelId: ch.id, force: true });
  return { ok: true, server };
}

/** Join a community discovered on the network (creates a mirror locally). */
export function joinNetworkCommunity({ name, key, channels = [], card = null }) {
  const existing = Object.values(state.servers).find((s) => s.networkKey === key);
  if (existing) return { ok: true, server: existing, existing: true };
  const r = validateServerName(card?.name || name);
  const safeName = r.ok ? r.value : String(card?.name || name).slice(0, 32);
  const net = state.network[key];
  const server = {
    id: `s_${randId(10)}`,
    name: safeName,
    desc: String(card?.desc || net?.topic || 'A community on the TalkingApp network.').slice(0, 180),
    color: card?.color || colorFromString(key, 55),
    emoji: card?.emoji ?? null,
    networkKey: key,
    ownerId: card?.ownerId || null,
    ownerName: card?.ownerName || null,
    isPublic: true,
    isRemote: true,
    createdAt: Date.now(),
    channelIds: [],
    defaultChannelId: null,
    members: {},
    roles: {},
    memberRole: 'member',
    notify: 'all',
    categories: Array.isArray(card?.categories) ? card.categories.slice(0, 12) : [],
  };
  const channelDefs = Array.isArray(card?.channels) && card.channels.length
    ? card.channels
    : (channels.length ? channels : net?.channels?.length ? [...net.channels] : ['general']);
  const names = [];
  for (const def of channelDefs) {
    const raw = typeof def === 'string' ? { name: def } : def || {};
    const n = String(raw.name || '').toLowerCase();
    if (!/^[a-z0-9_-]{1,28}$/.test(n) || names.some((x) => x.name === n)) continue;
    names.push({ name: n, topic: String(raw.topic || '').slice(0, 140), category: String(raw.category || '').slice(0, 24), type: raw.type === 'announcement' ? 'announcement' : 'text' });
  }
  if (!names.length) names.push({ name: 'general', topic: '', category: '', type: 'text' });
  for (const def of names.slice(0, limitsFor(currentPlan().id).channels)) {
    const ch = createChannelRecord(server.id, def.name, def.topic);
    ch.category = def.category;
    ch.type = def.type;
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
  seedNewServerGreeting(server);
  persistNow();
  bus.emit('servers:changed');
  bus.emit('explore:changed');
  selectServer(server.id, { channelId: server.defaultChannelId, force: true });
  return { ok: true, server };
}

export function updateServer(id, patch) {
  const s = state.servers[id];
  if (!s) return { ok: false, error: 'Server not found.' };
  if (!canManageServer(s)) return ownershipError('server');
  if (patch.name != null) {
    const r = validateServerName(patch.name);
    if (!r.ok) return { ok: false, error: r.error };
    s.name = r.value;
  }
  if (patch.desc != null) s.desc = String(patch.desc).slice(0, 180);
  if (patch.color != null) s.color = patch.color;
  if (patch.emoji !== undefined) s.emoji = patch.emoji;
  if (patch.isPublic != null) {
    s.isPublic = Boolean(patch.isPublic);
    s.visibility = s.isPublic ? 'public' : 'invite';
  }
  if (patch.notify != null) s.notify = ['all', 'mentions', 'none'].includes(patch.notify) ? patch.notify : s.notify;
  persistNow();
  bus.emit('servers:changed');
  bus.emit('server:updated', s);
  bus.emit('server:sync', s);
  return { ok: true, server: s };
}

export function deleteServer(id) {
  const s = state.servers[id];
  if (!s) return { ok: false, error: 'Server not found.' };
  if (s.ownerId && s.ownerId !== state.self?.id) return { ok: false, error: 'Only the owner can delete this server.' };
  if (!s.ownerId && !canManageServer(s)) return ownershipError('server');
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

/** Leave a server: drop it from this device only. */
export function forgetServer(id) {
  const s = state.servers[id];
  if (!s) return { ok: false, error: 'Server not found.' };
  for (const cid of s.channelIds) {
    delete state.channels[cid];
    delete state.messages[cid];
    delete state.reads[cid];
    delete state.typing[cid];
    tombstones.delete(cid);
  }
  delete state.servers[id];
  if (state.ui.lastChannelByServer) delete state.ui.lastChannelByServer[id];
  if (state.ui.activeServerId === id) {
    const next = firstServerId();
    if (next) selectServer(next, { force: true });
    else {
      state.ui.activeServerId = '@me';
      state.ui.activeChannelId = null;
    }
  }
  persistNow();
  bus.emit('servers:changed');
  bus.emit('network:changed');
  bus.emit('active:changed');
  return { ok: true };
}

export function leaveServer(id) {
  const s = state.servers[id];
  if (!s) return;
  forgetServer(id);
  toast(`You left ${s.name}`, 'info');
}

/** Listed or invite-only. Only someone who can manage invites may change it. */
export function setServerVisibility(serverId, visibility) {
  const s = state.servers[serverId];
  if (!s) return { ok: false, error: 'Server not found.' };
  if (!can(s, state.self?.id, CAP.manageInvites)) {
    return { ok: false, error: 'Only the owner or an admin can change who can join.' };
  }
  const wanted = visibility === 'invite' ? 'invite' : 'public';
  if (wanted === serverVisibility(s)) return { ok: true, server: s, visibility: wanted, unchanged: true };
  s.visibility = wanted;
  s.isPublic = wanted === 'public';
  // A server that becomes private gets a fresh, unguessable key so the name no
  // longer gives it away. Existing members keep talking: we migrate them first.
  let oldKey = null;
  if (wanted === 'invite') {
    oldKey = s.networkKey;
    s.networkKey = privateNetworkKey();
  }
  persistNow();
  bus.emit('servers:changed');
  bus.emit('server:updated', s);
  if (oldKey) bus.emit('server:rekey', { server: s, oldKey, nextKey: s.networkKey });
  else bus.emit('server:sync', s);
  return { ok: true, server: s, visibility: wanted, oldKey };
}

/**
 * Rotate the invite link: everyone already inside follows to a new secret key,
 * while the old link stops working for anybody else.
 */
export function rotateInviteLink(serverId) {
  const s = state.servers[serverId];
  if (!s) return { ok: false, error: 'Server not found.' };
  if (!can(s, state.self?.id, CAP.manageInvites)) {
    return { ok: false, error: 'Only the owner or an admin can rotate the invite link.' };
  }
  const oldKey = s.networkKey;
  s.networkKey = isListed(s) ? networkKeyFor(s.name) : privateNetworkKey();
  if (isListed(s)) return { ok: false, error: 'Public servers are joined by name; make it invite-only first.' };
  s.inviteRotatedAt = Date.now();
  persistNow();
  bus.emit('servers:changed');
  bus.emit('server:updated', s);
  bus.emit('server:rekey', { server: s, oldKey, nextKey: s.networkKey });
  return { ok: true, server: s, oldKey, nextKey: s.networkKey };
}

/** Apply a rekey sent by another member, so the whole room moves together. */
export function applyRekey({ oldKey, nextKey }) {
  if (!oldKey || !nextKey || oldKey === nextKey) return { ok: false };
  const s = Object.values(state.servers).find((srv) => srv.networkKey === oldKey);
  if (!s) return { ok: false, reason: 'unknown-key' };
  s.networkKey = nextKey;
  s.visibility = 'invite';
  s.isPublic = false;
  persistNow();
  bus.emit('servers:changed');
  bus.emit('server:updated', s);
  return { ok: true, server: s };
}

/* -------------------------------- channels ------------------------------- */

export function createChannel(serverId, name, topic = '', { category = '', type = 'text' } = {}) {
  const s = state.servers[serverId];
  if (!s) return { ok: false, error: 'Server not found.' };
  if (!can(s, state.self?.id, CAP.manageChannels)) return ownershipError('server');
  const r = validateChannelName(name);
  if (!r.ok) return { ok: false, error: r.error };
  if (s.channelIds.some((cid) => state.channels[cid].name === r.value)) {
    return { ok: false, error: 'This server already has a channel with that name.' };
  }
  const cap = limitsFor(currentPlan().id).channels;
  if (s.channelIds.length >= cap) {
    return { ok: false, error: `A server can have ${cap} channels on your plan. Settings → Plans raises that.`, planLimit: true };
  }
  const ch = createChannelRecord(serverId, r.value, String(topic).slice(0, 140));
  ch.category = String(category || '').slice(0, 24);
  ch.type = type === 'announcement' ? 'announcement' : 'text';
  state.channels[ch.id] = ch;
  s.channelIds.push(ch.id);
  persistNow();
  bus.emit('channels:changed', serverId);
  bus.emit('servers:changed');
  bus.emit('server:sync', s);
  return { ok: true, channel: ch };
}

export function updateChannel(channelId, patch) {
  const ch = state.channels[channelId];
  if (!ch) return { ok: false, error: 'Channel not found.' };
  if (!canManageChannel(channelId)) return ownershipError('channel');
  if (patch.name != null) {
    const r = validateChannelName(patch.name);
    if (!r.ok) return { ok: false, error: r.error };
    const clash = state.servers[ch.serverId]?.channelIds.some((id) => id !== channelId && state.channels[id]?.name === r.value);
    if (clash) return { ok: false, error: 'This server already has a channel with that name.' };
    ch.name = r.value;
  }
  if (patch.topic != null) ch.topic = String(patch.topic).slice(0, 140);
  if (patch.category != null) ch.category = String(patch.category).slice(0, 24);
  if (patch.type != null) ch.type = patch.type === 'announcement' ? 'announcement' : 'text';
  persistNow();
  bus.emit('channels:changed', ch.serverId);
  bus.emit('channel:updated', ch);
  bus.emit('server:sync', state.servers[ch.serverId]);
  return { ok: true, channel: ch };
}

export function deleteChannel(channelId) {
  const ch = state.channels[channelId];
  if (!ch) return { ok: false, error: 'Channel not found.' };
  if (!canManageChannel(channelId)) return ownershipError('channel');
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
  bus.emit('server:sync', s);
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

/* -------------------------------- blocking ------------------------------- */

/** Have I blocked this person? Blocked people are filtered out everywhere. */
export function isBlocked(userId) {
  return Boolean(userId && state.blocked && state.blocked[userId]);
}

export function blockedList() {
  return Object.values(state.blocked || {})
    .map((b) => ({ ...b, id: b.id || b.userId }))
    .filter((b) => b.id)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

/** Messages from people you blocked are kept, hidden, and come back on unblock. */
export function isHiddenMessage(msg) {
  if (!msg) return false;
  if (msg.system || msg.userId === 'talkingapp') return false;
  return isBlocked(msg.userId);
}

/** The message list a channel should actually show. */
export function visibleMessages(channelId) {
  return (state.messages[channelId] || []).filter((m) => !isHiddenMessage(m));
}

export function blockUser(userId, info = {}) {
  if (!state.self) return { ok: false, error: 'Sign in first.' };
  if (!userId) return { ok: false, error: 'Nobody to block.' };
  if (userId === state.self.id) return { ok: false, error: 'You cannot block yourself.' };
  const known = (info.displayName ? info : null) || state.users[userId] || state.peers[userId]?.user || {};
  const existing = state.blocked[userId];
  state.blocked[userId] = {
    id: userId,
    name: known.displayName || existing?.name || 'Blocked user',
    handle: known.handle || existing?.handle || 'unknown',
    at: existing?.at || Date.now(),
  };
  // a blocked conversation stops counting as unread and stops showing typing
  const dmId = state.dmChannels[userId];
  if (dmId) state.reads[dmId] = Date.now();
  for (const [cid, map] of Object.entries(state.typing)) {
    if (map[userId]) {
      delete map[userId];
      bus.emit('typing:changed', cid);
    }
  }
  persistNow();
  bus.emit('blocked:changed', { userId, blocked: true });
  bus.emit('messages:filtered', { userId });
  bus.emit('presence:changed');
  return { ok: true, blocked: state.blocked[userId] };
}

export function unblockUser(userId) {
  if (!state.blocked?.[userId]) return { ok: false, error: 'That person is not blocked.' };
  delete state.blocked[userId];
  persistNow();
  bus.emit('blocked:changed', { userId, blocked: false });
  bus.emit('messages:filtered', { userId });
  return { ok: true };
}

export function toggleBlockUser(userId, info = {}) {
  return isBlocked(userId) ? unblockUser(userId) : blockUser(userId, info);
}

/** The other person in a direct message channel, if it is one. */
export function dmPeer(channelId) {
  const ch = state.channels[channelId];
  if (!ch || ch.type !== 'dm' || !ch.dmUserId) return null;
  return state.users[ch.dmUserId] || state.peers[ch.dmUserId]?.user || { id: ch.dmUserId, displayName: ch.name, handle: ch.handle };
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
  if (!canPostInChannel(channelId)) {
    toast(ch.type === 'announcement' ? 'Only staff can post in an announcement channel.' : 'Your role in this server is read-only.', 'warn');
    return null;
  }
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

export function editMessage(channelId, msgId, text, { broadcast = true, remote = false } = {}) {
  const m = state.messages[channelId]?.find((x) => x.id === msgId);
  if (!m) return null;
  // Only the author may rewrite a message. `remote` means the network layer
  // already checked that the author (or the server owner) sent the change.
  if (!remote && m.userId !== state.self?.id) {
    toast('You can only edit your own messages.', 'warn');
    return null;
  }
  m.text = String(text).slice(0, 2000);
  m.editedTs = Date.now();
  persist();
  bus.emit('message:updated', { channelId, message: m });
  if (broadcast) bus.emit('message:editOut', { channelId, message: m });
  return m;
}

const tombstones = new Map();   // channelId -> [messageId] recently deleted

export function tombstonesFor(channelId) {
  return tombstones.get(channelId) || [];
}

function rememberTombstone(channelId, msgId) {
  const list = tombstones.get(channelId) || [];
  if (!list.includes(msgId)) list.push(msgId);
  tombstones.set(channelId, list.slice(-50));
}

export function deleteMessage(channelId, msgId, { broadcast = true, remote = false } = {}) {
  const list = state.messages[channelId];
  if (!list) return;
  const i = list.findIndex((m) => m.id === msgId);
  if (i === -1) return;
  if (!remote) {
    const mine = list[i].userId === state.self?.id;
    if (!mine && !canModerateChannel(channelId)) {
      toast('Only the author or a moderator can delete that message.', 'warn');
      return;
    }
  }
  list.splice(i, 1);
  rememberTombstone(channelId, msgId);
  persist();
  bus.emit('message:deleted', { channelId, messageId: msgId });
  if (broadcast) bus.emit('message:deleteOut', { channelId, messageId: msgId });
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
  const mine = m.userId === state.self?.id;
  if (!mine && !canModerateChannel(channelId)) {
    toast('Only the author or a moderator can pin here.', 'warn');
    return;
  }
  m.pinned = !m.pinned;
  persist();
  bus.emit('message:updated', { channelId, message: m });
  bus.emit('pins:changed', channelId);
  return m.pinned;
}

export function pinnedMessages(channelId) {
  return (state.messages[channelId] || []).filter((m) => m.pinned);
}

/* ------------------------- shared log (relay history) -------------------- */

const LOG_MAX = 120;

/** Compact, text-only copy of a channel for the relay's retained history. */
export function logEntriesFor(channelId, limit = LOG_MAX) {
  const ch = state.channels[channelId];
  if (!ch || ch.type === 'dm') return [];
  const list = (state.messages[channelId] || [])
    .filter((m) => m.text && !m.pending && !m.failed && !m.system && m.userId !== 'talkingapp')
    .slice(-limit);
  return list.map((m) => ({
    id: m.id,
    u: m.userId,
    n: m.displayName,
    h: m.handle,
    c: m.accentColor || null,
    t: m.text.slice(0, 1200),
    ts: m.ts,
    pin: m.pinned ? 1 : 0,
    e: m.editedTs ? 1 : 0,
    a: m.avatar?.kind === 'image' ? 0 : 1,
  }));
}

/** Apply a channel history digest from another device or from the relay. */
export function mergeRemoteEntries({ key, channel, entries = [], removed = [] }) {
  const server = Object.values(state.servers).find((s) => s.networkKey === key);
  if (!server) return { ok: false, reason: 'no-server' };
  const name = String(channel || 'general').toLowerCase();
  let ch = server.channelIds.map((id) => state.channels[id]).find((c) => c && c.name === name);
  if (!ch) {
    // a channel that exists on the server owner's side but not here yet
    if (server.ownerId === state.self?.id) return { ok: false, reason: 'looking-at-my-own-server' };
    const created = createChannelRecord(server.id, name, '');
    if (!created) return { ok: false, reason: 'bad-name' };
    state.channels[created.id] = created;
    server.channelIds.push(created.id);
    ch = created;
    bus.emit('channels:changed', server.id);
  }
  const list = state.messages[ch.id] || (state.messages[ch.id] = []);
  const ids = new Set(list.map((m) => m.id));
  let added = 0;
  for (const raw of entries.slice(-LOG_MAX)) {
    if (!raw?.id || !raw.t || ids.has(raw.id)) continue;
    if (removed.includes(raw.id)) continue;
    const msg = makeMessage({
      channelId: ch.id,
      userId: raw.u || 'unknown',
      displayName: raw.n || 'Member',
      handle: raw.h || 'member',
      avatar: defaultAvatar(raw.n || 'Member'),
      accentColor: raw.c || null,
      text: String(raw.t).slice(0, 2000),
      ts: Number(raw.ts) || Date.now(),
      network: true,
    });
    msg.id = raw.id;
    msg.pinned = Boolean(raw.pin);
    msg.editedTs = raw.e ? raw.ts : null;
    list.push(msg);
    ids.add(raw.id);
    added++;
  }
  let removedCount = 0;
  if (removed.length) {
    const kill = new Set(removed);
    for (let i = list.length - 1; i >= 0; i--) {
      if (kill.has(list[i].id)) { list.splice(i, 1); removedCount++; }
    }
  }
  if (added || removedCount) {
    list.sort((a, b) => a.ts - b.ts);
    persist();
    bus.emit('messages:synced', { channelId: ch.id });
    if (state.ui.activeChannelId === ch.id) bus.emit('message:new', { channelId: ch.id, message: list.at(-1) });
    else bus.emit('channel:unread', { channelId: ch.id });
  }
  return { ok: true, channelId: ch.id, added, removed: removedCount };
}

/** A compact card describing a server, so members see the real thing. */
export function serverCardFor(server) {
  if (!server) return null;
  const channels = server.channelIds
    .map((id) => state.channels[id])
    .filter(Boolean)
    .slice(0, limitsFor(currentPlan().id).channels)
    .map((c) => ({ name: c.name, topic: (c.topic || '').slice(0, 120), category: c.category || '', type: c.type || 'text' }));
  const members = Object.values(server.members || {}).slice(0, 60).map((m) => ({ id: m.id, name: m.name, handle: m.handle, role: m.role }));
  return {
    key: server.networkKey,
    name: server.name,
    desc: (server.desc || '').slice(0, 180),
    emoji: server.emoji || null,
    color: server.color || null,
    ownerId: server.ownerId || null,
    ownerName: server.ownerId
      ? (server.ownerId === state.self?.id ? state.self.displayName : state.users[server.ownerId]?.displayName || server.ownerName || null)
      : null,
    isPublic: server.isPublic !== false,
    channels,
    members,
    savedAt: Date.now(),
  };
}

/**
 * Take what another member published about a server. We never let a card change
 * a server we own — that is the whole point of ownership.
 */
export function ingestServerCard(card) {
  if (!card?.key) return { ok: false, reason: 'no-key' };
  const server = Object.values(state.servers).find((s) => s.networkKey === card.key);
  if (!server) return { ok: false, reason: 'no-server' };
  if (server.ownerId && server.ownerId === state.self?.id) return { ok: false, reason: 'mine' };
  if (server.ownerId && card.ownerId && card.ownerId !== server.ownerId) return { ok: false, reason: 'owner-mismatch' };
  let changed = false;
  if (card.name && card.name !== server.name) { server.name = String(card.name).slice(0, 32); changed = true; }
  if (card.desc != null && card.desc !== server.desc) { server.desc = String(card.desc).slice(0, 180); changed = true; }
  if (card.emoji !== undefined && card.emoji !== server.emoji) { server.emoji = card.emoji; changed = true; }
  if (card.color && card.color !== server.color) { server.color = card.color; changed = true; }
  if (!server.ownerId && card.ownerId) { server.ownerId = card.ownerId; changed = true; }
  if (card.ownerName && card.ownerName !== server.ownerName) { server.ownerName = card.ownerName; changed = true; }
  // A card can never flip a server's discoverability. Only its owner decides that.
  if (server.visibility === 'invite') server.isPublic = false;
  if (Array.isArray(card.channels) && card.channels.length) {
    for (const def of card.channels) {
      const name = String(def?.name || '').toLowerCase();
      if (!/^[a-z0-9_-]{1,28}$/.test(name)) continue;
      const existing = server.channelIds.map((id) => state.channels[id]).find((c) => c && c.name === name);
      if (existing) {
        const cat = String(def.category || '').slice(0, 24);
        if (cat !== (existing.category || '')) { existing.category = cat; changed = true; }
        const topic = String(def.topic || '').slice(0, 140);
        if (topic && topic !== existing.topic) { existing.topic = topic; changed = true; }
        if ((def.type === 'announcement') !== (existing.type === 'announcement')) {
          existing.type = def.type === 'announcement' ? 'announcement' : 'text';
          changed = true;
        }
      } else if (server.channelIds.length < 60) {
        const ch = createChannelRecord(server.id, name, String(def.topic || '').slice(0, 140));
        ch.category = String(def.category || '').slice(0, 24);
        ch.type = def.type === 'announcement' ? 'announcement' : 'text';
        state.channels[ch.id] = ch;
        server.channelIds.push(ch.id);
        changed = true;
      }
    }
  }
  if (Array.isArray(card.members) && card.members.length) {
    server.members = server.members || {};
    for (const m of card.members.slice(0, 60)) {
      if (!m?.id) continue;
      const prev = server.members[m.id];
      if (m.role === 'owner' && m.id !== server.ownerId) continue;
      server.members[m.id] = {
        id: m.id,
        name: m.name || prev?.name || 'Member',
        handle: m.handle || prev?.handle || 'member',
        role: m.role === 'owner' ? 'owner' : (isRoleId(m.role) ? m.role : (prev?.role || 'member')),
        plan: prev?.plan || 'free',
        since: prev?.since || Date.now(),
      };
      changed = true;
    }
  }
  if (changed) {
    persist();
    bus.emit('servers:changed');
    bus.emit('members:changed', server.id);
    bus.emit('server:updated', server);
  }
  return { ok: true, server, changed };
}

export function setServerNotify(serverId, level) {
  const server = state.servers[serverId];
  if (!server) return { ok: false, error: 'Server not found.' };
  server.notify = ['all', 'mentions', 'none'].includes(level) ? level : 'all';
  persistNow();
  bus.emit('servers:changed');
  bus.emit('server:updated', server);
  return { ok: true, notify: server.notify };
}

/* --------------------------------- plans --------------------------------- */

export function currentPlan() {
  const id = state.settings?.plan;
  return planOf(isPlanId(id) ? id : DEFAULT_PLAN);
}

export function setPlan(planId) {
  if (!isPlanId(planId)) return { ok: false, error: 'Unknown plan.' };
  state.settings.plan = planId;
  if (state.self) state.self.plan = planId;
  persistNow();
  bus.emit('settings:changed', { key: 'plan', value: planId });
  bus.emit('plan:changed', planOf(planId));
  return { ok: true, plan: planOf(planId) };
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
  return (state.messages[channelId] || []).filter((m) => m.ts > read && !m.isSelf && !m.system && !isHiddenMessage(m)).length;
}

export function mentionCount(channelId) {
  if (!state.self) return 0;
  const read = state.reads[channelId] || 0;
  const handle = state.self.handle;
  return (state.messages[channelId] || []).filter(
    (m) => m.ts > read && !m.isSelf && !isHiddenMessage(m)
      && (new RegExp(`@${handle}\\b`, 'i').test(m.text) || /@everyone\b/i.test(m.text)),
  ).length;
}

export function unreadEverywhere() {
  let total = 0;
  for (const [cid, list] of Object.entries(state.messages)) {
    const read = state.reads[cid] || 0;
    total += list.filter((m) => m.ts > read && !m.isSelf && !m.system && !isHiddenMessage(m)).length;
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
  if (!userId || state.presence[userId] === status) return;
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
    if (isListed(s)) registerNetworkCommunity(s);
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
      if (m.text.toLowerCase().includes(q) && !isHiddenMessage(m)) messages.push({ ...m, channelId: cid });
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

/* -------------------------------- snapshots ------------------------------ */

/** Everything worth saving: profile, servers, channels, history, DMs, settings. */
export function snapshotState() {
  const messages = {};
  for (const [cid, list] of Object.entries(state.messages)) {
    const msgs = list
      .filter((m) => !m.pending)
      .slice(-120)
      .map((m) => ({
        ...m,
        // keep the file small: oversized inline avatars fall back to a colour
        avatar: m.avatar?.kind === 'image' && (m.avatar.src || '').length > 40000
          ? { kind: 'color', color: m.accentColor || AVATAR_COLORS[0], initials: m.avatar.initials || null }
          : m.avatar,
      }));
    if (msgs.length) messages[cid] = msgs;
  }
  return {
    v: 3,
    handle: state.self?.handle || null,
    self: state.self,
    users: Object.fromEntries(Object.entries(state.users).filter(([id]) => id !== state.self?.id).slice(0, 200)),
    servers: state.servers,
    channels: state.channels,
    messages,
    reads: { ...state.reads },
    dmChannels: { ...state.dmChannels },
    settings: { ...state.settings },
    // copies, not references: a snapshot must not change when the app moves on
    blocked: JSON.parse(JSON.stringify(state.blocked || {})),
    ui: {
      activeServerId: state.ui.activeServerId,
      activeChannelId: state.ui.activeChannelId,
      lastChannelByServer: { ...state.ui.lastChannelByServer },
    },
    savedAt: Date.now(),
  };
}

export function applySnapshot(snap, { replaceLocal = true } = {}) {
  if (!snap?.self) throw new Error('That backup has no profile in it.');
  const previousHandle = state.self?.handle || null;
  state.self = normalizeSelf(snap.self);
  state.users = { ...(snap.users || {}) };
  state.users[state.self.id] = state.self;
  state.servers = snap.servers || {};
  state.channels = snap.channels || {};
  state.messages = snap.messages || {};
  state.reads = snap.reads || {};
  state.dmChannels = snap.dmChannels || {};
  state.blocked = snap.blocked || {};
  state.settings = { ...DEFAULT_SETTINGS, ...(snap.settings || {}) };
  state.self.plan = isPlanId(state.settings.plan) ? state.settings.plan : DEFAULT_PLAN;

  for (const srv of Object.values(state.servers)) {
    srv.channelIds = (srv.channelIds || []).filter((id) => state.channels[id]);
    if (!srv.channelIds.length) {
      const ch = createChannelRecord(srv.id, 'general', '');
      state.channels[ch.id] = ch;
      srv.channelIds.push(ch.id);
    }
    srv.defaultChannelId = srv.channelIds.includes(srv.defaultChannelId) ? srv.defaultChannelId : srv.channelIds[0];
    srv.networkKey = srv.networkKey || networkKeyFor(srv.name);
    srv.notify = ['all', 'mentions', 'none'].includes(srv.notify) ? srv.notify : 'all';
    srv.inviteCode = srv.inviteCode || `inv_${randId(9)}`;
    srv.visibility = srv.visibility === 'invite' || srv.isPublic === false ? 'invite' : 'public';
    srv.isPublic = srv.visibility === 'public';
    srv.members = srv.members && typeof srv.members === 'object' ? srv.members : {};
    if (srv.ownerId === state.self.id && srv.members[state.self.id]) srv.members[state.self.id].role = 'owner';
  }
  if (!state.ui || !state.ui.activeServerId) {
    state.ui.activeServerId = snap.ui?.activeServerId && state.servers[snap.ui.activeServerId] ? snap.ui.activeServerId : Object.keys(state.servers)[0] || '@me';
    state.ui.activeChannelId = state.channels[snap.ui?.activeChannelId] ? snap.ui.activeChannelId : null;
  }
  const firstServer = state.ui.activeServerId && state.ui.activeServerId !== '@me' ? state.servers[state.ui.activeServerId] : null;
  if (!state.ui.activeChannelId && firstServer) state.ui.activeChannelId = firstServer.defaultChannelId;

  state.ready = true;
  if (replaceLocal) persistNow();
  if (previousHandle && previousHandle !== state.self.handle) {
    storage.remove(`${PROFILE_KEY}.${previousHandle}`);
  }
  bus.emit('identity:created', state.self);
  bus.emit('servers:changed');
  bus.emit('channels:changed');
  bus.emit('dms:changed');
  bus.emit('settings:changed', { key: 'all' });
  bus.emit('active:changed');
  return state;
}

/** Attach a downloaded image/GIF to a message that already exists. */
export function setMessageAttachment(channelId, msgId, attachment) {
  const m = state.messages[channelId]?.find((x) => x.id === msgId);
  if (!m) return null;
  m.attachment = attachment;
  m.attachmentDropped = false;
  persist();
  bus.emit('message:updated', { channelId, message: m });
  return m;
}

export function resetEverything() {
  wipeDevice();
}

export { DEFAULT_SETTINGS, createChannelRecord };
