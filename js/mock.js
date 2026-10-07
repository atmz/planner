// Offline dev mode (?mock=1): a fake backend + fake calendars, with data spread across a year
// relative to today. Edits persist in localStorage until "Reset mock data".
import * as P from './periods.js';
import { TABS, TAB_NAMES, newRecord, DEFAULT_SETTINGS } from './schema.js';

const KEY = 'planner-mock-v2';
const EV_KEY = 'planner-mock-events-v2';
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* ignore */ } };
const delay = (ms = 60) => new Promise(r => setTimeout(r, ms));
const clone = x => JSON.parse(JSON.stringify(x));

export const MOCK_QUEUE_KEY = 'planner-queue:mock';
export function resetMock() { lsSet(KEY, null); lsSet(EV_KEY, null); lsSet(MOCK_QUEUE_KEY, null); }

// ---------------------------------------------------------------------------
// Data

function generate(T = P.today()) {
  const db = Object.fromEntries(TAB_NAMES.map(t => [t, []]));
  const add = (tab, f) => { const r = newRecord(tab, f); db[tab].push(r); return r; };
  const d = n => P.addDays(T, n);
  const week = P.periodOf('week', T), month = P.periodOf('month', T), quarter = P.periodOf('quarter', T), year = P.periodOf('year', T);

  const [work, home, family, personal] = [
    ['Work', '#3d6b9e'], ['Home', '#b0703a'], ['Family', '#8a4f8f'], ['Personal', '#4c8a5a'],
  ].map(([name, color], i) => add('Areas', { name, color, order: i }));

  // Goals cascade: year → quarter → month
  const gFit = add('Goals', { title: 'Run a sub-55 10k', when: year, area_id: personal.id, why: 'Feel strong at 45', measure: 'Race result', status: 'active', progress: 40, order: 1 });
  const gReno = add('Goals', { title: 'Finish the house renovation', when: year, area_id: home.id, why: 'Stop living in a building site', measure: 'Kitchen, bathroom and garden done', status: 'active', order: 2 });
  const gWork = add('Goals', { title: 'Three steady consulting clients', when: year, area_id: work.id, status: 'active', progress: 66, order: 3 });
  const gRun = add('Goals', { title: 'Run three times a week', when: quarter, area_id: personal.id, parent_id: gFit.id, status: 'active', progress: 50, order: 1 });
  const gKitchen = add('Goals', { title: 'Kitchen usable by Christmas', when: quarter, area_id: home.id, parent_id: gReno.id, status: 'active', order: 2 });
  const gTiles = add('Goals', { title: 'Choose tiles and book the tiler', when: month, area_id: home.id, parent_id: gKitchen.id, status: 'active', order: 1 });
  add('Goals', { title: 'Weekly long run ≥ 8 km', when: month, area_id: personal.id, parent_id: gRun.id, status: 'active', progress: 25, order: 2 });
  add('Goals', { title: 'Read 12 books', when: year, area_id: personal.id, status: 'paused', progress: 30, order: 4 });

  // Projects
  const pKitchen = add('Projects', { title: 'Kitchen renovation', area_id: home.id, goal_id: gKitchen.id, status: 'active', target: P.next(month), order: 1 });
  const pSite = add('Projects', { title: 'Website refresh', area_id: work.id, goal_id: gWork.id, status: 'active', target: quarter, order: 2 });
  const pTax = add('Projects', { title: 'Self-assessment tax return', area_id: work.id, status: 'waiting', target: P.next(quarter), order: 3, notes: 'Waiting on P60 from accountant' });
  const pShed = add('Projects', { title: 'Garden shed', area_id: home.id, goal_id: gReno.id, status: 'someday', order: 4 });
  add('Projects', { title: 'New laptop setup', area_id: work.id, status: 'done', order: 5, done_at: new Date(Date.now() - 864e5 * 20).toISOString() });
  add('Projects', { title: 'Family photo book', area_id: family.id, status: 'on_hold', order: 6 });

  // Trips — one spans a month boundary, one a year boundary
  const lakeStart = P.addDays(P.end(P.periodOf('month', d(14))), -3);
  const tLake = add('Trips', { title: 'Lakeside — half term', destination: 'Lakeside', start: lakeStart, end: P.addDays(lakeStart, 8), status: 'booked', who: 'Sam, Jo, kids', area_id: family.id, color: '#c4703f', notes: 'Grandparents’ for the week' });
  const yr = Number(year);
  const tXmas = add('Trips', { title: 'Winter by the sea', destination: 'Seaview', start: `${yr}-12-20`, end: `${yr + 1}-01-03`, status: 'planning', who: 'Everyone', area_id: family.id, color: '#3f8f7f' });
  add('Trips', { title: 'Ski weekend', destination: 'The mountains', start: `${yr + 1}-02-12`, end: `${yr + 1}-02-14`, status: 'idea', who: 'Sam, Jo', area_id: personal.id, color: '#5a6fb5' });
  const tPast = add('Trips', { title: 'Summer at the coast', destination: 'The coast', start: `${yr}-07-18`, end: `${yr}-07-26`, status: 'done', who: 'Everyone', area_id: family.id, color: '#d1a03a' });

  const item = (trip, f) => add('TripItems', { trip_id: trip.id, ...f });
  item(tLake, { kind: 'flight', title: 'Flight out', date: tLake.start, time: '07:40', end_date: tLake.start, end_time: '10:35', location: 'Terminal 1', reference: 'FL123 · ABC123', cost: 612, currency: 'EUR', order: 1 });
  item(tLake, { kind: 'transport', title: 'Hire car', date: tLake.start, time: '11:30', end_date: tLake.end, location: 'Airport', reference: 'EC-88213', cost: 245, currency: 'GBP', order: 2 });
  item(tLake, { kind: 'stay', title: 'Grandma’s', date: tLake.start, end_date: tLake.end, location: 'Lakeside', order: 3 });
  item(tLake, { kind: 'activity', title: 'Theme park', date: P.addDays(tLake.start, 2), time: '10:00', reference: 'LL-55120', link: 'https://example.com', cost: 180, currency: 'GBP', order: 4 });
  item(tLake, { kind: 'food', title: 'Sunday lunch at the village pub', date: P.addDays(tLake.start, 4), time: '13:00', order: 5 });
  item(tLake, { kind: 'flight', title: 'Flight home', date: tLake.end, time: '16:10', end_date: tLake.end, end_time: '22:50', reference: 'FL124 · ABC123', order: 6 });
  item(tXmas, { kind: 'stay', title: 'Holiday villa', date: tXmas.start, end_date: tXmas.end, reference: 'AIR-77K2', cost: 2100, currency: 'EUR', order: 1 });

  const packing = (trip, items) => {
    const l = add('Lists', { title: `Packing — ${trip.title}`, trip_id: trip.id, area_id: trip.area_id });
    items.forEach((title, i) => add('Tasks', { title, list_id: l.id, trip_id: trip.id, order: i, done: trip.status === 'done' }));
    return l;
  };
  packing(tLake, ['Passports', 'Chargers', 'Raincoats', 'Wellies', 'Kids’ tablets', 'Present for Grandma']);
  packing(tPast, ['Passports', 'Sun cream', 'Swimsuits', 'Snorkels', 'Hats']);
  packing(tXmas, ['Presents', 'Chargers']);
  const books = add('Lists', { title: 'Books to read', area_id: personal.id, order: 1 });
  ['The Overstory', 'Piranesi', 'Four Thousand Weeks'].forEach((title, i) => add('Tasks', { title, list_id: books.id, order: i, done: i === 0 }));
  const gifts = add('Lists', { title: 'Gift ideas', area_id: family.id, order: 2 });
  ['Mum — garden voucher', 'Jo — pottery class'].forEach((title, i) => add('Tasks', { title, list_id: gifts.id, order: i }));

  // Todos at every precision, with deadlines in every state
  const task = f => add('Tasks', f);
  task({ title: 'Call the tiler', when: T, time: '10:00', project_id: pKitchen.id, goal_id: gTiles.id, area_id: home.id });
  task({ title: 'Submit VAT return', when: T, due: d(2), due_time: '17:00', priority: 'high', area_id: work.id });
  task({ title: 'Long run 8 km', when: d(1), time: '07:00', goal_id: gRun.id, area_id: personal.id });
  task({ title: 'Homepage copy draft', when: d(1), project_id: pSite.id, area_id: work.id });
  task({ title: 'Pick up dry cleaning', when: d(-1), area_id: home.id, done: true });
  task({ title: 'Email accountant re: P60', when: d(-3), project_id: pTax.id, area_id: work.id });
  task({ title: 'Renew car insurance', when: '', due: d(-2), area_id: home.id });
  task({ title: 'Book car service', when: week, area_id: home.id });
  task({ title: 'Send invoice to Northwind', when: week, due: d(3), area_id: work.id });
  task({ title: 'Choose worktop samples', when: P.next(week), project_id: pKitchen.id, area_id: home.id });
  task({ title: 'Order skirting boards', when: month, project_id: pKitchen.id, area_id: home.id, due: P.end(month) });
  task({ title: 'Plan school pick-up rota', when: month, area_id: family.id });
  task({ title: 'Get three quotes for windows', when: quarter, goal_id: gReno.id, area_id: home.id });
  task({ title: 'Sort out pension transfer', when: year, area_id: personal.id, due: `${yr}-12-15` });
  task({ title: 'Learn Greek properly', when: 'someday', area_id: personal.id });
  task({ title: 'Build a bench for the garden', when: 'someday', project_id: pShed.id, area_id: home.id });
  task({ title: 'Look into solar panels', when: '' });
  task({ title: 'Birthday present for Mum', when: '', due: d(12), area_id: family.id });
  task({ title: 'Book airport parking', when: '', trip_id: tLake.id, due: P.addDays(tLake.start, -10), area_id: family.id });
  task({ title: 'Online check-in', when: P.addDays(tLake.start, -1), trip_id: tLake.id, due: P.addDays(tLake.start, -1), area_id: family.id });
  task({ title: 'Book winter flights', when: month, trip_id: tXmas.id, due: d(9), priority: 'high', area_id: family.id });
  task({ title: 'Wireframes sign-off', when: d(5), time: '14:00', project_id: pSite.id, area_id: work.id, due: d(5) });
  task({ title: 'Dentist check-up', when: d(8), time: '09:15', area_id: personal.id });
  task({ title: 'Quarterly accounts', when: P.next(month), due: P.addDays(P.end(P.next(month)), -5), area_id: work.id, remind_days: 7 });
  task({ title: 'Review insurance renewals', when: P.next(quarter), area_id: home.id });

  // Period pages
  db.Periods.push(
    { period: week, focus_1: 'VAT return out of the door', focus_2: 'Book the tiler', focus_3: 'Three runs', notes: 'Jo away Thu–Fri.', review: '', reviewed_at: '', updated_at: new Date().toISOString() },
    { period: month, focus_1: 'Kitchen decisions made', focus_2: 'Website wireframes', focus_3: 'Plan Christmas trip', notes: '', review: '', reviewed_at: '', updated_at: new Date().toISOString() },
    { period: quarter, focus_1: 'Kitchen usable', focus_2: 'New client signed', focus_3: '', notes: '', review: '', reviewed_at: '', updated_at: new Date().toISOString() },
    { period: year, focus_1: 'Health', focus_2: 'House', focus_3: 'Steady work', notes: 'Word of the year: enough.', review: '', reviewed_at: '', updated_at: new Date().toISOString() },
  );
  const settings = { ...DEFAULT_SETTINGS, calendars: 'primary,family', background_calendars: 'holidays,school' };
  for (const [key, value] of Object.entries(settings)) db.Settings.push({ key, value, updated_at: new Date().toISOString() });
  return db;
}

