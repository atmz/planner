// Bootstrap: pick backend (mock or Google), sign-in / first-run screens, header, view rendering,
// keyboard shortcuts, quick capture, background refresh.
import * as P from './periods.js';
import { CLIENT_ID, SPREADSHEET_ID } from './config.js';
import { store, openTasks, reviewDue } from './store.js';
import * as auth from './auth.js';
import * as cal from './calendar.js';
import { sheetBackend, createSpreadsheet } from './sheet.js';
import { mockBackend, mockCalendarProvider } from './mock.js';
import { parseHash, periodHash, HORIZONS, onRoute } from './router.js';
import { h, toast } from './ui/components.js';
import { enableDragAndDrop } from './ui/task.js';
import { openCapture } from './ui/event.js';
import * as day from './ui/day.js';
import * as week from './ui/week.js';
import * as month from './ui/month.js';
import * as quarter from './ui/quarter.js';
import * as year from './ui/year.js';
import * as todos from './ui/todos.js';
import * as trips from './ui/trips.js';
import * as goals from './ui/goals.js';
import * as projects from './ui/projects.js';
import * as lists from './ui/lists.js';
import * as inbox from './ui/inbox.js';
import * as review from './ui/review.js';
import * as settings from './ui/settings.js';

const VIEWS = {
  day: day.render, week: week.render, month: month.render, quarter: quarter.render, year: year.render,
  todos: todos.render, trips: trips.renderList, trip: trips.renderTrip,
  goals: goals.renderList, goal: goals.renderGoal, projects: projects.renderBoard, project: projects.renderProject,
  lists: lists.renderLists, list: lists.renderList, inbox: inbox.renderInbox, someday: inbox.renderSomeday,
  review: review.render, settings: settings.render,
};
const NAV = [['todos', 'Todos'], ['trips', 'Trips'], ['goals', 'Goals'], ['projects', 'Projects'], ['lists', 'Lists'], ['inbox', 'Inbox']];

const isMock = new URLSearchParams(location.search).has('mock') || window.PLANNER_DEMO === true;
const SHEET_KEY = 'planner-spreadsheet-id';
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const spreadsheetId = () => SPREADSHEET_ID || lsGet(SHEET_KEY) || '';

const root = document.getElementById('app');

// Zen mode: a calmer planner (CSS hides the rail, meetings and most chips). Remembered per device.
const ZEN_KEY = 'planner-zen';
function setZen(on) {
  document.documentElement.classList.toggle('zen', on);
  try { on ? localStorage.setItem(ZEN_KEY, '1') : localStorage.removeItem(ZEN_KEY); } catch { /* ignore */ }
  renderHeader();
}
document.documentElement.classList.toggle('zen', lsGet(ZEN_KEY) === '1');
let route = parseHash();
let dirty = false;

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  if (isMock) {
    document.documentElement.classList.add('mock');
    cal.setProvider(mockCalendarProvider());
    await start(mockBackend());
    return;
  }
  if (!CLIENT_ID) return screen(setupScreen());
  try { await auth.init(CLIENT_ID); }
  catch (e) { return screen(messageScreen('Couldn’t load Google sign-in', e.message, h('button', { onclick: () => location.reload() }, 'Retry'))); }
  auth.onChange(signedIn => {
    if (!store.loaded) return;
    if (signedIn) { store.flush(); refresh(); } else renderHeader();
  });
  // Token refresh needs a user action (it may open a popup), so piggyback on clicks and keys.
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { auth.ensureFresh().catch(() => store.setStatus('auth')); }, { capture: true });
  screen(signInScreen());
}

async function afterSignIn() {
  if (!spreadsheetId()) return screen(firstRunScreen());
  cal.setProvider(cal.googleProvider(auth.api));
  await start(sheetBackend(auth.api, spreadsheetId()));
}

async function start(backend) {
  screen(messageScreen('Opening your planner…', ''));
  try { await store.init(backend); }
  catch (e) {
    console.error(e);
    return screen(messageScreen('Couldn’t load the planner', e.message, h('button', { onclick: () => start(backend) }, 'Retry')));
  }
  root.replaceChildren(h('header#header'), h('main#main'), h('button#fab', { type: 'button', 'aria-label': 'Quick capture (n)', title: 'Quick capture (n)', onclick: () => openCapture() }, '+'));
  enableDragAndDrop(root);
  store.subscribe(kind => {
    if (kind === 'status') return renderStatus();
    scheduleRender();
  });
  onRoute(r => { route = r; render(); window.scrollTo(0, 0); });
  document.addEventListener('keydown', onKey);
  root.addEventListener('focusout', () => setTimeout(() => { if (dirty && !typing()) render(); }, 150));
  window.addEventListener('focus', () => refresh());
  window.addEventListener('online', () => store.flush());
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60_000);
  matchMedia('screen and (max-width: 760px)').addEventListener('change', () => render());
  render();
}

