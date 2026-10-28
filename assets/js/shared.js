// TalkingApp — shared history over the relay
//
// Two kinds of retained frames keep everyone in sync without a backend:
//
//   • log/<serverKey>/<channel>  a compact digest of that channel's recent
//     messages, so a brand-new device (or someone who was asleep) still sees
//     the conversation. Retained frames are replayed by the relay and by the
//     public brokers to anyone who connects later.
//
//   • srv/<serverKey>            a card describing the server: real name,
//     icon, colour, owner, channels, categories and member roles. Members who
//     joined by invite see the actual server instead of a blank mirror.
//
// Anything that arrives for a server we do not have yet is held in memory and
// applied the moment we join, so the invite flow lands people in a populated
// server rather than an empty one.

import { bus } from './bus.js';
import { net } from './net.js';
import {
  state, logEntriesFor, mergeRemoteEntries, ingestServerCard, serverCardFor,
  tombstonesFor, currentPlan, canManageServer, noteRemoteCommunity, isListed,
  applyRekey,
} from './store.js';
import { limitsFor } from './plans.js';

const pendingLogs = new Map();     // serverKey/channel -> packet
const cards = new Map();           // serverKey -> card
const logTimers = new Map();       // channelId -> timeout
const cardTimers = new Map();      // serverId -> timeout
let wired = false;
let flushTimer = null;

export function cardFor(key) {
  return cards.get(String(key || '')) || null;
}

export function knownCardKeys() {
  return [...cards.keys()];
}

export function pendingLogCount() {
  return pendingLogs.size;
}

/* ------------------------------- publishing ------------------------------- */

function channelDigest(channelId) {
  const channel = state.channels[channelId];
  if (!channel || channel.type === 'dm' || !channel.serverId) return null;
  const server = state.servers[channel.serverId];
  if (!server?.networkKey) return null;
  // Invite-only servers keep their history off the shared room entirely.
  if (!isListed(server)) return null;
  const limit = Math.min(120, limitsFor(currentPlan().id).logEntries);
  const entries = logEntriesFor(channelId, limit);
  const removed = tombstonesFor(channelId);
  if (!entries.length && !removed.length) return null;
  return {
    key: server.networkKey,
    channel: channel.name,
    entries,
    removed,
  };
}

/** Queue a channel digest publish (debounced — bursts of typing stay cheap). */
export function scheduleChannelLog(channelId) {
  if (!channelId) return;
  clearTimeout(logTimers.get(channelId));
  logTimers.set(channelId, setTimeout(() => {
    logTimers.delete(channelId);
    const digest = channelDigest(channelId);
    if (!digest) return;
    net.publishChannelLog(digest);
  }, 900));
}

export function publishChannelLogNow(channelId) {
  const digest = channelDigest(channelId);
  if (!digest) return 0;
  return net.publishChannelLog(digest);
}

/** Publish the authoritative card for a server we actually run. */
export function scheduleServerCard(server) {
  const srv = typeof server === 'string' ? state.servers[server] : server;
  if (!srv || !isListed(srv) || srv.isRemote) return;
  if (!canManageServer(srv)) return;
  clearTimeout(cardTimers.get(srv.id));
  cardTimers.set(srv.id, setTimeout(() => {
    cardTimers.delete(srv.id);
    if (!state.servers[srv.id]) return;
    net.publishServerCard(serverCardFor(srv));
  }, 1600));
}

export function publishAllNow() {
  for (const s of Object.values(state.servers)) {
    if (isListed(s) && !s.isRemote && canManageServer(s)) net.publishServerCard(serverCardFor(s));
  }
  for (const [cid, ch] of Object.entries(state.channels)) {
    if (ch?.serverId) publishChannelLogNow(cid);
  }
}

/**
 * Send a card straight to one person. Invite-only servers use this instead of
 * the shared room, so their name and channels never leak to strangers.
 */
export function sendCardTo(peerId, server) {
  const srv = typeof server === 'string' ? state.servers[server] : server;
  if (!srv || !peerId) return 0;
  return net.sendServerCard({ to: peerId, card: serverCardFor(srv) });
}

/** Tell everybody inside an invite-only server that its key moved. */
export function announceRekey({ oldKey, nextKey, serverId }) {
  if (!oldKey || !nextKey) return 0;
  return net.sendRekey({ oldKey, nextKey, serverId });
}

/* ------------------------------- receiving ------------------------------- */

