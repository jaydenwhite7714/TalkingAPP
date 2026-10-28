# Voice channels — scope before code

You asked for voice, and asked me to scope it before writing any. This is that
scope. It is deliberately honest about the two things that make voice different
from every feature shipped so far: **the cost is measured in pennies and people,
not lines of code**, and **the promise “it just works for two strangers” is much
harder to keep than it is for text**.

Nothing in this document is built yet.

---

## 1. What exists today

| Piece | State |
|---|---|
| Relay (`tools/relay/server.mjs`) | Own MQTT-over-WebSocket + raw broadcast, retained frames, optional self-host |
| Public transport | 4 free public WSS brokers (EMQX, HiveMQ, Mosquitto, Eclipse) |
| Identity | Username + password, PBKDF2 150k, sealed vault in the cloud |
| Permissions | Roles checked in the store before every mutation and again on the wire |
| Servers / channels | Public or invite-only, categories, announcements, threads, slowmode |
| Media | Images and GIFs, chunked over the same relay |

Everything above is text and bytes. Voice adds three things the project has no
machinery for yet: **live audio capture**, **peer-to-peer media transport**, and
**a signalling path that works through firewalls**.

## 2. Why voice is not “one more channel type”

- **Audio does not go through the relay.** MQTT brokers are the wrong tool:
  they are built for small messages, not 50 packets a second per person. The
  relay’s only job in voice is *signalling* — “here is my offer, here is my
  answer, here is a candidate route”.
- **Audio is peer-to-peer over WebRTC.** Browsers do this well, but they need
  STUN to discover a route, and TURN to relay when a network blocks direct
  connections. On school and office Chromebooks, TURN is not optional; roughly
  one connection in five needs it.
- **TURN costs money.** Free STUN exists (Google’s). Free TURN, at any
  reliability, does not. A TURN server is a small VM plus bandwidth: about
  **$5/month for a handful of rooms**, and it scales with minutes, not users.
- **Mesh does not scale.** Without a media server, every participant sends their
  audio to every other participant. Four people is fine. Eight is not — upload
  bandwidth and CPU both collapse. This is not a bug we can optimise away in the
  client; it is a topology limit.
- **Autoplay and permissions are hostile.** Browsers refuse to play audio until
  a user gesture, and mic permission is per-origin. Both are solvable, but they
  change the UI: you cannot join a voice channel silently in the background.

That last point matters for the app’s core promise. Today someone can open the
link and be chatting in ten seconds. Voice will always need one deliberate click
and one browser prompt.

## 3. Proposed architecture

```
  browser A                         signal relay (existing)                      browser B
  ┌──────────┐   offer / answer / ICE candidates  ┌─────────────┐   ┌──────────┐
  │ mic ─►── │ ─────────────────────────────────► │  MQTT / WS  │ ◄─ │ ──► mic  │
  │ WebRTC   │                                    └─────────────┘   │ WebRTC   │
  └────┬─────┘                                                       └────┬─────┘
       │            DTLS-SRTP audio, peer to peer (or via TURN)           │
       └───────────────────────────────────────────────────────────────┘
```

**Signalling packets** ride the existing envelope and keying, so invite-only
voice rooms stay as private as their text channels:

| `kind` | Payload | Purpose |
|---|---|---|
| `voice-join` | `{ key, channel, room }` | “I am in this voice room” |
| `voice-leave` | `{ key, channel }` | clean exit |
| `voice-roster` | `{ key, channel, peers: [userId] }` | who is currently connected |
| `voice-signal` | `{ key, channel, to, from, sdp?, candidate? }` | SDP offer/answer and ICE |
| `voice-mute` | `{ key, channel, userId, muted }` | so the roster shows a mic-off icon |

Everything is addressed to one peer (`to`), except join/leave/roster. Audio
itself never touches these topics.

**Connection policy**

- `RTCPeerConnection` per pair, with a single `AudioContext` and per-peer gain
  nodes (so we can offer per-person volume and a local mute).
