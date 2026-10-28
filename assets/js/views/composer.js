// Message composer: typing, replies, editing, emoji, images, autocomplete
import { el, autoResizeTextarea, debounce, throttle, escapeHtml, nearBottom } from '../util.js';
import { icon, iconHTML } from '../icons.js';
import {
  state, activeChannel, sendMessage, editMessage, toast, setSetting,
  canPostInChannel, currentPlan, dmPeer, isBlocked, unblockUser,
} from '../store.js';
import { maxUploadBytes, planOf } from '../plans.js';
import { bus } from '../bus.js';
import { openEmojiPicker } from '../ui/emojiPicker.js';
import { closePopover } from '../ui/menu.js';
import { searchEmojis } from '../emojis.js';
import { prepareAttachment } from '../avatar.js';

let area = null;
let ta = null;
let replyBar = null;
let editState = null;
let attachment = null;
let ac = null;              // autocomplete popover
let acItems = [];
let acIndex = 0;
let acContext = null;
let draftChannel = null;

const MAX = 2000;

export function initComposer() {
  area = document.getElementById('composerArea');
  render();

  bus.on('active:changed', () => {
    saveDraft();
    editState = null;
    attachment = null;
    state.ui.replyTo = null;
    render();
  });
  bus.on('typing:changed', updateTypingBar);
  setInterval(updateTypingBar, 1500);

  document.addEventListener('ta:composer-focus', focusComposer);
  document.addEventListener('ta:composer-set-text', (e) => {
    if (!ta) return;
    ta.value = e.detail || '';
    onInput();
    focusComposer();
  });
}

export function focusComposer() {
  if (!ta) return;
  ta.focus({ preventScroll: true });
  const len = ta.value.length;
  ta.setSelectionRange(len, len);
}

export function setReplyTo(msg) {
  if (!msg) return;
  state.ui.replyTo = msg.id;
  renderReplyBar(msg);
  focusComposer();
}

