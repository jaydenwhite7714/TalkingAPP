// All the dialogs: create server/channel, settings, explore, invite, search
import { el, escapeHtml, copyToClipboard, formatMessageStamp, formatRelative, plural, debounce, validateChannelName, colorFromString } from '../util.js';
import { icon, iconHTML } from '../icons.js';
import { avatarHTML, serverIconHTML, AVATAR_COLORS, processImageFile, defaultAvatar } from '../avatar.js';
import {
  state, createServer, createChannel, updateChannel, deleteChannel, updateServer, deleteServer,
  updateSelf, setSetting, setTheme, setAccent, dmList, openDM, ensureDMChannelForUser, markRead,
  pinnedMessages, toast, searchAll, unreadCount, joinNetworkCommunity, signOut, resetEverything,
  flush, persistNow, networkKeyFor, activeChannel, canManageServer,
} from '../store.js';
import { readAccount, checkPassword, changeAccountPassword } from '../account.js';
import { sessionPassword } from '../session.js';
import { downloadBackup, readBackupFile, saveVaultToCloud, restoreSnapshot, localVault } from '../vault.js';
import { bus } from '../bus.js';
import { openModal, confirmDialog, promptDialog, closeAllModals } from '../ui/modal.js';
import { openMenu } from '../ui/menu.js';
import { openProfileCard } from '../ui/profileCard.js';
import { CONFIG } from '../config.js';
import { net } from '../net.js';
import { plainPreview } from '../markdown.js';
import { goToChannel, goToServer } from './shell.js';

const MODAL_TAB = { lastSettingsTab: 'account' };

/* ============================ create a server ============================ */

export function openCreateServer() {
  const nameInput = el('input', { class: 'input', id: 'srvName', maxlength: '32', placeholder: 'e.g. Late Night Gaming', autofocus: true });
  const descInput = el('input', { class: 'input', id: 'srvDesc', maxlength: '180', placeholder: 'What is this place about?' });
  const chanInput = el('input', { class: 'input', id: 'srvChan', maxlength: '28', value: 'general', placeholder: 'general' });
  let color = AVATAR_COLORS[3];
  let emoji = '💬';

  const swatches = el('div', { class: 'swatches' });
  for (const c of AVATAR_COLORS) {
    const b = el('button', {
      class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(c === color),
      style: { background: c }, 'aria-label': `Color ${c}`,
      onclick: () => {
        color = c;
        swatches.querySelectorAll('.swatch').forEach((n) => n.setAttribute('aria-checked', 'false'));
        b.setAttribute('aria-checked', 'true');
        updatePreview();
      },
    });
    swatches.append(b);
  }

  const emojiRow = el('div', { class: 'swatches' });
  for (const e of ['💬', '🎮', '🎨', '🎵', '🚀', '🧠', '🐸', '🍕', '🔥', '🌙']) {
    const b = el('button', {
      class: 'swatch', type: 'button', style: { background: 'var(--bg-elevated-2)', fontSize: '15px' },
      text: e, 'aria-label': `Icon ${e}`,
      onclick: () => {
        emoji = e;
        emojiRow.querySelectorAll('.swatch').forEach((n) => n.style.boxShadow = '');
        b.style.boxShadow = '0 0 0 2px var(--accent)';
        updatePreview();
      },
    });
    emojiRow.append(b);
  }

  const previewHolder = el('div', { class: 'banner-upload' });
  function updatePreview() {
    const name = nameInput.value || 'Your server';
    const fake = { name, color, emoji };
    previewHolder.innerHTML = `${serverIconHTML(fake, { size: 54 })}
      <div><div style="font-weight:700;font-size:15px">${escapeHtml(name)}</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-top:2px">${escapeHtml(descInput.value || 'Your new community')}</div></div>`;
  }
  nameInput.addEventListener('input', updatePreview);
  descInput.addEventListener('input', updatePreview);

  const err = el('div', { class: 'form-error', hidden: true });

  const content = el('div', { class: 'modal-body pad' },
    el('div', { class: 'form-group' }, previewHolder),
    el('div', { class: 'form-group' },
      el('label', { class: 'form-label', for: 'srvName', text: 'Server name' }), nameInput),
    el('div', { class: 'form-group' },
      el('label', { class: 'form-label', for: 'srvDesc', text: 'Description' }), descInput,
      el('div', { class: 'form-help', text: 'Shown in Explore so people on the network know what this community is.' })),
    el('div', { class: 'form-group' },
      el('label', { class: 'form-label', for: 'srvChan', text: 'First channel' }), chanInput),
    el('div', { class: 'form-group' },
      el('span', { class: 'form-label', text: 'Icon' }), emojiRow),
    el('div', { class: 'form-group' },
      el('span', { class: 'form-label', text: 'Color' }), swatches),
    el('label', { class: 'row', style: { gap: '10px', cursor: 'pointer', padding: '4px 0' } },
      el('span', { class: 'pill accent', text: 'PUBLIC' }),
      el('span', { style: { fontSize: '12.5px', color: 'var(--text-2)' }, text: 'List this server in Explore and let anyone join' }),
    ),
    err,
  );

  const footer = el('div', { class: 'modal-foot' },
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ref.close() }, 'Cancel'),
    el('button', {
      class: 'btn btn-primary', type: 'button', onclick: () => {
        const res = createServer({
          name: nameInput.value,
          desc: descInput.value,
          color,
          emoji,
          channels: [chanInput.value || 'general'],
        });
        if (!res.ok) {
          err.hidden = false;
          err.textContent = res.error;
          nameInput.setAttribute('aria-invalid', 'true');
          nameInput.focus();
          return;
        }
        ref.close();
        toast(`${res.server.name} created`, 'party', { duration: 2600 });
      },
    }, icon('plus', 16), 'Create server'),
  );

  updatePreview();
  const ref = openModal({
    title: 'Create a server',
    subtitle: 'Your server is a space for your people. Give it a name and a personality.',
    content, footer, icon: 'globe', noAutofocus: false,
  });
  setTimeout(() => nameInput.focus(), 60);
}

/* ============================= create channel ============================ */

export function openCreateChannel(server, existing = null, { preselectName = '' } = {}) {
  if (!canManageServer(server)) {
    toast(`Only ${ownerNameOf(server)} can change channels in this server.`, 'warn');
    return;
  }
  const isEdit = Boolean(existing);
  const nameInput = el('input', { class: 'input', maxlength: '28', value: existing?.name || preselectName, placeholder: 'new-channel', autofocus: true });
  const topicInput = el('input', { class: 'input', maxlength: '140', value: existing?.topic || '', placeholder: 'What is this channel for?' });
  const err = el('div', { class: 'form-error', hidden: true });
  const preview = el('div', { class: 'row', style: { gap: '7px', color: 'var(--text-2)', fontSize: '14px', padding: '8px 0 2px' } });
  const updatePreview = () => {
    const v = validateChannelName(nameInput.value);
    preview.innerHTML = `${iconHTML('hash', 17)}<span style="font-weight:600;color:var(--text)">${escapeHtml(v.value || 'channel-name')}</span>`;
  };
  nameInput.addEventListener('input', updatePreview);
  updatePreview();

  const content = el('div', { class: 'modal-body pad' },
    el('div', { class: 'form-group' },
      el('label', { class: 'form-label', text: 'Channel name' }),
      el('div', { class: 'row', style: { gap: '0', position: 'relative' } },
        el('span', { class: 'input-prefix', style: { position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-4)', fontWeight: '600' }, text: '#' }),
        (nameInput.style.paddingLeft = '26px', nameInput),
      ),
      preview,
      el('div', { class: 'form-help', text: 'Lowercase letters, numbers and dashes work best.' }),
    ),
    el('div', { class: 'form-group' },
      el('label', { class: 'form-label', text: 'Channel topic' }), topicInput),
    err,
  );

  const footer = el('div', { class: 'modal-foot' });
  if (isEdit) {
    footer.append(el('button', {
      class: 'btn btn-danger-soft', type: 'button', style: { marginRight: 'auto' },
      onclick: () => { ref.close(); deleteChannelFlow(existing); },
    }, icon('trash', 15), 'Delete'));
  }
  footer.append(
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ref.close() }, 'Cancel'),
    el('button', {
      class: 'btn btn-primary', type: 'button', onclick: () => {
        const res = isEdit
          ? updateChannel(existing.id, { name: nameInput.value, topic: topicInput.value })
          : createChannel(server.id, nameInput.value, topicInput.value);
        if (!res.ok) {
          err.hidden = false;
          err.textContent = res.error || 'Could not save that channel.';
          return;
        }
        ref.close();
        toast(isEdit ? 'Channel updated' : `#${res.channel.name} created`, 'ok');
        if (!isEdit) goToChannel(res.channel.id);
      },
    }, isEdit ? 'Save changes' : 'Create channel'),
  );

  const ref = openModal({
    title: isEdit ? 'Edit channel' : 'Create a channel',
    subtitle: isEdit ? `#${existing.name} in ${server.name}` : `Add a new room to ${server.name}`,
    content, footer, icon: 'hash',
  });
  setTimeout(() => { nameInput.focus(); nameInput.select(); }, 60);
}

