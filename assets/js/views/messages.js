// Message list rendering and interactions
import {
  el, escapeHtml, formatClock, formatDayLabel, formatMessageStamp, sameDay, cssEsc, copyToClipboard,
} from '../util.js';
import { avatarHTML } from '../avatar.js';
import { icon, iconHTML } from '../icons.js';
import { renderContent, plainPreview } from '../markdown.js';
import { emojify } from '../emojis.js';
import {
  state, toggleReaction, togglePin, deleteMessage, findMessage, markRead, toast,
} from '../store.js';
import { bus } from '../bus.js';
import { openMenu, closePopover } from '../ui/menu.js';
import { openProfileCard } from '../ui/profileCard.js';
import { openEmojiPicker } from '../ui/emojiPicker.js';
import { openLightbox } from '../ui/lightbox.js';
import { confirmDialog } from '../ui/modal.js';
import { openDM } from '../store.js';

let scroller = null;
let inner = null;
let ctx = { channelId: null, lastMsg: null, lastNode: null, lastDay: null };
let atBottom = true;
let jumpBtn = null;

const GROUP_WINDOW = 5 * 60 * 1000;

export function initMessages() {
  scroller = document.getElementById('messagesScroll');
  inner = document.getElementById('messagesInner');
  scroller.addEventListener('scroll', () => {
    atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    if (atBottom) removeJump();
  }, { passive: true });

  inner.addEventListener('click', onListClick);
  inner.addEventListener('contextmenu', onListContext);

  bus.on('message:new', ({ channelId, message }) => {
    if (channelId !== ctx.channelId) return;
    if (!message.system && !message.isSelf) markRead(channelId);
    handleIncoming(message);
  });
  bus.on('message:updated', ({ channelId, message }) => {
    if (channelId !== ctx.channelId) return;
    const node = inner.querySelector(`.message[data-id="${cssEsc(message.id)}"]`);
    if (!node) return renderMessage(message);
    const keepGroup = node.classList.contains('group-start');
    node.replaceWith(messageNode(message, { group: keepGroup }));
  });
  bus.on('message:deleted', ({ channelId, messageId }) => {
    if (channelId !== ctx.channelId) return;
    const node = inner.querySelector(`.message[data-id="${cssEsc(messageId)}"]`);
    if (node) {
      node.style.transition = 'opacity .12s, transform .12s';
      node.style.opacity = '0';
      node.style.transform = 'translateX(-6px)';
      setTimeout(() => {
        node.remove();
        if (ctx.lastNode === node) {
          ctx.lastMsg = null;
          ctx.lastNode = null;
        }
      }, 120);
    }
  });
  bus.on('typing:changed', renderTyping);
}

/* ------------------------------ full render ------------------------------ */

export function openChannelView(channelId) {
  if (!scroller) initMessages();
  const ch = state.channels[channelId];
  ctx = { channelId, lastMsg: null, lastNode: null, lastDay: null };
  const readTs = state.reads[channelId] || 0;
  let lastMsg = null;
  let lastDay = null;
  inner.replaceChildren();
  if (!ch) return;

  inner.append(introNode(ch));

  const list = state.messages[channelId] || [];
  const hasUnread = list.some((m) => m.ts > readTs && !m.isSelf && !m.system);
  let unreadInserted = !hasUnread;

  for (const msg of list) {
    if (lastDay == null || !sameDay(lastDay, msg.ts)) {
      inner.append(dayDivider(msg.ts));
      lastDay = msg.ts;
    }
    if (!unreadInserted && msg.ts > readTs && !msg.isSelf && !msg.system) {
      inner.append(el('div', { class: 'unread-divider', id: 'unread-divider' }, el('span', { text: 'New messages' })));
      unreadInserted = true;
    }
    const group = !lastMsg || lastMsg.userId !== msg.userId || msg.ts - lastMsg.ts > GROUP_WINDOW || Boolean(msg.replyTo) || String(msg.text || '').includes('\n');
    const node = messageNode(msg, { group });
    inner.append(node);
    lastMsg = msg;
    ctx.lastMsg = msg;
    ctx.lastNode = node;
  }
  ctx.lastDay = lastDay;

  // members may change the available width — settle then pin to bottom
  requestAnimationFrame(() => scrollToBottom(false));
  setTimeout(() => scrollToBottom(false), 60);
  setTimeout(() => { if (atBottom) scrollToBottom(false); }, 200);

  const unread = document.getElementById('unread-divider');
  if (unread) {
    unread.scrollIntoView({ block: 'center' });
    atBottom = false;
  }
}

