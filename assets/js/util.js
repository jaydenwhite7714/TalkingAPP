// TalkingApp — small utilities

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k in node && k !== 'list' && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(4)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function uid(len = 12) {
  const bytes = new Uint8Array(len);
  (globalThis.crypto || { getRandomValues: (a) => a.forEach((_, i) => (a[i] = Math.random() * 256)) }).getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function randId(len = 16) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, len);
}

/** Escape a string for use in a CSS selector. */
export const cssEsc = (s) => (globalThis.CSS?.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c));

export function debounce(fn, ms = 150) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function throttle(fn, ms = 100) {
  let last = 0, timer = null, lastArgs;
  return (...args) => {
    lastArgs = args;
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...lastArgs);
      }, ms - (now - last));
    }
  };
}

export const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function plural(n, word, pluralForm) {
  return `${n} ${n === 1 ? word : pluralForm || word + 's'}`;
}

const clockFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
const shortDateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

export const formatClock = (ts) => clockFmt.format(new Date(ts));
export const formatDate = (ts) => dateFmt.format(new Date(ts));

export function formatDayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7 && diffDays > 0) return weekdayFmt.format(d);
  return d.getFullYear() === now.getFullYear() ? shortDateFmt.format(d) : dateFmt.format(d);
}

export function formatMessageStamp(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86400000);
  const time = clockFmt.format(d);
  if (diffDays === 0) return `Today at ${time}`;
  if (diffDays === 1) return `Yesterday at ${time}`;
  return `${shortDateFmt.format(d)} at ${time}`;
}

export function formatRelative(ts) {
  const diff = Date.now() - ts;
  const abs = Math.abs(diff);
  if (abs < 45_000) return 'just now';
  const mins = Math.round(abs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return shortDateFmt.format(new Date(ts));
}

export function sameDay(a, b) {
  const x = new Date(a), y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** Deterministic, pleasant hue from an arbitrary string. */
export function hueFromString(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

export function colorFromString(str = '', light = 58) {
  const h = hueFromString(str);
  return `hsl(${h} 68% ${light}%)`;
}

// ---------- storage ----------
export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('[storage] failed', e);
      return false;
    }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch {}
  },
};

// ---------- validation ----------
const RESERVED = new Set(['everyone', 'here', 'admin', 'moderator', 'system', 'talkingapp', 'support', 'staff', 'owner']);
const HANDLE_RE = /^[a-z0-9._-]{2,20}$/;

export function validateHandle(raw) {
  const h = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!h) return { ok: false, value: h, error: 'Pick a username.' };
  if (h.length < 2) return { ok: false, value: h, error: 'Usernames need at least 2 characters.' };
  if (h.length > 20) return { ok: false, value: h, error: 'Usernames can be at most 20 characters.' };
  if (!HANDLE_RE.test(h)) return { ok: false, value: h, error: 'Only letters, numbers, dots, dashes and underscores.' };
  if (RESERVED.has(h)) return { ok: false, value: h, error: 'That username is reserved. Try another one.' };
  return { ok: true, value: h };
}

export function validateDisplayName(raw) {
  const n = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!n) return { ok: false, value: n, error: 'Add a display name.' };
  if (n.length > 24) return { ok: false, value: n, error: 'Keep it under 24 characters.' };
  return { ok: true, value: n };
}

export function validateServerName(raw) {
  const n = String(raw || '').trim().replace(/\s+/g, ' ');
  if (n.length < 2) return { ok: false, value: n, error: 'Server names need at least 2 characters.' };
  if (n.length > 32) return { ok: false, value: n, error: 'Server names can be at most 32 characters.' };
  return { ok: true, value: n };
}

export function validateChannelName(raw) {
  const n = String(raw || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!n) return { ok: false, value: n, error: 'Give the channel a name.' };
  if (n.length > 28) return { ok: false, value: n, error: 'Channel names can be at most 28 characters.' };
  return { ok: true, value: n };
}

export function isMobileViewport() {
  return window.matchMedia('(max-width: 860px)').matches;
}

/** Is the user currently scrolled near the bottom of a scroll container? */
export function nearBottom(node, threshold = 120) {
  return node.scrollHeight - node.scrollTop - node.clientHeight < threshold;
}

export function autoResizeTextarea(ta, maxHeight = 220) {
  ta.style.height = 'auto';
  const h = Math.min(maxHeight, ta.scrollHeight);
  ta.style.height = h + 'px';
  ta.style.overflowY = ta.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

export function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  return Promise.resolve(fallbackCopy(text));
}
function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch {}
  ta.remove();
}

/** Move focus without triggering scroll jumps. */
export function focusQuiet(node, opts = { preventScroll: true }) {
  try { node?.focus(opts); } catch {}
}

export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable || tag === 'SELECT';
}
