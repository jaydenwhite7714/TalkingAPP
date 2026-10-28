// End-to-end relay checks: retained history + server cards reach a brand-new
// device that has never been online before, with no peers around.
// Needs a relay running on :8081  →  PORT=8081 npm run relay

import wsPkg from 'ws';
const WsClient = wsPkg.WebSocket;
const WebSocket = WsClient;
import { reporter, sleep } from './harness.mjs';

const URL = 'ws://localhost:8081/ws';
const t = reporter();

const connect = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(URL);
  ws.on('open', () => resolve(ws));
  ws.on('error', reject);
});
const collect = (ws, ms) => new Promise((resolve) => {
  const got = [];
  const onMsg = (d) => got.push(d.toString());
  ws.on('message', onMsg);
  setTimeout(() => { ws.off('message', onMsg); resolve(got); }, ms);
});
const retain = (ws, topic, payload) => ws.send(JSON.stringify({ __ta_retain: true, topic, payload }));

await t.test('a channel digest survives for a device that arrives later', async () => {
  const a = await connect();
  const digest = JSON.stringify({
    v: 1, sid: 'log', id: 'dg1', ts: Date.now(), system: true,
    from: { id: 'log', displayName: 'History' },
    kind: 'log', key: 'astro-club', channel: 'general', removed: [],
    entries: [
      { id: 'h1', u: 'ada', n: 'Ada', h: 'ada', t: 'telescopes are set up', ts: Date.now() - 9000, a: 1 },
      { id: 'h2', u: 'sam', n: 'Sam', h: 'sam', t: 'on my way', ts: Date.now() - 8000, a: 1 },
    ],
  });
  retain(a, 'log/astro-club/general', digest);
  await sleep(200);

  const b = await connect();              // the brand-new Chromebook
  const got = await collect(b, 700);
  const frame = got.map((f) => { try { return JSON.parse(f); } catch { return null; } })
    .find((p) => p?.kind === 'log' && p.key === 'astro-club');
  if (!frame) throw new Error('no retained digest arrived');
  if (frame.entries.length !== 2) throw new Error(`expected 2 entries, got ${frame.entries.length}`);
  if (frame.entries[0].t !== 'telescopes are set up') throw new Error('digest content damaged');
  a.close(); b.close();
});

await t.test('server cards survive too, so invites land in a real server', async () => {
  const a = await connect();
  const card = JSON.stringify({
    v: 1, sid: 'log', id: 'card1', ts: Date.now(), system: true,
    from: { id: 'log', displayName: 'History' },
    kind: 'server-card',
    card: {
      key: 'astro-club', name: 'Astro Club', desc: 'telescopes', emoji: '🔭', color: '#5865f2',
      ownerId: 'ada', ownerName: 'Ada', savedAt: Date.now(),
      channels: [{ name: 'general', category: 'Start here', type: 'text' }],
      members: [{ id: 'ada', role: 'owner', name: 'Ada', handle: 'ada' }],
    },
  });
  retain(a, 'srv/astro-club', card);
  await sleep(200);
  const b = await connect();
  const got = await collect(b, 700);
  const frame = got.map((f) => { try { return JSON.parse(f); } catch { return null; } })
    .find((p) => p?.kind === 'server-card' && p.card?.key === 'astro-club');
  if (!frame) throw new Error('no server card arrived');
  if (frame.card.name !== 'Astro Club' || frame.card.emoji !== '🔭') throw new Error('card damaged in transit');
  a.close(); b.close();
});

await t.test('live chat still reaches a second client', async () => {
  const a = await connect();
  const b = await connect();
  const wait = collect(b, 700);
  a.send(JSON.stringify({ v: 1, sid: 'abc', id: 'live1', ts: Date.now(), from: { id: 'ada' }, kind: 'chat', text: 'ping live' }));
  const got = await wait;
  if (!got.some((f) => f.includes('ping live'))) throw new Error('live chat frame lost');
  a.close(); b.close();
});

await t.test('the vault copy still restores for a new device', async () => {
  const a = await connect();
  retain(a, 'vault/nova/0', JSON.stringify({ v: 1, sid: 'vault', id: 'v1', ts: Date.now(), system: true, from: { id: 'vault' }, kind: 'vault', handle: 'nova', part: 0, total: 1, data: '{"sealed":true}' }));
  await sleep(200);
  const b = await connect();
  const got = await collect(b, 600);
  const frame = got.map((f) => { try { return JSON.parse(f); } catch { return null; } }).find((p) => p?.kind === 'vault');
  if (frame?.handle !== 'nova') throw new Error('vault frame missing');
  a.close(); b.close();
});

const failed = t.finish('relay checks');
process.exit(failed ? 1 : 0);