export function deleteChannelFlow(ch) {
  const server = state.servers[ch.serverId];
  if (!canManageServer(server)) {
    toast(`Only ${ownerNameOf(server)} can delete channels here.`, 'warn');
    return;
  }
  const total = state.servers[ch.serverId]?.channelIds.length || 0;
  if (total <= 1) {
    toast('A server needs at least one channel.', 'warn');
    return;
  }
  confirmDialog({
    title: `Delete #${ch.name}`,
    body: `This removes the channel and its local message history. Other people on the network will keep their copy.`,
    confirmLabel: 'Delete channel',
    danger: true,
  }).then((ok) => {
    if (!ok) return;
    const res = deleteChannel(ch.id);
    if (res?.ok === false) toast(res.error, 'warn');
    else toast('Channel deleted', 'ok');
  });
}

/* ================================= invite =============================== */

export function openInvite(server) {
  const base = `${location.origin}${location.pathname}`;
  const joinUrl = server
    ? `${base}?join=${encodeURIComponent(server.networkKey)}&name=${encodeURIComponent(server.name)}`
    : `${base}`;

  const makeRow = (value, label, primary) => el('div', { class: 'share-block', style: { marginBottom: '9px' } },
    icon(primary ? 'userPlus' : 'link', 15),
    el('span', { text: value, title: value }),
    el('button', {
      class: `btn ${primary ? 'btn-primary' : 'btn-secondary'} btn-sm`, type: 'button',
      onclick: async (e) => {
        await copyToClipboard(value);
        const span = e.currentTarget.querySelector('span:last-child');
        if (span) span.textContent = 'Copied';
        toast(`${label} copied`, 'ok');
      },
    }, icon('copy', 14), el('span', { text: 'Copy' })),
  );

  const linkRow = el('div', {},
    server ? el('div', { class: 'section-title', text: 'Server invite — lands them inside this server' }) : null,
    server ? makeRow(joinUrl, 'Server invite', true) : null,
    el('div', { class: 'section-title', style: { marginTop: server ? '14px' : '0' }, text: 'Plain link — opens TalkingApp' }),
    makeRow(base, 'Link', false),
  );

  const content = el('div', { class: 'modal-body pad' },
    el('p', { class: 'muted', style: { fontSize: '13.5px', lineHeight: '1.55', marginBottom: '14px' },
      text: `Anyone who opens this link can talk to you in real time. ${server ? `They will show up in ${server.name}’s member list as soon as they arrive.` : ''}` }),
    linkRow,
    el('div', { class: 'section-title', style: { marginTop: '18px' }, text: 'Ways to invite' }),
    el('div', { class: 'tip-card' },
      el('div', { class: 'tip-ico' }, icon('wifi', 15)),
      el('div', {}, el('b', { text: 'Send it to a friend' }),
        el('p', { text: 'The plain link works on any device. The server invite puts them straight into this server with its channels.' }))),
    el('div', { class: 'tip-card' },
      el('div', { class: 'tip-ico' }, icon('lock', 15)),
      el('div', {}, el('b', { text: 'Keep it public-safe' }),
        el('p', { text: 'Messages travel through a public relay server. Do not share passwords or private info.' }))),
    el('div', { class: 'tip-card' },
      el('div', { class: 'tip-ico' }, icon('wifi', 15)),
      el('div', {}, el('b', { text: 'Want a quieter room?' }),
        el('p', { text: 'Append &room=your-name to the link to put your group in its own room on the relay. Everyone needs the same room name to see each other.' }))),
    el('div', { class: 'section-title', style: { marginTop: '14px' }, text: `Current room — ${CONFIG.room}` }),
    el('div', { class: 'share-block' },
      icon('globe', 15),
      el('span', { class: 'muted', style: { flex: '1' }, text: 'Bring everyone to the same room on the relay.' }),
      el('button', {
        class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: async () => { await copyToClipboard(`${base}?room=${encodeURIComponent(CONFIG.room)}`); toast('Room link copied', 'ok'); },
      }, icon('copy', 14), el('span', { text: 'Copy' }))),
  );

  const footer = el('div', { class: 'modal-foot' },
    el('button', {
      class: 'btn btn-secondary', type: 'button',
      onclick: () => window.open(base, '_blank', 'noopener'),
    }, icon('external', 15), 'Open in new tab'),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: () => ref.close() }, 'Done'),
  );

  const ref = openModal({ title: 'Invite people', subtitle: server ? `Grow ${server.name}` : 'Bring someone into the conversation', content, footer, icon: 'userPlus' });
}

/* ============================= server settings ========================== */

export function openServerSettings(server) {
  if (!canManageServer(server)) {
    toast(`Only ${ownerNameOf(server)} can edit this server.`, 'warn');
    openServerInfo(server);
    return;
  }
  const nameInput = el('input', { class: 'input', maxlength: '32', value: server.name });
  const descInput = el('input', { class: 'input', maxlength: '180', value: server.desc || '' });
  let color = server.color || '#5865f2';
  let emoji = server.emoji || null;
  let isPublic = server.isPublic !== false;

  const swatches = el('div', { class: 'swatches' });
  for (const c of AVATAR_COLORS) {
    const b = el('button', {
      class: 'swatch', type: 'button', 'aria-checked': String(c === color), style: { background: c },
      onclick: () => {
        color = c;
        swatches.querySelectorAll('.swatch').forEach((n) => n.setAttribute('aria-checked', 'false'));
        b.setAttribute('aria-checked', 'true');
        updateHolder();
      },
    });
    swatches.append(b);
  }
  const emojiRow = el('div', { class: 'swatches' });
  for (const e of ['💬', '🎮', '🎨', '🎵', '🚀', '🧠', '🐸', '🍕', '🔥', '🌙', ''] ) {
    const b = el('button', {
      class: 'swatch', type: 'button', style: { background: 'var(--bg-elevated-2)', fontSize: '15px' },
      text: e || 'Aa',
      onclick: () => {
        emoji = e || null;
        emojiRow.querySelectorAll('.swatch').forEach((n) => n.style.boxShadow = '');
        b.style.boxShadow = '0 0 0 2px var(--accent)';
        updateHolder();
      },
    });
    emojiRow.append(b);
  }
  const publicSwitch = el('button', {
    class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(isPublic),
    onclick: (e) => {
      isPublic = !isPublic;
      e.currentTarget.setAttribute('aria-checked', String(isPublic));
    },
  });

  const holder = el('div', { class: 'banner-upload' });
  function updateHolder() {
    holder.innerHTML = `${serverIconHTML({ name: nameInput.value || server.name, color, emoji }, { size: 54 })}
      <div><div style="font-weight:700;font-size:15px">${escapeHtml(nameInput.value || server.name)}</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-top:2px">${plural(server.channelIds.length, 'channel')} · ${server.isRemote ? 'network community' : 'your server'}</div></div>`;
  }
  nameInput.addEventListener('input', updateHolder);

  const content = el('div', { class: 'modal-body pad' },
    holder,
    el('div', { class: 'form-group', style: { marginTop: '16px' } },
      el('label', { class: 'form-label', text: 'Server name' }), nameInput),
    el('div', { class: 'form-group' }, el('label', { class: 'form-label', text: 'Description' }), descInput),
    el('div', { class: 'form-group' }, el('span', { class: 'form-label', text: 'Icon' }), emojiRow),
    el('div', { class: 'form-group' }, el('span', { class: 'form-label', text: 'Color' }), swatches),
    el('div', { class: 'setting-row', style: { borderTop: '1px solid var(--border)' } },
      el('div', { class: 'sr-text' },
        el('div', { class: 'sr-title', text: 'List in Explore' }),
        el('div', { class: 'sr-desc', text: 'Show this community to everyone online so they can join.' })),
      publicSwitch),
    el('div', { class: 'setting-row' },
      el('div', { class: 'sr-text' },
        el('div', { class: 'sr-title', text: 'Network key' }),
        el('div', { class: 'sr-desc', text: `${networkKeyFor(server.name)} — servers with the same key share one conversation across browsers.` })),
      el('button', {
        class: 'btn btn-sm btn-secondary', type: 'button',
        onclick: async () => { await copyToClipboard(networkKeyFor(server.name)); toast('Network key copied', 'ok'); },
      }, icon('copy', 13), 'Copy')),
  );

  const footer = el('div', { class: 'modal-foot spread' },
    el('button', {
      class: 'btn btn-danger-soft', type: 'button',
      onclick: () => { ref.close(); server.isStarter || server.isRemote ? hideServer(server) : deleteServerFlow(server); },
    }, icon('logout', 15), server.isStarter || server.isRemote ? 'Leave' : 'Delete server'),
    el('div', { class: 'row', style: { gap: '9px' } },
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => ref.close() }, 'Cancel'),
      el('button', {
        class: 'btn btn-primary', type: 'button', onclick: () => {
          const res = updateServer(server.id, { name: nameInput.value, desc: descInput.value, color, emoji, isPublic });
          if (!res.ok) { toast(res.error, 'error'); return; }
          ref.close();
          toast('Server updated', 'ok');
        },
      }, 'Save changes'),
    ),
  );

  updateHolder();
  const ref = openModal({ title: 'Server settings', subtitle: server.name, content, footer, icon: 'settings', size: 'wide' });
}

