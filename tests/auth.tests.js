import { suite, eq, ok } from './harness.js';

// Minimal Google Identity Services stub.
const calls = [];
let config = null;
const client = { requestAccessToken(opts) { calls.push(opts); } };
globalThis.window ??= globalThis;
globalThis.google = { accounts: { oauth2: { initTokenClient(cfg) { config = cfg; return client; }, revoke() {}, hasGrantedAllScopes: () => true } } };
const auth = await import('../js/auth.js');
const respond = resp => (client.callback || config.callback)(resp);

suite('auth: token handling', t => {
  t('init passes an error_callback to GIS', async () => {
    await auth.init('cid');
    ok(typeof config.error_callback === 'function');
  });
  t('getToken never opens a popup on its own (no token → auth error)', async () => {
    calls.length = 0;
    let err;
    try { await auth.getToken(); } catch (e) { err = e; }
    ok(err && err.auth, 'auth error');
    eq(calls.length, 0, 'no requestAccessToken');
  });
  t('signIn resolves when GIS returns a token', async () => {
    calls.length = 0;
    const p = auth.signIn();
    eq(calls.length, 1);
    respond({ access_token: 'tok', expires_in: 3600 });
    eq(await p, 'tok');
    eq(await auth.getToken(), 'tok');
  });
  t('a GIS popup error settles the pending request', async () => {
    const p = auth.signIn();
    config.error_callback({ type: 'popup_closed' });
    let err; try { await p; } catch (e) { err = e; }
    ok(err && err.auth);
  });
  t('ensureFresh (called from a user action) refreshes silently when the token is near expiry', async () => {
    const p = auth.signIn(); respond({ access_token: 'tok2', expires_in: 3600 }); await p;
    calls.length = 0;
    auth.ensureFresh();
    eq(calls.length, 0, 'fresh token: nothing to do');
    auth.expireToken();
    const r = auth.ensureFresh();
    eq(calls.length, 1);
    eq(calls[0], { prompt: '' });
    respond({ access_token: 'tok3', expires_in: 3600 });
    await r;
    eq(await auth.getToken(), 'tok3');
  });
  t('a 401 marks the token expired without opening a popup', async () => {
    calls.length = 0;
    globalThis.fetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized', json: async () => ({}) });
    let err; try { await auth.api('https://x'); } catch (e) { err = e; }
    ok(err && err.auth);
    eq(calls.length, 0);
    ok(!auth.isSignedIn());
  });
  t('a 403 permission error is not an auth error', async () => {
    const p = auth.signIn(); respond({ access_token: 't', expires_in: 3600 }); await p;
    globalThis.fetch = async () => ({ ok: false, status: 403, statusText: 'Forbidden', json: async () => ({ error: { message: 'The caller does not have permission' } }) });
    let err; try { await auth.api('https://x'); } catch (e) { err = e; }
    eq([err.status, !!err.auth], [403, false]);
  });
});
