// TalkingApp — the vault: an encrypted copy of everything, and file backups
//
// "Save everything" has two layers:
//   • a JSON file you can download and keep (works with zero network), and
//   • a sealed copy published through the relay, so signing in on another
//     Chromebook with the same username + password restores servers, channels,
//     history, DMs, settings and profile.

import { state, snapshotState, applySnapshot } from './store.js';
import { deriveVaultKey, encryptJson, decryptJson, readAccount, VAULT_KEY } from './account.js';
import { storage } from './util.js';
import { net } from './net.js';
import { bus } from './bus.js';

const CHUNK = 11000;          // characters of base64 per relay message
const MAX_CHUNKS = 120;       // ~1.3 MB sealed ceiling
const MAX_ATTACHMENT_TOTAL = 620_000;

/* ------------------------------- compression ------------------------------ */

async function deflate(text) {
  if (typeof CompressionStream !== 'function') return { enc: 'none', body: text };
  try {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { enc: 'gzip', body: btoa(bin) };
  } catch {
    return { enc: 'none', body: text };
  }
}

async function inflate(payload) {
  if (payload.enc !== 'gzip') return payload.body;
  const bin = atob(payload.body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/* --------------------------------- sealing -------------------------------- */

export async function sealSnapshot(password) {
  const account = readAccount();
  if (!account) throw new Error('No account on this device.');
  const snapshot = snapshotState();
  const json = JSON.stringify(snapshot);
  const packed = await deflate(json);
  const key = await deriveVaultKey(password, account.salt, account.iterations);
  const sealed = await encryptJson(key, packed);
  return { v: 1, handle: account.handle, savedAt: Date.now(), iterations: account.iterations, salt: account.salt, ...sealed };
}

export async function openSealed(password, sealed) {
  const account = readAccount();
  const salt = sealed.salt || account?.salt;
  const iterations = sealed.iterations || account?.iterations;
  if (!salt) throw new Error('This backup is missing its salt.');
  const key = await deriveVaultKey(password, salt, iterations);
  const packed = await decryptJson(key, sealed);   // throws when the password is wrong
  return JSON.parse(await inflate(packed));
}

/* ------------------------------ cloud publish ----------------------------- */

function chunksOf(text) {
  const total = Math.max(1, Math.ceil(text.length / CHUNK));
  const out = [];
  for (let i = 0; i < total; i++) out.push(text.slice(i * CHUNK, (i + 1) * CHUNK));
  return out;
}

/** Publish the sealed vault as retained relay messages (so new devices get it). */
export async function saveVaultToCloud(password) {
  const sealed = await sealSnapshot(password);
  const blob = JSON.stringify(sealed);
  let parts = chunksOf(blob);
  if (parts.length > MAX_CHUNKS) throw new Error('Your data is too large for the cloud copy — export a file instead.');
  const sent = net.publishVault({ handle: sealed.handle, parts, total: parts.length, savedAt: sealed.savedAt });
  storage.set(VAULT_KEY, { handle: sealed.handle, sealed, savedAt: sealed.savedAt });
  bus.emit('vault:saved', { savedAt: sealed.savedAt, size: blob.length, transports: sent });
  return { sealed, size: blob.length, parts: parts.length };
}

export function localVault() {
  return storage.get(VAULT_KEY, null);
}

/* ------------------------------ cloud receive ----------------------------- */

const incoming = new Map();   // handle -> { parts: Map, total, savedAt }

export function ingestVaultPacket(p) {
  if (!p?.handle || p.part == null) return;
  const key = String(p.handle).toLowerCase();
  const entry = incoming.get(key) || { parts: new Map(), total: p.total, savedAt: p.savedAt };
  entry.total = p.total || entry.total;
  entry.savedAt = Math.max(entry.savedAt || 0, p.savedAt || 0);
  entry.parts.set(Number(p.part), p.data || '');
  incoming.set(key, entry);
  if (entry.parts.size >= entry.total && entry.total > 0) {
    let blob = '';
    for (let i = 0; i < entry.total; i++) {
      const piece = entry.parts.get(i);
      if (piece == null) return;      // wait for the rest
      blob += piece;
    }
    incoming.delete(key);
    let sealed;
    try { sealed = JSON.parse(blob); } catch { return; }
    storage.set(VAULT_KEY, { handle: key, sealed, savedAt: sealed.savedAt });
    bus.emit('vault:received', { handle: key, savedAt: sealed.savedAt });
  }
}

export function hasIncoming(handle) {
  return incoming.has(String(handle || '').toLowerCase());
}

/**
 * Ask the relay (and anyone online) for the cloud copy of a username.
 * Resolves with the sealed blob, or null after the timeout.
 */
export function fetchVaultFromCloud(handle, { timeout = 5200 } = {}) {
  const key = String(handle || '').toLowerCase();
  const local = localVault();
  const cached = local && String(local.handle).toLowerCase() === key ? local : null;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      bus.off('vault:received', onReceived);
      clearTimeout(timer);
      resolve(value);
    };
    const onReceived = ({ handle: h }) => {
      const mine = localVault();
      if (String(h).toLowerCase() === key && mine) finish(mine.sealed);
    };
    const timer = setTimeout(() => finish(cached?.sealed || null), timeout);
    bus.on('vault:received', onReceived);
    if (cached) {
      // we already have one; still give the relay a moment to send a fresher copy
      setTimeout(() => finish(cached.sealed), Math.min(1200, timeout));
    }
    net.requestVault(key);
  });
}

/* -------------------------------- restores -------------------------------- */

export function restoreSnapshot(snapshot, { replaceLocal = true } = {}) {
  if (!snapshot?.self) throw new Error('That backup does not contain a profile.');
  applySnapshot(snapshot, { replaceLocal });
  bus.emit('vault:restored', { handle: snapshot.self.handle });
  return snapshot;
}

/* ------------------------------- file backup ------------------------------ */

export function backupFilename(handle = state.self?.handle || 'me') {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `talkingapp-${handle}-${stamp}.json`;
}

/** Plain JSON backup — everything, readable, yours. */
export async function downloadBackup() {
  const snapshot = snapshotState();
  const payload = { app: 'TalkingApp', kind: 'backup', v: 3, exportedAt: Date.now(), snapshot };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = backupFilename(snapshot.self?.handle);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { size: blob.size, name: a.download };
}

export async function readBackupFile(file) {
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('That file is not a TalkingApp backup.'); }
  const snapshot = parsed.snapshot || (parsed.self ? parsed : null);
  if (!snapshot?.self?.id) throw new Error('That backup has no profile in it.');
  return snapshot;
}

/** Keep total embedded image bytes sane before uploading a cloud copy. */
export function trimAttachments(snapshot) {
  let budget = MAX_ATTACHMENT_TOTAL;
  const channels = Object.entries(snapshot.messages || {});
  for (const [, list] of channels) {
    for (let i = list.length - 1; i >= 0; i--) {
      const att = list[i].attachment;
      if (!att?.src) continue;
      const size = att.src.length;
      if (size > budget) {
        list[i] = { ...list[i], attachment: null, attachmentDropped: true };
      } else {
        budget -= size;
      }
    }
  }
  return snapshot;
}
