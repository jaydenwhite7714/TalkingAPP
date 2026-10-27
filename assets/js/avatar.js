// TalkingApp — avatars (uploaded images or generated gradient initials)
import { escapeHtml, hueFromString } from './util.js';

export const AVATAR_COLORS = [
  '#5865f2', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b',
  '#22c55e', '#06b6d4', '#3b82f6', '#a3e635', '#64748b',
];

const FALLBACK_COLORS = [
  ['#5865f2', '#8b5cf6'],
  ['#06b6d4', '#3b82f6'],
  ['#f43f5e', '#fb7185'],
  ['#22c55e', '#14b8a6'],
  ['#f59e0b', '#ef4444'],
  ['#a855f7', '#ec4899'],
  ['#0ea5e9', '#22d3ee'],
  ['#84cc16', '#22c55e'],
  ['#e879f9', '#8b5cf6'],
  ['#fb923c', '#f43f5e'],
];

/**
 * A generated avatar. The initials and the gradient are frozen here, at the
 * moment the avatar is made — so renaming yourself later changes your name,
 * never your picture.
 */
export function defaultAvatar(name = '', color = null) {
  const pair = FALLBACK_COLORS[hueFromString(name || 'x') % FALLBACK_COLORS.length];
  return {
    kind: 'color',
    color: color || pair[0],
    color2: color ? shade(color, -16) : pair[1],
    initials: initialsOf(name || '?'),
  };
}

export function initialsOf(name = '') {
  const cleaned = String(name).replace(/[^\p{L}\p{N} ._-]/gu, '').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Render avatar markup.
 * @param {object} user  user object with displayName + avatar
 * @param {object} opts  {size: css px, cls, status, showStatus}
 */
export function avatarHTML(user = {}, opts = {}) {
  const { size = 40, cls = '', status = null, showStatus = false, square = false } = opts;
  const av = user.avatar || defaultAvatar(user.displayName || user.name || '');
  const name = user.displayName || user.name || '?';
  const label = escapeHtml(name);
  const style = `width:${size}px;height:${size}px;${square ? '' : ''}`;
  const base = `avatar ${cls}`.trim();
  const rounded = square ? 'avatar-square' : '';

  if (av.kind === 'image' && av.src) {
    return `<span class="${base} ${rounded}" style="${style}" role="img" aria-label="${label}">
      <img src="${escapeHtml(av.src)}" alt="" loading="lazy" decoding="async" draggable="false" />
      ${showStatus && status ? statusDot(status) : ''}
    </span>`;
  }

  const c1 = av.color || '#5865f2';
  const c2 = av.color2 || shade(c1, -14);
  const fontSize = Math.max(10, Math.round(size * 0.4));
  // av.initials is frozen when the avatar is created, so a rename keeps the
  // same picture instead of redrawing different letters.
  const letters = av.initials || initialsOf(name);
  return `<span class="${base} ${rounded}" style="${style};--a1:${escapeHtml(c1)};--a2:${escapeHtml(c2)};font-size:${fontSize}px" role="img" aria-label="${label}">
    <span class="avatar-initials">${escapeHtml(letters)}</span>
    ${showStatus && status ? statusDot(status) : ''}
  </span>`;
}

export function statusDot(status = 'online') {
  return `<span class="status-dot status-${escapeHtml(status)}" aria-label="${escapeHtml(status)}"></span>`;
}

/** Lighten/darken a hex color. */
export function shade(hex, percent) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const nums = [1, 2, 3].map((i) => parseInt(m[i], 16));
  const out = nums.map((n) => {
    const v = Math.round(n + (percent / 100) * 255);
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  });
  return `#${out.join('')}`;
}

export function contrastText(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return '#fff';
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.65 ? '#111' : '#fff';
}

/** Downscale + compress a chosen image into a small square data URL. */
export function processImageFile(file, { size = 256, quality = 0.86, maxInputBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file selected.'));
    if (!file.type.startsWith('image/')) return reject(new Error('That file is not an image.'));
    if (file.size > maxInputBytes) return reject(new Error('That image is larger than 8 MB.'));

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        const hasAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif';
        const src = canvas.toDataURL(hasAlpha ? 'image/webp' : 'image/jpeg', quality);
        resolve({ src, width: size, height: size });
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('We could not read that image.'));
    };
    img.src = url;
  });
}

