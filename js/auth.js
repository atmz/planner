// Google Identity Services token client. The token lives in memory only.
// GIS token requests open a popup, which browsers only allow during a user action, so the
// token is requested only from sign-in clicks and from ensureFresh() (called on clicks/keys).
// Background work (timers, refreshes, the write queue) never opens a popup: it gets an auth
// error instead and waits for the next user action.
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
const REQUEST_TIMEOUT = 120_000;
const REFRESH_MARGIN = 5 * 60_000;

let tokenClient = null;
let token = null;
let expiresAt = 0;
let hadSession = false;
let inflight = null;
let settle = null; // { resolve, reject } of the current request
const listeners = new Set();

export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach(fn => fn(isSignedIn()));
export const isSignedIn = () => !!token && Date.now() < expiresAt;
const authError = msg => Object.assign(new Error(msg), { auth: true });

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.append(s);
  });
}

function onToken(resp) {
  const s = settle; settle = null; inflight = null;
  if (resp.error) { s?.reject(authError(resp.error_description || resp.error)); return; }
  if (google.accounts.oauth2.hasGrantedAllScopes && !google.accounts.oauth2.hasGrantedAllScopes(resp, ...SCOPES)) {
    s?.reject(authError('Please allow access to both Google Sheets and Google Calendar.'));
    return;
  }
  token = resp.access_token;
  expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60_000;
  hadSession = true;
  emit();
  s?.resolve(token);
}
function onError(err) {
  const s = settle; settle = null; inflight = null;
  s?.reject(authError(err?.message || err?.type || 'Sign-in was interrupted'));
}

export async function init(id) {
  await loadGis();
  tokenClient = google.accounts.oauth2.initTokenClient({ client_id: id, scope: SCOPES.join(' '), callback: onToken, error_callback: onError });
}

function request(prompt) {
  if (inflight) return inflight;
  inflight = new Promise((resolve, reject) => {
    const timer = setTimeout(() => onError({ message: 'Sign-in timed out' }), REQUEST_TIMEOUT);
    settle = { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } };
    tokenClient.requestAccessToken(prompt === undefined ? {} : { prompt });
  });
  return inflight;
}

/** Interactive sign-in — call only from a click handler. */
export const signIn = () => request();

/**
 * Call from user actions (pointerdown / keydown): if this session has signed in and the token has
 * expired or is about to, refresh it silently while the browser still allows the popup.
 */
export function ensureFresh() {
  if (!tokenClient || !hadSession || inflight) return inflight || Promise.resolve(token);
  if (token && expiresAt - Date.now() > REFRESH_MARGIN) return Promise.resolve(token);
  return request('').catch(e => { emit(); throw e; });
}

/** The current token, or an auth error. Never opens a popup. */
export async function getToken() {
  if (isSignedIn()) return token;
  throw authError('Signed out — sign in again to keep saving.');
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null;
  expiresAt = 0;
  hadSession = false;
  emit();
}

/** Test hook from PLAN §9: simulate an expired token. */
export function expireToken() { expiresAt = 0; }

/** fetch + bearer token + JSON. Errors carry .auth (sign in again), .offline, or .status. */
export async function api(url, { method = 'GET', body } = {}) {
  const tok = await getToken();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw Object.assign(new Error('Network unavailable'), { offline: true, cause: e });
  }
  if (res.status === 401) {
    token = null; expiresAt = 0;
    emit();
    throw Object.assign(authError('Your Google session expired — sign in again.'), { status: 401 });
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); msg = j.error?.message || msg; } catch { /* not JSON */ }
    if (res.status === 403 && /permission/i.test(msg)) msg = 'You don’t have edit access to this sheet. Ask its owner to share it with you as Editor.';
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}
