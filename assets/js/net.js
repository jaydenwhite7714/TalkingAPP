// TalkingApp — real-time network layer
//
// Everyone with the page open joins the same room on public relay infrastructure.
// Two transport kinds are supported and merged:
//   • mqtt    — pub/sub over WebSocket to a public MQTT broker (mqtt.js, vendored)
//   • raw-ws  — a plain WebSocket that broadcasts JSON to every connected client
//   • local   — BroadcastChannel, links tabs/windows on the same machine (always on)
//
// All transports carry the same JSON envelope, so anything that arrives twice is
// de-duplicated by envelope id.

import { bus } from './bus.js';
import { CONFIG } from './config.js';
import { randId } from './util.js';

const SEEN_LIMIT = 600;
const HEARTBEAT_MS = CONFIG.relay.heartbeatMs;
const PEER_TIMEOUT_MS = CONFIG.relay.peerTimeoutMs;

let mqttLibPromise = null;
function loadMqttLib() {
  if (globalThis.mqtt) return Promise.resolve(globalThis.mqtt);
  if (mqttLibPromise) return mqttLibPromise;
  mqttLibPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL('../vendor/mqtt.min.js', import.meta.url).href;
    script.async = true;
    script.onload = () => (globalThis.mqtt ? resolve(globalThis.mqtt) : reject(new Error('mqtt bundle missing')));
    script.onerror = () => reject(new Error('Could not load the relay library'));
    document.head.appendChild(script);
  }).catch((e) => {
    mqttLibPromise = null;
    throw e;
  });
  return mqttLibPromise;
}

class MqttTransport {
  constructor(candidate) {
    this.kind = 'mqtt';
    this.url = candidate.url;
    this.label = new URL(candidate.url).host;
    this.state = 'idle';
    this.client = null;
    this.optional = Boolean(candidate.optional);
  }

  async connect(ctx) {
    this.state = 'connecting';
    ctx.onStatus();
    let mqtt;
    try {
      mqtt = await loadMqttLib();
    } catch (err) {
      this.state = 'error';
      this.error = err.message;
      ctx.onStatus();
      return;
    }
    if (this.closed) return;
    const topicBase = `${CONFIG.room}`;
    const clientId = `ta_${ctx.sid}_${randId(6)}`;
    let url = this.url;
    try {
      this.client = mqtt.connect(url, {
        clientId,
        clean: true,
        keepalive: 30,
        reconnectPeriod: 5000,
        connectTimeout: 9000,
        protocolVersion: 4,
        resubscribe: true,
      });
    } catch (err) {
      this.state = 'error';
      this.error = err.message;
      ctx.onStatus();
      return;
    }

    const c = this.client;
    const failTimer = setTimeout(() => {
      if (this.state !== 'online') {
        this.state = 'error';
        this.error = 'Timed out connecting';
        ctx.onStatus();
        try { c.end(true); } catch {}
      }
    }, 12000);

    c.on('connect', () => {
      clearTimeout(failTimer);
      this.state = 'online';
      this.error = null;
      c.subscribe(`${topicBase}/#`, { qos: 0 }, (err) => {
        if (err) {
          this.state = 'error';
          this.error = err.message;
        }
        ctx.onStatus();
        ctx.onOnline(this);
      });
    });
    c.on('message', (topic, payload) => {
      if (!topic.startsWith(`${topicBase}/`)) return;
      if (topic.endsWith('/hello')) return;
      try {
        ctx.onPacket(payload.toString(), this);
      } catch {}
    });
    c.on('reconnect', () => {
      if (this.state === 'online') this.state = 'connecting';
      ctx.onStatus();
    });
    c.on('close', () => {
      if (this.state === 'online') this.state = 'connecting';
      ctx.onStatus();
    });
    c.on('error', (err) => {
      this.error = err?.message || 'Relay error';
      if (this.state !== 'online') this.state = 'error';
      ctx.onStatus();
    });
  }

  send(payload) {
    if (this.state !== 'online' || !this.client) return false;
    try {
      this.client.publish(`${CONFIG.room}/msg`, payload, { qos: 0, retain: false });
      return true;
    } catch {
      return false;
    }
  }

  /** Retained messages survive on the broker, so a new device can pick them up. */
  sendRetained(topic, payload) {
    if (this.state !== 'online' || !this.client) return false;
    try {
      this.client.publish(`${CONFIG.room}/${topic}`, payload, { qos: 1, retain: true });
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this.closed = true;
    try { this.client?.end(true); } catch {}
  }
}

class RawWsTransport {
  constructor(candidate) {
    this.kind = 'raw-ws';
    this.url = candidate.url;
    this.label = new URL(candidate.url).host;
    this.state = 'idle';
    this.ws = null;
    this.optional = Boolean(candidate.optional);
    this.attempts = 0;
  }