export function startEdit(msg) {
  if (!msg || msg.userId !== state.self?.id) return;
  editState = { id: msg.id, channelId: msg.channelId, original: msg.text };
  state.ui.replyTo = null;
  render();
  if (ta) {
    ta.value = msg.text;
    onInput();
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
}

export function insertText(text) {
  if (!ta) return;
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  onInput();
  focusComposer();
}

/* --------------------------------- render -------------------------------- */

function render() {
  if (!area) return;
  const ch = activeChannel();
  area.replaceChildren();
  replyBar = null;
  if (!ch) {
    area.append(el('div', { class: 'composer-hint' }, 'Pick a channel to start talking.'));
    return;
  }

  const typingBar = el('div', { class: 'typing-bar', id: 'typingBar', style: { visibility: 'hidden' } });
  area.append(typingBar);
  updateTypingBar();

  const peer = ch.type === 'dm' ? dmPeer(ch.id) : null;
  if (peer && isBlocked(peer.id)) {
    area.append(el('div', { class: 'composer-locked' },
      el('span', { class: 'cl-ico', html: iconHTML('lock', 16) }),
      el('div', { style: { flex: '1' } },
        el('b', { text: `You blocked ${peer.displayName || 'this person'}` }),
        el('span', { text: 'They cannot reach you and their messages stay hidden. Nothing was deleted.' })),
      el('button', {
        class: 'btn btn-secondary btn-sm', type: 'button',
        onclick: () => {
          unblockUser(peer.id);
          toast(`Unblocked ${peer.displayName || 'them'}`, 'ok');
          render();
        },
      }, icon('check', 14), 'Unblock')));
    return;
  }

  if (!canPostInChannel(ch.id)) {
    const server = ch.serverId ? state.servers[ch.serverId] : null;
    const role = server?.members?.[state.self?.id]?.role;
    area.append(el('div', { class: 'composer-locked' },
      el('span', { class: 'cl-ico', html: iconHTML('lock', 16) }),
      el('div', {},
        el('b', { text: ch.type === 'announcement' ? `#${ch.name} is an announcement channel` : `You have read-only access in ${server?.name || 'this server'}` }),
        el('span', { text: ch.type === 'announcement'
          ? 'Only moderators, admins and the owner can post here. You can still react and reply in the other channels.'
          : `Your role is ${String(role || 'read-only').replace(/^./, (c) => c.toUpperCase())}. Ask the owner for a different role if you need to post.` }))));
    return;
  }

  if (state.ui.replyTo) {
    const msg = (state.messages[ch.id] || []).find((m) => m.id === state.ui.replyTo);
    if (msg) area.append(makeReplyBar(msg));
  }
  if (editState) area.append(makeEditBar());

  const composer = el('div', { class: 'composer', id: 'composer' });
  const tools = el('div', { class: 'composer-tools' });

  const attachBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Attach an image or GIF', 'aria-label': 'Attach an image or GIF' }, icon('image', 19));
  attachBtn.addEventListener('click', pickImage);
  tools.append(attachBtn);

  const emojiBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Emoji', 'aria-label': 'Emoji' }, icon('smile', 19));
  emojiBtn.addEventListener('click', () => {
    openEmojiPicker({
      anchor: emojiBtn,
      onPick: (char) => insertText(char),
    });
  });
  tools.append(emojiBtn);

  const markdownBtn = el('button', { class: 'icon-btn', type: 'button', title: 'Formatting help', 'aria-label': 'Formatting help' }, icon('sparkle', 18));
  markdownBtn.addEventListener('click', showFormattingHelp);
  tools.append(markdownBtn);

  const main = el('div', { class: 'composer-main' });
  ta = el('textarea', {
    class: 'composer-input',
    id: 'composerInput',
    rows: '1',
    maxlength: String(MAX),
    placeholder: ch.type === 'dm' ? `Message @${ch.handle}` : `Message #${ch.name}`,
    'aria-label': ch.type === 'dm' ? `Message ${ch.name}` : `Message #${ch.name}`,
    autocomplete: 'off',
    spellcheck: 'true',
  });
  ta.value = state.ui.drafts?.[ch.id] || '';
  draftChannel = ch.id;
  main.append(ta);

  const sendBtn = el('button', { class: 'send-btn', type: 'button', title: 'Send message', 'aria-label': 'Send message' }, icon('send', 17));
  sendBtn.addEventListener('click', submit);

  composer.append(tools, main, sendBtn);
  area.append(composer);
  area.append(el('div', { class: 'composer-hint' },
    el('span', { html: `<b>Enter</b> to send` }), el('kbd', { text: 'Shift' }), el('span', { text: '+ Enter for a new line' }),
    el('span', { class: 'grow' }),
    el('span', { id: 'charCount', text: '' }),
  ));

  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', onKeyDown);
  ta.addEventListener('blur', () => setTimeout(() => closeAutocomplete(), 120));
  ta.addEventListener('paste', onPaste);
  ta.addEventListener('scroll', () => autoResizeTextarea(ta));
  composer.addEventListener('dragover', (e) => { e.preventDefault(); composer.style.borderColor = 'var(--accent)'; });
  composer.addEventListener('dragleave', () => { composer.style.borderColor = ''; });
  composer.addEventListener('drop', onDrop);

  onInput();
}

function makeReplyBar(msg) {
  const bar = el('div', { class: 'composer-reply' },
    icon('reply', 15),
    el('span', { html: `Replying to <b>${escapeHtml(msg.displayName)}</b>` }),
    el('span', { class: 'reply-text', text: msg.text.replace(/\n/g, ' ').slice(0, 110) }),
    el('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'Cancel reply',
      onclick: () => { state.ui.replyTo = null; render(); focusComposer(); },
    }, icon('close', 15)),
  );
  return bar;
}

function makeEditBar() {
  return el('div', { class: 'composer-edit' },
    icon('edit', 14),
    el('span', { class: 'edit-label', text: 'Editing message' }),
    el('span', { class: 'reply-text', text: 'Esc to cancel' }),
    el('span', { class: 'grow' }),
    el('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'Cancel edit',
      onclick: () => { editState = null; render(); focusComposer(); },
    }, icon('close', 15)),
  );
}

function renderReplyBar(msg) {
  const existing = area?.querySelector('.composer-reply');
  const node = makeReplyBar(msg);
  if (existing) existing.replaceWith(node);
  else area?.insertBefore(node, area.querySelector('.composer'));
}

/* --------------------------------- input --------------------------------- */

function onInput() {
  if (!ta) return;
  autoResizeTextarea(ta);
  const composer = document.getElementById('composer');
  composer?.classList.toggle('has-text', ta.value.trim().length > 0 || Boolean(attachment));
  const count = document.getElementById('charCount');
  if (count) count.textContent = ta.value.length > 1700 ? `${ta.value.length} / ${MAX}` : '';
  saveDraftDebounced();
  emitTyping();
  updateAutocomplete();
}

const saveDraftDebounced = debounce(() => saveDraft(), 400);
function saveDraft() {
  if (!ta || !draftChannel) return;
  if (!state.ui.drafts) state.ui.drafts = {};
  state.ui.drafts[draftChannel] = ta.value;
}

