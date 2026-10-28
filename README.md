# TalkingApp

A Discord-style chat app that runs entirely in your browser and deploys free on **GitHub Pages**.
Pick a username and password, create servers with roles and channels, send pictures and GIFs, and
talk to everyone on the site in real time — no backend to run, no installs.

**[Open TalkingApp »](https://jaydenwhite7714.github.io/TalkingAPP/)**

![TalkingApp](assets/img/logo.svg)

---

## What it does

**Real-time, for real.** Every browser that has the page open joins the same room on public relay
infrastructure (MQTT over WebSocket, with extra brokers and a plain WebSocket relay as fallbacks).
Messages, reactions, edits, deletes, typing indicators and presence all arrive instantly on
everyone else's screen. Offline? Messages are queued locally and sent the moment the network
comes back.

**A real account.** Pick a display name, `@username` and password. The password is verified with
PBKDF2-SHA256 (150k rounds, per-account salt) and the app asks for it every time it opens; the
session copy lives in memory only. Usernames cannot be reused, and one account per browser.

**Everything follows you.** Servers, channels, messages, DMs, settings, roles and your plan are
sealed with AES-GCM into a cloud copy keyed by your username. Sign in on another Chromebook and the
copy is fetched, decrypted and restored — the relay keeps the retained frames, so it works with
nobody else online. Copies trim themselves to fit instead of silently failing, and the newest
messages and pictures are the last things dropped. A plain JSON backup file is one click away too.

**Roles that actually stop people.** Owner, admin, moderator, member and read-only. Capabilities are
checked in the store before any mutation, in the UI, and again when a change arrives from the
network: only the author or the server owner can rewrite or delete a message remotely. Servers you
did not create are read-only for you, announcement channels are staff-only, and a server card
published by someone else can never rename a server you own.

**Servers, channels, communities.**
- Create servers with an icon, colour, description and categories of channels; per-server
  notification levels (all / mentions / muted).
- Public servers are listed in **Explore** where anyone online can join with one click — with the
  real name, icon, owner and channel list, not a blank mirror.
- **Shared history:** each channel publishes a compact text-only digest as a retained relay frame,
  so a device that opens the page later still sees the conversation, even if nobody is online.
- Share an invite link that drops people into your server (`?join=your-server`), complete with its
  channels and categories.
- Give people roles in **Server settings → People & roles**; the member list shows role chips and
  plan badges.

**A chat client that feels finished.**
Markdown (`**bold**`, `*italic*`, `__underline__`, `~~strike~~`, `` `code` ``, code blocks,
`||spoilers||`, `> quotes`), emoji shortcodes (`:fire:`), a full emoji picker with search,
replies, reactions, pinned messages, message editing and deleting, image attachments, mentions
with autocomplete, channel links, message search, direct messages, a member list with live
presence, unread badges, notification sounds, desktop notifications, and a keyboard-shortcut layer.

**Plans, without a payment screen.** Free, Plus and Studio change how many servers you can create,
how many channels each gets, your upload ceiling, how much history travels in the shared log and how
big the encrypted cloud copy is. Paid tiers add a badge next to your name. Switching is instant,
nothing is charged, and the plan travels with your account. See **Settings → Plans**.

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

Nothing to build — the site is plain static files at the repository root, so Pages serves it directly.

1. Push to `main`.
2. **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`** (one click, once).
3. The site goes live at `https://<user>.github.io/<repo>/` — or on jsDelivr immediately, with no
   settings at all: `https://cdn.jsdelivr.net/gh/<user>/<repo>@main/`.

`.nojekyll` and `404.html` are already in place. If you would rather publish from Actions instead,
drop the two "stage + upload" steps back in front of `actions/deploy-pages@v4` and set
**Source: GitHub Actions** — but do not run both at once: a branch source and an Actions deploy
published to the same site will race each other.

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
* Every channel also publishes its recent messages as a **retained** frame on
  `log/<server-key>/<channel>`, and each server publishes a card on `srv/<server-key>`. Retained
  frames are replayed by the relay (and by public MQTT brokers) to any client that connects later,
  which is what makes history and server branding survive a fresh device. Digests are text-only and
  capped at ~96 KB; deletions travel as tombstones.
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
* Your profile, servers, channels and message history live in `localStorage` in your own browser.
  The only thing replicated is your **encrypted** cloud copy, plus the text-only channel digests and
  server cards described above — never images, never passwords.
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
  net.js                   transport pool (MQTT / WebSocket / BroadcastChannel), outbox, digests
  shared.js                retained history digests + server cards (cross-device sync)
  perms.js                 roles and capabilities (pure, unit-tested)
  plans.js                 Free / Plus / Studio definitions and limits
  account.js               password hashing, handles, encrypted vault key
  vault.js                 sealed cloud copy, trimming, file backups
  session.js               in-memory session password
  markdown.js              safe message rendering
  emojis.js                emoji data, search, shortcodes
  avatar.js                avatars, image processing, server icons
  sim.js                   clearly-labelled demo members (opt-in)
  ui/                      modal, menu, popover, toast, emoji picker, profile card, lightbox
  views/                   onboarding, shell, messages, composer, modals
tools/
  serve.mjs                zero-dependency static dev server
  relay/server.mjs         self-hostable relay (MQTT over WS + broadcast WS)
404.html                   branded not-found page
```

## Tests

```bash
npm test              # module graph + required files (fast, no browser)
npm run test:logic    # roles, plans, vault trimming, history digests (jsdom)
npm run test:ui       # boots the real app: sign-up, lock screen, roles, plans
PORT=8081 npm run relay &   # the two live suites need a relay
npm run test:relay    # retained history/cards/vault against the relay
npm run test:realtime # the app + a second player over real WebSockets
```

The live suites boot the actual app in jsdom, connect it to `tools/relay/server.mjs`
with a real socket, and check that a second person's messages arrive, that replies
travel back, and that a **third** client connecting afterwards receives the retained
channel digest and server card.

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