/** Build a server icon from its name (letter monogram). */
export function serverIconHTML(server = {}, { size = 48, active = false } = {}) {
  const name = server.name || 'Server';
  const color = server.color || FALLBACK_COLORS[hueFromString(name) % FALLBACK_COLORS.length][0];
  const color2 = shade(color, -18);
  if (server.avatar?.kind === 'image' && server.avatar.src) {
    return `<span class="server-icon" style="width:${size}px;height:${size}px">
      <img src="${escapeHtml(server.avatar.src)}" alt="" draggable="false" />
    </span>`;
  }
  return `<span class="server-icon server-icon-mono" style="width:${size}px;height:${size}px;--a1:${escapeHtml(color)};--a2:${escapeHtml(color2)};font-size:${Math.round(size * 0.36)}px">${escapeHtml(initialsOf(name).slice(0, 2))}</span>`;
}


/* ------------------------------ image helpers ----------------------------- */

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('We could not read that image.'));
    img.src = src;
  });
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

function hasAlpha(type = '') {
  return /png|webp|gif|svg/i.test(type);
}

function canvasToDataUrl(canvas, type, quality) {
  const url = canvas.toDataURL(type, quality);
  // some engines silently fall back to PNG; keep it small by trying JPEG too
  if (type === 'image/webp' && url.startsWith('data:image/png')) return canvas.toDataURL('image/jpeg', quality);
  return url;
}

/** Downscale an image to fit `max` on its longest side, keeping its shape. */
export async function shrinkImage(src, { max = 1280, quality = 0.8, type = 'image/webp', maxBytes = 0 } = {}) {
  const img = await loadImage(src);
  let scale = Math.min(1, max / Math.max(img.width || max, img.height || max));
  let q = quality;
  let out = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const w = Math.max(1, Math.round((img.width || max) * scale));
    const h = Math.max(1, Math.round((img.height || max) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    out = canvasToDataUrl(canvas, type, q);
    if (!maxBytes || out.length <= maxBytes) return { src: out, width: w, height: h };
    q = Math.max(0.4, q - 0.12);
    scale *= 0.82;
  }
  return { src: out, width: img.width, height: img.height };
}

/** Square avatar crop. Also stores a small `wire` copy for the relay. */
export async function prepareAvatarFile(file, { size = 176 } = {}) {
  if (!file) throw new Error('No file selected.');
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image.');
  if (file.size > 12 * 1024 * 1024) throw new Error('That image is larger than 12 MB.');
  const raw = await readFileAsDataURL(file);
  const img = await loadImage(raw);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const scale = Math.max(size / img.width, size / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  const src = canvasToDataUrl(canvas, hasAlpha(file.type) ? 'image/webp' : 'image/jpeg', 0.85);

  const small = document.createElement('canvas');
  small.width = 96;
  small.height = 96;
  small.getContext('2d').drawImage(canvas, 0, 0, 96, 96);
  const wire = canvasToDataUrl(small, 'image/webp', 0.72);
  return { kind: 'image', src, wire, name: file.name || 'avatar', ts: Date.now() };
}

/** Build the small relay copy for an avatar that was saved before wiring up. */
export async function ensureWireAvatar(avatar) {
  if (!avatar || avatar.kind !== 'image' || !avatar.src) return avatar;
  if (avatar.wire) return avatar;
  try {
    const small = await shrinkImage(avatar.src, { max: 96, quality: 0.72, maxBytes: 26000 });
    return { ...avatar, wire: small.src };
  } catch {
    return avatar;
  }
}

/**
 * Prepare an uploaded picture for a message.
 * GIFs keep their original bytes so the animation survives; everything else is
 * downscaled and re-encoded to something the relay can carry.
 */
export async function prepareAttachment(file) {
  if (!file) throw new Error('No file selected.');
  const type = String(file.type || '');
  if (!type.startsWith('image/')) throw new Error('That file is not an image.');

  if (type === 'image/gif') {
    if (file.size > 1.6 * 1024 * 1024) throw new Error('That GIF is larger than 1.6 MB — try a shorter one.');
    const src = await readFileAsDataURL(file);
    const img = await loadImage(src).catch(() => null);
    return {
      kind: 'gif',
      src,
      name: file.name || 'animation.gif',
      width: img?.width || 0,
      height: img?.height || 0,
      bytes: src.length,
      animated: true,
    };
  }

  if (file.size > 20 * 1024 * 1024) throw new Error('That image is larger than 20 MB.');
  const raw = await readFileAsDataURL(file);
  const shrunk = await shrinkImage(raw, {
    max: 1280,
    quality: 0.82,
    type: hasAlpha(type) ? 'image/webp' : 'image/jpeg',
    maxBytes: 460_000,
  });
  return {
    kind: 'image',
    src: shrunk.src,
    name: file.name || 'image',
    width: shrunk.width,
    height: shrunk.height,
    bytes: shrunk.src.length,
  };
}