function rememberPending(p) {
  const id = `${p.key}/${p.channel}`;
  const prev = pendingLogs.get(id);
  if (!prev || (p.savedAt || 0) >= (prev.savedAt || 0)) pendingLogs.set(id, p);
  // bound the cache so a busy network can never grow it without limit
  while (pendingLogs.size > 220) pendingLogs.delete(pendingLogs.keys().next().value);
}

function applyLogPacket(p) {
  if (!p?.key || !p?.channel) return;
  const server = Object.values(state.servers).find((s) => s.networkKey === p.key);
  if (!server) {
    rememberPending(p);
    return;
  }
  const result = mergeRemoteEntries({ key: p.key, channel: p.channel, entries: p.entries || [], removed: p.removed || [] });
  if (result?.ok && result.added) bus.emit('history:arrived', { channelId: result.channelId, added: result.added });
}

function applyCardPacket(p) {
  if (p?.to && p.to !== state.self?.id) return;
  const card = p?.card;
  if (!card?.key) return;
  const prev = cards.get(card.key);
  if (!prev || (card.savedAt || 0) >= (prev.savedAt || 0)) cards.set(card.key, card);
  noteRemoteCommunity({
    key: card.key,
    name: card.name,
    topic: card.desc,
    channels: (card.channels || []).map((c) => c.name),
    peerId: card.ownerId || 'server',
  });
  const res = ingestServerCard(card);
  if (res?.ok && res.changed) bus.emit('server:card-applied', { server: res.server });
}

/**
 * Apply everything we cached for a server we just joined. Called from the join
 * flow and after unlocking, so a fresh install never shows an empty room.
 */
export function applyPendingForServer(serverKey) {
  if (!serverKey) return 0;
  let applied = 0;
  for (const [id, p] of [...pendingLogs]) {
    if (p.key !== serverKey) continue;
    const res = mergeRemoteEntries({ key: p.key, channel: p.channel, entries: p.entries || [], removed: p.removed || [] });
    if (res?.ok) { applied += res.added; pendingLogs.delete(id); }
  }
  const card = cards.get(serverKey);
  if (card) ingestServerCard(card);
  return applied;
}

/** Apply cached history for every server we already have. */
export function flushPending() {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    for (const [id, p] of [...pendingLogs]) {
      const server = Object.values(state.servers).find((s) => s.networkKey === p.key);
      if (!server) continue;
      const res = mergeRemoteEntries({ key: p.key, channel: p.channel, entries: p.entries || [], removed: p.removed || [] });
      if (res?.ok) pendingLogs.delete(id);
    }
    for (const card of cards.values()) ingestServerCard(card);
  }, 250);
}

/* --------------------------------- wiring -------------------------------- */

export function initShared() {
  if (wired) return;
  wired = true;

  bus.on('net:log', applyLogPacket);
  bus.on('net:server-card', applyCardPacket);
  bus.on('net:rekey', (p) => {
    if (p.from?.id === state.self?.id) return;
    const res = applyRekey({ oldKey: p.oldKey, nextKey: p.nextKey });
    if (res.ok) {
      bus.emit('server:rekeyed', { server: res.server });
      // republish under the new key once things have settled
      setTimeout(publishAllNow, 800);
    }
  });

  // republish whenever the thing we are the source of truth for changes
  bus.on('message:new', ({ channelId }) => scheduleChannelLog(channelId));
  bus.on('message:updated', ({ channelId }) => scheduleChannelLog(channelId));
  bus.on('message:deleted', ({ channelId }) => scheduleChannelLog(channelId));
  bus.on('messages:synced', ({ channelId }) => scheduleChannelLog(channelId));
  bus.on('pins:changed', (channelId) => scheduleChannelLog(channelId));

  bus.on('server:sync', (server) => scheduleServerCard(server));
  bus.on('server:updated', (server) => scheduleServerCard(server));
  bus.on('servers:changed', () => { for (const s of Object.values(state.servers)) scheduleServerCard(s); });
  bus.on('channels:changed', () => { for (const s of Object.values(state.servers)) scheduleServerCard(s); });
  bus.on('members:changed', (serverId) => { if (serverId) scheduleServerCard(serverId); });

  let lastOnlinePublish = 0;
  bus.on('net:status', ({ status }) => {
    if (status !== 'online') return;
    // a reconnected relay may have restarted: put our public rooms back, but
    // never more than once every half minute on a flapping connection
    if (Date.now() - lastOnlinePublish < 30000) return;
    lastOnlinePublish = Date.now();
    setTimeout(publishAllNow, 900);
  });
  bus.on('vault:restored', () => setTimeout(publishAllNow, 700));
  bus.on('identity:created', () => setTimeout(flushPending, 500));
}
