#!/usr/bin/env node
// Minimal static file server with no dependencies. `npm run dev`
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
// the realtime relay (npm run relay) — proxied so the browser only talks to one origin
const RELAY_PORT = Number(process.env.RELAY_PORT || 8080);
const RELAY_HOST = process.env.RELAY_HOST || '127.0.0.1';
const RELAY_PATHS = ['/ws', '/mqtt', '/health'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (RELAY_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
    const upstream = http.request({
      host: RELAY_HOST, port: RELAY_PORT, path: req.url, method: req.method, headers: req.headers,
    }, (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => res.writeHead(502, { 'content-type': 'text/plain' }).end('relay offline'));
    req.pipe(upstream);
    return;
  }
  let filePath = path.join(root, decodeURIComponent(url.pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });
    res.end(data);
  });
});

// WebSocket upgrade passthrough so the relay reaches the browser on the same origin
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!RELAY_PATHS.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(RELAY_PORT, RELAY_HOST, () => {
    const headers = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      headers.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
    }
    upstream.write(`${headers.join('\r\n')}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PORT, HOST, () => {
  console.log(`[dev] http://localhost:${PORT}`);
  console.log(`[dev] relay proxied from :${RELAY_PORT} at /ws, /mqtt, /health`);
});