async function refresh() {
  if (!store.loaded) return;
  try { cal.invalidate(); await store.refresh(); }
  catch (e) { console.warn('[planner] refresh failed', e); if (e.auth) store.setStatus('auth', e); }
}

// ---------------------------------------------------------------------------
// Screens

function screen(content) { root.replaceChildren(h('div.screen', content)); }

function messageScreen(title, text, ...actions) {
  return h('div.card.center', h('h1.brand', 'Planner'), h('h2', title), text ? h('p', text) : null, h('div.actions', actions));
}

function setupScreen() {
  return messageScreen('Almost there',
    'Add your Google OAuth client ID to js/config.js (see PLAN.md §2). Meanwhile you can try the planner with sample data.',
    h('a.button.primary', { href: '?mock=1' }, 'Open with sample data'));
}

function signInScreen() {
  const btn = h('button.primary', { type: 'button', onclick: async () => {
    btn.disabled = true;
    try { await auth.signIn(); await afterSignIn(); }
    catch (e) { btn.disabled = false; toast('Sign-in failed: ' + e.message); }
  } }, 'Sign in with Google');
  return messageScreen('Your paper planner, online', 'Sign in to open your planner sheet and calendar.', btn,
    h('a.button', { href: '?mock=1' }, 'Try with sample data'));
}

function firstRunScreen() {
  const out = h('div');
  const create = h('button.primary', { type: 'button', onclick: async () => {
    create.disabled = true;
    try {
      const id = await createSpreadsheet(auth.api);
      lsSet(SHEET_KEY, id);
      out.replaceChildren(h('p', 'Created! Paste this into js/config.js as SPREADSHEET_ID, then share the sheet as Editor with anyone else who uses the planner:'),
        h('pre.code', id), h('button.primary', { type: 'button', onclick: afterSignIn }, 'Open planner'));
    } catch (e) { create.disabled = false; toast('Couldn’t create the sheet: ' + e.message); }
  } }, 'Create planner sheet');
  const paste = h('input', { type: 'text', placeholder: 'or paste an existing spreadsheet ID' });
  out.append(create, h('div.or', paste, h('button', { type: 'button', onclick: () => { if (paste.value.trim()) { lsSet(SHEET_KEY, paste.value.trim()); afterSignIn(); } } }, 'Use this sheet')));
  return messageScreen('Set up your planner', 'No planner sheet yet. Create one in your Google Drive (a spreadsheet called “Planner”).', out);
}

// ---------------------------------------------------------------------------
// Header

function viewPeriod() { return HORIZONS.includes(route.view) ? route.param : null; }

function renderHeader() {
  const header = document.getElementById('header');
  if (!header) return;
  const period = viewPeriod();
  const horizon = period ? route.view : null;
  const td = P.today();
  const target = t => (period ? P.convert(period, t) : P.periodOf(t, td));
  const inboxCount = openTasks(t => !t.when && !t.list_id).length;

  const nav = h('nav.horizons', { 'aria-label': 'Horizon' }, HORIZONS.map(t =>
    h('a.ribbon', { href: periodHash(target(t)), class: t === horizon ? 'on' : '', title: `${t[0].toUpperCase() + t.slice(1)} (${t[0]})` }, t[0].toUpperCase() + t.slice(1))));

  const stepper = period ? h('div.stepper.period-nav',
    h('a.icon', { href: periodHash(P.prev(period)), 'aria-label': 'Previous (←)', title: 'Previous (←)' }, '‹'),
    h('a.today', { href: periodHash(P.periodOf(horizon, td)), title: 'Today (t)' }, 'Today'),
    h('a.icon', { href: periodHash(P.next(period)), 'aria-label': 'Next (→)', title: 'Next (→)' }, '›'),
    h('h1.period-label', P.label(period)),
    reviewBadge(period)) : h('div.period-nav', h('a.today', { href: periodHash(P.periodOf('week', td)) }, 'Today'));

  header.replaceChildren(
    h('div.bar',
      h('a.brand', { href: '#/', title: 'Planner' }, 'Planner'),
      nav, stepper,
      h('nav.links', { 'aria-label': 'Pages' }, NAV.map(([v, label]) =>
        h('a', { href: `#/${v}`, class: route.view === v || route.view === v.replace(/s$/, '') ? 'on' : '', dataset: v === 'inbox' ? { dropWhen: '' } : {} },
          label, v === 'inbox' && inboxCount ? h('span.count', inboxCount) : null)),
        h('a', { href: '#/someday', class: route.view === 'someday' ? 'on' : '', dataset: { dropWhen: 'someday' } }, 'Someday')),
      h('div.tools',
        h('span#sync'),
        h('button.chip.zen-toggle', { type: 'button', class: document.documentElement.classList.contains('zen') ? 'on' : '', 'aria-pressed': String(document.documentElement.classList.contains('zen')), title: 'Zen mode: hide the busy bits (z)', onclick: () => setZen(!document.documentElement.classList.contains('zen')) }, 'Zen'),
        h('a.icon', { href: '#/settings', 'aria-label': 'Settings', title: 'Settings' }, '⚙'),
        isMock ? h('span.chip.mock-chip', { title: 'Sample data — changes stay in this browser' }, 'sample')
          : h('button.icon', { type: 'button', 'aria-label': 'Sign out', title: 'Sign out', onclick: () => signOut() }, '⏻'))));
  renderStatus();
}

