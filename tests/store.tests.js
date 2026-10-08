import { suite, eq, ok } from './harness.js';
import { TAB_NAMES, TABS } from '../js/schema.js';

const mem = new Map();
globalThis.localStorage ??= { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), clear: () => mem.clear() };
const { store } = await import('../js/store.js');
const cal = await import('../js/calendar.js');

const clone = x => JSON.parse(JSON.stringify(x));
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
async function settle() { for (let i = 0; i < 50 && (store.pending() || store.status === 'saving'); i++) await tick(5); }

function fakeBackend({ queueKey = 'planner-queue:test', remote = {}, onAppend, onUpdate } = {}) {
  const db = Object.fromEntries(TAB_NAMES.map(t => [t, clone(remote[t] || [])]));
  let gate = null;
  return {
    queueKey, db,
    hold() { let release; gate = new Promise(r => { release = r; }); return () => release(); },
    async loadAll() { const snap = clone(db); if (gate) { const g = gate; gate = null; await g; } return snap; },
    async append(tab, rec, opts) { if (onAppend) await onAppend(tab, rec, opts); db[tab].push(clone(rec)); return rec; },
    async update(tab, key, patch, baseAt, full) {
      if (onUpdate) await onUpdate(tab, key, patch);
      const k = TABS[tab].key;
      const i = db[tab].findIndex(r => r[k] === key);
      if (i < 0) { db[tab].push({ ...full, ...patch }); return { ...full, ...patch }; }
      db[tab][i] = { ...db[tab][i], ...patch };
      return clone(db[tab][i]);
    },
  };
}

suite('store: write queue', t => {
  t('a write that lands during a refresh is not undone by the stale snapshot', async () => {
    localStorage.clear();
    const be = fakeBackend();
    await store.init(be);
    const release = be.hold();
    const refreshing = store.refresh();
    const rec = store.add('Tasks', { title: 'Added mid-refresh' });
    await settle();
    eq(be.db.Tasks.length, 1, 'saved to backend');
    release();
    await refreshing;
    ok(store.get('Tasks', rec.id), 'still visible after refresh');
  });
  t('a non-retryable failure is set aside and later writes still save', async () => {
    localStorage.clear();
    const be = fakeBackend({ onAppend: (tab, rec) => { if (rec.title === 'bad') throw Object.assign(new Error('Bad request'), { status: 400 }); } });
    await store.init(be);
    store.add('Tasks', { title: 'bad' });
    store.add('Tasks', { title: 'good' });
    await settle();
    eq(be.db.Tasks.map(r => r.title), ['good']);
    eq(store.failed().length, 1);
    eq(store.pending(), 0);
  });
  t('a 403 permission error is not treated as signed out', async () => {
    localStorage.clear();
    const be = fakeBackend({ onAppend: () => { throw Object.assign(new Error('The caller does not have permission'), { status: 403 }); } });
    await store.init(be);
    store.add('Tasks', { title: 'x' });
    await settle();
    ok(store.status !== 'auth', 'status ' + store.status);
    eq(store.failed().length, 1);
  });
  t('a retried append is flagged so the backend can check for a landed first attempt', async () => {
    localStorage.clear();
    const seen = [];
    let fail = true;
    const be = fakeBackend({ onAppend: (tab, rec, opts) => { seen.push(!!opts?.retry); if (fail) { fail = false; throw Object.assign(new Error('Network'), { offline: true }); } } });
    await store.init(be);
    store.add('Tasks', { title: 'flaky' });
    await settle();
    await store.flush();
    await settle();
    eq(seen, [false, true]);
    eq(be.db.Tasks.length, 1);
  });
  t('the persisted queue is per backend (sample data never flushes into the real sheet)', async () => {
    localStorage.clear();
    const mock = fakeBackend({ queueKey: 'planner-queue:mock', onAppend: () => { throw Object.assign(new Error('Offline'), { offline: true }); } });
    await store.init(mock);
    store.add('Tasks', { title: 'mock edit' });
    await settle();
    eq(store.pending(), 1, 'queued in mock mode');
    const sheet = fakeBackend({ queueKey: 'planner-queue:sheet:S' });
    await store.init(sheet);
    await settle();
    eq(sheet.db.Tasks.length, 0, 'not flushed into the sheet');
  });
  t('duplicate Periods rows are merged field by field on load', async () => {
    localStorage.clear();
    const be = fakeBackend({ remote: { Periods: [
      { period: '2026-W41', focus_1: 'Sam', notes: '', updated_at: '2026-10-07T09:00:00Z' },
      { period: '2026-W41', focus_1: '', notes: 'Jo', updated_at: '2026-10-07T09:01:00Z' },
    ] } });
    await store.init(be);
    const p = store.period('2026-W41');
    eq([p.focus_1, p.notes], ['Sam', 'Jo']);
  });
});