function ownerNameOf(server) {
  if (!server?.ownerId) return 'the owner';
  if (server.ownerId === state.self?.id) return 'you';
  const owner = state.users[server.ownerId];
  return owner?.displayName ? owner.displayName : 'the owner';
}

/** Read-only view for servers you did not create. */
export function openServerInfo(server) {
  const owner = server.ownerId ? state.users[server.ownerId] : null;
  const ownerLabel = owner?.displayName || (server.isRemote ? 'another member' : 'the TalkingApp team');
  const content = el('div', { class: 'modal-body pad' },
    el('div', { class: 'sync-card' },
      el('div', { class: 'sync-ico', html: iconHTML('lock', 18) }),
      el('div', {},
        el('b', { text: `Owned by ${ownerLabel}` }),
        el('span', { text: 'Only the owner can rename this server, change its icon, or add and remove channels.' }))),
    el('div', { class: 'kv-list' },
      el('div', {}, el('span', { text: 'Name' }), el('b', { text: server.name })),
      el('div', {}, el('span', { text: 'Channels' }), el('b', { text: String(server.channelIds.length) })),
      el('div', {}, el('span', { text: 'Network key' }), el('b', { text: server.networkKey })),
      el('div', {}, el('span', { text: 'Type' }), el('b', { text: server.isRemote ? 'network community' : server.isStarter ? 'official' : 'private' })),
    ),
    server.desc ? el('p', { class: 'muted', style: { marginTop: '12px', fontSize: '13px', lineHeight: '1.55' }, text: server.desc }) : null,
    el('div', { class: 'tip-card', style: { marginTop: '12px' } },
      el('div', { class: 'tip-ico', html: iconHTML('userPlus', 15) }),
      el('div', {}, el('b', { text: 'Want your own space?' }),
        el('p', { text: 'Create a server from the + button and you can shape it however you like.' }))),
  );
  const footer = el('div', { class: 'modal-foot spread' },
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { ref.close(); hideServer(server); } }, icon('logout', 15), 'Leave'),
    el('div', { class: 'row', style: { gap: '8px' } },
      el('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { ref.close(); openInvite(server); } }, icon('userPlus', 15), 'Invite'),
      el('button', { class: 'btn btn-primary', type: 'button', onclick: () => ref.close() }, 'Done')),
  );
  const ref = openModal({ title: server.name, subtitle: 'Server info', content, footer, icon: 'info' });
  return ref;
}

export function deleteServerFlow(server) {
  if (!canManageServer(server)) {
    toast(`Only ${ownerNameOf(server)} can delete this server.`, 'warn');
    return;
  }
  confirmDialog({
    title: `Delete ${server.name}?`,
    body: 'This removes the server, its channels and the local message history. You cannot undo it.',
    confirmLabel: 'Delete server',
    danger: true,
  }).then((ok) => {
    if (!ok) return;
    deleteServer(server.id);
    toast(`${server.name} deleted`, 'ok');
  });
}

export function hideServer(server) {
  confirmDialog({
    title: `Leave ${server.name}?`,
    body: server.isRemote
      ? 'You will stop seeing messages from this community. You can join again from Explore.'
      : 'This starter server will be removed from your list. You can re-add it any time from Explore.',
    confirmLabel: 'Leave',
    danger: true,
  }).then((ok) => {
    if (!ok) return;
    deleteServer(server.id);
    toast(`You left ${server.name}`, 'ok');
  });
}

/* ================================ explore =============================== */