  connect(ctx) {
    this.ctx = ctx;
    this.state = 'connecting';
    ctx.onStatus();
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.state = 'error';
      this.error = err.message;
      ctx.onStatus();
      return;
    }
    const ws = this.ws;
    const failTimer = setTimeout(() => {
      if (this.state !== 'online') {
        this.state = 'error';
        this.error = 'Timed out connecting';
        ctx.onStatus();
        try { ws.close(); } catch {}
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(failTimer);
      this.state = 'online';
      this.error = null;
      this.attempts = 0;
      ctx.onStatus();
      ctx.onOnline(this);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      try { ctx.onPacket(ev.data, this); } catch {}
    };
    ws.onerror = () => {
      this.error = 'Connection failed';
      if (this.state !== 'online') this.state = 'error';
      ctx.onStatus();
    };
    ws.onclose = () => {
      clearTimeout(failTimer);
      const wasOnline = this.state === 'online';
      this.state = wasOnline ? 'reconnecting' : 'error';
      ctx.onStatus();
      if (this.closed) return;
      const delay = Math.min(20000, 1500 * Math.pow(1.6, this.attempts++));
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this.connect(ctx), delay);
    };
  }

  send(payload) {
    if (this.state !== 'online') return false;
    try { this.ws.send(payload); return true; } catch { return false; }
  }

  sendRetained(topic, payload) {
    if (this.state !== 'online') return false;
    try {
      this.ws.send(JSON.stringify({ __ta_retain: true, topic, payload }));
      return true;
    } catch { return false; }
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    try { this.ws?.close(); } catch {}
  }
}

class LocalTransport {
  constructor() {
    this.kind = 'local';
    this.url = 'broadcast-channel';
    this.label = 'this device';
    this.state = 'online';
    this.channel = null;
  }
  connect(ctx) {
    this.ctx = ctx;
    try {
      this.channel = new BroadcastChannel(`${CONFIG.room}-local`);
      this.channel.onmessage = (ev) => {
        if (typeof ev.data === 'string') ctx.onPacket(ev.data, this);
      };
      this.state = 'online';
    } catch {
      this.state = 'error';
    }
    ctx.onStatus();
    if (this.state === 'online') ctx.onOnline(this);
  }
  send(payload) {
    if (this.state !== 'online' || !this.channel) return false;
    try { this.channel.postMessage(payload); return true; } catch { return false; }
  }