function introNode(ch) {
  const s = ch.type === 'dm' ? null : state.servers[ch.serverId];
  const user = ch.type === 'dm' ? state.users[ch.dmUserId] || { displayName: ch.name, handle: ch.handle } : null;
  const title = ch.type === 'dm' ? `${user.displayName}` : `#${ch.name}`;
  const sub = ch.type === 'dm'
    ? `This is the beginning of your conversation with @${ch.handle}. ${state.presence[ch.dmUserId] === 'online' ? 'They are online right now.' : 'They will see your messages when they are online.'}`
    : ch.topic || `${s ? `Welcome to #${ch.name} in ${s.name}.` : ''}`;
  const node = el('div', { class: 'chat-intro', 'data-intro': '1' });
  const ic = el('div', { class: 'ci-icon' }, ch.type === 'dm'
    ? el('div', { html: avatarHTML(user, { size: 56 }) })
    : icon(ch.type === 'dm' ? 'at' : 'hash', 34));
  node.append(ic, el('h2', { text: title }), el('p', { text: sub }));
  if (ch.type !== 'dm') {
    node.append(el('div', { class: 'ci-hint' },
      icon('sparkle', 14),
      el('span', { html: `This channel is part of <b>#${escapeHtml(ch.name)}</b> — anyone in <b>${escapeHtml(s?.name || 'this server')}</b> on the network can read and reply.` }),
    ));
  } else {
    node.append(el('div', { class: 'ci-hint' }, icon('lock', 14), el('span', { text: 'Direct messages are one-to-one. Only the two of you see them.' })));
  }
  return node;
}

function dayDivider(ts) {
  return el('div', { class: 'day-divider' }, el('span', { text: formatDayLabel(ts) }));
}

export function scrollToBottom(smooth = true) {
  if (!scroller) return;
  scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  atBottom = true;
  removeJump();
}

/* ------------------------------- one message ----------------------------- */