export function openExplore() {
  const body = el('div', { class: 'modal-body pad' });
  const search = el('input', { class: 'input input-search', placeholder: 'Search communities or people', 'aria-label': 'Search communities' });
  body.append(el('div', { class: 'input-search-wrap', style: { marginBottom: '6px' } }, icon('search', 15), search));
  const results = el('div');
  body.append(results);

  function render(filter = '') {
    results.replaceChildren();
    const q = filter.toLowerCase();

    const peers = Object.values(state.peers).filter((p) => p.user?.id !== state.self?.id);
    const people = peers.filter((p) => !q || p.user.displayName?.toLowerCase().includes(q) || p.user.handle?.includes(q));

    results.append(el('div', { class: 'explore-section-title' }, icon('users', 13), `People online — ${people.length}`));
    if (!people.length) {
      results.append(el('div', { class: 'explore-empty' },
        el('b', { text: 'Nobody else is online right now' }),
        'Open this page on your phone or send the link to a friend — as soon as they arrive they show up here, in your member list, and can chat instantly.'));
    } else {
      const chips = el('div', { class: 'chip-list' });
      for (const p of people) {
        const chip = el('button', { class: 'member-chip', type: 'button' });
        chip.innerHTML = `${avatarHTML(p.user, { size: 22, status: p.status, showStatus: true })}<span>${escapeHtml(p.user.displayName)}</span>`;
        chip.addEventListener('click', (e) => {
          openProfileCard({ anchor: chip, user: p.user, status: p.status, onMessage: (u) => {
            closeAllModals();
            const dm = openDM(u.id, u);
            if (dm) goToChannel(dm.id);
          } });
        });
        chips.append(chip);
      }
      results.append(chips);
    }

    const communities = Object.values(state.network)
      .filter((n) => n.key && !isJoinedKey(n.key))
      .filter((n) => !q || n.name?.toLowerCase().includes(q) || (n.topic || '').toLowerCase().includes(q))
      .sort((a, b) => (b.peers?.size || 0) - (a.peers?.size || 0));

    results.append(el('div', { class: 'explore-section-title' }, icon('compass', 13), `Communities on the network — ${communities.length}`));
    if (!communities.length) {
      results.append(el('div', { class: 'explore-empty' },
        el('b', { text: 'No new communities found yet' }),
        'Communities other people create show up here. Create your own and it will appear for everyone else.'));
    } else {
      const grid = el('div', { class: 'explore-grid' });
      for (const c of communities) {
        const members = c.peers?.size || 0;
        const card = el('div', { class: 'explore-card' });
        card.innerHTML = `
          <div class="explore-card-top">
            ${serverIconHTML({ name: c.name, color: colorFromString(c.key, 55) }, { size: 40 })}
            <div class="grow"><h4>${escapeHtml(c.name)}</h4>
            <div style="font-size:11.5px;color:var(--text-3)">${c.channels?.size || 1} channels · ${members} online</div></div>
          </div>
          <p>${escapeHtml(c.topic || 'A community on the TalkingApp network.')}</p>
          <div class="ec-foot"><span class="pill green"><i></i>live</span><span class="grow"></span><button class="btn btn-sm btn-primary" type="button">Join</button></div>`;
        card.querySelector('button').addEventListener('click', () => {
          const res = joinNetworkCommunity({ name: c.name, key: c.key, topic: c.topic, channels: [...(c.channels || [])] });
          if (res.ok) {
            closeAllModals();
            goToServer(res.server.id);
            bus.emit('community:joined', { server: res.server });
            toast(`Joined ${res.server.name}`, 'party');
          }
        });
        grid.append(card);
      }
      results.append(grid);
    }

    results.append(el('div', { class: 'explore-section-title' }, icon('globe', 13), 'Your servers'));
    const grid2 = el('div', { class: 'explore-grid' });
    for (const s of Object.values(state.servers)) {
      const card = el('div', { class: 'explore-card' });
      card.innerHTML = `
        <div class="explore-card-top">
          ${serverIconHTML(s, { size: 40 })}
          <div class="grow"><h4>${escapeHtml(s.name)}</h4>
          <div style="font-size:11.5px;color:var(--text-3)">${plural(s.channelIds.length, 'channel')} · ${s.isPublic ? 'public' : 'private'}</div></div>
        </div>
        <p>${escapeHtml(s.desc || 'No description yet.')}</p>
        <div class="ec-foot"><span class="pill">${escapeHtml(s.networkKey)}</span><span class="grow"></span><button class="btn btn-sm btn-secondary" type="button">Open</button></div>`;
      card.querySelector('button').addEventListener('click', () => { closeAllModals(); goToServer(s.id); });
      grid2.append(card);
    }
    const createCard = el('button', { class: 'explore-card', type: 'button', style: { alignItems: 'center', justifyContent: 'center', minHeight: '120px', borderStyle: 'dashed' } },
      icon('plus', 26), el('span', { style: { fontWeight: '650', fontSize: '13.5px' }, text: 'Create a server' }));
    createCard.addEventListener('click', () => { closeAllModals(); openCreateServer(); });
    grid2.append(createCard);
    results.append(grid2);
  }

  search.addEventListener('input', debounce(() => render(search.value), 120));
  render();

  const footer = el('div', { class: 'modal-foot spread' },
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { closeAllModals(); openCreateServer(); } }, icon('plus', 15), 'New server'),
    el('button', { class: 'btn btn-primary', type: 'button', onclick: () => ref.close() }, 'Done'),
  );

  const ref = openModal({
    title: 'Explore the network',
    subtitle: 'Everything happening right now across everyone who has TalkingApp open.',
    content: body, footer, icon: 'compass', size: 'xwide', noAutofocus: true,
  });
  setTimeout(() => search.focus({ preventScroll: true }), 80);
}

function isJoinedKey(key) {
  return Object.values(state.servers).some((s) => s.networkKey === key);
}

/* ================================ search =============================== */

export function openSearch(initial = '') {
  const input = el('input', { class: 'input', value: initial, placeholder: 'Search messages, channels, people…', autofocus: true });
  const results = el('div', { style: { marginTop: '12px', minHeight: '120px' } });

  function render(q) {
    results.replaceChildren();
    if (!q.trim()) {
      results.append(el('div', { class: 'explore-empty' },
        el('b', { text: 'Search everything' }),
        'Find a message, jump to a channel, or look someone up. Try “general”, “hello”, or a username.'));
      return;
    }
    const { channels, messages, servers } = searchAll(q);
    if (servers.length) {
      results.append(el('div', { class: 'explore-section-title' }, icon('globe', 13), 'Servers'));
      for (const s of servers.slice(0, 4)) {
        results.append(el('button', {
          class: 'ac-item', type: 'button', style: { width: '100%' },
          onclick: () => { ref.close(); goToServer(s.id); },
        }, icon('globe', 15), el('span', { class: 'ac-name', text: s.name }), el('span', { class: 'ac-sub', text: plural(s.channelIds.length, 'channel') })));
      }
    }
    if (channels.length) {
      results.append(el('div', { class: 'explore-section-title' }, icon('hash', 13), 'Channels'));
      for (const c of channels.slice(0, 8)) {
        const srv = state.servers[c.serverId];
        results.append(el('button', {
          class: 'ac-item', type: 'button', style: { width: '100%' },
          onclick: () => { ref.close(); goToChannel(c.id); },
        }, icon(c.type === 'dm' ? 'at' : 'hash', 15), el('span', { class: 'ac-name', text: c.type === 'dm' ? c.name : `#${c.name}` }), el('span', { class: 'ac-sub', text: srv?.name || 'Direct message' })));
      }
    }
    if (messages.length) {
      results.append(el('div', { class: 'explore-section-title' }, icon('search', 13), `Messages — ${messages.length}`));
      for (const m of messages.slice(0, 12)) {
        const ch = state.channels[m.channelId];
        const btn = el('button', { class: 'ac-item', type: 'button', style: { width: '100%', alignItems: 'flex-start' } });
        btn.innerHTML = `${avatarHTML(m, { size: 24 })}<span class="ac-name" style="display:block">
          <span style="font-weight:600;color:var(--text)">${escapeHtml(m.displayName)}</span>
          <span style="color:var(--text-3);font-size:12px"> in ${ch?.type === 'dm' ? 'DM' : '#' + escapeHtml(ch?.name || '')}</span>
          <div style="font-size:12.5px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(plainPreview(m.text, 90))}</div>
        </span>`;
        btn.addEventListener('click', () => {
          ref.close();
          goToChannel(m.channelId);
          setTimeout(() => import('./messages.js').then((mm) => mm.scrollToMessage(m.id)), 220);
        });
        results.append(btn);
      }
    }
    if (!servers.length && !channels.length && !messages.length) {
      results.append(el('div', { class: 'explore-empty' }, el('b', { text: 'No matches' }), `Nothing found for “${escapeHtml(q)}”.`));
    }
  }

  input.addEventListener('input', debounce(() => render(input.value), 140));
  render(initial);

  const content = el('div', { class: 'modal-body pad' }, input, results);
  const ref = openModal({ title: 'Search', content, icon: 'search', size: 'wide', noAutofocus: true });
  setTimeout(() => { input.focus(); input.select(); }, 80);
}

/* ================================= pins ================================ */

export function openPins(ch) {
  const pins = pinnedMessages(ch.id);
  const body = el('div', { class: 'modal-body pad' });
  if (!pins.length) {
    body.append(el('div', { class: 'explore-empty' }, el('b', { text: 'No pinned messages' }), 'Right-click any message and choose “Pin message” to keep it here.'));
  } else {
    for (const m of pins) {
      const row = el('div', { class: 'tip-card', style: { alignItems: 'flex-start', cursor: 'pointer' } });
      row.innerHTML = `${avatarHTML(m, { size: 28 })}
        <div style="min-width:0"><b>${escapeHtml(m.displayName)} <span style="font-weight:500;color:var(--text-4);font-size:11px">${formatMessageStamp(m.ts)}</span></b>
        <p style="color:var(--text-2);white-space:pre-wrap">${escapeHtml(plainPreview(m.text, 220))}</p></div>`;
      row.addEventListener('click', () => {
        ref.close();
        goToChannel(m.channelId);
        setTimeout(() => import('./messages.js').then((mm) => mm.scrollToMessage(m.id)), 240);
      });
      body.append(row);
    }
  }
  const ref = openModal({ title: 'Pinned messages', subtitle: ch.type === 'dm' ? 'Direct message' : `#${ch.name}`, content: body, icon: 'pin' });
}

/* =============================== new DM ================================ */

