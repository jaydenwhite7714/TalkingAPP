// "Two Chromebooks" check: the real app, over a real WebSocket relay.
//
//   • the app connects to tools/relay/server.mjs like a browser would
//   • a second player (a plain ws client) talks to it and hears it back
//   • a third player connects afterwards and receives retained history
// Needs a relay running on :8081  →  PORT=8081 npm run relay

import { boot, reporter, sleep, ROOT } from './harness.mjs';
import wsPkg from 'ws';
const WsClient = wsPkg.WebSocket;

const RELAY = 'ws://localhost:8081/ws';
const t = reporter();
const errors = [];

// --- a WebSocket that behaves like the browser one but really connects ------
class BrowserLikeSocket {
  static instances = [];
  constructor(url) {
    this.url = String(url);
    this.readyState = 0;
    this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
    this._listeners = new Map();
    BrowserLikeSocket.instances.push(this);
    if (this.url !== RELAY) { this.readyState = 3; return; }   // ignore the other candidates
    this._ws = new WsClient(this.url);
    this._ws.on('open', () => { this.readyState = 1; this.onopen?.({}); });
    this._ws.on('message', (d) => {
      const ev = { data: d.toString() };
      this.onmessage?.(ev);
      for (const fn of this._listeners.get('message') || []) fn(ev);
    });
    this._ws.on('close', () => { this.readyState = 3; this.onclose?.({}); });
    this._ws.on('error', () => { this.onerror?.({}); });
  }
  send(data) { try { this._ws?.send(data); } catch {} }
  close() { try { this._ws?.close(); } catch {} this.readyState = 3; }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener() {}
}

const { window } = await boot({ localStorageSeed: { 'ta.relay.override': RELAY } });
window.WebSocket = BrowserLikeSocket;
Object.defineProperty(globalThis, 'WebSocket', { value: BrowserLikeSocket, configurable: true, writable: true });

const account = await import(`${ROOT}/assets/js/account.js`);
const store = await import(`${ROOT}/assets/js/store.js`);
const { net } = await import(`${ROOT}/assets/js/net.js`);

const HANDLE = 'relaykid';
const PW = 'relay password 42';
store.useAccountNamespace(HANDLE);
const reg = await account.registerAccount({ handle: HANDLE, displayName: 'Relay Kid', password: PW });
if (!reg.ok) throw new Error(reg.error);
store.createProfile({ displayName: 'Relay Kid', handle: HANDLE });
store.createServer({ name: 'Relay Room', channels: ['general'] });
const srv = Object.values(store.state.servers).find((s) => s.name === 'Relay Room');
const general = srv.channelIds.map((id) => store.state.channels[id]).find((c) => c.name === 'general');
store.persistNow();

await import(`${ROOT}/assets/js/main.js`);
await sleep(400);

// unlock
const form = window.document.getElementById('lockForm');
window.document.getElementById('lockPassword').value = PW;
form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
for (let i = 0; i < 80 && net.status() !== 'online'; i++) await sleep(100);
if (net.status() !== 'online') throw new Error(`app never connected (status ${net.status()})`);

// --- the other person -------------------------------------------------------
const other = new WsClient(RELAY);
await new Promise((res, rej) => { other.on('open', res); other.on('error', rej); });
const inbox = [];
other.on('message', (d) => inbox.push(d.toString()));
const drain = (ms) => sleep(ms).then(() => inbox.splice(0));
const waitFor = async (pred, ms = 2500) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const hit = inbox.find(pred);
    if (hit) return hit;
    await sleep(80);
  }
  return null;
};

