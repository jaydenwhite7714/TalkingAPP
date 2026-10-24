// App shell: server rail, channel sidebar, chat header, member list
import { el, escapeHtml, plural, cssEsc, debounce } from '../util.js';
import { icon, iconHTML } from '../icons.js';
import { avatarHTML, serverIconHTML, defaultAvatar } from '../avatar.js';
import {
  state, selectServer, selectChannel, dmList, unreadCount, mentionCount, markRead,
  pinnedMessages, openDM, toast, setSetting, firstServerId,
} from '../store.js';
import { bus } from '../bus.js';
import { openMenu, closeMenu } from '../ui/menu.js';
import { openProfileCard } from '../ui/profileCard.js';
import { openEmojiPicker } from '../ui/emojiPicker.js';
import * as modals from './modals.js';

let railEl, sidebarEl, headerEl, membersEl, appEl, scrimEl;
let sidebarSearch = '';
let collapsedGroups = new Set();

export function initShell() {
  railEl = document.getElementById('rail');
  sidebarEl = document.getElementById('sidebar');
  headerEl = document.getElementById('chatHeader');
  membersEl = document.getElementById('membersPanel');
  appEl = document.getElementById('app');
  scrimEl = document.getElementById('drawerScrim');

  scrimEl.addEventListener('click', () => toggleDrawer(false));
  document.getElementById('messagesScroll')?.addEventListener('pointerdown', () => {
    if (appEl.classList.contains('drawer-open') && window.matchMedia('(max-width: 860px)').matches) toggleDrawer(false);
    if (state.ui.membersOpen && window.matchMedia('(max-width: 1060px)').matches) toggleMembers(false, { silent: true });
  });

  const rerenderAll = () => { renderRail(); renderSidebar(); renderHeader(); renderMembers(); };
  bus.on('active:changed', () => { renderRail(); renderSidebar(); renderHeader(); renderMembers(); });
  bus.on('servers:changed', () => { renderRail(); renderSidebar(); renderHeader(); });
  bus.on('server:updated', () => { renderRail(); renderSidebar(); renderHeader(); });
  bus.on('channels:changed', () => { renderSidebar(); renderHeader(); });
  bus.on('channel:updated', () => { renderSidebar(); renderHeader(); });
  bus.on('presence:changed', debounce(() => { renderMembers(); renderSidebar(); }, 80));
  bus.on('net:status', () => { renderSidebar(); renderMembers(); });
  bus.on('connection:changed', () => { renderConnectionBanner(); renderSidebar(); });
  bus.on('dms:changed', () => renderSidebar());
  bus.on('reads:changed', debounce(() => { renderSidebar(); renderRail(); }, 120));
  bus.on('message:new', debounce(() => { renderSidebar(); renderRail(); renderMembers(); }, 140));
  bus.on('self:changed', () => { renderRail(); renderSidebar(); renderMembers(); renderUserPanel(); });
  bus.on('settings:changed', ({ key }) => {
    if (key === 'showMembers') toggleMembers(state.settings.showMembers, { silent: true });
    renderMembers();
  });
  bus.on('pins:changed', () => renderHeader());
  bus.on('net:join', debounce(() => { renderMembers(); renderSidebar(); }, 120));
  bus.on('net:leave', debounce(() => { renderMembers(); renderSidebar(); }, 120));
  bus.on('net:presence', debounce(() => { renderMembers(); renderSidebar(); }, 120));
  bus.on('drawer:changed', () => appEl.classList.toggle('drawer-open', state.ui.sidebarOpen));

  window.addEventListener('resize', debounce(() => {
    renderMembers();
    if (!window.matchMedia('(max-width: 860px)').matches) toggleDrawer(false);
  }, 120));

  rerenderAll();
  renderConnectionBanner();
  renderUserPanel();
}

/* ---------------------------------- rail --------------------------------- */