suite('calendar: cache', t => {
  t('after invalidate, events stay visible while refetching', async () => {
    localStorage.clear();
    await store.init(fakeBackend());
    cal.setProvider({
      async listCalendars() { return [{ id: 'primary', summary: 'Me' }]; },
      async listEvents() { return [{ id: 'e1', summary: 'Meet', start: { date: '2026-10-09' }, end: { date: '2026-10-10' } }]; },
    });
    cal.events('2026-10-01', '2026-10-31');
    await tick(10);
    eq(cal.events('2026-10-01', '2026-10-31').events.length, 1);
    cal.invalidate();
    eq(cal.events('2026-10-01', '2026-10-31').events.length, 1, 'stale events kept during refetch');
  });
});

suite('calendar: creating and editing events', t => {
  const calls = [];
  const provider = {
    async listCalendars() { return [{ id: 'primary', summary: 'Me', accessRole: 'owner', primary: true }, { id: 'hol', summary: 'Holidays', accessRole: 'reader' }, { id: 'fam', summary: 'Family', accessRole: 'writer' }]; },
    async listEvents() { return []; },
    async insert(cal, body) { calls.push(['insert', cal, body]); return { id: 'new1', ...body }; },
    async patch(cal, id, body) { calls.push(['patch', cal, id, body]); return { id, ...body }; },
    async remove(cal, id) { calls.push(['remove', cal, id]); },
  };
  t('eventBody: all-day ranges use an exclusive end date', () => {
    eq(cal.eventBody({ title: 'Ski', allDay: true, start: '2027-02-12', end: '2027-02-14' }), { summary: 'Ski', start: { date: '2027-02-12' }, end: { date: '2027-02-15' } });
  });
  t('eventBody: timed events carry local wall time and the time zone', () => {
    const b = cal.eventBody({ title: 'Party', allDay: false, start: '2026-10-10', end: '2026-10-11', startTime: '22:00', endTime: '01:00' });
    eq([b.start.dateTime, b.end.dateTime], ['2026-10-10T22:00:00', '2026-10-11T01:00:00']);
    ok(b.start.timeZone && b.end.timeZone);
  });
  t('writable calendars are owner/writer ones, primary first', async () => {
    cal.setProvider(provider);
    await cal.listCalendars();
    eq(cal.writableCalendars().map(c => c.id), ['primary', 'fam']);
  });
  t('create / update / delete go to the right calendar', async () => {
    calls.length = 0;
    const e = { title: 'Lunch', allDay: false, start: '2026-10-09', end: '2026-10-09', startTime: '13:00', endTime: '14:30' };
    await cal.createEvent('fam', e);
    await cal.updateEvent('fam', 'abc', { ...e, title: 'Lunch!' });
    await cal.deleteEvent('fam', 'abc');
    eq(calls.map(c => [c[0], c[1]]), [['insert', 'fam'], ['patch', 'fam'], ['remove', 'fam']]);
    eq(calls[1][3].summary, 'Lunch!');
  });
  t('normalise keeps what the editor needs', () => {
    const n = cal.normalise({ id: 'i_2026', recurringEventId: 'i', summary: 'Standup', location: 'Room 1', start: { dateTime: new Date(2026, 9, 9, 9, 30).toISOString() }, end: { dateTime: new Date(2026, 9, 9, 9, 45).toISOString() } }, 'fam');
    eq([n.calendarId, n.recurring, n.location, n.startTime, n.endTime, n.editable], ['fam', true, 'Room 1', '09:30', '09:45', true]);
    eq(cal.normalise({ id: 'h', summary: 'Holiday', start: { date: '2026-12-25' }, end: { date: '2026-12-26' } }, 'hol').editable, false);
  });
});

suite('store: habits', t => {
  t('toggleHabit ticks and unticks a day, saving one log row', async () => {
    localStorage.clear();
    const be = fakeBackend();
    await store.init(be);
    const { toggleHabit, habitLog } = await import('../js/store.js');
    const h = store.add('Habits', { title: 'No alcohol', schedule: 'daily' });
    toggleHabit(h.id, '2026-10-08');
    ok(habitLog().has(`${h.id}|2026-10-08`));
    await settle();
    toggleHabit(h.id, '2026-10-08');
    ok(!habitLog().has(`${h.id}|2026-10-08`));
    await settle();
    eq(be.db.HabitLog.length, 1);
    eq([be.db.HabitLog[0].key, be.db.HabitLog[0].done], [`${h.id}|2026-10-08`, false]);
  });
  t('habits() lists active habits in order', async () => {
    const { habits } = await import('../js/store.js');
    store.add('Habits', { title: 'B', order: 2 });
    store.add('Habits', { title: 'Old', order: 0, archived: true });
    store.add('Habits', { title: 'A', order: 1 });
    eq(habits().map(h => h.title).filter(x => x !== 'No alcohol'), ['A', 'B']);
  });
});