function messageNode(msg, { group = true } = {}) {
  const isSelf = msg.userId === state.self?.id;
  const selfHandle = state.self?.handle;
  const mentionsMe = selfHandle && new RegExp(`@${selfHandle}\\b`, 'i').test(msg.text || '');
  const mentionsAll = /@everyone\b/i.test(msg.text || '');
  const highlighted = !isSelf && (mentionsMe || mentionsAll);

  const node = el('div', {
    class: `message${group ? ' group-start' : ' compact'}${highlighted ? ' mentioned' : ''}`,
    'data-id': msg.id,
    'data-user': msg.userId,
  });

  const user = { id: msg.userId, displayName: msg.displayName, handle: msg.handle, avatar: msg.avatar, accentColor: msg.accentColor };

  // avatar column
  const avWrap = el('div', { class: 'msg-avatar' });
  if (group) {
    avWrap.innerHTML = avatarHTML(user, { size: 40 });
  } else {
    const stamp = el('span', { class: 'msg-stamp', text: formatClock(msg.ts), title: formatMessageStamp(msg.ts) });
    avWrap.append(stamp);
  }
  node.append(avWrap);

  const body = el('div', { class: 'msg-body' });

  if (group) {
    const head = el('div', { class: 'msg-head' },
      el('span', { class: 'msg-author', 'data-user': msg.userId, text: msg.displayName }),
    );
    if (msg.system) head.append(el('span', { class: 'msg-badge bot', text: 'APP' }));
    if (isSelf) head.append(el('span', { class: 'msg-badge', text: 'YOU', style: 'background:var(--bg-hover-strong);color:var(--text-2)' }));
    if (msg.isSimulated) head.append(el('span', { class: 'msg-badge net', text: 'DEMO' }));
    head.append(el('span', {
      class: 'msg-time',
      text: formatClock(msg.ts),
      title: formatMessageStamp(msg.ts),
    }));
    if (msg.network) head.append(el('span', { class: 'msg-edited', title: 'Delivered over the TalkingApp network', text: '· network' }));
    if (msg.pinned) head.append(el('span', { class: 'msg-pin-mark', title: 'Pinned message', html: iconHTML('pin', 12) }));
    body.append(head);
  }

  if (msg.replyTo) {
    const parent = findMessage(msg.replyTo, msg.channelId) || msg.replyParent;
    const name = parent?.displayName || msg.replyToName || 'a message';
    const snippet = parent ? plainPreview(emojify(parent.text), 70) : emojify(msg.replyToText || 'original message');
    const reply = el('div', { class: 'msg-reply', 'data-jump': msg.replyTo },
      el('span', { class: 'reply-line' }),
      el('b', { text: name }),
      el('span', { class: 'reply-text', text: snippet || 'click to jump' }),
    );
    body.append(reply);
  }

  const text = el('div', { class: 'msg-text' });
  text.innerHTML = renderContent(msg.text || '');
  decorateContent(text, msg);
  body.append(text);

  if (msg.attachment?.src) {
    const att = el('div', { class: 'msg-attachment', 'data-lightbox': msg.attachment.src });
    att.innerHTML = `<img src="${escapeHtml(msg.attachment.src)}" alt="${escapeHtml(msg.attachment.name || 'attachment')}" loading="lazy" />`;
    body.append(att);
  }

  if (msg.editedTs) {
    text.append(el('span', { class: 'msg-edited', text: ' (edited)', title: formatMessageStamp(msg.editedTs) }));
  }

  if (msg.reactions && Object.keys(msg.reactions).length) {
    body.append(reactionBar(msg));
  }

  if (msg.queued) {
    body.append(el('div', { class: 'msg-pending-op' },
      icon('wifiOff', 12),
      'Waiting for the network — will send automatically'));
  } else if (msg.pending) {
    body.append(el('div', { class: 'msg-pending-op' }, el('span', { class: 'spinner', style: 'width:10px;height:10px;border-width:1.5px' }), 'Sending…'));
  }
  if (msg.failed) {
    body.append(el('div', { class: 'msg-failed' }, icon('warning', 13), 'Not delivered — you appear to be offline.'));
  }

  body.append(toolbar(msg));
  node.append(body);
  return node;
}

function decorateContent(root, msg) {
  // mark mentions of me, resolve handles to profiles
  for (const m of root.querySelectorAll('.mention')) {
    const handle = (m.dataset.mention || '').toLowerCase();
    if (state.self && handle === state.self.handle) m.classList.add('me');
    const known = Object.values(state.users).find((u) => u.handle === handle) ||
      Object.values(state.peers).map((p) => p.user).find((u) => u?.handle === handle);
    if (!known) m.classList.add('unknown');
    m.addEventListener('click', (e) => {
      e.stopPropagation();
      const u = Object.values(state.users).find((x) => x.handle === handle) ||
        Object.values(state.peers).map((p) => p.user).find((x) => x.handle === handle);
      if (u) openProfileCard({ anchor: m, user: u, status: state.presence[u.id], onMessage: (usr) => openDM(usr.id, usr) });
    });
  }
  for (const c of root.querySelectorAll('.channel-ref')) {
    c.addEventListener('click', (e) => {
      e.stopPropagation();
      const name = c.dataset.channel;
      const ch = state.servers[msg.channelId ? state.channels[msg.channelId]?.serverId : null];
      const target = ch ? state.channels[ch.channelIds.find((id) => state.channels[id]?.name === name)] : null;
      const globalTarget = target || Object.values(state.channels).find((x) => x.name === name && x.type !== 'dm');
      if (globalTarget) {
        import('./shell.js').then((m) => m.goToChannel(globalTarget.id));
      }
    });
  }
  for (const s of root.querySelectorAll('.spoiler')) {
    s.addEventListener('click', () => s.classList.toggle('revealed'));
    s.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); s.classList.toggle('revealed'); } });
  }
}