function renderRail() {
  if (!railEl) return;
  railEl.replaceChildren();
  const scroll = el('div', { class: 'rail-scroll' });

  const dmUnread = dmList().reduce((n, c) => n + unreadCount(c.id), 0);
  const dmMentions = dmList().reduce((n, c) => n + mentionCount(c.id), 0);
  const home = el('button', {
    class: `rail-item rail-home-item${state.ui.activeServerId === '@me' ? ' is-active' : ''}`,
    type: 'button',
    'aria-label': 'Direct messages',
    onclick: () => goHome(),
  },
    el('span', { class: 'rail-home', html: `<img src="assets/img/favicon.svg" alt="" />` }),
    el('span', { class: 'rail-tip', text: 'Direct messages' }),
  );
  if (dmUnread) home.append(el('span', { class: `rail-badge${dmMentions ? '' : ' rail-badge-dot'}`, text: dmMentions ? String(dmMentions) : '' }));
  scroll.append(home);
  scroll.append(el('div', { class: 'rail-sep' }));

  const servers = Object.values(state.servers).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  for (const s of servers) {
    const unread = s.channelIds?.reduce((n, id) => n + unreadCount(id), 0) || 0;
    const mentions = s.channelIds?.reduce((n, id) => n + mentionCount(id), 0) || 0;
    const item = el('button', {
      class: `rail-item${state.ui.activeServerId === s.id ? ' is-active' : ''}${unread ? ' has-unread' : ''}`,
      type: 'button',
      'data-server': s.id,
      'aria-label': s.name,
      onclick: () => goToServer(s.id),
      oncontextmenu: (e) => { e.preventDefault(); serverMenu(s, e); },
    });
    const iconHTMLStr = serverIconHTML(s, { size: 48, active: state.ui.activeServerId === s.id });
    const holder = el('span', { html: iconHTMLStr });
    const serverIcon = holder.firstElementChild;
    if (s.isRemote) serverIcon?.classList.add('is-remote');
    item.append(serverIcon || holder);
    item.append(el('span', { class: 'rail-tip', text: s.name }));
    if (unread) item.append(el('span', { class: `rail-badge${mentions ? '' : ' rail-badge-dot'}`, text: mentions ? String(mentions) : '' }));
    scroll.append(item);
  }

  const add = el('button', { class: 'rail-item rail-add', type: 'button', 'aria-label': 'Add a server', onclick: () => modals.openCreateServer() },
    el('span', { class: 'rail-btn', html: iconHTML('plus', 22) }),
    el('span', { class: 'rail-tip', text: 'Add a server' }),
  );
  scroll.append(add);

  const explore = el('button', {
    class: 'rail-item rail-explore', type: 'button', 'aria-label': 'Explore communities',
    onclick: () => modals.openExplore(),
  },
    el('span', { class: 'rail-btn', html: iconHTML('compass', 22) }),
    el('span', { class: 'rail-tip', text: 'Explore communities' }),
  );
  const netCount = Object.values(state.network).filter((n) => !n.local && !isJoined(n.key)).length;
  if (netCount) explore.append(el('span', { class: 'rail-badge', text: String(netCount) }));
  scroll.append(explore);
  railEl.append(scroll);

  const bottom = el('div', { class: 'rail-bottom' });
  bottom.append(el('button', {
    class: 'rail-item rail-bottom-item', type: 'button', 'aria-label': 'Toggle theme',
    onclick: toggleTheme,
  }, el('span', { class: 'rail-btn', style: { background: 'transparent', color: 'var(--text-3)' }, html: iconHTML(state.settings.theme === 'dark' ? 'moon' : 'sun', 20) })));
  bottom.append(el('button', {
    class: 'rail-item rail-bottom-item', type: 'button', 'aria-label': 'User settings',
    onclick: () => modals.openSettings(),
  }, el('span', { class: 'rail-btn', style: { background: 'transparent', color: 'var(--text-3)' }, html: iconHTML('settings', 20) })));
  railEl.append(bottom);
}

