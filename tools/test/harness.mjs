// jsdom harness shared by the TalkingApp test suites.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

// repo root is two levels up from tools/test
export const ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

export async function boot({ localStorageSeed = {} } = {}) {
  const html = await readFile(`${ROOT}/index.html`, 'utf8');
  const dom = new JSDOM(html, {
    url: 'http://localhost:8080/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // jsdom lacks a pile of browser APIs the app touches; stub the harmless ones
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
  class FakeObserver { observe() {} unobserve() {} disconnect() {} }
  window.ResizeObserver = window.ResizeObserver || FakeObserver;
  window.IntersectionObserver = window.IntersectionObserver || FakeObserver;
  window.AudioContext = window.AudioContext || class { resume() {} createOscillator() { return { connect() {}, start() {}, stop() {}, frequency: { setValueAtTime() {} }, type: '' }; } createGain() { return { connect() {}, gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} } }; } get destination() { return {}; } get currentTime() { return 0; } };
  window.HTMLElement.prototype.scrollTo = window.HTMLElement.prototype.scrollTo || function () {};
  window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || function () {};
  window.HTMLElement.prototype.setPointerCapture = window.HTMLElement.prototype.setPointerCapture || function () {};
  window.Notification = window.Notification || class { static permission = 'denied'; static requestPermission() { return Promise.resolve('denied'); } };
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async () => {} }, configurable: true });
  window.URL.createObjectURL = window.URL.createObjectURL || (() => 'blob:fake');
  window.URL.revokeObjectURL = window.URL.revokeObjectURL || (() => {});

  for (const [k, v] of Object.entries(localStorageSeed)) window.localStorage.setItem(k, v);

  // make the window double as the module global
  const g = globalThis;
  const define = (key, value) => Object.defineProperty(g, key, { value, configurable: true, writable: true });
  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('location', window.location);
  define('localStorage', window.localStorage);
  define('sessionStorage', window.sessionStorage);
  define('HTMLElement', window.HTMLElement);
  define('Element', window.Element);
  define('Node', window.Node);
  define('CustomEvent', window.CustomEvent);
  define('Event', window.Event);
  define('KeyboardEvent', window.KeyboardEvent);
  define('MouseEvent', window.MouseEvent);
  define('getComputedStyle', window.getComputedStyle.bind(window));
  define('matchMedia', window.matchMedia);
  define('ResizeObserver', window.ResizeObserver);
  define('IntersectionObserver', window.IntersectionObserver);
  define('requestAnimationFrame', (fn) => setTimeout(() => fn(Date.now()), 0));
  define('cancelAnimationFrame', (id) => clearTimeout(id));
  define('Notification', window.Notification);
  define('BroadcastChannel', class { postMessage() {} close() {} addEventListener() {} });

  // A WebSocket that never connects: keeps the network layer in its "trying"
  // state so tests never leave the room for a real broker.
  class FakeWebSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
      FakeWebSocket.instances.push(this);
    }
    send() {}
    close() { this.readyState = 3; }
    addEventListener() {}
    removeEventListener() {}
  }
  FakeWebSocket.instances = [];
  define('WebSocket', FakeWebSocket);
  define('AudioContext', window.AudioContext);
  define('Image', window.Image);

  return { dom, window };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function reporter() {
  const results = [];
  return {
    results,
    async test(name, fn) {
      try {
        await fn();
        results.push(['ok', name]);
      } catch (err) {
        results.push(['fail', name, err?.message || String(err)]);
      }
    },
    finish(label) {
      for (const [status, name, err] of results) {
        console.log(`${status === 'ok' ? '  \u001b[32m✓\u001b[0m' : '  \u001b[31m✗\u001b[0m'} ${name}${err ? ` — ${err}` : ''}`);
      }
      const failed = results.filter((r) => r[0] === 'fail').length;
      console.log(failed ? `\n${failed} failed\n` : `\nAll ${label} passed\n`);
      return failed;
    },
  };
}
