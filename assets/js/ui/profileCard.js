// User profile card popover
import { el, escapeHtml, formatDate, formatRelative, copyToClipboard, colorFromString } from '../util.js';
import { avatarHTML, defaultAvatar } from '../avatar.js';
import { icon } from '../icons.js';
import { openPopover, closePopover } from './menu.js';
import { state } from '../store.js';
import { toast } from './toast.js';

const STATUS_LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do not disturb', offline: 'Offline' };

/**
 * @param {object} opts
 * @param {HTMLElement} opts.anchor
 * @param {object} opts.user  public profile
 * @param {string} [opts.status]
 * @param {boolean} [opts.simulated]
 * @param {HTMLElement} [opts.roleTag]
 */
export function openProfileCard({ anchor, user, status = null, simulated = false, onMessage = null, placement = 'right' }) {
  const isSelf = user.id === state.self?.id;
  const st = status || (isSelf ? state.self?.status : 'offline') || 'offline';
  const accent = user.accentColor || '#5865f2';
  const joined = user.createdAt ? formatDate(user.createdAt) : null;

  const card = el('div', { class: 'profile-card' });
  card.innerHTML = `
    <div class="pc-banner" style="--a1:${escapeHtml(accent)};--a2:${escapeHtml(colorFromString(user.handle || user.displayName || 'x', 46))}">
      <div class="pc-avatar">${avatarHTML(user, { size: 68 })}</div>
    </div>
    <div class="pc-body">
      <div class="pc-name">${escapeHtml(user.displayName || 'Unknown')}</div>
      <div class="pc-handle">@${escapeHtml(user.handle || 'user')}</div>
      <div class="pc-status-row">
        <span class="dot status-${escapeHtml(st)}"></span>
        <span>${escapeHtml(STATUS_LABEL[st] || 'Offline')}</span>
        ${simulated ? '<span class="pill" style="height:16px;font-size:10px">demo</span>' : ''}
        ${isSelf ? '<span class="pill accent" style="height:16px;font-size:10px">you</span>' : ''}
      </div>
      <div class="pc-divider"></div>
      <div class="pc-section-label">About me</div>
      <div class="pc-bio">${user.bio ? escapeHtml(user.bio) : '<span style="color:var(--text-4)">No bio yet.</span>'}</div>
      ${joined ? `<div class="pc-divider"></div><div class="pc-section-label">Member since</div><div class="pc-meta">${escapeHtml(joined)}</div>` : ''}
      <div class="pc-divider"></div>
      <div class="pc-actions"></div>
    </div>
  `;

  const actions = card.querySelector('.pc-actions');
  if (isSelf) {
    actions.append(el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      onclick: () => { closePopover(); document.dispatchEvent(new CustomEvent('ta:edit-profile')); },
    }, icon('edit', 15), 'Edit profile'));
    actions.append(el('button', {
      class: 'btn btn-outline',
      type: 'button',
      onclick: async () => {
        await copyToClipboard(`@${user.handle}`);
        toast('Username copied', 'ok');
      },
    }, icon('copy', 15), 'Copy'));
  } else {
    actions.append(el('button', {
      class: 'btn btn-primary',
      type: 'button',
      onclick: () => { closePopover(); onMessage?.(user); },
    }, icon('send', 15), 'Message'));
    actions.append(el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      title: 'Copy username',
      onclick: async () => {
        await copyToClipboard(`@${user.handle}`);
        toast('Username copied', 'ok');
      },
    }, icon('copy', 15)));
  }

  openPopover({ content: card, anchor, placement, className: 'profile-popover' });
  return card;
}
