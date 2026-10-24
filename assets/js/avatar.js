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

export function defaultAvatar(name = '', color = null) {
  const pair = FALLBACK_COLORS[hueFromString(name || 'x') % FALLBACK_COLORS.length];
  return { kind: 'color', color: color || pair[0], color2: color ? null : pair[1] };
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
  return `<span class="${base} ${rounded}" style="${style};--a1:${escapeHtml(c1)};--a2:${escapeHtml(c2)};font-size:${fontSize}px" role="img" aria-label="${label}">
    <span class="avatar-initials">${escapeHtml(initialsOf(name))}</span>
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