function reviewBadge(period) {
  const t = P.precision(period);
  if (t === 'day') return null;
  const cur = P.periodOf(t, P.today());
  const prev = P.prev(cur);
  if (reviewDue(prev)) return h('a.badge', { href: `#/review/${prev}`, title: 'This period ended without a review' }, `Review ${P.relLabel(prev).toLowerCase()} due`);
  return null;
}

function renderStatus() {
  const el = document.getElementById('sync');
  if (!el) return;
  const n = store.pending();
  const s = store.status;
  const nf = store.failed().length;
  const text = { idle: '', saving: 'Saving…', saved: 'Saved', failed: nf ? `${nf} change${nf > 1 ? 's' : ''} couldn’t be saved` : `Save failed — retrying (${n})`, offline: `Offline — ${n} queued`, auth: 'Signed out' }[s] ?? '';
  el.className = `sync ${s}`;
  el.title = store.lastError?.message || '';
  el.replaceChildren(text);
  if (nf) {
    el.append(' ', h('button.link', { type: 'button', title: store.lastError?.message || '', onclick: () => store.retryFailed() }, 'Retry'),
      ' · ', h('button.link', { type: 'button', onclick: () => store.discardFailed() }, 'Discard'));
  }
  if (s === 'auth' && !isMock) {
    el.append(' ', h('button.link', { type: 'button', onclick: async () => {
      try { await auth.signIn(); store.flush(); refresh(); } catch (e) { toast('Sign-in failed: ' + e.message); }
    } }, 'Sign in'));
  }
}

function signOut(force = false) {
  if (store.pending() && !force) {
    toast(`${store.pending()} change(s) haven’t saved yet.`, { action: 'Sign out anyway', onAction: () => signOut(true) });
    return;
  }
  auth.signOut();
  location.reload();
}

// ---------------------------------------------------------------------------
// Rendering

function typing() {
  const a = document.activeElement;
  // Add-lines commit on Enter and are restored after a render, so they don't block one.
  if (a?.matches?.('input.add-line')) return false;
  return a && document.getElementById('main')?.contains(a) && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(a.type)));
}

let raf = 0;
function scheduleRender() {
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; if (typing()) { dirty = true; renderHeader(); } else render(); });
}

function render() {
  dirty = false;
  renderHeader();
  const main = document.getElementById('main');
  if (!main) return;
  const fn = VIEWS[route.view];
  const y = window.scrollY;
  const focusedAdd = document.activeElement?.matches?.('input.add-line') ? document.activeElement.placeholder : null;
  main.className = `view-${route.view}`;
  try {
    main.replaceChildren(fn ? fn(route.param, route.query) : h('div.page', h('h2', 'Not found'), h('a', { href: '#/' }, 'Back to this week')));
  } catch (e) {
    console.error(e);
    main.replaceChildren(h('div.page', h('h2', 'Something went wrong'), h('pre.code', e.stack || e.message)));
  }
  window.scrollTo(0, y);
  if (focusedAdd) main.querySelector(`input.add-line[placeholder="${CSS.escape(focusedAdd)}"]`)?.focus();
}

// ---------------------------------------------------------------------------
// Keyboard

function onKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  if (document.querySelector('dialog[open]')) return;
  const period = viewPeriod();
  const go = hash => { e.preventDefault(); location.hash = hash; };
  const horizon = { d: 'day', w: 'week', m: 'month', q: 'quarter', y: 'year' }[e.key];
  if (e.key === 'n') { e.preventDefault(); openCapture(); }
  else if (e.key === 'e') { e.preventDefault(); openCapture({ mode: 'event' }); }
  else if (e.key === 'z') { e.preventDefault(); setZen(!document.documentElement.classList.contains('zen')); }
  else if (e.key === 'ArrowLeft' && period) go(periodHash(P.prev(period)));
  else if (e.key === 'ArrowRight' && period) go(periodHash(P.next(period)));
  else if (e.key === 't') go(periodHash(P.periodOf(period ? route.view : 'week', P.today())));
  else if (horizon) go(periodHash(period ? P.convert(period, horizon) : P.periodOf(horizon, P.today())));
  else if (e.key === 'g') go('#/goals');
  else if (e.key === 'p') go('#/projects');
  else if (e.key === 'i') go('#/inbox');
}

boot();
