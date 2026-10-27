// TalkingApp — the unlocked session (in memory only)
//
// The vault is encrypted with your password, so keeping the password for this
// tab is what lets the app re-seal an updated cloud copy later. It lives in a
// module variable — never in localStorage — and disappears when the tab closes.

let password = null;
let unlockedAt = 0;

export function setSessionPassword(value) {
  password = typeof value === 'string' && value ? value : null;
  unlockedAt = password ? Date.now() : 0;
}

export function sessionPassword() {
  return password;
}

export function clearSessionPassword() {
  password = null;
  unlockedAt = 0;
}

export function sessionAge() {
  return unlockedAt ? Date.now() - unlockedAt : 0;
}
