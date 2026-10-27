// Sign-up / username creation screen
import { el, validateHandle, validateDisplayName, validateServerName, storage, debounce } from '../util.js';
import { AVATAR_COLORS, defaultAvatar, avatarHTML, initialsOf, prepareAvatarFile } from '../avatar.js';
import { icon } from '../icons.js';
import { state, createProfile, registerAllCommunities, createServer, toast, useAccountNamespace, persistNow } from '../store.js';
import { bus } from '../bus.js';
import { registerAccount, passwordProblem, passwordStrength, isClaimedLocally, suggestHandle, checkPassword } from '../account.js';
import { setSessionPassword } from '../session.js';
import { saveVaultToCloud } from '../vault.js';
import { net } from '../net.js';
import { showLock } from './lock.js';

const ADJ = ['cosmic', 'quiet', 'neon', 'wild', 'lucky', 'sunny', 'midnight', 'velvet', 'rapid', 'gentle', 'electric', 'hidden', 'crimson', 'frozen', 'golden'];
const NOUN = ['otter', 'comet', 'pixel', 'falcon', 'cactus', 'ember', 'harbor', 'lynx', 'mango', 'orbit', 'panda', 'raven', 'sock', 'tiger', 'wave'];

let chosenAvatar = null;
let handleTouched = false;
let onChange = null;