// ---------------------------------------------------------------------------
// Backend

export function mockBackend() {
  let db;
  try { db = JSON.parse(lsGet(KEY) || 'null'); } catch { db = null; }
  if (!db) { db = generate(); save(); }
  function save() { lsSet(KEY, JSON.stringify(db)); }
  const keyOf = tab => TABS[tab].key;

  return {
    name: 'mock',
    queueKey: MOCK_QUEUE_KEY,
    async loadAll() { await delay(); return clone(db); },
    async append(tab, record) {
      await delay();
      if (globalThis.__plannerOffline) throw Object.assign(new Error('Offline (simulated)'), { offline: true });
      db[tab].push(clone(record)); save(); return record;
    },
    async update(tab, key, patch, baseAt, full) {
      await delay();
      if (globalThis.__plannerOffline) throw Object.assign(new Error('Offline (simulated)'), { offline: true });
      const i = db[tab].findIndex(r => r[keyOf(tab)] === key);
      if (i < 0) { const rec = { ...(full || {}), ...patch }; db[tab].push(rec); save(); return rec; }
      db[tab][i] = { ...db[tab][i], ...patch };
      save();
      return clone(db[tab][i]);
    },
  };
}

// ---------------------------------------------------------------------------
// Calendar provider

const CALS = [
  { id: 'primary', summary: 'Me', backgroundColor: '#4a78b5', primary: true },
  { id: 'family', summary: 'Family', backgroundColor: '#4c8a5a' },
  { id: 'holidays', summary: 'Public holidays', backgroundColor: '#9e9e9e' },
  { id: 'school', summary: 'School terms', backgroundColor: '#b39ddb' },
];