function isJoined(networkKey) {
  return Object.values(state.servers).some((s) => s.networkKey === networkKey);
}

function toggleTheme() {
  const next = state.settings.theme === 'dark' ? 'light' : 'dark';
  import('../store.js').then((m) => m.setTheme(next));
  renderRail();
  toast(`${next === 'dark' ? 'Dark' : 'Light'} theme enabled`, 'ok', { duration: 1600 });
}

function serverMenu(s, e) {
  const items = [
    { label: 'Mark as read', icon: 'check', onClick: () => { s.channelIds.forEach(markRead); renderSidebar(); renderRail(); } },
    { label: 'Invite people', icon: 'userPlus', onClick: () => modals.openInvite(s) },
    { label: 'Create channel', icon: 'hash', onClick: () => modals.openCreateChannel(s) },
    { sep: true },
    { label: 'Server settings', icon: 'settings', onClick: () => modals.openServerSettings(s) },
    { sep: true },
  ];
  if (s.isStarter || s.isRemote) {
    items.push({ label: s.isRemote ? 'Leave community' : 'Hide from my list', icon: 'logout', danger: true, onClick: () => modals.hideServer(s) });
  } else {
    items.push({ label: 'Delete server', icon: 'trash', danger: true, onClick: () => modals.deleteServerFlow(s) });
  }
  openMenu({ items, at: e, align: 'start' });
}

/* --------------------------------- sidebar -------------------------------- */

function renderSidebar() {
  if (!sidebarEl) return;
  const top = document.getElementById('sidebarTop');
  const scroll = document.getElementById('sidebarScroll');
  top.replaceChildren();
  scroll.replaceChildren();

  const isHome = state.ui.activeServerId === '@me' || !state.ui.activeServerId;
  if (isHome) {
    top.append(el('div', { class: 'server-switcher', style: { cursor: 'default' } },
      icon('at', 19),
      el('b', { text: 'Direct messages' }),
    ));
    top.append(el('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'New direct message',
      title: 'New direct message',
      onclick: () => modals.openNewDM(),
    }, icon('addUser', 18)));
    scroll.append(renderDMSidebar());
  } else {
    const s = state.servers[state.ui.activeServerId];
    if (!s) return;
    const switcher = el('button', {
      class: 'server-switcher',
      type: 'button',
      onclick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openMenu({
          items: [
            { type: 'label', label: 'My servers' },
            ...Object.values(state.servers).map((srv) => ({
              label: srv.name,
              icon: srv.id === s.id ? 'check' : 'globe',
              onClick: () => goToServer(srv.id),
            })),
            { sep: true },
            { label: 'Explore communities', icon: 'compass', onClick: () => modals.openExplore() },
            { label: 'Create a server', icon: 'plus', onClick: () => modals.openCreateServer() },
          ],
          anchorRect: r,
        });
      },
    },
      el('span', { class: 'switcher-icon', html: s.emoji ? `<span style="font-size:14px">${escapeHtml(s.emoji)}</span>` : escapeHtml((s.name || '?').slice(0, 1).toUpperCase()), style: { '--a1': s.color || '#5865f2', '--a2': '#8b6ff5' } }),
      el('b', { text: s.name }),
      icon('chevronDown', 16),
    );
    top.append(switcher);
    top.append(el('button', {
      class: 'icon-btn', type: 'button', 'aria-label': 'Create channel', title: 'Create channel',
      onclick: () => modals.openCreateChannel(s),
    }, icon('plus', 18)));

    const group = el('div', { class: `channel-group${collapsedGroups.has('text_' + s.id) ? ' collapsed' : ''}` });
    const head = el('div', { class: 'channel-group-head' },
      el('button', {
        class: 'group-toggle', type: 'button',
        onclick: () => {
          const key = 'text_' + s.id;
          if (collapsedGroups.has(key)) collapsedGroups.delete(key); else collapsedGroups.add(key);
          renderSidebar();
        },
      }, icon('chevronDown', 12), el('span', { text: 'Text channels' })),
      el('button', {
        class: 'channel-group-add', type: 'button', 'aria-label': 'Create channel', title: 'Create channel',
        onclick: (e) => { e.stopPropagation(); modals.openCreateChannel(s); },
      }, icon('plus', 14)),
    );
    group.append(head);
    const list = el('div', { class: 'channel-list' });
    for (const cid of s.channelIds) {
      const ch = state.channels[cid];
      if (!ch) continue;
      const unread = unreadCount(cid);
      const mentions = mentionCount(cid);
      const active = state.ui.activeChannelId === cid;
      const item = el('a', {
        class: `channel-item${active ? ' is-active' : ''}${unread ? ' unread' : ''}`,
        'data-channel': cid,
        tabindex: '0',
        role: 'link',
        onclick: (e) => { e.preventDefault(); goToChannel(cid); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToChannel(cid); } },
      },
        icon('hash', 18),
        el('span', { class: 'ch-name', text: ch.name }),
      );
      if (unread) item.append(el('span', { class: 'badge', text: String(mentions || unread) }));
      const actions = el('span', { class: 'channel-actions' });
      const gear = el('button', {
        type: 'button', 'aria-label': 'Channel options', title: 'Edit channel',
        onclick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          openMenu({
            items: [
              { label: 'Edit channel', icon: 'edit', onClick: () => modals.openCreateChannel(s, ch) },
              { label: 'Copy channel name', icon: 'copy', onClick: async () => {
                const { copyToClipboard } = await import('../util.js');
                await copyToClipboard(`#${ch.name}`);
                toast('Copied', 'ok');
              } },
              { label: 'Mark as read', icon: 'check', onClick: () => { markRead(cid); renderSidebar(); } },
              { sep: true },
              { label: 'Delete channel', icon: 'trash', danger: true, onClick: () => modals.deleteChannelFlow(ch) },
            ],
            at: e,
            align: 'end',
          });
        },
      }, icon('settings', 14));
      actions.append(gear);
      item.append(actions);
      list.append(item);
    }
    group.append(list);
    scroll.append(group);
    scroll.append(networkCard(s));
  }
  renderUserPanel();
}

