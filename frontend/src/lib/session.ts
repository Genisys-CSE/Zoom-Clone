// Browser session: which demo user is signed in (user1 / user2).
// localStorage = per-browser, so two browsers (or normal + incognito)
// can be two different users — exactly what two-user testing needs.
const KEY = "zoom-clone-user";

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null; // prerender / private mode
  }
}

export function getSessionName(): string | null {
  return storage()?.getItem(KEY) ?? null;
}

export function setSessionName(name: string) {
  storage()?.setItem(KEY, name);
  notifyAuth();
}

export function clearSession() {
  storage()?.removeItem(KEY);
  notifyAuth();
}

const AUTH_EVENT = "zoom-clone-auth";

/** Tell every mounted component the identity changed (same-tab
 * localStorage writes fire no event on their own). */
export function notifyAuth() {
  try {
    window.dispatchEvent(new Event(AUTH_EVENT));
  } catch { /* prerender */ }
}

/** Subscribe to sign in/out. Returns an unsubscribe function. */
export function onAuthChange(cb: () => void): () => void {
  window.addEventListener(AUTH_EVENT, cb);
  return () => window.removeEventListener(AUTH_EVENT, cb);
}