const HOLIDAYS = {
  holidays: {
    '01-01': 'New Year’s Day', '12-25': 'Christmas Day',
    '2026-04-03': 'Good Friday', '2026-04-06': 'Easter Monday', '2026-05-04': 'Early May bank holiday', '2026-05-25': 'Spring bank holiday', '2026-08-31': 'Summer bank holiday', '2026-12-28': 'Boxing Day (substitute)',
    '2027-03-26': 'Good Friday', '2027-03-29': 'Easter Monday', '2027-05-03': 'Early May bank holiday', '2027-05-31': 'Spring bank holiday', '2027-08-30': 'Summer bank holiday', '2027-12-27': 'Christmas (substitute)', '2027-12-28': 'Boxing Day (substitute)',
  },
};
const SCHOOL = [ // [start, end inclusive, title]
  ['2026-02-16', '2026-02-20', 'Half term'], ['2026-03-30', '2026-04-10', 'Easter holidays'], ['2026-05-25', '2026-05-29', 'Half term'],
  ['2026-07-22', '2026-09-02', 'Summer holidays'], ['2026-10-26', '2026-10-30', 'Half term'], ['2026-12-21', '2027-01-01', 'Christmas holidays'],
  ['2027-02-15', '2027-02-19', 'Half term'], ['2027-03-29', '2027-04-09', 'Easter holidays'], ['2027-05-31', '2027-06-04', 'Half term'],
  ['2027-07-21', '2027-09-01', 'Summer holidays'], ['2027-10-25', '2027-10-29', 'Half term'], ['2027-12-20', '2027-12-31', 'Christmas holidays'],
];