  sendRetained() { return false; }
  close() { try { this.channel?.close(); } catch {} }
}

/* ------------------------------- the client ------------------------------- */

const seen = new Set();
const seenOrder = [];
function remember(id) {
  if (!id) return false;
  if (seen.has(id)) return false;
  seen.add(id);
  seenOrder.push(id);
  if (seenOrder.length > SEEN_LIMIT) seen.delete(seenOrder.shift());
  return true;
}

export const net = {
  sid: randId(10),
  profile: null,
  communities: [],
  transports: [],
  peers: new Map(),      // user id -> { user, status, communities, lastSeen, ts }
  started: false,
  typingOut: new Map(),
  outbox: [],
  _heartbeat: null,
  _sweep: null,

  init({ profile, communities }) {
    this.profile = profile;
    this.communities = communities || [];
    // the lock screen connects with a placeholder profile; swap it live later
    if (this.started && profile?.id && profile.id !== 'lock') this.updateProfile(profile, this.communities);
    return this;
  },

  start() {
    if (this.started) return;
    this.started = true;
    const ctx = {
      sid: this.sid,
      onStatus: () => this.emitStatus(),
      onOnline: (transport) => {
        this.emitStatus();
        this.publish({ kind: 'hello', status: this.profile?.status || 'online', communities: this.communities, user: this.wireProfile() });
        if (transport.kind !== 'local') this.flushOutbox();
      },
      onPacket: (raw, transport) => this.handlePacket(raw, transport),
    };

    const make = (c) => {
      if (c.kind === 'mqtt') return new MqttTransport(c);
      if (c.kind === 'raw-ws') return new RawWsTransport(c);
      return new LocalTransport(c);
    };
    const candidates = CONFIG.relay.candidates;
    this.transports = candidates.map(make);
    const started = new Set();
    const bringUp = (t) => {
      if (!t || started.has(t)) return;
      started.add(t);
      try { t.connect(ctx); } catch (e) { t.state = 'error'; t.error = e.message; }
    };

    // local tab-bridge and the first two relays come up immediately
    this.transports.filter((t) => t.kind === 'local').forEach(bringUp);
    const relays = this.transports.filter((t) => t.kind !== 'local');
    relays.slice(0, 2).forEach(bringUp);
    // spare relays only if the first ones don't come through
    clearTimeout(this._spareTimer);
    this._spareTimer = setTimeout(() => {
      if (this.status() !== 'online') relays.slice(2).forEach(bringUp);
    }, 6500);

    clearInterval(this._heartbeat);
    this._heartbeat = setInterval(() => {
      this.publish({ kind: 'presence', status: this.profile?.status || 'online', communities: this.communities, user: this.wireProfile() }, { noDedupe: true });
    }, HEARTBEAT_MS);

    clearInterval(this._sweep);
    this._sweep = setInterval(() => this.sweep(), 5000);

    window.addEventListener('pagehide', () => this.stop());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.publish({ kind: 'presence', status: this.profile?.status || 'online', communities: this.communities, user: this.wireProfile() }, { noDedupe: true });
        this.sweep();
      }
    });
    setTimeout(() => this.emitStatus(), 50);
  },

  stop() {
    this.publish({ kind: 'bye' }, { noDedupe: true });
    for (const t of this.transports) t.close();
    clearInterval(this._heartbeat);
    clearInterval(this._sweep);
    this.started = false;
  },

  updateProfile(profile, communities) {
    this.profile = profile;
    if (communities) this.communities = communities;
    this.publish({ kind: 'presence', status: profile?.status || 'online', communities: this.communities, user: this.wireProfile() }, { noDedupe: true });
  },

  wireProfile() {
    const p = this.profile || {};
    // image avatars travel as a 96px copy so other people actually see them
    const av = p.avatar?.kind === 'image'
      ? (p.avatar.wire ? { kind: 'image', src: p.avatar.wire } : null)
      : p.avatar;
    return {
      id: p.id,
      displayName: p.displayName,
      handle: p.handle,
      accentColor: p.accentColor,
      avatar: av,
      plan: p.plan || 'free',
      bio: (p.bio || '').slice(0, 190),
    };
  },

  onlineCount() {
    return this.transports.filter((t) => t.kind !== 'local' && t.state === 'online').length > 0;
  },

  status() {
    const live = this.transports.filter((t) => t.kind !== 'local' && t.state === 'online').length;
    if (live > 0) return 'online';
    const trying = this.transports.some((t) => t.state === 'connecting' || t.state === 'reconnecting');
    return trying ? 'connecting' : 'offline';
  },

  emitStatus() {
    bus.emit('net:status', {
      status: this.status(),
      transports: this.transports.map((t) => ({ kind: t.kind, url: t.url, label: t.label, state: t.state, error: t.error || null })),
      peers: this.peers.size,
    });
  },

  flushOutbox() {
    if (!this.outbox.length) return;
    const cutoff = Date.now() - 10 * 60 * 1000;
    const pending = this.outbox.filter((item) => item.ts > cutoff);
    this.outbox = [];
    for (const item of pending) {
      let sent = 0;
      for (const t of this.transports) if (t.kind !== 'local' && t.send(item.json)) sent++;
      if (!sent) { this.outbox.push(item); break; }
      bus.emit('net:flushed', { kind: item.kind });
    }
    if (this.outbox.length === 0) bus.emit('net:outbox-empty');
  },

  queuedCount() {
    return this.outbox.length;
  },

  publish(env, { noDedupe = false } = {}) {
    const packet = {
      v: 1,
      sid: this.sid,
      id: env.id || randId(12),
      ts: Date.now(),
      from: this.wireProfile(),
      ...env,
    };
    const json = JSON.stringify(packet);
    let sent = 0;
    for (const t of this.transports) {
      const ok = t.send(json);
      if (ok && t.kind !== 'local') sent++;
    }
    if (!noDedupe) remember(packet.id);
    else remember(`p_${packet.id}`);
    if (!sent && env.kind !== 'bye' && env.kind !== 'hello') {
      this.outbox.push({ json, ts: Date.now(), kind: env.kind });
      if (this.outbox.length > 60) this.outbox.shift();
    }
    return sent;
  },

  handlePacket(raw, transport) {
    // chunks stay well under this; whole-vault frames can be a little larger
    if (!raw || raw.length > 120000) return;
    // the raw relay forwards retained frames wrapped in their topic: unwrap and
    // treat the payload exactly as if we had just received it
    if (raw.startsWith('{"__ta_retain"')) {
      try {
        const frame = JSON.parse(raw);
        if (frame?.__ta_retain && frame.payload) this.handlePacket(String(frame.payload), transport);
      } catch {}
      return;
    }
    let p;
    try { p = JSON.parse(raw); } catch { return; }
    if (!p || p.v !== 1 || !p.from?.id) return;
    if (p.sid === this.sid) return;              // our own echo

    // system traffic (vault copies, username lookups) never becomes a "peer"
    if (p.system || String(p.kind).startsWith('vault')) {
      if (!remember(p.id)) return;
      if (p.kind === 'vault-request') bus.emit('net:vault-request', p);
      else if (p.kind === 'vault') bus.emit('net:vault', p);
      else if (p.kind === 'handle-check') bus.emit('net:handle-check', p);
      else if (p.kind === 'handle-taken') bus.emit('net:handle-taken', p);
      else if (p.kind === 'log') bus.emit('net:log', p);
      else if (p.kind === 'server-card') bus.emit('net:server-card', p);
      return;
    }
    if (p.from.id === this.profile?.id && p.sid !== this.sid) {
      // another tab signed in as the same profile — still show it, but don't DM yourself
    }
    if (!remember(p.id)) return;                 // duplicate across transports

    const user = p.from;
    const existing = this.peers.get(user.id);
    const communities = (Array.isArray(p.communities) ? p.communities : [])
      .map((c) => (typeof c === 'string' ? c : c?.key))
      .filter(Boolean);
    this.peers.set(user.id, {
      user: { ...(existing?.user || {}), ...user },
      status: p.status || existing?.status || 'online',
      communities: communities.length ? communities : (existing?.communities || []),
      lastSeen: Date.now(),
      ts: existing?.ts || Date.now(),
      transport: transport.kind,
    });

    if (p.kind === 'bye') {
      this.peers.delete(user.id);
      bus.emit('net:leave', { userId: user.id });
      this.emitStatus();
      return;
    }

    const isNew = !existing;
    if (isNew) bus.emit('net:join', { peer: this.peers.get(user.id) });
    if (p.kind === 'hello' || p.kind === 'presence') {
      bus.emit('net:presence', { peer: this.peers.get(user.id), isNew });
      this.emitStatus();
      // Introduce ourselves right away so the newcomer sees us without waiting
      // for the next heartbeat. Only on first contact, so we never ping-pong.
      if (isNew) {
        setTimeout(() => this.publish({ kind: 'presence', status: this.profile?.status || 'online', communities: this.communities, user: this.wireProfile() }, { noDedupe: true }), 120);
      }
      return;
    }
    bus.emit('net:peer', { peer: this.peers.get(user.id) });
    bus.emit(`net:${p.kind}`, p);
  },

  sweep() {
    const now = Date.now();
    let removed = 0;
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > PEER_TIMEOUT_MS) {
        this.peers.delete(id);
        bus.emit('net:leave', { userId: id });
        removed++;
      }
    }
    if (removed) this.emitStatus();
    else bus.emit('net:tick');
  },

  sendChat({ channelKey, channel, serverKey, serverName, serverTopic, channels, message, replyTo }) {
    const att = message.attachment
      ? { kind: message.attachment.kind, name: message.attachment.name, width: message.attachment.width, height: message.attachment.height, size: message.attachment.bytes || message.attachment.src?.length || 0 }
      : null;
    return this.publish({
      kind: 'chat',
      key: serverKey,
      serverName,
      serverTopic,
      channels,
      channel,
      msgId: message.id,
      text: message.text,
      att,
      msgTs: message.ts,
      replyTo: replyTo ? { name: replyTo.displayName, text: replyTo.text.slice(0, 120) } : null,
    });
  },

  /** Push a picture/GIF alongside a chat message, in relay-sized chunks. */
  sendMedia({ serverKey, channel, msgId, attachment, to = null }) {
    if (!attachment?.src) return 0;
    const CHUNK = 15000;
    const data = attachment.src;
    const total = Math.ceil(data.length / CHUNK);
    const meta = {
      kind: attachment.kind || 'image',
      name: attachment.name || 'image',
      width: attachment.width || 0,
      height: attachment.height || 0,
    };
    let sent = 0;
    for (let part = 0; part < total; part++) {
      sent += this.publish({
        kind: to ? 'media-dm' : 'media',
        key: serverKey,
        channel,
        to,
        msgId,
        part,
        total,
        meta,
        data: data.slice(part * CHUNK, (part + 1) * CHUNK),
      }) ? 1 : 0;
    }
    return sent;
  },

  /* ----------------------------- vault (cloud) ---------------------------- */

  publishVault({ handle, parts, total, savedAt }) {
    let sent = 0;
    parts.forEach((data, part) => {
      const packet = {
        v: 1,
        sid: 'vault',
        id: randId(12),
        ts: Date.now(),
        system: true,
        from: { id: 'vault', displayName: 'Vault' },
        kind: 'vault',
        handle,
        part,
        total,
        savedAt,
        data,
      };
      const json = JSON.stringify(packet);
      for (const t of this.transports) {
        if (t.kind === 'local') continue;
        if (t.sendRetained?.(`vault/${handle}/${part}`, json) && t.state === 'online') sent++;
      }
    });
    return sent;
  },

  /**
   * Publish a compact history digest for one channel as a retained frame.
   * Retained frames are replayed to anyone who connects later, so a brand-new
   * device sees the conversation without needing another person online.
   */
  publishChannelLog({ key, channel, entries, removed, savedAt }) {
    if (!key || !channel) return 0;
    const body = this.packRetained({
      kind: 'log',
      key,
      channel,
      entries,
      removed,
      savedAt: savedAt || Date.now(),
    });
    return this.sendSystemRetained(`log/${key}/${channel}`, body);
  },

  /** Publish what a server looks like, so members see its real name and icon. */
  publishServerCard(card) {
    if (!card?.key) return 0;
    const body = this.packRetained({ kind: 'server-card', card });
    return this.sendSystemRetained(`srv/${card.key}`, body);
  },

  /** Build a system envelope and cap it so brokers and the relay both accept it. */
  packRetained(env) {
    const packet = {
      v: 1,
      sid: 'log',
      id: randId(12),
      ts: Date.now(),
      system: true,
      from: { id: 'log', displayName: 'History' },
      ...env,
    };
    let json = JSON.stringify(packet);
    // digests carry a message list; keep the newest ones if it grows too big
    while (json.length > 96000 && Array.isArray(packet.entries) && packet.entries.length > 1) {
      packet.entries = packet.entries.slice(1);
      json = JSON.stringify(packet);
    }
    return json;
  },

  sendSystemRetained(topic, json) {
    // Retained frames are replayed by every broker that stores them, so two
    // copies is plenty: enough for redundancy without flooding the room.
    let sent = 0;
    for (const t of this.transports) {
      if (t.kind === 'local' || t.state !== 'online' || sent >= 2) continue;
      try {
        if (t.sendRetained?.(topic, json)) sent++;
      } catch {}
    }
    return sent;
  },

  requestVault(handle) {
    return this.publish({ kind: 'vault-request', handle, system: true }, { noDedupe: true });
  },

  /** Ask everyone online whether a username is already in use. */
  checkHandle(handle, { timeout = 1400 } = {}) {
    const target = String(handle || '').toLowerCase();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        bus.off('net:handle-taken', onTaken);
        resolve(value);
      };
      const onTaken = (p) => {
        if (String(p.handle || '').toLowerCase() === target) finish({ taken: true, by: p.from?.displayName || null });
      };
      const timer = setTimeout(() => finish({ taken: false }), timeout);
      bus.on('net:handle-taken', onTaken);
      this.publish({ kind: 'handle-check', handle: target, system: true }, { noDedupe: true });
    });
  },

  /** Ask whoever is already in a community to replay recent history. */
  requestHistory({ serverKey }) {
    return this.publish({ kind: 'sync', key: serverKey }, { noDedupe: true });
  },

  sendHistory({ serverKey, channel, entries, to }) {
    return this.publish({ kind: 'history', key: serverKey, channel, entries, to }, { noDedupe: true });
  },

  sendTyping({ serverKey, channel }) {
    const k = `${serverKey}/${channel}`;
    const last = this.typingOut.get(k) || 0;
    if (Date.now() - last < 2500) return;
    this.typingOut.set(k, Date.now());
    this.publish({ kind: 'typing', key: serverKey, channel }, { noDedupe: true });
  },

  sendDM({ to, message }) {
    return this.publish({
      kind: 'dm',
      to,
      msgId: message.id,
      text: message.text,
      msgTs: message.ts,
    });
  },

  sendReaction({ serverKey, channel, msgId, emoji, op, to = null }) {
    return this.publish({ kind: 'reaction', key: serverKey, channel, msgId, emoji, op, to });
  },

  sendEdit({ serverKey, channel, msgId, text, to = null }) {
    return this.publish({ kind: 'edit', key: serverKey, channel, msgId, text, to });
  },

  sendDelete({ serverKey, channel, msgId, to = null }) {
    return this.publish({ kind: 'delete', key: serverKey, channel, msgId, to });
  },
};
