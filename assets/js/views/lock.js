// TalkingApp — the lock screen: username + password, every time you come in
import { el, storage } from '../util.js';
import { avatarHTML } from '../avatar.js';
import {
  readAccount, checkPassword, registerAccount, passwordStrength, passwordProblem,
  clearAccount, suggestHandle, isClaimedLocally, claimHandle,
} from '../account.js';
import {
  useAccountNamespace, load, applySnapshot, snapshotState, persistNow, toast,
} from '../store.js';
import { fetchVaultFromCloud, openSealed, restoreSnapshot, saveVaultToCloud, localVault } from '../vault.js';
import { setSessionPassword } from '../session.js';
import { net } from '../net.js';
import { bus } from '../bus.js';
import { icon } from '../icons.js';

const LEGACY_STATE = 'ta.state.v2';

let screen = null;
let mode = 'unlock';
let onUnlocked = null;

/** main.js registers what "unlocked" means for the app. */
export function setUnlockHandler(fn) {
  onUnlocked = fn;
}

export function isLockShowing() {
  return Boolean(screen && !screen.classList.contains('hidden'));
}

export function hideLock() {
  screen?.classList.add('hidden');
  document.body.classList.remove('locked');
}

export function showLock({ nextMode = 'unlock', onDone = null } = {}) {
  if (!screen) build();
  mode = nextMode;
  if (onDone) onUnlocked = onDone;
  paint();
  screen.classList.remove('hidden');
  screen.removeAttribute('hidden');
  document.body.classList.add('locked');
  const focusTarget = mode === 'unlock' || mode === 'secure' ? passwordEl : userEl;
  setTimeout(() => focusTarget?.focus({ preventScroll: true }), 120);
}

/* ---------------------------------- build --------------------------------- */

let userEl, passwordEl, password2El, formEl, errorEl, unlockBtn, unlockLabel;
let whoEl, avatarEl, nameEl, handleEl, switchBtn, userField, confirmField, noteEl, titleEl, subEl, createBtn, wipeBtn;

function build() {
  screen = document.getElementById('lockScreen');
  userEl = document.getElementById('lockUser');
  passwordEl = document.getElementById('lockPassword');
  password2El = document.getElementById('lockPassword2');
  formEl = document.getElementById('lockForm');
  errorEl = document.getElementById('lockError');
  unlockBtn = document.getElementById('unlockBtn');
  unlockLabel = document.getElementById('unlockLabel');
  whoEl = document.getElementById('lockWho');
  avatarEl = document.getElementById('lockAvatar');
  nameEl = document.getElementById('lockName');
  handleEl = document.getElementById('lockHandle');
  switchBtn = document.getElementById('lockSwitch');
  userField = document.getElementById('lockUserField');
  confirmField = document.getElementById('lockConfirmField');
  noteEl = document.getElementById('lockNote');
  titleEl = document.getElementById('lockTitle');
  subEl = document.getElementById('lockSub');
  createBtn = document.getElementById('lockCreateAccount');
  wipeBtn = document.getElementById('lockWipe');

  document.getElementById('lockEye')?.addEventListener('click', (e) => toggleEye(e.currentTarget, passwordEl));

  userEl.addEventListener('input', () => {
    userEl.value = userEl.value.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 20);
    hideError();
  });
  passwordEl.addEventListener('input', hideError);
  password2El.addEventListener('input', hideError);

  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });

  switchBtn?.addEventListener('click', () => {
    const acc = readAccount();
    if (acc) {
      // keep the username reserved on this device, just stop signing in as them
      claimHandle(acc.handle, { displayName: acc.displayName });
      clearAccount();
      toast(`Signed out of @${acc.handle} on this device`, 'info');
    }
    mode = 'signin';
    paint();
    userEl.focus();
  });

  createBtn?.addEventListener('click', () => {
    clearAccount();
    hideLock();
    document.dispatchEvent(new CustomEvent('ta:new-account'));
  });

  wipeBtn?.addEventListener('click', async () => {
    const { confirmDialog } = await import('../ui/modal.js');
    const ok = await confirmDialog({
      title: 'Start over on this device?',
      body: 'This removes the saved account, your local copy of servers and history, and the cached cloud backup from this browser. A copy on another device (or in the cloud) is not affected.',
      confirmLabel: 'Start over',
      danger: true,
    });
    if (!ok) return;
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('ta.')) localStorage.removeItem(key);
    }
    location.reload();
  });
}

function toggleEye(btn, input) {
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-pressed', String(show));
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  input.focus({ preventScroll: true });
}

/* ---------------------------------- paint --------------------------------- */