export function openNewDM() {
  const input = el('input', { class: 'input', placeholder: 'Search people by name or @handle', autofocus: true });
  const list = el('div', { style: { marginTop: '10px' } });
  const candidates = () => {
    const map = new Map();
    for (const p of Object.values(state.peers)) if (p.user?.id !== state.self?.id) map.set(p.user.id, { user: p.user, status: p.status });
    for (const u of Object.values(state.users)) if (!u.simulated && u.id !== state.self?.id && !map.has(u.id)) map.set(u.id, { user: u, status: state.presence[u.id] || 'offline' });
    return [...map.values()];
  };

  function render(q = '') {
    list.replaceChildren();
    const items = candidates().filter(({ user }) => !q || user.displayName?.toLowerCase().includes(q.toLowerCase()) || user.handle?.includes(q.toLowerCase()));
    if (!items.length) {
      list.append(el('div', { class: 'explore-empty' },
        el('b', { text: 'No one else is here yet' }),
        'Share the link with a friend, or turn on demo members in Settings → Network to preview how conversations look.'));
      return;
    }
    for (const { user, status } of items) {
      const row = el('button', { class: 'ac-item', type: 'button', style: { width: '100%', padding: '8px' } });
      row.innerHTML = `${avatarHTML(user, { size: 30, status, showStatus: true })}
        <span class="ac-name">${escapeHtml(user.displayName)}<div class="ac-sub">@${escapeHtml(user.handle)}</div></span>
        <span class="ac-sub">${status === 'online' ? 'online' : 'offline'}</span>`;
      row.addEventListener('click', () => {
        const ch = openDM(user.id, user);
        ref.close();
        if (ch) goToChannel(ch.id);
      });
      list.append(row);
    }
  }

  input.addEventListener('input', debounce(() => render(input.value), 120));
  render();
  const content = el('div', { class: 'modal-body pad' }, input, list);
  const footer = el('div', { class: 'modal-foot spread' },
    el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { ref.close(); openExplore(); } }, icon('compass', 15), 'Explore'),
    el('button', { class: 'btn btn-secondary', type: 'button', onclick: () => ref.close() }, 'Close'),
  );
  const ref = openModal({ title: 'New message', subtitle: 'Start a private conversation', content, footer, icon: 'at', noAutofocus: true });
  setTimeout(() => input.focus({ preventScroll: true }), 80);
}

export function closeDM(ch) {
  confirmDialog({
    title: 'Close conversation',
    body: 'The conversation is hidden from your list. Its messages stay on this device unless you delete them.',
    confirmLabel: 'Close conversation',
  }).then((ok) => {
    if (!ok) return;
    delete state.dmChannels[ch.dmUserId];
    delete state.channels[ch.id];
    delete state.messages[ch.id];
    persistNow();
    bus.emit('dms:changed');
    bus.emit('servers:changed');
    if (state.ui.activeChannelId === ch.id) goToServer(state.servers[firstServer()]?.id || '@me');
    toast('Conversation closed', 'ok');
  });
}

function firstServer() {
  return Object.keys(state.servers)[0];
}

/* ================================ settings ============================= */

const NAV = [
  { id: 'account', label: 'My account', icon: 'user' },
  { id: 'backup', label: 'Backup & sync', icon: 'uploadCloud' },
  { id: 'profile', label: 'Profile', icon: 'edit' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'notifications', label: 'Notifications', icon: 'bell' },
  { id: 'network', label: 'Network', icon: 'wifi' },
  { id: 'keybinds', label: 'Keybinds', icon: 'list' },
  { id: 'about', label: 'About', icon: 'info' },
];

let openSettingsRef = null;

export function openSettings(tab = MODAL_TAB.lastSettingsTab || 'account') {
  if (openSettingsRef) { openSettingsRef.close(); openSettingsRef = null; }
  const nav = el('div', { class: 'settings-nav' });
  const content = el('div', { class: 'settings-content' });
  const layout = el('div', { class: 'settings-layout' }, nav, content);
  let current = tab;

  function select(id) {
    current = id;
    MODAL_TAB.lastSettingsTab = id;
    nav.querySelectorAll('.settings-nav-item').forEach((n) => n.classList.toggle('is-active', n.dataset.tab === id));
    renderTab(id);
  }

  for (const item of NAV) {
    nav.append(el('button', {
      class: 'settings-nav-item', type: 'button', 'data-tab': item.id,
      onclick: () => select(item.id),
    }, icon(item.icon, 16), item.label));
  }
  nav.append(el('div', { class: 'settings-nav-group', text: 'Danger zone' }));
  nav.append(el('button', {
    class: 'settings-nav-item danger', type: 'button', 'data-tab': 'danger',
    onclick: () => select('danger'),
  }, icon('warning', 16), 'Reset data'));

  function renderTab(id) {
    content.replaceChildren();
    if (id === 'account') content.append(accountTab());
    else if (id === 'backup') content.append(backupTab());
    else if (id === 'profile') content.append(profileTab());
    else if (id === 'appearance') content.append(appearanceTab());
    else if (id === 'notifications') content.append(notificationsTab());
    else if (id === 'network') content.append(networkTab());
    else if (id === 'keybinds') content.append(keybindsTab());
    else if (id === 'about') content.append(aboutTab());
    else if (id === 'danger') content.append(dangerTab());
  }

  const close = el('button', { class: 'icon-btn modal-close', type: 'button', 'aria-label': 'Close settings', onclick: () => ref.close() }, icon('close', 18));
  const head = el('div', { class: 'modal-head modal-hero', style: { paddingBottom: '14px' } }, close,
    el('h2', { text: 'Settings' }),
    el('p', { text: 'Make TalkingApp feel like yours.' }),
  );
  const modal = el('div', { class: 'modal wide settings-modal', role: 'dialog', 'aria-modal': 'true' });
  modal.append(head, layout);
  const backdrop = el('div', { class: 'modal-backdrop' });
  backdrop.append(modal);
  document.getElementById('modalRoot').append(backdrop);
  // register with the modal module for esc/focus handling
  let closed = false;
  function doClose() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    openSettingsRef = null;
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); doClose(); }
  }
  document.addEventListener('keydown', onKey, true);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) doClose(); });
  const ref = { close: doClose, modal, backdrop };
  openSettingsRef = ref;
  select(current);
  return ref;
}

function accountTab() {
  const self = state.self;
  const nameInput = el('input', { class: 'input', value: self.displayName, maxlength: '24' });
  const handleInput = el('input', { class: 'input', value: self.handle, maxlength: '20' });
  const bioInput = el('textarea', { class: 'textarea', maxlength: '190', rows: '3', placeholder: 'Tell people a little about yourself' });
  bioInput.value = self.bio || '';
  const err = el('div', { class: 'form-error', hidden: true });
  const saveBtn = el('button', {
    class: 'btn btn-primary btn-sm', type: 'button',
    onclick: () => {
      const res = updateSelf({ displayName: nameInput.value, handle: handleInput.value, bio: bioInput.value });
      if (!res.ok) { err.hidden = false; err.textContent = res.error; return; }
      err.hidden = true;
      toast('Profile saved', 'ok');
      bus.emit('self:changed');
    },
  }, 'Save changes');

  const avatarRow = el('div', { class: 'banner-upload' });
  renderAvatarRow(avatarRow);

  const wrap = el('div', {},
    el('h3', { text: 'My account' }),
    el('p', { class: 'sc-sub', text: 'Your identity lives in this browser. Nothing is uploaded to a server — change anything, any time.' }),
    avatarRow,
    el('div', { class: 'form-row', style: { marginTop: '16px' } },
      el('div', { class: 'form-group' }, el('label', { class: 'form-label', text: 'Display name' }), nameInput),
      el('div', { class: 'form-group' }, el('label', { class: 'form-label', text: 'Username' }), handleInput)),
    el('div', { class: 'form-group' }, el('label', { class: 'form-label', text: 'About me' }), bioInput),
    err,
    el('div', { class: 'row', style: { gap: '8px', marginTop: '12px' } },
      saveBtn,
      el('button', {
        class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: () => { flush(); toast('Saved to this browser', 'ok'); },
      }, 'Save now'),
      el('span', { class: 'grow' }),
      el('button', {
        class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: () => { closeAllModals(); document.dispatchEvent(new CustomEvent('ta:lock')); },
      }, icon('lock', 15), 'Lock now'),
    ),
    passwordBlock(),
  );
  return wrap;
}