- ICE servers: STUN always; TURN only when configured by the server owner
  (`?turn=…` override or a settings field). No hidden cost, no silent failure —
  if there is no TURN and the connection fails, the UI says *why*.
- Hard cap of **6 people per voice room** in meshed mode, enforced in the store
  and again on the wire. Above that, the room tells you to split.

**Where the code goes**

| File | Change |
|---|---|
| `assets/js/voice.js` (new) | capture, peer connections, mute, per-peer volume, ICE handling |
| `assets/js/store.js` | `voiceRooms` state, roster, cap, permission checks, per-user volume |
| `assets/js/net.js` | `sendVoiceJoin/Leave/Signal/Mute` |
| `assets/js/main.js` | wiring `net:voice-*`, cleanup on disconnect and on channel change |
| `assets/js/views/shell.js` | voice channels in the sidebar, “N connected” under the name |
| `assets/js/views/messages.js` | the room view: tiles, mic/camera-off indicators, leave button |
| `assets/js/views/modals.js` | channel type picker (text / announcement / **voice**), TURN config |
| `tools/test/voice.test.mjs` | signalling contract, cap enforcement, permission checks — no real audio |

## 4. Phases, and what each one earns

**Phase 1 — signalling only (1–2 days).**
Voice channel type, join/leave roster, mute state, permission checks, cap.
No audio yet. Ships something visible and testable, and proves the wire format.

**Phase 2 — real audio, mesh, 2–4 people (2–3 days).**
`getUserMedia`, one peer connection per pair, STUN only, per-peer volume, mic
meter, speaking indicator. This is the demo that makes people say “oh, it
actually works”.

**Phase 3 — reliability (1–2 days).**
TURN support and honest error surfaces, reconnect after a dropped signal,
cleanup on tab close, autoplay unlock, device picker, echo handling. Phases 1
and 2 look done and are not; this is the phase that makes it trustworthy.

**Phase 4 — optional, only if you want it.**
Screen share (same transport, video track), then video tiles. Push-to-talk and
soundboard are small once 1–3 exist.

Realistic total for phases 1–3: **4–7 working days**, plus a TURN VM if you want
it to work on locked-down school networks.

## 5. Cost and limits, stated plainly

| Item | Reality |
|---|---|
| STUN | Free (Google) |
| TURN | ~$5–10/month per small VM, more with heavy use. Call it “one coffee a month” for a classroom, real money at scale |
| Mesh cap | 6 people; beyond that audio quality degrades before the code notices |
| Mobile Safari | Mic capture needs HTTPS and a user gesture; fine on the deployed site, awkward on `file://` |
| Meeting recording | Not planned. It is a different product with consent problems |
| End-to-end secrecy | Same caveat as text: signalling is on shared public brokers unless you self-host. Media is DTLS-SRTP, so the *audio* is encrypted in transit by WebRTC regardless |

If the requirement is “a class of 30 can join one room”, mesh is the wrong
answer and we would need an SFU (mediasoup or LiveKit) plus a paid host.
That is a different project with a monthly bill.

## 6. How it would be tested

- **Signalling contract** in `tools/test/voice.test.mjs`: offer/answer relayed
  only to the addressed peer, roster converges, leave cleans up, cap refused at
  7, invite-only rooms never publish voice packets to the shared room.
- **A fake `RTCPeerConnection`** in the harness to drive the state machine
  without real media, so CI never needs a microphone.
- **The honest test**: two browser windows on two networks, one behind a
  restrictive firewall, actually hearing each other. That is a manual check,
  and I will say so rather than claim a green test proves it.
- **Regression**: `npm run test:all` must stay green throughout; voice must not
  slow down text or leak timers when the tab idles.

## 7. Recommendation

Build phases 1–3, then stop and use it. Do not start with video, and do not
promise large rooms. If you would rather keep the app text-only, that is a
defensible choice: everything here is currently instant, free and reliable, and
voice is the first feature that asks the owner to pay for a server.

Say “build voice” and I will start with phase 1 — no audio, just rooms,
rosters and permissions you can see — so you can judge the shape before
committing to the expensive part.