function reactionBar(msg) {
  const bar = el('div', { class: 'reactions' });
  const mine = state.self?.id;
  for (const [emoji, users] of Object.entries(msg.reactions || {})) {
    if (!users.length) continue;
    const btn = el('button', {
      class: `reaction${users.includes(mine) ? ' mine' : ''}`,
      type: 'button',
      title: `${users.length} reaction${users.length === 1 ? '' : 's'}`,
      'data-emoji': emoji,
      onclick: (e) => { e.stopPropagation(); toggleReaction(msg.channelId, msg.id, emoji); },
    }, el('span', { class: 'r-emoji', text: emoji }), el('span', { text: String(users.length) }));
    bar.append(btn);
  }
  const add = el('button', {
    class: 'reaction add',
    type: 'button',
    title: 'Add reaction',
    onclick: (e) => {
      e.stopPropagation();
      openEmojiPicker({
        anchor: e.currentTarget,
        onPick: (emoji) => { toggleReaction(msg.channelId, msg.id, emoji); closePopover(); },
      });
    },
  }, icon('smile', 15));
  bar.append(add);
  return bar;
}

function toolbar(msg) {
  const isSelf = msg.userId === state.self?.id;
  const bar = el('div', { class: 'msg-toolbar' });
  bar.append(el('button', {
    type: 'button', title: 'Add reaction', 'aria-label': 'Add reaction',
    onclick: (e) => openEmojiPicker({
      anchor: e.currentTarget,
      onPick: (emoji) => { toggleReaction(msg.channelId, msg.id, emoji); closePopover(); },
    }),
  }, icon('smile', 17)));
  bar.append(el('button', {
    type: 'button', title: 'Reply', 'aria-label': 'Reply',
    onclick: () => { import('./composer.js').then((m) => m.setReplyTo(msg)); },
  }, icon('reply', 17)));
  if (isSelf) {
    bar.append(el('button', {
      type: 'button', title: 'Edit', 'aria-label': 'Edit message',
      onclick: () => { import('./composer.js').then((m) => m.startEdit(msg)); },
    }, icon('edit', 16)));
  }
  bar.append(el('button', {
    type: 'button', title: 'More', 'aria-label': 'More options',
    onclick: (e) => messageMenu(msg, e.currentTarget),
  }, icon('more', 17)));
  return bar;
}

export function messageMenu(msg, anchor) {
  const isSelf = msg.userId === state.self?.id;
  const items = [
    { label: 'Add reaction', icon: 'smile', onClick: () => openEmojiPicker({ anchor, onPick: (e) => toggleReaction(msg.channelId, msg.id, e) }) },
    { label: 'Reply', icon: 'reply', onClick: () => import('./composer.js').then((m) => m.setReplyTo(msg)) },
    { label: 'Copy text', icon: 'copy', onClick: async () => { await copyToClipboard(msg.text); toast('Message copied', 'ok'); } },
    { sep: true },
    {
      label: msg.pinned ? 'Unpin message' : 'Pin message',
      icon: 'pin',
      onClick: () => {
        const pinned = togglePin(msg.channelId, msg.id);
        toast(pinned ? 'Pinned to this channel' : 'Unpinned', 'ok');
      },
    },
    { label: 'Copy message link', icon: 'link', onClick: async () => {
      const url = `${location.origin}${location.pathname}#/channel/${msg.channelId}/${msg.id}`;
      await copyToClipboard(url);
      toast('Link copied', 'ok');
    } },
  ];
  if (isSelf) {
    items.push({ sep: true });
    items.push({ label: 'Edit message', icon: 'edit', onClick: () => import('./composer.js').then((m) => m.startEdit(msg)) });
    items.push({ label: 'Delete message', icon: 'trash', danger: true, onClick: async () => {
      const ok = await confirmDialog({ title: 'Delete message', body: 'This will remove the message for everyone in this channel.', confirmLabel: 'Delete', danger: true });
      if (ok) deleteMessage(msg.channelId, msg.id);
    } });
  } else {
    items.push({ sep: true });
    items.push({ label: 'View profile', icon: 'user', onClick: () => {
      const u = state.users[msg.userId] || { id: msg.userId, displayName: msg.displayName, handle: msg.handle, avatar: msg.avatar };
      openProfileCard({ anchor, user: u, status: state.presence[msg.userId], onMessage: (usr) => openDM(usr.id, usr) });
    } });
  }
  openMenu({ items, at: anchor, align: 'end' });
}

/* ------------------------------ incremental ------------------------------ */