const allDay = (id, title, s, e = s) => ({ id, summary: title, start: { date: s }, end: { date: P.addDays(e, 1) } });
const timed = (id, title, day, time, mins) => {
  const [y, m, dd] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const s = new Date(y, m - 1, dd, hh, mm), e = new Date(s.getTime() + mins * 60_000);
  return { id, summary: title, start: { dateTime: s.toISOString() }, end: { dateTime: e.toISOString() } };
};

function generatedEvents(cal, start, end) {
  const out = [];
  if (HOLIDAYS[cal]) {
    for (const day of P.daysBetween(start, end)) {
      const t = HOLIDAYS[cal][day] || HOLIDAYS[cal][day.slice(5)];
      if (t) out.push(allDay(`${cal}-${day}`, t, day));
    }
    return out;
  }
  if (cal === 'school') return SCHOOL.filter(([s, e]) => s <= end && e >= start).map(([s, e, t]) => allDay(`school-${s}`, t, s, e));
  for (const day of P.daysBetween(start, end)) {
    const wd = P.dow(day);
    const n = P.diffDays('2026-01-05', day); // stable seed
    if (cal === 'primary') {
      if (wd < 5 && wd !== 2) out.push(timed(`su-${day}`, 'Team stand-up', day, '09:30', 15));
      if (wd === 2 && Math.floor(n / 7) % 2 === 0) out.push(timed(`lunch-${day}`, 'Lunch with Sam', day, '13:00', 60));
      if (wd === 3) out.push(timed(`pil-${day}`, 'Pilates', day, '18:30', 60));
      if (n % 23 === 5) out.push(timed(`cl-${day}`, 'Client call — Northwind', day, '15:00', 45));
      if (n % 61 === 10) out.push(allDay(`conf-${day}`, 'Product conference', day, P.addDays(day, 2)));
    }
    if (cal === 'family') {
      if (wd === 5) out.push(timed(`fb-${day}`, 'Football', day, '10:00', 90));
      if (n % 37 === 3) out.push(timed(`party-${day}`, 'Birthday party', day, '15:00', 120));
    }
  }
  return out;
}

export function mockCalendarProvider() {
  const created = () => { try { return JSON.parse(lsGet(EV_KEY) || '[]'); } catch { return []; } };
  const saveCreated = list => lsSet(EV_KEY, JSON.stringify(list));
  return {
    async listCalendars() { await delay(30); return CALS; },
    async listEvents(cal, start, end) {
      await delay(80);
      const mine = created().filter(e => e.cal === cal).map(e => e.ev).filter(ev => {
        const s = ev.start.date || ev.start.dateTime.slice(0, 10);
        const e = ev.end.date ? P.addDays(ev.end.date, -1) : ev.end.dateTime.slice(0, 10);
        return s <= end && e >= start;
      });
      return [...generatedEvents(cal, start, end), ...mine];
    },
    async insert(cal, body) {
      await delay();
      const ev = { ...body, id: 'mock-' + Math.random().toString(36).slice(2), start: toIso(body.start), end: toIso(body.end) };
      saveCreated([...created(), { cal, ev }]);
      return ev;
    },
    async patch(cal, id, body) {
      await delay();
      const list = created();
      const i = list.findIndex(x => x.ev.id === id);
      if (i < 0) throw new Error('Event not found');
      list[i].ev = { ...list[i].ev, ...body, start: toIso(body.start), end: toIso(body.end) };
      saveCreated(list);
      return list[i].ev;
    },
  };
}
// Mock stores local wall-clock times as real instants so the normaliser can read them back.
function toIso(x) { return x.date ? { date: x.date } : { dateTime: new Date(x.dateTime).toISOString() }; }