function paint() {
  const account = readAccount();
  screen.dataset.mode = mode;
  hideError();

  if (mode === 'signin') {
    titleEl.textContent = 'Sign in';
    subEl.textContent = 'Same username and password as your other device — your servers come with you.';
    whoEl.style.display = 'none';
    userField.hidden = false;
    confirmField.hidden = true;
    passwordEl.value = '';
    passwordEl.setAttribute('autocomplete', 'current-password');
    unlockLabel.textContent = 'Sign in';
    noteEl.textContent = 'We look for your encrypted backup on the relay. The password is what decrypts it — it is never sent.';
    switchBtn.hidden = true;
    return;
  }

  if (mode === 'secure') {
    titleEl.textContent = 'Set a password';
    subEl.textContent = 'Your profile is already on this device. Add a password so it is locked and can travel with you.';
    whoEl.style.display = 'none';
    userField.hidden = true;
    confirmField.hidden = false;
    passwordEl.value = '';
    password2El.value = '';
    passwordEl.setAttribute('autocomplete', 'new-password');
    unlockLabel.textContent = 'Lock my account';
    noteEl.textContent = 'Passwords are salted and stretched with PBKDF2 (150k rounds) before they are stored. Nobody — including us — ever sees the original.';
    switchBtn.hidden = true;
    return;
  }

  // unlock
  titleEl.textContent = 'Unlock TalkingApp';
  subEl.textContent = 'Enter your password to get back to your servers and messages.';
  userField.hidden = true;
  confirmField.hidden = true;
  passwordEl.value = '';
  passwordEl.setAttribute('autocomplete', 'current-password');
  password2El.value = '';
  unlockLabel.textContent = 'Unlock';
  switchBtn.hidden = false;
  noteEl.textContent = 'Your profile, servers and history are encrypted with this password. Sign in on another Chromebook with the same username and password to bring everything along.';

  const profile = storage.get(`ta.profile.${account.handle}`, null)
    || storage.get(LEGACY_STATE, null)?.self
    || account;
  whoEl.style.display = '';
  avatarEl.innerHTML = avatarHTML(profile, { size: 38, status: profile?.status || 'online', showStatus: true });
  nameEl.textContent = profile?.displayName || account.displayName || 'Welcome back';
  handleEl.textContent = `@${account.handle}`;
}

function setBusy(busy, label) {
  unlockBtn.disabled = busy;
  screen.dataset.busy = busy ? '1' : '0';
  if (label) unlockLabel.textContent = label;
}

function showError(message) {
  errorEl.hidden = false;
  errorEl.replaceChildren(icon('warning', 15), el('span', { text: message }));
  errorEl.style.animation = 'none';
  requestAnimationFrame(() => { errorEl.style.animation = ''; });
}
function hideError() {
  errorEl.hidden = true;
}

/* --------------------------------- submit --------------------------------- */

async function submit() {
  const account = readAccount();
  const password = passwordEl.value;

  if (mode === 'unlock' && account) {
    if (!password) return showError('Enter your password.');
    setBusy(true, 'Unlocking…');
    const ok = await checkPassword(account, password).catch(() => false);
    if (!ok) {
      setBusy(false, 'Unlock');
      showError('That password does not match this account.');
      passwordEl.select();
      return;
    }
    setSessionPassword(password);
    useAccountNamespace(account.handle);
    claimHandle(account.handle, { displayName: account.displayName });
    const restored = load();
    hideLock();
    if (!restored) {
      // account exists but its local copy is gone — try the cloud before starting fresh
      const sealed = await fetchVaultFromCloud(account.handle).catch(() => null);
      if (sealed) {
        try {
          const snapshot = await openSealed(password, sealed);
          restoreSnapshot(snapshot);
          load();
          toast('Your data was restored from the encrypted backup', 'ok');
        } catch { /* fall through */ }
      }
    }
    setBusy(false, 'Unlock');
    onUnlocked?.(account.handle);
    return;
  }

  if (mode === 'secure') {
    const legacy = storage.get(LEGACY_STATE, null);
    const handle = legacy?.self?.handle;
    const problem = passwordProblem(password);
    if (problem) return showError(problem);
    if (password !== password2El.value) return showError('Those passwords do not match.');
    setBusy(true, 'Locking…');
    try {
      await registerAccount({ handle, displayName: legacy?.self?.displayName || handle, password });
      setSessionPassword(password);
      useAccountNamespace(handle);
      applySnapshot({ ...legacy, v: 3 }, { replaceLocal: false });
      persistNow();
      storage.remove(LEGACY_STATE);
      hideLock();
      onUnlocked?.(handle);
      saveVaultToCloud(password).catch(() => {});
    } catch (err) {
      showError(err.message || 'Could not save that password.');
    } finally {
      setBusy(false, 'Lock my account');
    }
    return;
  }

  // sign in on a new device
  const handle = String(userEl.value || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,20}$/.test(handle)) return showError('Enter the username you use on your other device.');
  if (!password) return showError('Enter your password.');
  if (isClaimedLocally(handle) && !readAccount()) {
    // someone else's account on this device — still allowed, it is their password that proves it
  }
  setBusy(true, 'Looking for your account…');
  try {
    const sealed = await fetchVaultFromCloud(handle);
    if (!sealed) {
      setBusy(false, 'Sign in');
      showError(`No account called @${handle} answered. Check the spelling — or create a new account.`);
      return;
    }
    unlockLabel.textContent = 'Decrypting your data…';
    let snapshot;
    try {
      snapshot = await openSealed(password, sealed);
    } catch {
      setBusy(false, 'Sign in');
      showError('That password does not open this account.');
      passwordEl.select();
      return;
    }
    setSessionPassword(password);
    await registerAccount({ handle, displayName: snapshot.self?.displayName || handle, password });
    useAccountNamespace(handle);
    restoreSnapshot(snapshot);
    load();
    hideLock();
    onUnlocked?.(handle);
    toast(`Welcome back, ${snapshot.self?.displayName || handle}`, 'ok');
    // re-seal with this device's fresh salt
    saveVaultToCloud(password).catch(() => {});
  } catch (err) {
    setBusy(false, 'Sign in');
    showError(err.message || 'Could not sign in.');
  }
}

/** Suggest an unused username for the signup form. */
export function availableSuggestions(handle) {
  return suggestHandle(handle);
}

export function startNetworkForLock() {
  try {
    net.init({ profile: { id: 'lock', displayName: 'TalkingApp', handle: 'lock', avatar: null }, communities: [] });
    net.start();
  } catch {}
}

export { localVault };