export function initOnboarding({ onDone }) {
  onChange = onDone;
  const form = document.getElementById('signupForm');
  const nameInput = document.getElementById('displayName');
  const handleInput = document.getElementById('handle');
  const nameErr = document.getElementById('displayNameError');
  const handleErr = document.getElementById('handleError');
  const avatarHolder = document.getElementById('signupAvatar');
  const avatarFile = document.getElementById('avatarFile');
  const uploadBtn = document.getElementById('avatarUpload');
  const resetBtn = document.getElementById('avatarReset');
  const swatches = document.getElementById('colorSwatches');
  const startBtn = document.getElementById('startBtn');
  const pwInput = document.getElementById('signupPassword');
  const pwInput2 = document.getElementById('signupPassword2');
  const pwMeter = document.getElementById('pwMeter');
  const pwHint = document.getElementById('pwHint');
  const pwErr = document.getElementById('passwordError');
  const pwErr2 = document.getElementById('passwordError2');
  const handleStatus = document.getElementById('handleStatus');
  const eyeBtn = document.getElementById('signupPasswordEye');

  eyeBtn?.addEventListener('click', () => {
    const show = pwInput.type === 'password';
    pwInput.type = show ? 'text' : 'password';
    pwInput2.type = show ? 'text' : 'password';
    eyeBtn.setAttribute('aria-pressed', String(show));
    eyeBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    pwInput.focus({ preventScroll: true });
  });

  pwInput.addEventListener('input', () => {
    const { score, label, hint } = passwordStrength(pwInput.value);
    pwMeter.dataset.score = String(score);
    pwHint.className = 'field-hint';
    pwHint.textContent = pwInput.value ? `${label} — ${hint}` : 'This password unlocks your account on any device. It is never sent anywhere.';
    pwErr.hidden = true;
  });
  pwInput2.addEventListener('input', () => { pwErr2.hidden = true; });

  // seed with a friendly suggestion
  const suggestion = `${ADJ[Math.floor(Math.random() * ADJ.length)]}${NOUN[Math.floor(Math.random() * NOUN.length)]}`;
  chosenAvatar = {
    ...defaultAvatar(suggestion, AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]),
    initials: initialsOf(suggestion),
  };
  nameInput.value = suggestion.charAt(0).toUpperCase() + suggestion.slice(1);
  handleInput.value = suggestion;

  const paintAvatar = () => {
    const user = { displayName: nameInput.value || 'New friend', avatar: chosenAvatar };
    avatarHolder.innerHTML = avatarHTML(user, { size: 76, cls: 'avatar-xl' });
  };

  const paintSwatches = () => {
    swatches.replaceChildren();
    for (const c of AVATAR_COLORS) {
      const checked = chosenAvatar?.kind === 'color' && chosenAvatar.color === c;
      swatches.append(el('button', {
        class: 'swatch', type: 'button', role: 'radio', 'aria-checked': String(checked),
        style: { background: c }, 'aria-label': `Avatar color ${c}`, title: c,
        onclick: () => {
          chosenAvatar = { kind: 'color', color: c, initials: initialsOf(nameInput.value || 'You') };
          paintSwatches();
          paintAvatar();
        },
      }));
    }
  };

  const syncHandle = () => {
    if (handleTouched) return;
    const slug = nameInput.value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 20);
    handleInput.value = slug;
  };

  nameInput.addEventListener('input', () => {
    nameErr.hidden = true;
    nameInput.setAttribute('aria-invalid', 'false');
    syncHandle();
    paintAvatar();
  });
  handleInput.addEventListener('input', () => {
    handleTouched = true;
    handleErr.hidden = true;
    handleInput.setAttribute('aria-invalid', 'false');
    const caret = handleInput.selectionStart;
    handleInput.value = handleInput.value.toLowerCase().replace(/\s+/g, '');
    handleInput.setSelectionRange(caret, caret);
    runCheck(handleInput.value.trim());
  });

  uploadBtn.addEventListener('click', () => avatarFile.click());
  avatarFile.addEventListener('change', async () => {
    const file = avatarFile.files?.[0];
    if (!file) return;
    try {
      chosenAvatar = await prepareAvatarFile(file, { size: 176 });
      paintAvatar();
      paintSwatches();
    } catch (e) {
      showError(nameErr, e.message);
    }
    avatarFile.value = '';
  });
  resetBtn.addEventListener('click', () => {
    chosenAvatar = { ...defaultAvatar(handleInput.value || 'friend', AVATAR_COLORS[0]), initials: initialsOf(nameInput.value || 'You') };
    paintAvatar();
    paintSwatches();
  });

  // live username availability: this device first, then everyone online
  let availability = { state: 'idle' };
  let lastCheck = { handle: '', at: 0, taken: false, by: null };
  const paintAvailability = () => {
    if (!handleStatus) return;
    if (availability.state === 'idle') { handleStatus.hidden = true; return; }
    handleStatus.hidden = false;
    handleStatus.className = `field-hint ${availability.state === 'free' ? 'ok' : availability.state === 'taken' ? 'bad' : ''}`;
    handleStatus.textContent = availability.message;
  };
  const runCheck = debounce(async (handle) => {
    const valid = /^[a-z0-9._-]{2,20}$/.test(handle);
    if (!valid) { availability = { state: 'idle' }; paintAvailability(); return; }
    if (isClaimedLocally(handle)) {
      availability = { state: 'taken', message: `@${handle} is already saved on this device — sign in to it instead.` };
      paintAvailability();
      return;
    }
    availability = { state: 'checking', message: `Checking whether @${handle} is free…` };
    paintAvailability();
    const result = await net.checkHandle(handle, { timeout: 900 }).catch(() => ({ taken: false }));
    lastCheck = { handle, at: Date.now(), taken: Boolean(result.taken), by: result.by || null };
    if (handleInput.value.trim().toLowerCase() !== handle) return;
    if (result.taken) {
      availability = { state: 'taken', message: `@${handle} is taken${result.by ? ` by ${result.by}` : ''} — try @${suggestHandle(handle)}.` };
    } else {
      availability = { state: 'free', message: `@${handle} is free — it will be yours.` };
    }
    paintAvailability();
  }, 420);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nameRes = validateDisplayName(nameInput.value);
    if (!nameRes.ok) {
      showError(nameErr, nameRes.error);
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return;
    }
    const handleRes = validateHandle(handleInput.value || nameInput.value);
    if (!handleRes.ok) {
      showError(handleErr, handleRes.error);
      handleInput.setAttribute('aria-invalid', 'true');
      handleInput.focus();
      return;
    }
    const pwProblem = passwordProblem(pwInput.value);
    if (pwProblem) {
      showError(pwErr, pwProblem);
      pwInput.focus();
      return;
    }
    if (pwInput.value !== pwInput2.value) {
      showError(pwErr2, 'Those passwords do not match.');
      pwInput2.focus();
      return;
    }
    if (isClaimedLocally(handleRes.value)) {
      showError(handleErr, `@${handleRes.value} is already saved on this device. Sign in to it, or pick @${suggestHandle(handleRes.value)}.`);
      return;
    }

    startBtn.disabled = true;
    startBtn.replaceChildren(el('span', { class: 'spinner' }), 'Checking the username…');

    // reuse the check the field already ran, so pressing the button feels instant
    const fresh = lastCheck.handle === handleRes.value && Date.now() - lastCheck.at < 8000;
    const live = fresh
      ? { taken: lastCheck.taken, by: lastCheck.by }
      : await net.checkHandle(handleRes.value, { timeout: 900 }).catch(() => ({ taken: false }));
    if (live.taken) {
      startBtn.disabled = false;
      startBtn.replaceChildren('Start talking');
      showError(handleErr, `@${handleRes.value} is taken${live.by ? ` by ${live.by}` : ''} — try @${suggestHandle(handleRes.value)}.`);
      return;
    }

    startBtn.replaceChildren(el('span', { class: 'spinner' }), 'Creating your profile…');
    await registerAccount({ handle: handleRes.value, displayName: nameRes.value, password: pwInput.value });
    setSessionPassword(pwInput.value);
    useAccountNamespace(handleRes.value);

    const res = createProfile({
      displayName: nameRes.value,
      handle: handleRes.value,
      avatar: chosenAvatar || { ...defaultAvatar(nameRes.value), initials: initialsOf(nameRes.value) },
      accentColor: chosenAvatar?.color || AVATAR_COLORS[0],
    });
    if (!res.ok) {
      startBtn.disabled = false;
      startBtn.replaceChildren('Start talking');
      showError(handleErr, res.error);
      return;
    }
    registerAllCommunities();
    persistNow();
    saveVaultToCloud(pwInput.value).catch(() => {});
    setTimeout(() => showSetupStep(nameRes.value), 260);
  });

  /* ---------------------------- step 2: community ------------------------- */
  const setupForm = document.getElementById('setupForm');
  const serverNameInput = document.getElementById('serverName');
  const channelInput = document.getElementById('firstChannel');
  const serverNameErr = document.getElementById('serverNameError');
  const previewName = document.getElementById('setupPreviewName');
  const previewIcon = document.getElementById('setupIcon');
  const vibeGrid = document.getElementById('vibeGrid');
  const finishBtn = document.getElementById('finishBtn');

  const VIBES = [
    { emoji: '🎮', name: 'Gaming', server: 'Game Night', channel: 'general' },
    { emoji: '🎵', name: 'Music', server: 'Listening Room', channel: 'now-playing' },
    { emoji: '🎨', name: 'Creative', server: 'Studio', channel: 'showcase' },
    { emoji: '💻', name: 'Dev', server: 'Dev Corner', channel: 'general' },
    { emoji: '📚', name: 'Study', server: 'Study Hall', channel: 'general' },
    { emoji: '🏀', name: 'Sports', server: 'The Bench', channel: 'general' },
    { emoji: '🍿', name: 'Movies', server: 'Movie Night', channel: 'watchlist' },
    { emoji: '🛋️', name: 'Friends', server: 'Hangout', channel: 'general' },
  ];
  let selectedVibe = null;
  let nameTouched = false;

  const paintPreview = () => {
    const name = serverNameInput.value.trim() || 'My server';
    previewName.textContent = name;
    previewIcon.textContent = (selectedVibe ? selectedVibe.emoji : name.slice(0, 2)).slice(0, 2).toUpperCase();
    previewIcon.style.setProperty('--a1', chosenAvatar?.color || '#5865f2');
    previewIcon.style.setProperty('--a2', '#3f4bd1');
  };

  const paintVibes = () => {
    vibeGrid.replaceChildren();
    for (const vibe of VIBES) {
      const btn = el('button', {
        class: 'vibe', type: 'button', role: 'radio', 'aria-checked': String(selectedVibe === vibe),
        onclick: () => {
          selectedVibe = vibe;
          // only overwrite the name if the person hasn't typed their own
          if (!nameTouched) {
            serverNameInput.value = vibe.server;
            channelInput.value = vibe.channel;
          }
          paintVibes();
          paintPreview();
        },
      }, el('span', { text: vibe.emoji }), el('span', { text: vibe.name }));
      vibeGrid.append(btn);
    }
  };

  serverNameInput.addEventListener('input', () => {
    nameTouched = true;
    serverNameErr.hidden = true;
    paintPreview();
  });

  document.getElementById('setupBack')?.addEventListener('click', () => {
    setupForm.classList.add('hidden');
    setCardHead('Create your username', 'This is how everyone will see you. You can change it later.');
    form.classList.remove('hidden');
    nameInput.focus();
  });

  setupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameRes = validateServerName(serverNameInput.value);
    if (!nameRes.ok) {
      serverNameErr.hidden = false;
      serverNameErr.textContent = nameRes.error;
      serverNameInput.focus();
      return;
    }
    finishBtn.disabled = true;
    const res = createServer({
      name: nameRes.value,
      desc: selectedVibe ? `A ${selectedVibe.name.toLowerCase()} server, started on TalkingApp.` : 'My corner of the TalkingApp network.',
      color: chosenAvatar?.color || AVATAR_COLORS[0],
      emoji: selectedVibe?.emoji || '💬',
      channels: [channelInput.value || 'general'],
    });
    if (!res.ok) {
      finishBtn.disabled = false;
      serverNameErr.hidden = false;
      serverNameErr.textContent = res.error;
      return;
    }
    window.__taBootServerId = res.server.id;
    window.__taOpenInviteAfterBoot = res.server.id;
    enterApp();
  });

  const cardHead = document.querySelector('.signup-card > .signup-head');

  function setCardHead(title, subtitle) {
    if (!cardHead) return;
    cardHead.querySelector('h2').textContent = title;
    cardHead.querySelector('p').textContent = subtitle;
  }

  function showSetupStep(displayName) {
    if (!serverNameInput.value) {
      serverNameInput.value = `${displayName.split(' ')[0]}’s server`.replace(/'/g, '’');
    }
    paintVibes();
    paintPreview();
    form.classList.add('hidden');
    setCardHead('One last thing', 'Give your corner of the network a name.');
    setupForm.classList.remove('hidden');
    setTimeout(() => { serverNameInput.focus(); serverNameInput.select(); }, 160);
  }

  document.getElementById('showSignin')?.addEventListener('click', () => {
    document.getElementById('onboarding')?.classList.add('hidden');
    showLock({ nextMode: 'signin' });
  });

  paintSwatches();
  paintAvatar();

  // live stats on the hero
  const pill = document.getElementById('heroLivePill');
  const pillLabel = document.getElementById('heroLiveLabel');
  const onlineEl = document.getElementById('heroOnline');
  const serversEl = document.getElementById('heroServers');
  const paintStats = () => {
    const online = 1 + Object.values(state.peers).filter((p) => p.status === 'online').length;
    if (onlineEl) onlineEl.textContent = String(online);
    const total = Object.keys(state.network).length;
    if (serversEl) serversEl.textContent = String(Math.max(total, 2));
  };
  bus.on('net:status', ({ status }) => {
    if (!pill) return;
    pill.dataset.state = status === 'online' ? 'online' : status === 'offline' ? 'offline' : 'connecting';
    pillLabel.textContent = status === 'online' ? 'Live network' : status === 'connecting' ? 'Connecting' : 'Offline';
    paintStats();
  });
  bus.on('net:join', paintStats);
  bus.on('net:leave', paintStats);
  bus.on('net:presence', paintStats);
  paintStats();

  function enterApp() {
    // a server created during signup becomes the landing spot
    if (window.__taBootServerId && state.servers?.[window.__taBootServerId]) {
      state.ui.activeServerId = window.__taBootServerId;
      state.ui.activeChannelId = state.servers[window.__taBootServerId].defaultChannelId;
      window.__taBootServerId = null;
    }
    const onboarding = document.getElementById('onboarding');
    onboarding.style.transition = 'opacity .32s ease, transform .32s ease';
    onboarding.style.opacity = '0';
    onboarding.style.transform = 'scale(.985)';
    setTimeout(() => {
      onboarding.classList.add('hidden');
      onboarding.style.cssText = '';
      document.getElementById('app')?.classList.remove('hidden');
      onChange?.();
    }, 180);
  }

}

function showError(node, message) {
  if (!node) return;
  node.hidden = false;
  node.textContent = message;
  node.style.animation = 'none';
  requestAnimationFrame(() => { node.style.animation = ''; });
}

export function showOnboarding() {
  document.getElementById('app')?.classList.add('hidden');
  const ob = document.getElementById('onboarding');
  if (ob) {
    ob.classList.remove('hidden');
    ob.style.opacity = '';
  }
}