function emitTyping() {
  const ch = activeChannel();
  if (!ch || !ta?.value.trim()) return;
  bus.emit('composer:typing', { channelId: ch.id });
}

function onKeyDown(e) {
  if (ac && acItems.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      acIndex = (acIndex + (e.key === 'ArrowDown' ? 1 : -1) + acItems.length) % acItems.length;
      highlightAutocomplete();
      return;
    }
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
      e.preventDefault();
      chooseAutocomplete();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAutocomplete();
      return;
    }
  }
  if (e.key === 'Escape' && editState) {
    e.preventDefault();
    editState = null;
    render();
    return;
  }
  if (e.key === 'Escape' && state.ui.replyTo) {
    e.preventDefault();
    state.ui.replyTo = null;
    render();
    return;
  }
  if (e.key === 'Enter') {
    const wantsSend = state.settings.enterToSend ? !e.shiftKey : (e.ctrlKey || e.metaKey);
    if (wantsSend) {
      e.preventDefault();
      submit();
    }
  }
  if (e.key === 'ArrowUp' && !ta.value && !editState) {
    const msgs = state.messages[activeChannel()?.id] || [];
    const own = [...msgs].reverse().find((m) => m.userId === state.self?.id);
    if (own) {
      e.preventDefault();
      startEdit(own);
    }
  }
}

function onPaste(e) {
  const items = Array.from(e.clipboardData?.items || []);
  const img = items.find((i) => i.type.startsWith('image/') || i.type === 'image/gif');
  if (img) {
    e.preventDefault();
    const file = img.getAsFile();
    if (file) attachImage(file);
  }
}

function onDrop(e) {
  e.preventDefault();
  const composer = document.getElementById('composer');
  if (composer) composer.style.borderColor = '';
  const file = e.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) attachImage(file);
}

/* --------------------------------- submit -------------------------------- */

function submit() {
  if (!ta) return;
  const ch = activeChannel();
  if (!ch) return;
  const text = ta.value.trim();
  if (!text && !attachment) return;

  if (editState) {
    if (text) editMessage(editState.channelId, editState.id, text);
    editState = null;
    ta.value = '';
    if (state.ui.drafts) delete state.ui.drafts[ch.id];
    onInput();
    render();
    focusComposer();
    return;
  }

  const msg = sendMessage(ch.id, text || ' ', { replyTo: state.ui.replyTo || null });
  if (!msg) return;
  if (attachment) {
    msg.attachment = attachment;
    bus.emit('message:updated', { channelId: ch.id, message: msg });
    emitAttachment(msg);
    attachment = null;
  }
  state.ui.replyTo = null;
  ta.value = '';
  if (state.ui.drafts) delete state.ui.drafts[ch.id];
  autoResizeTextarea(ta);
  onInput();
  render();
  focusComposer();
  document.dispatchEvent(new CustomEvent('ta:composer-sent'));
  import('./messages.js').then((m) => m.scrollToBottom(true));
  bus.emit('composer:sent', { channelId: ch.id });
}

function emitAttachment(msg) {
  bus.emit('message:attachment', { channelId: msg.channelId, message: msg });
}

/* -------------------------------- images --------------------------------- */

function pickImage() {
  const input = el('input', { type: 'file', accept: 'image/*,image/gif', hidden: true });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) attachImage(file);
    input.remove();
  });
  document.body.append(input);
  input.click();
}

async function attachImage(file) {
  try {
    const plan = currentPlan();
    const cap = maxUploadBytes(plan.id);
    if (file.size > cap) {
      const bigger = planOf(plan.id === 'free' ? 'plus' : 'studio');
      toast(`${Math.round(file.size / (1024 * 1024))} MB is over the ${plan.limits.uploadMB} MB limit on ${plan.name}. ${bigger.name} allows ${bigger.limits.uploadMB} MB — Settings → Plans.`, 'warn', { duration: 6500 });
      return;
    }
    clearPreview();
    const composer = document.getElementById('composer');
    let preview = el('div', { class: 'composer-attachment', id: 'composerAttachment' },
      el('span', { class: 'ca-spinner' }, el('span', { class: 'spinner', style: { width: '13px', height: '13px', borderWidth: '2px' } }), 'Preparing…'));
    area.insertBefore(preview, area.querySelector('.composer'));
    composer?.classList.add('has-text');

    const prepared = await prepareAttachment(file);
    attachment = { ...prepared, ts: Date.now() };

    const isGif = prepared.kind === 'gif';
    const kb = Math.max(1, Math.round((prepared.bytes || prepared.src.length) / 1024));
    preview.replaceChildren(
      el('div', { class: 'ca-thumb' }, el('img', { src: prepared.src, alt: '' })),
      el('div', { class: 'ca-meta' },
        el('b', { text: isGif ? 'GIF ready' : 'Image ready' }),
        el('span', { text: `${prepared.name} · ${kb} KB${isGif ? ' · animated' : ''}` })),
      el('button', {
        class: 'icon-btn', type: 'button', 'aria-label': 'Remove attachment', title: 'Remove',
        onclick: () => {
          attachment = null;
          clearPreview();
          const c = document.getElementById('composer');
          if (c && !ta.value.trim()) c.classList.remove('has-text');
        },
      }, icon('close', 15)),
    );
    focusComposer();
  } catch (err) {
    clearPreview();
    attachment = null;
    toast(err.message || 'Could not attach that image', 'error');
  }
}

