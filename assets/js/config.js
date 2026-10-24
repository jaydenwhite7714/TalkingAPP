// TalkingApp — runtime configuration
// The relay lets everyone who has the page open talk to each other in real time.
// Transports are tried in parallel; messages are de-duplicated by id.

const params = new URLSearchParams(location.search);
const host = location.hostname;
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || location.protocol === 'file:';

function parseCandidates() {
  const out = [];
  // explicit override: ?relay=wss://example.org/ws or ?relay=mqtts://broker
  const override = params.get('relay') || localStorage.getItem('ta.relay.override');
  if (override) {
    for (const raw of override.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (/^mqtts?:\/\//i.test(raw) || /\/mqtt$/i.test(raw)) {
        // mqtt:// -> ws://, mqtts:// -> wss://
        out.push({ kind: 'mqtt', url: raw.replace(/^mqtts:\/\//i, 'wss://').replace(/^mqtt:\/\//i, 'ws://') });
      } else if (/^wss?:\/\//i.test(raw)) {
        out.push({ kind: 'raw-ws', url: raw });
      } else if (raw === 'local' || raw.startsWith('ws+local')) {
        out.push({ kind: 'local' });
      }
    }
  }
  if (isLocal && params.get('env') !== 'prod') {
    // Local dev relay (tools/relay/server.mjs) — MQTT over WS plus a raw broadcast socket.
    out.push({ kind: 'mqtt', url: 'ws://localhost:8080/mqtt', local: true, optional: true });
    out.push({ kind: 'raw-ws', url: 'ws://localhost:8080/ws', local: true, optional: true });
  }
  if (!isLocal || params.get('env') === 'prod') {
    // Free public brokers, all subscribed in parallel — the first one that connects wins
    // and the rest are redundant. Swap any of these for your own relay
    // (see tools/relay/server.mjs) with ?relay=wss://your-host/ws
    out.push({ kind: 'mqtt', url: 'wss://broker.emqx.io:8084/mqtt' });
    out.push({ kind: 'mqtt', url: 'wss://broker.hivemq.com:8884/mqtt' });
    out.push({ kind: 'mqtt', url: 'wss://test.mosquitto.org:8081/mqtt' });
    out.push({ kind: 'mqtt', url: 'wss://mqtt.eclipseprojects.io:443/mqtt' });
  }
  out.push({ kind: 'local' });
  return out;
}

const joinKey = params.get('join') || params.get('server') || '';
const joinName = params.get('name') || '';

export const CONFIG = {
  appName: 'TalkingApp',
  version: '1.0.0',
  room: (params.get('room') || localStorage.getItem('ta.room') || 'talkingapp-public-v1').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'talkingapp-public-v1',
  relay: {
    candidates: parseCandidates(),
    heartbeatMs: 12000,
    peerTimeoutMs: 50000,
    maxText: 2000,
  },
  links: {
    github: 'https://github.com/jaydenwhite7714/TalkingAPP',
    issues: 'https://github.com/jaydenwhite7714/TalkingAPP/issues',
  },
  isLocal,
  invite: joinKey
    ? { key: joinKey.replace(/[^a-z0-9-]/gi, '').slice(0, 40), name: (joinName || joinKey).slice(0, 40) }
    : null,
};

export function usableRelayCandidates() {
  return CONFIG.relay.candidates.filter((c) => c.kind !== 'local');
}