function renderDMSidebar() {
  const frag = document.createDocumentFragment();
  const searchWrap = el('div', { class: 'dm-search' });
  const input = el('input', {
    class: 'input input-search',
    placeholder: 'Find a conversation',
    value: sidebarSearch,
    'aria-label': 'Find a conversation',
    oninput: (e) => { sidebarSearch = e.target.value; renderSidebar(); setTimeout(() => {
      const n = sidebarEl.querySelector('.dm-search input');
      if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); }
    }, 0); },
  });
  searchWrap.append(el('div', { class: 'input-search-wrap' }, icon('search', 15), input));
  frag.append(searchWrap);

  const dms = dmList().filter((c) => {
    if (!sidebarSearch) return true;
    const name = state.users[c.dmUserId]?.displayName || c.name;
    return name.toLowerCase().includes(sidebarSearch.toLowerCase());
  });

  const online = peersForAll();

  if (!dms.length) {
    frag.append(el('div', { class: 'members-empty', html: sidebarSearch ? 'No conversations match that name.' : 'No conversations yet. Click <b>Explore</b> to find someone online, or open a profile and hit <b>Message</b>.' }));
  } else {
    frag.append(el('div', { class: 'dm-header' }, el('span', { class: 'grow', text: 'Direct messages' }), el('span', { class: 'pill', text: String(dms.length) })));
    for (const c of dms) {
      const user = state.users[c.dmUserId] || state.peers[c.dmUserId]?.user || { id: c.dmUserId, displayName: c.name, handle: c.handle };
      const last = state.messages[c.id]?.at(-1);
      const unread = unreadCount(c.id);
      const mentions = mentionCount(c.id);
      const active = state.ui.activeChannelId === c.id;
      const presence = state.presence[c.dmUserId] || (c.dmUserId === state.self?.id ? 'online' : 'offline');
      const item = el('div', {
        class: `dm-item${active ? ' is-active' : ''}${unread ? ' unread' : ''}`,
        role: 'link',
        tabindex: '0',
        onclick: () => goToChannel(c.id),
        onkeydown: (e) => { if (e.key === 'Enter') goToChannel(c.id); },
        oncontextmenu: (e) => {
          e.preventDefault();
          openMenu({
            items: [
              { label: 'Mark as read', icon: 'check', onClick: () => { markRead(c.id); renderSidebar(); } },
              { label: 'View profile', icon: 'user', onClick: () => {
                openProfileCard({ anchor: e.target, user, status: presence, onMessage: (u) => openDM(u.id, u) });
              } },
              { sep: true },
              { label: 'Close conversation', icon: 'close', danger: true, onClick: () => modals.closeDM(c) },
            ],
            at: e,
          });
        },
      });
      const holder = el('span', { html: avatarHTML(user, { size: 32, status: presence, showStatus: true }) });
      item.append(holder.firstElementChild || holder);
      item.append(el('div', { class: 'dm-meta' },
        el('div', { class: 'dm-name' }, el('span', { class: 'truncate', text: user.displayName || c.name })),
        el('div', { class: 'dm-preview', text: last ? `${last.isSelf ? 'You: ' : ''}${previewText(last)}` : 'No messages yet' }),
      ));
      if (unread) item.append(el('span', { class: 'badge', text: String(mentions || unread) }));
      frag.append(item);
    }
  }

  if (online.length) {
    frag.append(el('div', { class: 'dm-header', style: { marginTop: '12px' } },
      el('span', { class: 'grow', text: `Online now — ${online.length}` }),
    ));
    for (const peer of online.slice(0, 12)) {
      const u = peer.user;
      if (!u || u.id === state.self?.id) continue;
      const row = el('div', { class: 'dm-item', role: 'button', tabindex: '0', onclick: () => goToChannel(openDM(u.id, u)?.id) },
        el('span', { html: avatarHTML(u, { size: 28, status: 'online', showStatus: true }) }),
        el('div', { class: 'dm-meta' }, el('div', { class: 'dm-name', text: u.displayName }), el('div', { class: 'dm-preview', text: `@${u.handle}` })),
      );
      frag.append(row);
    }
  }

  frag.append(el('div', { style: { padding: '10px 4px 0' } },
    el('button', { class: 'btn btn-secondary btn-block btn-sm', type: 'button', onclick: () => modals.openExplore() },
      icon('compass', 15), 'Explore the network'),
  ));
  return frag;
}

