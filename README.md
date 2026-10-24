# TalkingApp

A Discord-style chat app that runs entirely in your browser and deploys free on **GitHub Pages**.
Pick a username, create a server, make channels, and talk to everyone on the site in real time —
no accounts, no backend to run, no installs.

**[Open TalkingApp »](https://jaydenwhite7714.github.io/TalkingAPP/)**

![TalkingApp](assets/img/logo.svg)

---

## What it does

**Real-time, for real.** Every browser that has the page open joins the same room on public relay
infrastructure (MQTT over WebSocket, with extra brokers and a plain WebSocket relay as fallbacks).
Messages, reactions, edits, deletes, typing indicators and presence all arrive instantly on
everyone else's screen. Offline? Messages are queued locally and sent the moment the network
comes back.

**Your identity, no sign-up.** Pick a display name, `@username`, avatar (upload or generated
colour) and bio. It's saved in your browser — no email, no password, nothing to verify.

**Servers, channels, communities.**
- Create servers with an icon, colour and description, and as many text channels as you like.
- Public servers are listed in **Explore** where anyone online can join with one click.
- Join a server and you receive its recent history automatically.
- Share an invite link that drops people straight into your server (`?join=your-server`).

**A chat client that feels finished.**
Markdown (`**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `` `code` ``, code blocks,
`||spoilers||`, `> quotes`), emoji shortcodes (`:fire:`), a full emoji picker with search,
replies, reactions, pinned messages, message editing and deleting, image attachments, mentions
with autocomplete, channel links, message search, direct messages, a member list with live
presence, unread badges, notification sounds, desktop notifications, and a keyboard-shortcut layer.

**Three themes, eight accents, compact mode.** Dark, light and midnight, all instant.

**Actually responsive.** Desktop rail → mobile drawer, sheet-style dialogs on phones, safe-area
padding for notched displays, 44 px touch targets.

---

## Run it locally

No build step. Any static file server works:

```bash
npm run dev          # http://localhost:8000  (zero-dependency static server)
```

Optional — a relay of your own, so local testing doesn't touch public brokers:

```bash
npm install
npm run relay        # ws://localhost:8080/ws  and  ws://localhost:8080/mqtt
```

When the page is opened from `localhost`, TalkingApp automatically prefers that local relay and
falls back to the public brokers if it isn't running.

## Deploy to GitHub Pages

The repository ships with `.github/workflows/pages.yml`.

1. Push to `main`.
2. In **Settings → Pages**, set **Source** to **GitHub Actions** (once).
3. The workflow stages `index.html`, `404.html` and `assets/`, then publishes.
   Your app is live at `https://<user>.github.io/<repo>/`.

Prefer a branch deploy? Point Pages at `main` / `root` — the site is plain static files, and
`.nojekyll` / `404.html` are already in place.

---

## How the real-time layer works

```
browser A ─┐                        ┌─ MQTT: broker.emqx.io      (primary)
browser B ─┼── JSON envelopes ──────┼─ MQTT: broker.hivemq.com   (spare)
browser C ─┘                        ├─ MQTT: test.mosquitto.org  (spare)
                                    ├─ MQTT: mqtt.eclipseprojects.io (spare)
                                    └─ BroadcastChannel (tabs on one device)
```

* Each client connects to the first relays that come up, subscribes to one room topic
  (`talkingapp-public-v1` by default) and publishes small JSON envelopes.
* Envelopes carry an id, so duplicates arriving over several transports are dropped.
* Presence is a heartbeat every few seconds; peers expire after 50 s of silence.
* Joining a community sends a `sync` request and whoever is already inside replays the last
  20 messages per channel (`history`).
* If no transport is connected, outgoing messages are parked in an outbox and flushed
  automatically on reconnect. The UI shows “Waiting for the network”.

The relay code is MIT-licensed (`assets/vendor/mqtt.min.js` by the MQTT.js project) and the
self-hosted relay in `tools/relay/server.mjs` is a ~120-line Node script.

### Point it at your own relay

```
https://your-site/?relay=wss://your-relay.example/ws
https://your-site/?relay=wss://your-broker.example:8884/mqtt
```

The setting is remembered in that browser, and can also be set in **Settings → Network**.
A private room: `?room=my-private-room`.

---

## Privacy, honestly

* Messages travel through **public** relay servers, unencrypted. Anyone with the topic name
  could subscribe. Treat the room like a public square — great for hanging out, not for secrets.
* Nothing is stored on a server. Your profile, servers, channels and message history live in
  `localStorage` in your own browser.
* Images are downscaled and embedded in the message (no uploads, no hosting).
* **Settings → Reset data** wipes everything on your device.

For a private group, run the included relay and use one of its endpoints with `?relay=…`.

---

## Project layout

```
index.html                 app shell (onboarding + chat + overlay roots)
assets/css/                tokens, layout, chat, components, onboarding, responsive
assets/js/
  main.js                  bootstrap, network wiring, notifications, routing, shortcuts
  store.js                 state, persistence, all mutations
  net.js                   transport pool (MQTT / WebSocket / BroadcastChannel), outbox
  markdown.js              safe message rendering
  emojis.js                emoji data, search, shortcodes
  avatar.js                avatars, image processing, server icons
  sim.js                   clearly-labelled demo members (opt-in)
  ui/                      modal, menu, popover, toast, emoji picker, profile card, lightbox
  views/                   onboarding, shell, messages, composer, modals
tools/
  serve.mjs                zero-dependency static dev server
  relay/server.mjs         self-hostable relay (MQTT over WS + broadcast WS)
.github/workflows/pages.yml  GitHub Pages deploy
```

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Enter` | send message |
| `Shift` + `Enter` | new line |
| `↑` (empty composer) | edit your last message |
| `Esc` | cancel reply / edit / close overlays |
| `Ctrl/⌘` + `K` | search everything |
| `Ctrl/⌘` + `,` | settings |
| `Ctrl/⌘` + `Shift` + `M` | toggle member list |
| `Ctrl/⌘` + `Shift` + `G` | jump to #general |

## Browser support

Current Chrome, Edge, Firefox and Safari (including iOS/Android). Uses ES modules, CSS nesting-free
modern CSS (`:has` avoided), `BroadcastChannel` and `localStorage`.

## License

App code: MIT. Inter and Noto Color Emoji fonts: SIL OFL 1.1. MQTT.js: MIT. See the licence files in
`assets/fonts/` and `assets/vendor/`.

## Instant preview links

If GitHub Pages is not enabled on the repository yet, the same site is served straight from the
repository through jsDelivr (no build, no config):

- <https://cdn.jsdelivr.net/gh/jaydenwhite7714/TalkingAPP@main/index.html>

Both hosts serve the identical static files, and the app falls back to public MQTT brokers for
real-time transport, so either link talks to everyone else on either link.