/* ------------------------------ account security -------------------------- */

function passwordBlock() {
  const account = readAccount();
  if (!account) {
    return el('div', { class: 'setting-block' },
      el('div', { class: 'sr-title', text: 'Password' }),
      el('div', { class: 'sr-desc', text: 'This device has no saved password. Lock the app to set one.' }));
  }
  const current = el('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Current password' });
  const next = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'New password (6+ characters)' });
  const confirm = el('input', { class: 'input', type: 'password', autocomplete: 'new-password', placeholder: 'Repeat new password' });
  const err = el('div', { class: 'form-error', hidden: true });
  const btn = el('button', {
    class: 'btn btn-primary btn-sm', type: 'button',
    onclick: async () => {
      if (next.value !== confirm.value) { err.hidden = false; err.textContent = 'The new passwords do not match.'; return; }
      btn.disabled = true;
      const res = await changeAccountPassword(current.value, next.value);
      btn.disabled = false;
      if (!res.ok) { err.hidden = false; err.textContent = res.error; return; }
      err.hidden = true;
      current.value = next.value = confirm.value = '';
      toast('Password changed — your cloud copy re-seals with it', 'ok');
      const { setSessionPassword } = await import('../session.js');
      setSessionPassword(next.value);
      saveVaultToCloud(next.value).catch(() => {});
    },
  }, 'Change password');
  return el('div', { class: 'setting-block' },
    el('div', { class: 'sr-title', text: 'Password' }),
    el('div', { class: 'sr-desc', text: `Unlocks this account. Stored as a salted PBKDF2 hash (${account.iterations.toLocaleString()} rounds) — the password itself never touches storage or the network.` }),
    el('div', { class: 'form-row' }, current),
    el('div', { class: 'form-row' }, next, confirm),
    err,
    el('div', { class: 'row', style: { marginTop: '10px' } }, btn));
}

/* -------------------------------- backup tab ------------------------------ */

function backupTab() {
  const account = readAccount();
  const vault = localVault();
  const savedAt = vault?.savedAt ? formatRelative(vault.savedAt) : 'never';
  const stateLabel = el('span', { class: 'sync-state', text: account ? `Signed in as @${account.handle}` : 'No account' });

  bus.on('vault:state', (p) => {
    if (p.state === 'saved') {
      stateLabel.textContent = 'Cloud copy saved just now';
      stateLabel.style.color = 'var(--green-bright)';
    } else if (p.state === 'error') {
      stateLabel.textContent = p.message || 'Could not save to the cloud';
      stateLabel.style.color = 'var(--yellow)';
    }
  });

  const fileInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const snapshot = await readBackupFile(file);
      const ok = await confirmDialog({
        title: 'Restore this backup?',
        body: `This replaces what is on this device with ${snapshot.self.displayName}'s data (${Object.keys(snapshot.servers || {}).length} servers). Your cloud copy is left alone until the next save.`,
        confirmLabel: 'Restore',
      });
      if (!ok) return;
      restoreSnapshot(snapshot);
      closeAllModals();
      location.reload();
    } catch (e) {
      toast(e.message || 'Could not read that backup', 'error');
    }
  });

  const saveBtn = el('button', {
    class: 'btn btn-primary btn-sm', type: 'button',
    onclick: async () => {
      const pw = sessionPassword();
      if (!pw) { toast('Unlock with your password first', 'warn'); return; }
      saveBtn.disabled = true;
      stateLabel.textContent = 'Sealing your data…';
      try {
        const res = await saveVaultToCloud(pw);
        stateLabel.textContent = `Saved ${Math.round(res.size / 1024)} KB · ${res.parts} part${res.parts === 1 ? '' : 's'}`;
        stateLabel.style.color = 'var(--green-bright)';
        toast('Cloud copy updated', 'ok');
      } catch (e) {
        stateLabel.textContent = e.message || 'Could not save';
        stateLabel.style.color = 'var(--yellow)';
      } finally {
        saveBtn.disabled = false;
      }
    },
  }, icon('uploadCloud', 15), 'Save to the cloud now');

  return el('div', {},
    el('h3', { text: 'Backup & sync' }),
    el('p', { class: 'sc-sub', text: 'Everything — servers, channels, history, DMs, settings and your profile — is saved under your username.' }),
    el('div', { class: 'sync-card' },
      el('div', { class: 'sync-ico', html: iconHTML('uploadCloud', 19) }),
      el('div', { style: { flex: '1', minWidth: '0' } },
        el('b', { text: 'Encrypted cloud copy' }),
        el('span', { text: `Last saved ${savedAt}. Same username + password on another Chromebook restores it.` }),
        stateLabel),
      saveBtn),
    el('div', { class: 'setting-block' },
      el('div', { class: 'sr-title', text: 'How it works' }),
      el('ul', { class: 'bullets' },
        el('li', { text: 'Your data is sealed with AES-256-GCM using a key derived from your password (PBKDF2, 150k rounds).' }),
        el('li', { text: 'The sealed copy is published to the relay as retained messages, so a new device can pick it up even if nobody else is online.' }),
        el('li', { text: 'The password itself is never stored, sent, or derivable from the copy.' }),
        el('li', { text: 'Pictures that would bloat the copy are dropped from it; your local device keeps them.' })),
    ),
    el('div', { class: 'setting-block' },
      el('div', { class: 'sr-title', text: 'Move to another computer' }),
      el('div', { class: 'sr-desc', text: 'Sign in there with the same username and password — or carry a file if you prefer.' }),
      el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
        el('button', {
          class: 'btn btn-secondary btn-sm', type: 'button',
          onclick: async () => {
            try {
              const res = await downloadBackup();
              toast(`Saved ${res.name}`, 'ok');
            } catch (e) { toast('Could not export that backup', 'error'); }
          },
        }, icon('download', 15), 'Download a backup file'),
        el('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: () => fileInput.click(),
        }, icon('upload', 15), 'Restore from a file'),
        fileInput),
    ),
    el('div', { class: 'tip-card', style: { marginTop: '14px' } },
      el('div', { class: 'tip-ico', html: iconHTML('shield', 15) }),
      el('div', {}, el('b', { text: 'If you forget the password' }),
        el('p', { text: 'Nobody can recover the cloud copy — that is what keeps it private. A downloaded backup file is your fallback, and your device keeps working as long as you remember it.' }))),
  );
}

function renderAvatarRow(holder) {
  const self = state.self;
  holder.replaceChildren();
  holder.innerHTML = avatarHTML(self, { size: 56 }) +
    `<div style="flex:1"><div style="font-weight:700;font-size:15px">${escapeHtml(self.displayName)}</div>
     <div style="font-size:12.5px;color:var(--text-3);margin-top:2px">@${escapeHtml(self.handle)}</div></div>`;

  const uploadBtn = el('button', { class: 'btn btn-secondary btn-sm', type: 'button' }, icon('upload', 14), 'Upload');
  uploadBtn.addEventListener('click', () => {
    const input = el('input', { type: 'file', accept: 'image/*', hidden: true });
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      try {
        const { src } = await processImageFile(file, { size: 192, quality: 0.8 });
        updateSelf({ avatar: { kind: 'image', src } });
        renderAvatarRow(holder);
        bus.emit('self:changed');
        toast('Avatar updated', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });
    document.body.append(input);
    input.click();
  });
  const colorBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Color');
  colorBtn.addEventListener('click', (e) => {
    const sw = el('div', { class: 'swatches', style: { padding: '10px', maxWidth: '260px' } });
    for (const c of AVATAR_COLORS) {
      sw.append(el('button', {
        class: 'swatch', type: 'button', style: { background: c }, 'aria-label': `Avatar color ${c}`,
        onclick: () => {
          updateSelf({ avatar: { kind: 'color', color: c }, accentColor: c });
          renderAvatarRow(holder);
          bus.emit('self:changed');
          closeAllModals();
          openSettings('account');
        },
      }));
    }
    openMenu({ items: [{ type: 'label', label: 'Avatar color' }, ...[...sw.children].map((btn, i) => ({ label: AVATAR_COLORS[i], onClick: () => btn.click() }))], at: e.currentTarget, align: 'end' });
  });
  holder.append(el('div', { class: 'row', style: { gap: '6px' } }, uploadBtn, colorBtn));
}