function previewText(m) {
  const t = (m.text || '').replace(/\s+/g, ' ').trim();
  if (m.attachment) return '📷 Image';
  return t.length > 42 ? t.slice(0, 41) + '…' : t;
}

function networkCard(s) {
  const net = state.network[s.networkKey] || { peers: new Set() };
  const peers = peerListForCommunity(s.networkKey).filter((p) => p.user.id !== state.self?.id);
  const online = peers.filter((p) => p.status === 'online');
  const status = state.ui.connection;
  const card = el('div', { class: 'net-card' });
  card.append(el('div', { class: 'net-card-top' },
    el('i', { class: online.length ? '' : 'off' }),
    el('span', { text: online.length ? `${plural(online.length, 'person')} online` : 'Nobody else here yet' }),
  ));
  card.append(el('p', { text: online.length
    ? `Talking in ${s.name}. Messages relay in real time.`
    : 'Share this page with a friend — you will see each other here instantly.' }));
  const actions = el('div', { class: 'net-card-actions' },
    el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => modals.openInvite(s) }, icon('userPlus', 14), 'Invite'),
    el('button', { class: 'btn btn-secondary btn-sm', type: 'button', onclick: () => modals.openExplore() }, icon('compass', 14), 'Explore'),
  );
  card.append(actions);
  return card;
}

