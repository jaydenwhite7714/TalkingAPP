#!/usr/bin/env node
// TalkingApp relay server
// -----------------------
// A tiny message relay with two endpoints so the web client can use whichever it likes:
//
//   /mqtt   MQTT 3.1.1 over WebSocket (via aedes)  — the default in production
//   /ws     plain WebSocket broadcast (every JSON frame is forwarded to every client)
//
// The public build talks to free public MQTT brokers, but pointing the app at this
// relay (`?relay=wss://your-host/ws`) gives you your own private, self-hosted room.
//
//   node tools/relay/server.mjs            # listens on 8080
//   PORT=9000 node tools/relay/server.mjs

import http from 'node:http';
import { WebSocketServer, createWebSocketStream } from 'ws';
import Aedes from 'aedes';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_FRAME = 512 * 1024;

const started = Date.now();
const stats = { wsClients: 0, mqttClients: 0, frames: 0 };

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, uptime: Math.round((Date.now() - started) / 1000), retained: retained.size, ...stats }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
  res.end('TalkingApp relay. Endpoints: /ws (broadcast) and /mqtt (MQTT over WebSocket).\n');
});

/* ---------------------------- raw ws broadcast --------------------------- */

// Retained frames (the encrypted vault) are kept in memory and replayed to
// every new client, so a fresh device can restore an account with no peers online.
const retained = new Map();          // topic -> { payload, savedAt }
const RETAIN_LIMIT = 260 * 1024 * 1024;

const rawWss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
rawWss.on('connection', (socket) => {
  stats.wsClients++;
  socket.isAlive = true;
  socket.on('pong', () => { socket.isAlive = true; });

  // hand over the retained state first, oldest topics first
  for (const [topic, entry] of retained) {
    if (socket.readyState !== 1) break;
    try { socket.send(entry.payload); } catch { break; }
  }

  socket.on('message', (data) => {
    const text = data.toString();
    if (text.length > MAX_FRAME) return;
    stats.frames++;

    if (text.startsWith('{"__ta_retain"')) {
      try {
        const frame = JSON.parse(text);
        if (frame?.__ta_retain && frame.topic) {
          let size = 0;
          for (const [, entry] of retained) size += entry.payload.length;
          if (size < RETAIN_LIMIT) {
            retained.set(String(frame.topic), { payload: String(frame.payload), savedAt: Date.now() });
            stats.retained = retained.size;
          }
        }
      } catch {}
    }

    for (const client of rawWss.clients) {
      if (client !== socket && client.readyState === 1) client.send(text);
    }
  });
  socket.on('close', () => { stats.wsClients--; });
  socket.on('error', () => {});
});

/* ------------------------------ mqtt broker ------------------------------ */

const aedes = new Aedes({ id: 'talkingapp-relay' });
const mqttWss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
mqttWss.on('connection', (socket) => {
  stats.mqttClients++;
  const duplex = createWebSocketStream(socket);
  aedes.handle(duplex);
  socket.on('close', () => { stats.mqttClients--; });
});

/* ------------------------------ http upgrade ----------------------------- */

httpServer.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/mqtt') {
    mqttWss.handleUpgrade(req, socket, head, (ws) => mqttWss.emit('connection', ws, req));
    return;
  }
  if (pathname === '/ws') {
    rawWss.handleUpgrade(req, socket, head, (ws) => rawWss.emit('connection', ws, req));
    return;
  }
  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
});

setInterval(() => {
  for (const client of rawWss.clients) {
    if (client.isAlive === false) { client.terminate(); continue; }
    client.isAlive = false;
    client.ping();
  }
}, 30000);

httpServer.listen(PORT, HOST, () => {
  console.log(`[relay] listening on ws://${HOST}:${PORT}/ws and ws://${HOST}:${PORT}/mqtt`);
  console.log(`[relay] health: http://localhost:${PORT}/health`);
});

function shutdown() {
  console.log('[relay] shutting down');
  for (const c of rawWss.clients) c.close();
  aedes.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