function handleIncoming(msg) {
  if (!msg.system && !msg.isSelf) markRead(ctx.channelId);
  const shouldStick = atBottom || msg.isSelf;
  const lastDay = ctx.lastDay;
  if (lastDay == null || !sameDay(lastDay, msg.ts)) {
    inner.append(dayDivider(msg.ts));
    ctx.lastDay = msg.ts;
    ctx.lastMsg = null;
  }
  const group = !ctx.lastMsg || ctx.lastMsg?.userId !== msg.userId ||
    msg.ts - (ctx.lastMsg?.ts || 0) > GROUP_WINDOW || Boolean(msg.replyTo) || ctx.lastMsg == null;
  const node = messageNode(msg, { group });
  inner.append(node);
  ctx.lastMsg = msg;
  ctx.lastNode = node;
  if (shouldStick) requestAnimationFrame(() => scrollToBottom(false));
  else showJump();
}

function renderMessage(msg) {
  const node = messageNode(msg, { group: true });
  inner.append(node);
  requestAnimationFrame(() => scrollToBottom(false));
}

/* --------------------------------- events -------------------------------- */

function onListClick(e) {
  const target = e.target;
  if (target.closest('.msg-toolbar') || target.closest('.reactions')) return;

  const lb = target.closest('[data-lightbox]');
  if (lb) return openLightbox(lb.dataset.lightbox);

  const jump = target.closest('[data-jump]');
  if (jump) {
    e.preventDefault();
    const id = jump.dataset.jump;
    scrollToMessage(id);
    return;
  }

  const author = target.closest('.msg-author, .msg-avatar');
  if (author) {
    const holder = author.closest('.message');
    const userId = holder?.dataset.user;
    if (userId) {
      const u = state.users[userId] || (() => {
        const m = state.messages[ctx.channelId]?.find((x) => x.id === holder.dataset.id);
        return m ? { id: m.userId, displayName: m.displayName, handle: m.handle, avatar: m.avatar } : null;
      })();
      if (u) {
        openProfileCard({
          anchor: author.querySelector('.avatar') || author,
          user: u,
          status: state.presence[userId] || (userId === state.self?.id ? state.self.status : 'offline'),
          onMessage: (usr) => openDM(usr.id, usr),
        });
      }
    }
    return;
  }

}

function onListContext(e) {
  const holder = e.target.closest('.message');
  if (!holder) return;
  const msg = state.messages[ctx.channelId]?.find((m) => m.id === holder.dataset.id);
  if (!msg) return;
  e.preventDefault();
  messageMenu(msg, e.target);
}

export function scrollToMessage(id) {
  const node = inner?.querySelector(`.message[data-id="${cssEsc(id)}"]`);
  if (!node) return false;
  node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  node.style.transition = 'background .25s';
  node.style.background = 'color-mix(in oklab, var(--accent) 22%, transparent)';
  setTimeout(() => { node.style.background = ''; }, 900);
  return true;
}

/* -------------------------------- jump pill ------------------------------- */

function showJump() {
  if (!scroller || document.getElementById('jumpBottom')) return;
  jumpBtn = el('button', {
    class: 'jump-bottom', type: 'button', id: 'jumpBottom',
    onclick: () => scrollToBottom(true),
  }, icon('chevronDown', 16), 'New messages');
  scroller.parentElement.append(jumpBtn);
}
function removeJump() {
  jumpBtn?.remove();
  jumpBtn = null;
}

/* -------------------------------- typing ---------------------------------- */

function renderTyping() {
  const bar = document.getElementById('typingBar');
  if (!bar) return;
  const names = Object.entries(state.typing[ctx.channelId] || {})
    .filter(([, v]) => v.until > Date.now())
    .map(([, v]) => v.name);
  if (!names.length) {
    bar.replaceChildren();
    bar.style.visibility = 'hidden';
    return;
  }
  bar.style.visibility = 'visible';
  const label = names.length === 1
    ? `${names[0]} is typing`
    : names.length === 2
      ? `${names[0]} and ${names[1]} are typing`
      : `${names.length} people are typing`;
  bar.replaceChildren(
    el('span', { class: 'typing-dots' }, el('i'), el('i'), el('i')),
    el('span', { text: label }),
  );
}