function peersForAll() {
  return Object.values(state.peers)
    .filter((p) => p.user?.id !== state.self?.id)
    .sort((a, b) => (a.user.displayName || '').localeCompare(b.user.displayName || ''));
}

export function peerListForCommunity(key) {
  const out = [];
  for (const p of Object.values(state.peers)) {
    if (p.communities?.includes(key)) out.push(p);
  }
  return out;
}

/* --------------------------------- header -------------------------------- */

function renderHeader() {
  if (!headerEl) return;
  const ch = state.channels[state.ui.activeChannelId];
  headerEl.replaceChildren();

  const menuBtn = el('button', {
    class: 'icon-btn mobile-menu-btn', type: 'button', 'aria-label': 'Open navigation',
    onclick: (e) => { e.stopPropagation(); toggleDrawer(true); },
  }, icon('more', 22));
  headerEl.append(menuBtn);

  if (!ch) {
    headerEl.append(el('h2', { text: 'Welcome' }));
    return;
  }

  if (ch.type === 'dm') {
    const user = state.users[ch.dmUserId] || state.peers[ch.dmUserId]?.user || { id: ch.dmUserId, displayName: ch.name, handle: ch.handle };
    const presence = state.presence[ch.dmUserId] || 'offline';
    const obj = el('div', { class: 'row', style: { gap: '9px', cursor: 'pointer', minWidth: '0' },
      onclick: (e) => openProfileCard({ anchor: e.currentTarget, user, status: presence, onMessage: (u) => openDM(u.id, u) }),
    });
    obj.innerHTML = `${avatarHTML(user, { size: 26 })}<h2 style="max-width:220px">${escapeHtml(user.displayName)}</h2>`;
    headerEl.append(obj);
    headerEl.append(el('span', { class: 'ch-topic', html: `<span style="color:var(--${presence === 'online' ? 'green' : 'text-3'})">${presence === 'online' ? 'Online' : 'Offline'}</span> · @${escapeHtml(ch.handle)}` }));
  } else {
    headerEl.append(el('span', { class: 'ch-glyph' }, icon('hash', 22)));
    headerEl.append(el('h2', { text: ch.name }));
    if (ch.topic) headerEl.append(el('span', { class: 'ch-topic', text: ch.topic, title: ch.topic }));
  }

  const actions = el('div', { class: 'chat-actions' });
  const pins = state.messages[ch.id]?.filter((m) => m.pinned) || [];
  if (pins.length) {
    actions.append(el('button', {
      class: 'icon-btn', type: 'button', title: `${pins.length} pinned`, 'aria-label': 'Pinned messages',
      onclick: () => modals.openPins(ch),
    }, icon('pin', 18)));
  }
  if (ch.type !== 'dm') {
    actions.append(el('button', {
      class: `icon-btn${state.ui.membersOpen ? ' is-on' : ''}`, type: 'button', title: 'Members', 'aria-label': 'Toggle member list',
      onclick: () => toggleMembers(!state.ui.membersOpen),
    }, icon('users', 19)));
  }
  actions.append(el('button', {
    class: 'icon-btn', type: 'button', title: 'Search', 'aria-label': 'Search',
    onclick: () => modals.openSearch(),
  }, icon('search', 19)));
  actions.append(el('button', {
    class: 'icon-btn', type: 'button', title: 'More', 'aria-label': 'Channel options',
    onclick: (e) => channelMenu(e.currentTarget, ch),
  }, icon('moreVertical', 19)));
  headerEl.append(actions);
}