function profileTab() {
  const self = state.self;
  const wrap = el('div', {},
    el('h3', { text: 'Profile' }),
    el('p', { class: 'sc-sub', text: 'How you appear to everyone on the network.' }),
  );
  const preview = el('div', { class: 'banner-upload', style: { padding: '18px' } });
  preview.innerHTML = `${avatarHTML(self, { size: 64 })}
    <div><div style="font-weight:750;font-size:17px">${escapeHtml(self.displayName)}</div>
    <div style="color:var(--text-3);font-size:13px">@${escapeHtml(self.handle)}</div>
    <div style="color:var(--text-2);font-size:12.5px;margin-top:5px">${escapeHtml(self.bio || 'No bio yet.')}</div></div>`;
  wrap.append(preview);

  wrap.append(el('div', { class: 'setting-block', style: { marginTop: '14px' } },
    el('div', { class: 'sr-title', text: 'Status' }),
    el('div', { class: 'sr-desc', text: 'Shown next to your name everywhere. Invisible makes you appear offline.' }),
    el('div', { class: 'radio-group' },
      ...[['online', 'Online'], ['idle', 'Idle'], ['dnd', 'Do not disturb'], ['offline', 'Invisible']].map(([val, label]) =>
        el('button', {
          class: 'radio-card', type: 'button', 'aria-checked': String(self.status === val),
          onclick: (e) => {
            updateSelf({ status: val });
            wrap.querySelectorAll('.radio-card').forEach((n) => n.setAttribute('aria-checked', 'false'));
            e.currentTarget.setAttribute('aria-checked', 'true');
            bus.emit('self:changed');
          },
        }, el('b', {}, el('span', { class: `status-dot status-${val}`, style: { width: '9px', height: '9px', borderRadius: '50%' } }), label))),
    ),
  ));

  wrap.append(el('div', { class: 'setting-block' },
    el('div', { class: 'sr-title', text: 'Accent color' }),
    el('div', { class: 'sr-desc', text: 'Used for your avatar fallback and profile banner.' }),
    accentRow(),
  ));

  wrap.append(el('div', { class: 'setting-block' },
    el('div', { class: 'sr-title', text: 'Preview profile card' }),
    el('div', { class: 'sr-desc', text: 'This is what people see when they click your name.' }),
    el('button', {
      class: 'btn btn-secondary btn-sm', type: 'button',
      onclick: (e) => openProfileCard({ anchor: e.currentTarget, user: state.self, status: state.self.status, placement: 'right' }),
    }, icon('user', 15), 'Open my card'),
  ));
  return wrap;
}

function accentRow() {
  const row = el('div', { class: 'accent-row' });
  const accents = [['blurple', '#5865f2'], ['violet', '#a259ff'], ['rose', '#f43f5e'], ['amber', '#f59e0b'], ['emerald', '#10b981'], ['cyan', '#06b6d4'], ['pink', '#eb459e'], ['slate', '#64748b']];
  for (const [id, color] of accents) {
    row.append(el('button', {
      class: 'accent-dot', type: 'button', style: { background: color, color },
      'aria-checked': String(state.settings.accent === id), 'aria-label': id,
      onclick: () => {
        setAccent(id);
        row.querySelectorAll('.accent-dot').forEach((n) => n.setAttribute('aria-checked', 'false'));
        row.querySelector(`[aria-label="${id}"]`)?.setAttribute('aria-checked', 'true');
        const rgb = color;
        updateSelf({ accentColor: rgb });
      },
    }));
  }
  return row;
}

function appearanceTab() {
  const wrap = el('div', {},
    el('h3', { text: 'Appearance' }),
    el('p', { class: 'sc-sub', text: 'Tune the look. Everything updates instantly.' }),
  );

  const cards = el('div', { class: 'theme-cards' });
  const themes = [
    ['dark', 'Dark', '#1a1c22', '#13151a', '#0b0c10'],
    ['light', 'Light', '#ffffff', '#f2f3f6', '#e6e8ec'],
    ['midnight', 'Midnight', '#141726', '#0f1220', '#090b14'],
  ];
  for (const [id, label, chat, side, rail] of themes) {
    const isOn = (id === 'midnight' ? state.settings.theme === 'midnight' : state.settings.theme === id);
    const card = el('button', { class: 'theme-card', type: 'button', 'aria-checked': String(isOn) });
    card.innerHTML = `<div class="theme-preview">
        <div class="tp-rail" style="background:${rail}"></div>
        <div class="tp-side" style="background:${side}"></div>
        <div class="tp-chat" style="background:${chat}">
          <div class="tp-line" style="background:#5865f2;width:60%"></div>
          <div class="tp-line" style="background:${id === 'light' ? '#c9cdd6' : '#333844'};width:85%"></div>
          <div class="tp-line" style="background:${id === 'light' ? '#d8dbe2' : '#2b303a'};width:70%"></div>
          <div class="tp-line" style="background:${id === 'light' ? '#c9cdd6' : '#333844'};width:45%"></div>
        </div></div><span>${label}</span>`;
    card.addEventListener('click', () => {
      setTheme(id);
      cards.querySelectorAll('.theme-card').forEach((n) => n.setAttribute('aria-checked', 'false'));
      card.setAttribute('aria-checked', 'true');
      document.dispatchEvent(new CustomEvent('ta:theme-changed'));
    });
    cards.append(card);
  }
  wrap.append(el('div', { class: 'setting-block' }, el('div', { class: 'sr-title', text: 'Theme' }), el('div', { class: 'sr-desc', text: 'Pick the mood you want to live in.' }), cards));
  wrap.append(el('div', { class: 'setting-block' },
    el('div', { class: 'sr-title', text: 'Accent' }), el('div', { class: 'sr-desc', text: 'Your highlight color across the app.' }), accentRow()));

  wrap.append(switchRow('Compact messages', 'Tighter spacing so more conversation fits on screen.', 'compact'));
  wrap.append(switchRow('Show member list', 'Display who is online in this server.', 'showMembers'));
  wrap.append(switchRow('Show timestamps', 'Show the clock time next to each message.', 'timestamps'));
  wrap.append(switchRow('Reduce motion', 'Fewer animations and transitions.', 'reduceMotion'));
  return wrap;
}

function switchRow(title, desc, key) {
  const btn = el('button', {
    class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(Boolean(state.settings[key])),
    onclick: (e) => {
      const next = !Boolean(state.settings[key]);
      setSetting(key, next);
      e.currentTarget.setAttribute('aria-checked', String(next));
      document.dispatchEvent(new CustomEvent('ta:settings-applied', { detail: { key } }));
    },
  });
  return el('div', { class: 'setting-row' },
    el('div', { class: 'sr-text' }, el('div', { class: 'sr-title', text: title }), el('div', { class: 'sr-desc', text: desc })),
    btn,
  );
}

function notificationsTab() {
  const wrap = el('div', {},
    el('h3', { text: 'Notifications' }),
    el('p', { class: 'sc-sub', text: 'TalkingApp only pings you when it matters.' }),
  );
  wrap.append(switchRow('Message sounds', 'A soft pop when a new message arrives.', 'sounds'));
  wrap.append(switchRow('Desktop notifications', 'Native popups when the window is in the background.', 'desktopNotifs'));
  wrap.append(switchRow('Show typing indicators', 'See when someone is composing a reply.', 'showTyping'));

  wrap.append(el('div', { class: 'setting-block' },
    el('div', { class: 'sr-title', text: 'Test a notification' }),
    el('div', { class: 'sr-desc', text: 'Check your sound and popup settings without waiting for a message.' }),
    el('div', { class: 'row', style: { gap: '8px' } },
      el('button', {
        class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: () => document.dispatchEvent(new CustomEvent('ta:test-notification')),
      }, icon('bell', 14), 'Send test'),
      el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button',
        onclick: async () => {
          if (!('Notification' in window)) return toast('This browser has no notification support', 'warn');
          const p = await Notification.requestPermission();
          toast(p === 'granted' ? 'Desktop notifications enabled' : 'Permission not granted', p === 'granted' ? 'ok' : 'warn');
        },
      }, 'Enable desktop alerts'),
    ),
  ));
  return wrap;
}