await t.test('a stranger shows up in the member list', async () => {
  other.send(JSON.stringify({
    v: 1, sid: 'other-sid', id: 'p1', ts: Date.now(), kind: 'presence', status: 'online',
    from: { id: 'u_other', displayName: 'Maya', handle: 'maya', accentColor: '#eb459e', plan: 'plus', avatar: { kind: 'color', color: '#eb459e' } },
    communities: [{ key: srv.networkKey, name: 'Relay Room', channels: ['general'] }],
  }));
  await sleep(600);
  const members = store.memberList(store.state.servers[srv.id]);
  if (!members.some((m) => m.id === 'u_other')) throw new Error('presence did not register a member');
});

await t.test('their message appears in the app', async () => {
  other.send(JSON.stringify({
    v: 1, sid: 'other-sid', id: 'chat1', ts: Date.now(), kind: 'chat',
    key: srv.networkKey, channel: 'general', msgId: 'remote_msg_1', text: 'hi from the other laptop', msgTs: Date.now(),
    from: { id: 'u_other', displayName: 'Maya', handle: 'maya', avatar: { kind: 'color', color: '#eb459e' } },
  }));
  for (let i = 0; i < 30; i++) {
    if ((store.state.messages[general.id] || []).some((m) => m.id === 'remote_msg_1')) break;
    await sleep(100);
  }
  if (!(store.state.messages[general.id] || []).some((m) => m.id === 'remote_msg_1')) throw new Error('message never arrived');
  const shown = window.document.getElementById('messagesScroll')?.textContent || '';
  if (!shown.includes('hi from the other laptop')) throw new Error('message did not render');
});

await t.test('what I type reaches them over the relay', async () => {
  await drain(100);
  store.sendMessage(general.id, 'and hello back from this one');
  const got = await waitFor((f) => f.includes('and hello back from this one'));
  if (!got) throw new Error('the other side never received my message');
});

await t.test('the channel digest is retained for a device that arrives later', async () => {
  // force a digest publish (the app debounces these)
  const { publishAllNow } = await import(`${ROOT}/assets/js/shared.js`);
  publishAllNow();
  await sleep(900);

  const late = new WsClient(RELAY);
  await new Promise((res, rej) => { late.on('open', res); late.on('error', rej); });
  const lateInbox = [];
  late.on('message', (d) => lateInbox.push(d.toString()));
  await sleep(900);
  const digest = lateInbox
    .map((f) => { try { return JSON.parse(f); } catch { return null; } })
    .find((p) => p?.kind === 'log' && p.key === srv.networkKey && p.channel === 'general');
  late.close();
  if (!digest) throw new Error('no retained digest was stored by the relay');
  const texts = (digest.entries || []).map((e) => e.t);
  if (!texts.some((x) => x.includes('and hello back from this one'))) throw new Error(`digest is missing my message: ${texts.join(' | ')}`);
  if (!texts.some((x) => x.includes('hi from the other laptop'))) throw new Error('digest is missing their message');
  if (JSON.stringify(digest).length > 96000) throw new Error('digest exceeds the frame budget');
});

await t.test('the server card was published with its real name and owner', async () => {
  const late = new WsClient(RELAY);
  await new Promise((res, rej) => { late.on('open', res); late.on('error', rej); });
  const got = [];
  late.on('message', (d) => got.push(d.toString()));
  await sleep(900);
  late.close();
  const card = got.map((f) => { try { return JSON.parse(f); } catch { return null; } })
    .find((p) => p?.kind === 'server-card' && p.card?.key === srv.networkKey);
  if (!card) throw new Error('no server card retained');
  if (card.card.name !== 'Relay Room') throw new Error(`wrong name: ${card.card.name}`);
  if (!card.card.ownerId) throw new Error('card has no owner');
  if (!card.card.channels.some((c) => c.name === 'general')) throw new Error('card has no channels');
});

await t.test('the app never logged a console error while doing all that', () => {
  const real = errors.filter((e) => !/Not implemented|Could not parse CSS|jsdom/i.test(e));
  if (real.length) throw new Error(real.slice(0, 3).join(' | '));
});

other.close();
const failed = t.finish('real-time checks');
window.close();
process.exit(failed ? 1 : 0);