function channelMenu(anchor, ch) {
  const items = [];
  if (ch.type === 'dm') {
    const user = state.users[ch.dmUserId] || { id: ch.dmUserId, displayName: ch.name, handle: ch.handle };
    items.push({ label: 'View profile', icon: 'user', onClick: () => openProfileCard({ anchor, user, status: state.presence[ch.dmUserId], onMessage: (u) => openDM(u.id, u) }) });
    items.push({ label: 'Close conversation', icon: 'close', danger: true, onClick: () => modals.closeDM(ch) });
  } else {
    const s = state.servers[ch.serverId];
    items.push({ label: 'Copy channel name', icon: 'copy', onClick: async () => {
      const { copyToClipboard } = await import('../util.js');
      await copyToClipboard(`#${ch.name}`);
      toast('Channel name copied', 'ok');
    } });
    items.push({ label: 'Edit channel', icon: 'edit', onClick: () => modals.openCreateChannel(s, ch) });
    items.push({ label: 'Create channel', icon: 'plus', onClick: () => modals.openCreateChannel(s) });
    items.push({ label: 'Mark as read', icon: 'check', onClick: () => { markRead(ch.id); renderSidebar(); } });
    items.push({ sep: true });
    items.push({ label: 'Invite people', icon: 'userPlus', onClick: () => modals.openInvite(s) });
    items.push({ label: 'Server settings', icon: 'settings', onClick: () => modals.openServerSettings(s) });
    items.push({ sep: true });
    items.push({ label: 'Notification settings', icon: 'bell', onClick: () => modals.openSettings('notifications') });
  }
  openMenu({ items, at: anchor, align: 'end' });
}

/* --------------------------------- members -------------------------------- */

function renderMembers() {
  if (!membersEl) return;
  membersEl.replaceChildren();
  const ch = state.channels[state.ui.activeChannelId];
  const narrow = window.matchMedia('(max-width: 1060px)').matches;
  const visible = ch && ch.type !== 'dm' && state.ui.membersOpen;
  membersEl.classList.toggle('hidden', !visible);
  if (!visible) return;

  const s = state.servers[ch.serverId];
  if (!s) return;
  const peers = peerListForCommunity(s.networkKey);
  const simulated = simulatedMembers(s.networkKey);
  const self = state.self;

  const online = [];
  const offline = [];
  if (self) {
    if (self.status === 'offline') offline.push({ user: self, status: 'offline', self: true });
    else online.push({ user: self, status: self.status, self: true });
  }
  const seen = new Set([self?.id]);
  for (const p of peers) {
    if (!p.user || seen.has(p.user.id)) continue;
    seen.add(p.user.id);
    (p.status === 'offline' ? offline : online).push({ user: p.user, status: p.status });
  }
  for (const u of simulated) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    (u.status === 'offline' ? offline : online).push({ user: u, status: u.status || 'online', simulated: true });
  }

  membersEl.append(el('div', { class: 'members-group-head' },
    el('span', { text: `Online — ${online.length}` }),
  ));
  for (const m of online) membersEl.append(memberRow(m, s));
  if (!peers.length && !simulated.length) {
    membersEl.append(el('div', { class: 'members-empty', html: 'It&rsquo;s just you here so far. Share the page — everyone who opens it shows up in this list.' }));
  }
  if (offline.length) {
    membersEl.append(el('div', { class: 'members-group-head', style: { marginTop: '10px' }, text: `Offline — ${offline.length}` }));
    for (const m of offline) membersEl.append(memberRow(m, s));
  }
}

function simulatedMembers(key) {
  return Object.values(state.users).filter((u) => u.simulated && (u.communities || []).includes(key));
}

function memberRow({ user, status, self, simulated }, server) {
  const row = el('div', { class: `member${status === 'offline' ? ' offline' : ''}`, role: 'button', tabindex: '0' });
  row.innerHTML = `${avatarHTML(user, { size: 30, status, showStatus: true })}
    <div class="m-meta">
      <div class="m-name">${escapeHtml(user.displayName)}${self && server.ownerId === user.id ? '<span class="m-crown">' + iconHTML('crown', 13) + '</span>' : ''}</div>
      <div class="m-sub">${simulated ? 'demo member' : '@' + escapeHtml(user.handle)}</div>
    </div>`;
  row.addEventListener('click', (e) => {
    openProfileCard({ anchor: row, user, status, simulated, placement: 'left', onMessage: (u) => openDM(u.id, u) });
  });
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter') row.click(); });
  return row;
}

