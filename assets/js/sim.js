// Clearly-labelled demo members (opt-in preview, never presented as real people)
import { bus } from './bus.js';
import { state, makeMessage, addMessage, persistNow, markRead } from './store.js';
import { randId } from './util.js';

const DEMO = [
  {
    displayName: 'Ava',
    handle: 'ava',
    color: '#ec4899',
    accent: '#ec4899',
    bio: 'Demo member — here so you can see how TalkingApp feels with people in it.',
    lines: [
      'hey! this is a demo message 👋',
      'turn me off any time in **Settings → Network**',
      'try replying to a message, adding a reaction, or pasting an image',
      'the real magic is opening the link on a second device 🚀',
    ],
  },
  {
    displayName: 'Kenji',
    handle: 'kenji',
    color: '#06b6d4',
    accent: '#06b6d4',
    bio: 'Demo member — simulated on this device, not a real person.',
    lines: [
      'markdown works: **bold**, *italic*, `code`, ||spoilers||',
      'try :tada: shortcodes too',
      '`/` commands are not a thing yet — but channels are',
      'you can pin messages from the right-click menu 📌',
    ],
  },
  {
    displayName: 'Rosa',
    handle: 'rosa',
    color: '#f59e0b',
    accent: '#f59e0b',
    bio: 'Demo member — a friendly face while the room is empty.',
    lines: [
      'a server for every friend group, and channels for every topic',
      'right-click a message to edit, pin, or delete it',
      'light theme is in Settings → Appearance 🌙',
      'see you on the network ✨',
    ],
  },
];

let timers = [];
let active = false;
let replyIndex = 0;

export function isSimActive() {
  return active;
}

export function startSim() {
  if (active) return;
  active = true;
  const keys = Object.values(state.servers).filter((s) => s.isPublic).map((s) => s.networkKey);
  const created = [];
  for (const d of DEMO) {
    const user = {
      id: `sim_${d.handle}`,
      displayName: d.displayName,
      handle: d.handle,
      avatar: { kind: 'color', color: d.color },
      accentColor: d.accent,
      bio: d.bio,
      status: 'online',
      createdAt: Date.now() - 1000 * 60 * 60 * 24 * 30,
      simulated: true,
      communities: keys,
    };
    state.users[user.id] = user;
    state.presence[user.id] = 'online';
    created.push(user);
  }
  bus.emit('presence:changed');
  bus.emit('servers:changed');

  const server = Object.values(state.servers).find((s) => s.isPublic);
  const channel = server ? state.channels[server.channelIds[1] || server.defaultChannelId] : null;
  if (channel) {
    created.forEach((user, i) => {
      const timer = setTimeout(() => {
        if (!active) return;
        const text = user.handle === 'ava'
          ? 'welcome in 👋 this room is new, so take a look around'
          : DEMO[i].lines[0];
        addMessage(channel.id, makeMessage({
          channelId: channel.id,
          userId: user.id,
          displayName: user.displayName,
          handle: user.handle,
          avatar: user.avatar,
          accentColor: user.accentColor,
          text,
          isSelf: false,
        }));
      }, 1200 + i * 2600);
      timers.push(timer);
    });
  }
  persistNow();
}

export function stopSim() {
  active = false;
  timers.forEach(clearTimeout);
  timers = [];
  for (const d of DEMO) {
    const id = `sim_${d.handle}`;
    delete state.users[id];
    delete state.presence[id];
    for (const [cid, list] of Object.entries(state.messages)) {
      state.messages[cid] = list.filter((m) => m.userId !== id);
    }
  }
  bus.emit('presence:changed');
  bus.emit('servers:changed');
  bus.emit('active:changed');
  persistNow();
}

/** Sometimes reply when the user is talking in a channel the demo members are in. */
export function simulateReply(channelId, userText) {
  if (!active) return;
  const ch = state.channels[channelId];
  if (!ch || ch.type === 'dm') return;
  const server = state.servers[ch.serverId];
  if (!server?.isPublic) return;
  const member = DEMO[replyIndex % DEMO.length];
  const user = state.users[`sim_${member.handle}`];
  if (!user) return;
  const mention = new RegExp(`@${member.handle}`, 'i').test(userText);
  if (!mention && Math.random() > 0.34) return;
  replyIndex++;
  const delay = 1400 + Math.random() * 2200;
  const timer = setTimeout(() => {
    if (!active) return;
    const options = mention
      ? ['good question — this is a demo reply, but real people reply instantly too', 'yes! 👋 (demo message)']
      : ['💬', 'nice one', 'agreed', 'that is a good point', '🔥', 'demo mode is doing its thing — turn it off in Settings → Network'];
    const text = options[Math.floor(Math.random() * options.length)];
    addMessage(channelId, makeMessage({
      channelId,
      userId: user.id,
      displayName: user.displayName,
      handle: user.handle,
      avatar: user.avatar,
      accentColor: user.accentColor,
      text,
      isSelf: false,
    }));
    if (ch.id === state.ui.activeChannelId) markRead(channelId);
  }, delay);
  timers.push(timer);
}