function networkTab() {
  const wrap = el('div', {},
    el('h3', { text: 'Network' }),
    el('p', { class: 'sc-sub', text: 'TalkingApp relays messages through public infrastructure so everyone on the page can chat in real time.' }),
  );

  const statusRow = el('div', { class: 'setting-block' });
  const paint = () => {
    const st = net.status();
    statusRow.replaceChildren(
      el('div', { class: 'row', style: { justifyContent: 'space-between', marginBottom: '10px' } },
        el('div', { class: 'sr-title', text: 'Relay status' }),
        el('span', { class: `pill ${st === 'online' ? 'green' : st === 'connecting' ? 'yellow' : 'red'}` }, el('i'), st === 'online' ? 'Connected' : st === 'connecting' ? 'Connecting' : 'Offline'),
      ),
      el('div', { class: 'kv-list' },
        ...net.transports.map((t) => el('div', {},
          el('span', { text: `${t.kind === 'mqtt' ? 'MQTT' : t.kind === 'raw-ws' ? 'WebSocket' : 'Local tabs'} · ${t.label}` }),
          el('b', { style: { color: t.state === 'online' ? 'var(--green-bright)' : t.state === 'error' ? 'var(--red)' : 'var(--text-3)' }, text: t.state })),
        ),
        el('div', {}, el('span', { text: 'Room' }), el('b', { text: CONFIG.room })),
        el('div', {}, el('span', { text: 'People online' }), el('b', { text: String(Object.keys(state.peers).length + 1) })),
      ),
      el('div', { class: 'row', style: { gap: '8px', marginTop: '12px' } },
        el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => document.dispatchEvent(new CustomEvent('ta:reconnect')) }, icon('wifi', 14), 'Reconnect'),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { net.emitStatus(); paint(); toast('Status refreshed', 'ok'); } }, 'Refresh'),
      ),
    );
  };
  paint();
  wrap.append(statusRow);

  const relayInput = el('input', { class: 'input', placeholder: 'wss://your-relay.example/ws', value: localStorage.getItem('ta.relay.override') || '' });
  wrap.append(el('div', { class: 'setting-block' },
    el('div', { class: 'sr-title', text: 'Custom relay' }),
    el('div', { class: 'sr-desc', text: 'Point the app at your own MQTT broker or broadcast WebSocket. Leave empty to use the default public relays.' }),
    el('div', { class: 'row', style: { gap: '8px' } }, relayInput,
      el('button', {
        class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: () => {
          const v = relayInput.value.trim();
          if (v) localStorage.setItem('ta.relay.override', v);
          else localStorage.removeItem('ta.relay.override');
          toast('Relay saved — reloading', 'ok');
          setTimeout(() => location.reload(), 700);
        },
      }, 'Save')),
  ));

  wrap.append(el('div', { class: 'setting-block' },
    el('div', { class: 'sr-title', text: 'Preview with demo members' }),
    el('div', { class: 'sr-desc', text: 'Adds a few clearly-labelled demo people so you can see how conversations feel before anyone else joins. They are simulated on this device and never pretend to be real.' }),
    (() => {
      const btn = el('button', {
        class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(Boolean(state.settings.simulated)),
        onclick: (e) => {
          const next = !state.settings.simulated;
          setSetting('simulated', next);
          e.currentTarget.setAttribute('aria-checked', String(next));
          document.dispatchEvent(new CustomEvent('ta:sim-toggle', { detail: { on: next } }));
        },
      });
      return el('div', { class: 'row', style: { gap: '10px' } }, btn, el('span', { style: { fontSize: '12.5px', color: 'var(--text-3)' }, text: 'Only visible to you' }));
    })(),
  ));

  wrap.append(el('div', { class: 'tip-card', style: { marginTop: '10px' } },
    el('div', { class: 'tip-ico' }, icon('lock', 15)),
    el('div', {}, el('b', { text: 'Public by design' }),
      el('p', { text: 'The free public relays carry these messages unencrypted. Great for a hangout, not for secrets.' }))));
  return wrap;
}

function keybindsTab() {
  const rows = [
    ['Send message', ['Enter']],
    ['New line', ['Shift', 'Enter']],
    ['Edit your last message', ['↑']],
    ['Cancel reply or edit', ['Esc']],
    ['Add reaction to hovered message', ['Click', '😊']],
    ['Open search', ['Ctrl', 'K']],
    ['Close dialog / menu', ['Esc']],
    ['Toggle member list', ['Ctrl', 'Shift', 'M']],
    ['Open this settings panel', ['Ctrl', ',']],
    ['Jump to #general', ['Ctrl', 'Shift', 'G']],
  ];
  const wrap = el('div', {}, el('h3', { text: 'Keybinds' }), el('p', { class: 'sc-sub', text: 'Talk faster.' }));
  const grid = el('div', { class: 'kbd-grid' });
  for (const [label, keys] of rows) {
    grid.append(el('div', { class: 'kbd-row' },
      el('span', { text: label }),
      el('span', { class: 'keys' }, ...keys.map((k) => el('kbd', { class: 'key', text: k }))),
    ));
  }
  wrap.append(grid);
  return wrap;
}

function aboutTab() {
  const wrap = el('div', {},
    el('h3', { text: 'About TalkingApp' }),
    el('p', { class: 'sc-sub', text: 'A real-time chat app that runs entirely in your browser and deploys free on GitHub Pages.' }),
    el('div', { class: 'sync-card' },
      el('div', { class: 'sync-ico', html: iconHTML('heart', 18) }),
      el('div', {}, el('b', { text: 'Made by Jayden' }),
        el('span', { text: 'Designed and built by hand — no frameworks, no tracking, no ads.' }))),
    el('div', { class: 'setting-block' },
      el('div', { class: 'kv-list' },
        el('div', {}, el('span', { text: 'Version' }), el('b', { text: CONFIG.version })),
        el('div', {}, el('span', { text: 'Build' }), el('b', { text: 'static · github pages' })),
        el('div', {}, el('span', { text: 'Storage' }), el('b', { text: 'this browser only' })),
        el('div', {}, el('span', { text: 'Messages' }), el('b', { text: 'relayed publicly, not stored on a server' })),
      )),
    el('div', { class: 'row', style: { gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
      el('a', { class: 'btn btn-secondary btn-sm', href: CONFIG.links.github, target: '_blank', rel: 'noopener' }, icon('globe', 14), 'Source code'),
      el('a', { class: 'btn btn-ghost btn-sm', href: CONFIG.links.issues, target: '_blank', rel: 'noopener' }, icon('info', 14), 'Report a bug'),
    ),
    el('div', { class: 'tip-card', style: { marginTop: '14px' } },
      el('div', { class: 'tip-ico' }, icon('heart', 15)),
      el('div', {}, el('b', { text: 'Built for talking' }), el('p', { text: 'No algorithm, no feed, no ads. Just people, channels, and the occasional 🔥 reaction.' }))),
  );
  return wrap;
}

function dangerTab() {
  return el('div', {},
    el('h3', { text: 'Reset data' }),
    el('p', { class: 'sc-sub', text: 'Start fresh. Your profile, servers, and local message history will be wiped from this browser.' }),
    el('div', { class: 'tip-card' },
      el('div', { class: 'tip-ico' }, icon('warning', 15)),
      el('div', {}, el('b', { text: 'This cannot be undone' }), el('p', { text: 'Other people keep their own copies of any conversations you had.' }))),
    el('div', { class: 'row', style: { gap: '8px', marginTop: '14px' } },
      el('button', {
        class: 'btn btn-danger-soft', type: 'button',
        onclick: async () => {
          const ok = await confirmDialog({ title: 'Reset everything?', body: 'This clears your profile, servers and local messages from this browser.', confirmLabel: 'Reset everything', danger: true });
          if (ok) resetEverything();
        },
      }, icon('trash', 15), 'Reset my data'),
      el('button', {
        class: 'btn btn-secondary', type: 'button',
        onclick: () => { flush(); toast('Saved', 'ok'); },
      }, 'Save a copy'),
    ),
  );
}

export { closeAllModals };
