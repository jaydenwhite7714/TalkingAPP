// TalkingApp — local accounts: usernames, passwords, encryption keys
//
// There is no server, so an account is two things:
//   1. a *local* record on this device holding a salted PBKDF2 verifier of the
//      password (never the password itself), and
//   2. an *encrypted* copy of your data ("the vault") that travels through the
//      relay, so the same username + password brings everything back on any
//      other Chromebook.
//
// The vault key is derived from the password, which is also how a fresh device
// proves the password is right: AES-GCM will not decrypt with the wrong one.

import { storage } from './util.js';

export const ACCOUNT_KEY = 'ta.account.v1';
export const CLAIMS_KEY = 'ta.claims.v1';
export const VAULT_KEY = 'ta.vault.v1';
export const ITERATIONS = 150_000;

const enc = new TextEncoder();
const subtle = () => globalThis.crypto?.subtle;

/* --------------------------------- base64 -------------------------------- */

export function bytesToB64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < arr.length; i += step) {
    bin += String.fromCharCode.apply(null, arr.subarray(i, i + step));
  }
  return btoa(bin);
}

export function b64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* -------------------------------- password -------------------------------- */

export function passwordProblem(password) {
  const p = String(password || '');
  if (p.length < 6) return 'Use at least 6 characters.';
  if (p.length > 128) return 'That password is too long (128 characters max).';
  if (/^\s+$/.test(p)) return 'A password cannot be only spaces.';
  return null;
}

export function passwordStrength(password) {
  const p = String(password || '');
  if (!p) return { score: 0, label: 'Empty', hint: 'Pick something you will remember.' };
  let score = 0;
  if (p.length >= 6) score++;
  if (p.length >= 10) score++;
  if (p.length >= 14) score++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) score++;
  if (/[0-9]/.test(p)) score++;
  if (/[^A-Za-z0-9]/.test(p)) score++;
  score = Math.min(4, Math.round(score * 0.72));
  const labels = ['Very weak', 'Weak', 'Okay', 'Good', 'Strong'];
  const hints = [
    'Try at least 6 characters.',
    'Add a few more characters.',
    'Add a number or a capital letter.',
    'Nice — that will do the job.',
    'Great password. Keep it safe.',
  ];
  return { score, label: labels[score], hint: hints[score] };
}

/* --------------------------------- crypto -------------------------------- */

function requireCrypto() {
  if (!subtle()) throw new Error('This browser cannot encrypt data (needs HTTPS or localhost).');
  return subtle();
}

async function pbkdf2Bits(password, saltBytes, iterations) {
  const s = requireCrypto();
  const keyMaterial = await s.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
  const bits = await s.deriveBits({ name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, keyMaterial, 256);
  return new Uint8Array(bits);
}

export function randomSalt() {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return bytesToB64(salt);
}

/** Salt + verifier for a password. The password itself is never stored. */
export async function makeCredentials(password, iterations = ITERATIONS) {
  const salt = randomSalt();
  const verifier = bytesToB64(await pbkdf2Bits(password, b64ToBytes(salt), iterations));
  return { salt, verifier, iterations };
}

function equalStrings(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export async function checkPassword(account, password) {
  if (!account?.salt || !account?.verifier) return false;
  try {
    const candidate = bytesToB64(await pbkdf2Bits(password, b64ToBytes(account.salt), account.iterations || ITERATIONS));
    return equalStrings(candidate, account.verifier);
  } catch {
    return false;
  }
}

/** AES-GCM key used to seal/unseal the cloud copy of your data. */
export async function deriveVaultKey(password, salt, iterations = ITERATIONS) {
  const s = requireCrypto();
  const saltBytes = b64ToBytes(salt);
  const material = await s.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
  return s.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(key, value) {
  const s = requireCrypto();
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const data = enc.encode(JSON.stringify(value));
  const cipher = await s.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(cipher)) };
}

export async function decryptJson(key, sealed) {
  const s = requireCrypto();
  const plain = await s.decrypt({ name: 'AES-GCM', iv: b64ToBytes(sealed.iv) }, key, b64ToBytes(sealed.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ------------------------------- the account ------------------------------ */

export function readAccount() {
  const acc = storage.get(ACCOUNT_KEY, null);
  if (!acc?.handle || !acc?.verifier) return null;
  return acc;
}

export function writeAccount(account) {
  storage.set(ACCOUNT_KEY, account);
  claimHandle(account.handle, { displayName: account.displayName });
  return account;
}

export function clearAccount() {
  storage.remove(ACCOUNT_KEY);
}

export async function registerAccount({ handle, displayName, password }) {
  const problem = passwordProblem(password);
  if (problem) return { ok: false, error: problem };
  const creds = await makeCredentials(password);
  const account = {
    v: 1,
    handle: String(handle).toLowerCase(),
    displayName,
    salt: creds.salt,
    verifier: creds.verifier,
    iterations: creds.iterations,
    createdAt: Date.now(),
    savedAt: Date.now(),
  };
  writeAccount(account);
  return { ok: true, account };
}

export async function changeAccountPassword(password, nextPassword) {
  const account = readAccount();
  if (!account) return { ok: false, error: 'No account on this device.' };
  if (!(await checkPassword(account, password))) return { ok: false, error: 'Current password is incorrect.' };
  const problem = passwordProblem(nextPassword);
  if (problem) return { ok: false, error: problem };
  const creds = await makeCredentials(nextPassword, account.iterations);
  const updated = { ...account, salt: creds.salt, verifier: creds.verifier, savedAt: Date.now() };
  writeAccount(updated);
  return { ok: true, account: updated };
}

/* --------------------------- username reservations ------------------------ */

/** Usernames already claimed on this device — they cannot be reused. */
export function readClaims() {
  return storage.get(CLAIMS_KEY, {}) || {};
}

export function claimHandle(handle, info = {}) {
  const key = String(handle || '').toLowerCase();
  if (!key) return;
  const claims = readClaims();
  claims[key] = { ...(claims[key] || {}), handle: key, ...info, lastSeen: Date.now() };
  storage.set(CLAIMS_KEY, claims);
}

export function isClaimedLocally(handle) {
  const key = String(handle || '').toLowerCase();
  if (!key) return false;
  if (readAccount()?.handle === key) return true;
  return Boolean(readClaims()[key]);
}

export function claimedHandles() {
  return Object.keys(readClaims());
}

/** Suggest a free variant of a taken username (nova → nova2, nova_2 …). */
export function suggestHandle(handle, taken = []) {
  const base = String(handle || 'you').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 16) || 'you';
  const blocked = new Set([...taken.map((t) => String(t).toLowerCase()), ...claimedHandles()]);
  for (const suffix of ['2', '3', '7', '_', 'x', '2026', '99', 'o', '1']) {
    const candidate = `${base}${suffix}`.slice(0, 20);
    if (!blocked.has(candidate)) return candidate;
  }
  return `${base}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 20);
}