function clearPreview() {
  document.getElementById('composerAttachment')?.remove();
}

/* ------------------------------ autocomplete ----------------------------- */

function getToken(value, caret) {
  const before = value.slice(0, caret);
  const emoji = /(^|[\s(]):([a-z0-9_+-]{0,24})$/i.exec(before);
  if (emoji) return { kind: 'emoji', query: emoji[2], start: caret - emoji[2].length - 1, end: caret };
  const mention = /(^|[\s(])@([a-z0-9._-]{0,20})$/i.exec(before);
  if (mention) return { kind: 'mention', query: mention[2], start: caret - mention[2].length - 1, end: caret };
  const channel = /(^|[\s(])#([a-z0-9_-]{0,28})$/i.exec(before);
  if (channel) return { kind: 'channel', query: channel[2], start: caret - channel[2].length - 1, end: caret };
  return null;
}

function updateAutocomplete() {
  if (!ta) return;
  const token = getToken(ta.value, ta.selectionStart);
  if (!token) return closeAutocomplete();
  const q = token.query.toLowerCase();
  let items = [];

  if (token.kind === 'mention') {
    const seen = new Set();
    const candidates = [];
    const push = (u) => {
      if (!u?.handle || seen.has(u.id)) return;
      seen.add(u.id);
      candidates.push({ type: 'user', user: u, name: u.displayName, sub: `@${u.handle}` });
    };
    if (state.self) push(state.self);
    for (const peer of Object.values(state.peers)) push(peer.user);
    for (const u of Object.values(state.users)) push(u);
    items = candidates.filter((c) => c.user.displayName.toLowerCase().includes(q) || c.user.handle.includes(q)).slice(0, 8);
    if (!items.length && 'everyone'.startsWith(q)) items = [{ type: 'everyone', name: 'everyone', sub: 'Notify everyone in this channel' }];
  } else if (token.kind === 'channel') {
    const ch = activeChannel();
    const ids = ch?.serverId ? state.servers[ch.serverId]?.channelIds || [] : Object.keys(state.channels);
    items = ids.map((id) => state.channels[id]).filter(Boolean)
      .filter((c) => c.type !== 'dm' && c.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({ type: 'channel', channel: c, name: `#${c.name}`, sub: state.servers[c.serverId]?.name || '' }));
  } else if (token.kind === 'emoji') {
    if (!q) return closeAutocomplete();
    items = searchEmojis(q).slice(0, 8).map((e) => ({ type: 'emoji', emoji: e.char, name: `:${e.codes[0]}:`, sub: '' }));
  }

  if (!items.length) return closeAutocomplete();
  acContext = token;
  acItems = items;
  acIndex = 0;
  renderAutocomplete();
}

function renderAutocomplete() {
  if (!ac) {
    ac = el('div', { class: 'autocomplete', role: 'listbox' });
    document.body.append(ac);
  }
  ac.replaceChildren();
  ac.append(el('div', { class: 'ac-head', text: acContext.kind === 'emoji' ? 'Emoji' : acContext.kind === 'mention' ? 'Members' : 'Channels' }));
  acItems.forEach((item, i) => {
    const btn = el('button', {
      class: `ac-item${i === acIndex ? ' is-active' : ''}`,
      type: 'button',
      role: 'option',
      onmousedown: (e) => { e.preventDefault(); acIndex = i; chooseAutocomplete(); },
    });
    if (item.type === 'emoji') {
      btn.append(el('span', { class: 'ac-emoji', text: item.emoji }), el('span', { class: 'ac-name', text: item.name }));
    } else if (item.type === 'user') {
      btn.innerHTML = `<span class="avatar" style="width:22px;height:22px;font-size:9px;--a1:${item.user.accentColor || '#5865f2'};--a2:#8b6ff5"><span class="avatar-initials">${escapeHtml((item.name || '?').slice(0, 2).toUpperCase())}</span></span>`;
      btn.append(el('span', { class: 'ac-name', text: item.name }), el('span', { class: 'ac-sub', text: item.sub }));
    } else {
      btn.append(icon(item.type === 'channel' ? 'hash' : 'at', 15), el('span', { class: 'ac-name', text: item.name }), el('span', { class: 'ac-sub', text: item.sub || '' }));
    }
    ac.append(btn);
  });
  positionAutocomplete();
}

function positionAutocomplete() {
  if (!ac || !ta) return;
  const r = ta.getBoundingClientRect();
  const composer = document.getElementById('composer')?.getBoundingClientRect();
  const height = ac.offsetHeight;
  ac.style.left = `${Math.round(r.left)}px`;
  ac.style.top = `${Math.round(Math.min(r.top - height - 8, window.innerHeight - height - 12))}px`;
}

function highlightAutocomplete() {
  if (!ac) return;
  ac.querySelectorAll('.ac-item').forEach((n, i) => n.classList.toggle('is-active', i === acIndex));
  ac.querySelector('.ac-item.is-active')?.scrollIntoView({ block: 'nearest' });
}

function chooseAutocomplete() {
  const item = acItems[acIndex];
  if (!item || !acContext || !ta) return closeAutocomplete();
  const before = ta.value.slice(0, acContext.start);
  const after = ta.value.slice(acContext.end);
  let insert = '';
  if (item.type === 'emoji') insert = item.emoji + ' ';
  else if (item.type === 'everyone') insert = '@everyone ';
  else if (item.type === 'user') insert = `@${item.user.handle} `;
  else if (item.type === 'channel') insert = `#${item.channel.name} `;
  ta.value = before + insert + after;
  const caret = (before + insert).length;
  ta.setSelectionRange(caret, caret);
  closeAutocomplete();
  onInput();
  focusComposer();
}

function closeAutocomplete() {
  if (ac) { ac.remove(); ac = null; }
  acItems = [];
  acContext = null;
}

/* -------------------------------- helper UI ------------------------------ */

function updateTypingBar() {
  const bar = document.getElementById('typingBar');
  if (!bar) return;
  const ch = activeChannel();
  if (!ch) return;
  const names = Object.entries(state.typing[ch.id] || {})
    .filter(([uid, v]) => v.until > Date.now() && uid !== state.self?.id)
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
  bar.replaceChildren(el('span', { class: 'typing-dots' }, el('i'), el('i'), el('i')), el('span', { text: label }));
}

function showFormattingHelp() {
  import('../ui/modal.js').then(({ openModal }) => {
    const content = el('div', { class: 'modal-body pad' });
    content.innerHTML = `
      <div class="kbd-grid">
        <div class="kbd-row"><span>Bold</span><span class="keys"><kbd class="key">**text**</kbd></span></div>
        <div class="kbd-row"><span>Italic</span><span class="keys"><kbd class="key">*text*</kbd></span></div>
        <div class="kbd-row"><span>Underline</span><span class="keys"><kbd class="key">__text__</kbd></span></div>
        <div class="kbd-row"><span>Strikethrough</span><span class="keys"><kbd class="key">~~text~~</kbd></span></div>
        <div class="kbd-row"><span>Inline code</span><span class="keys"><kbd class="key">\`code\`</kbd></span></div>
        <div class="kbd-row"><span>Code block</span><span class="keys"><kbd class="key">\`\`\`js</kbd></span></div>
        <div class="kbd-row"><span>Spoiler</span><span class="keys"><kbd class="key">||hidden||</kbd></span></div>
        <div class="kbd-row"><span>Quote</span><span class="keys"><kbd class="key">&gt; text</kbd></span></div>
        <div class="kbd-row"><span>Emoji</span><span class="keys"><kbd class="key">:tada:</kbd></span></div>
        <div class="kbd-row"><span>Mention</span><span class="keys"><kbd class="key">@handle</kbd></span></div>
        <div class="kbd-row"><span>Channel</span><span class="keys"><kbd class="key">#channel</kbd></span></div>
      </div>`;
    openModal({ title: 'Text formatting', subtitle: 'A tiny bit of markdown goes a long way.', content, icon: 'sparkle' });
  });
}