/* -------------------------------- user panel ------------------------------ */

function renderUserPanel() {
  const panel = document.getElementById('userPanel');
  if (!panel) return;
  panel.replaceChildren();
  const self = state.self;
  if (!self) return;
  const main = el('button', {
    class: 'up-main', type: 'button', 'aria-label': 'Your profile',
    onclick: (e) => {
      openProfileCard({ anchor: e.currentTarget, user: self, status: self.status, placement: 'right' });
    },
  });
  main.innerHTML = `${avatarHTML(self, { size: 32, status: self.status, showStatus: true })}
    <div class="up-meta">
      <div class="up-name">${escapeHtml(self.displayName)}</div>
      <div class="up-sub">@${escapeHtml(self.handle)}</div>
    </div>`;
  panel.append(main);

  const mic = el('button', {
    class: 'icon-btn', type: 'button', title: state.self.muted ? 'Unmute' : 'Mute microphone', 'aria-label': 'Toggle microphone',
    onclick: () => { state.self.muted = !state.self.muted; toast(state.self.muted ? 'Microphone muted (visual only)' : 'Microphone unmuted', 'info', { duration: 1800 }); renderUserPanel(); },
  }, icon(state.self.muted ? 'micOff' : 'mic', 18));

  const deaf = el('button', {
    class: 'icon-btn', type: 'button', title: state.self.deafened ? 'Undeafen' : 'Deafen', 'aria-label': 'Toggle deafen',
    onclick: () => { state.self.deafened = !state.self.deafened; renderUserPanel(); },
  }, icon(state.self.deafened ? 'headphonesOff' : 'headphones', 18));

  const cog = el('button', {
    class: 'icon-btn', type: 'button', title: 'User settings', 'aria-label': 'User settings',
    onclick: () => modals.openSettings(),
  }, icon('settings', 18));

  panel.append(el('div', { class: 'up-actions' }, mic, deaf, cog));
}

/* --------------------------------- helpers -------------------------------- */

export function toggleMembers(open, { silent = false } = {}) {
  state.ui.membersOpen = open;
  if (!silent) setSetting('showMembers', open);
  renderMembers();
  renderHeader();
}

export function toggleDrawer(open) {
  state.ui.sidebarOpen = open;
  appEl.classList.toggle('drawer-open', open);
  scrimEl.hidden = !open;
}

function renderConnectionBanner() {
  const existing = document.getElementById('connBanner');
  const status = state.ui.connection;
  if (status === 'online') { existing?.remove(); return; }
  if (existing) existing.remove();
  const ch = state.channels[state.ui.activeChannelId];
  const banner = el('div', { class: `conn-banner${status === 'offline' ? ' offline' : ''}`, id: 'connBanner' },
    icon(status === 'connecting' ? 'wifi' : 'wifiOff', 15),
    el('span', { class: 'grow', text: status === 'connecting'
      ? 'Connecting to the TalkingApp network… messages will send once connected.'
      : 'You are offline — messages will stay on this device until the network reconnects.' }),
    el('button', { type: 'button', text: 'Retry', onclick: () => document.dispatchEvent(new CustomEvent('ta:reconnect')) }),
  );
  document.querySelector('.chat')?.insertBefore(banner, document.getElementById('chatBody'));
}

/* --------------------------------- routing -------------------------------- */

export function goToServer(id) {
  selectServer(id);
  if (window.matchMedia('(max-width: 860px)').matches) toggleDrawer(false);
}

export function goHome() {
  const dms = dmList();
  selectServer('@me', { channelId: dms[0]?.id });
  if (window.matchMedia('(max-width: 860px)').matches) toggleDrawer(false);
}

export function goToChannel(channelId) {
  if (!state.channels[channelId]) return;
  selectChannel(channelId);
  if (window.matchMedia('(max-width: 860px)').matches) toggleDrawer(false);
}
