// In-memory state, selectors, optimistic updates and the write queue.
// The store talks to a swappable backend with this interface:
//   loadAll()                          → { [tab]: record[] }
//   append(tab, record)                → record
//   update(tab, key, patch, baseAt, full) → record as now stored (merged with the remote row)
import { TABS, TAB_NAMES, newRecord, DEFAULT_SETTINGS } from './schema.js';
import * as P from './periods.js';

const QUEUE_KEY = 'planner-queue';
const lsGet = k => { try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; } };
const lsSet = (k, v) => { try { v === null ? globalThis.localStorage?.removeItem(k) : globalThis.localStorage?.setItem(k, v); } catch { /* storage unavailable */ } };
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Pure selectors (unit-tested)

const isLive = r => r && !r.deleted;

/** 'overdue' | 'soon' | 'later' | null */
export function dueState(task, today, defaultRemind = 3) {
  if (!task.due || task.done) return null;
  const days = P.diffDays(today, task.due);
  if (days < 0) return 'overdue';
  const remind = task.remind_days ?? defaultRemind;
  return days <= remind ? 'soon' : 'later';
}

export function dueChip(due, today) {
  const n = P.diffDays(today, due);
  if (n === 0) return 'Due today';
  if (n === 1) return 'Due tomorrow';
  if (n < 0) return `${-n} day${n === -1 ? '' : 's'} late`;
  if (n < 7) return `Due ${P.DOW3[P.dow(due)]}`;
  return `Due in ${n} days`;
}

/** Todos-view grouping: 'overdue' | 'week' | 'month' | 'later' | 'none' */
export function deadlineGroup(task, today) {
  if (!task.due) return 'none';
  if (task.due < today) return 'overdue';
  if (P.contains(P.periodOf('week', today), task.due)) return 'week';
  if (P.contains(P.periodOf('month', today), task.due)) return 'month';
  return 'later';
}

/** Order scheduling strings: by start date, finer precision first; someday, then inbox last. */
export function cmpWhen(a = '', b = '') {
  const key = w => {
    const t = P.precision(w);
    if (t === 'someday') return ['9999-98', 0];
    if (!(t in P.RANK)) return ['9999-99', 0];
    return [P.start(w), P.RANK[t]];
  };
  const [sa, ra] = key(a), [sb, rb] = key(b);
  return sa < sb ? -1 : sa > sb ? 1 : ra - rb;
}

export function cmpTask(a, b) {
  return cmpWhen(a.when, b.when) || (a.time || '99').localeCompare(b.time || '99') || (a.order ?? 0) - (b.order ?? 0) || (a.created_at || '').localeCompare(b.created_at || '');
}

export function nextAction(tasks) {
  return tasks.filter(t => isLive(t) && !t.done).sort(cmpTask)[0] ?? null;
}

export function carryTarget(period) { return P.next(period); }

/** Percentage from linked todos, projects and sub-goals, or null when nothing is linked. */
export function computedProgress(goalId, { tasks, projects, goals }) {
  let total = 0, done = 0;
  for (const t of tasks) if (isLive(t) && t.goal_id === goalId) { total++; if (t.done) done++; }
  for (const p of projects) if (isLive(p) && p.goal_id === goalId && p.status !== 'dropped') { total++; if (p.status === 'done') done++; }
  for (const g of goals) if (isLive(g) && g.parent_id === goalId && g.status !== 'dropped') { total++; if (g.status === 'achieved') done++; }
  return total ? Math.round((done / total) * 100) : null;
}

export function tripsOn(day, trips) {
  return trips.filter(t => isLive(t) && t.status !== 'cancelled' && t.start && t.end && t.start <= day && day <= t.end);
}

// ---------------------------------------------------------------------------
// The store

const listeners = new Set();
let backend = null;
let queueKey = QUEUE_KEY;
let queue = [];
let failedOps = [];
let flushing = false;
let retryTimer = null;
const landedDuringRefresh = new Set(); // one array per in-flight refresh

/** 4xx errors that retrying won't fix (bad request, no permission, not found…). */
const permanent = e => !e.auth && !e.offline && e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status);

/** Merge two copies of the same row: the newer one wins, but its blank fields don't erase the other's text. */
function mergeDuplicate(a, b) {
  const [older, newer] = (a.updated_at || '') <= (b.updated_at || '') ? [a, b] : [b, a];
  const out = { ...older };
  for (const [k, v] of Object.entries(newer)) if (v !== '' && v !== null && v !== undefined) out[k] = v;
  return out;
}

export const store = {
  data: Object.fromEntries(TAB_NAMES.map(t => [t, new Map()])),
  status: 'idle', // idle | saving | saved | failed | offline | auth
  lastError: null,
  loaded: false,

  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  emit(kind = 'data') { for (const fn of listeners) fn(kind); },

  async init(be) {
    backend = be;
    clearTimeout(retryTimer);
    flushing = false;
    queueKey = be.queueKey || QUEUE_KEY;
    try { const saved = JSON.parse(lsGet(queueKey) || '{}'); queue = Array.isArray(saved) ? saved : saved.queue || []; failedOps = saved.failed || []; }
    catch { queue = []; failedOps = []; }
    await this.refresh();
    this.loaded = true;
    this.flush();
  },

  /** Reload everything from the backend, then re-apply writes that haven't landed (or landed mid-load). */
  async refresh() {
    const landed = [];
    landedDuringRefresh.add(landed);
    let all;
    try { all = await backend.loadAll(); }
    finally { landedDuringRefresh.delete(landed); }
    for (const tab of TAB_NAMES) {
      const m = new Map();
      for (const r of all[tab] || []) {
        const k = r[TABS[tab].key];
        if (!k) continue;
        m.set(k, m.has(k) ? mergeDuplicate(m.get(k), r) : r);
      }
      this.data[tab] = m;
    }
    for (const w of landed) this.data[w.tab].set(w.key, { ...(this.data[w.tab].get(w.key) || {}), ...w.rec });
    for (const op of queue) this._applyLocal(op.tab, op.key, op.op === 'append' ? op.record : op.patch);
    this.emit('data');
  },

  // ---- reads
  get(tab, key) { const r = this.data[tab].get(key); return isLive(r) ? r : null; },
  all(tab) { return [...this.data[tab].values()].filter(isLive); },
  setting(key) { return this.data.Settings.get(key)?.value ?? DEFAULT_SETTINGS[key] ?? ''; },
  period(p) { return this.data.Periods.get(p) || { period: p, focus_1: '', focus_2: '', focus_3: '', notes: '', review: '', reviewed_at: '' }; },

  // ---- writes (optimistic)
  add(tab, fields) {
    const rec = newRecord(tab, fields);
    if (tab === 'Tasks' && rec.done && !rec.done_at) rec.done_at = rec.updated_at;
    this.data[tab].set(rec[TABS[tab].key], rec);
    this._enqueue({ op: 'append', tab, key: rec[TABS[tab].key], record: rec });
    this.emit('data');
    return rec;
  },

  update(tab, key, patch) {
    const cur = this.data[tab].get(key);
    if (!cur) {
      if (TABS[tab].key === 'id') throw new Error(`No ${tab} record ${key}`);
      return this.add(tab, { [TABS[tab].key]: key, ...patch }); // Periods / Settings upsert
    }
    patch = { ...patch, updated_at: nowIso() };
    if ('done' in patch && (tab === 'Tasks')) patch.done_at = patch.done ? (cur.done_at || patch.updated_at) : '';
    if (tab === 'Projects' && 'status' in patch) patch.done_at = patch.status === 'done' ? (cur.done_at || patch.updated_at) : '';
    const baseAt = cur.updated_at;
    this._applyLocal(tab, key, patch);
    this._enqueue({ op: 'update', tab, key, patch, baseAt });
    this.emit('data');
    return this.data[tab].get(key);
  },

  remove(tab, key) { return this.update(tab, key, { deleted: true }); },
  setPeriod(p, patch) { return this.update('Periods', p, patch); },
  setSetting(key, value) { return this.update('Settings', key, { value: String(value) }); },

  _applyLocal(tab, key, patch) {
    const cur = this.data[tab].get(key);
    this.data[tab].set(key, { ...(cur || {}), ...patch });
  },

  _enqueue(op) {
    // Coalesce with a pending write for the same row so a burst of edits is one request.
    const pending = queue.findLast?.(q => q.tab === op.tab && q.key === op.key && !q.inflight);
    if (pending && op.op === 'update') {
      if (pending.op === 'append') pending.record = { ...pending.record, ...op.patch };
      else pending.patch = { ...pending.patch, ...op.patch };
    } else {
      queue.push(op);
    }
    this._persistQueue();
    this.flush();
  },

  _persistQueue() {
    const strip = list => list.map(({ inflight, ...q }) => q);
    lsSet(queueKey, queue.length || failedOps.length ? JSON.stringify({ queue: strip(queue), failed: strip(failedOps) }) : null);
  },

  pending() { return queue.length; },
  /** Writes the backend rejected for good (e.g. no edit access); kept so nothing is lost silently. */
  failed() { return failedOps; },
  retryFailed() { queue.push(...failedOps.map(o => ({ ...o, attempts: 0 }))); failedOps = []; this._persistQueue(); this.flush(); },
  async discardFailed() { failedOps = []; this._persistQueue(); await this.refresh(); this.setStatus('saved'); },

  setStatus(s, err = null) { this.status = s; this.lastError = err; this.emit('status'); },

  async flush() {
    if (flushing || !backend) return;
    if (!queue.length) return;
    flushing = true;
    clearTimeout(retryTimer);
    this.setStatus('saving');
    let lastPermanent = null;
    try {
      while (queue.length) {
        const op = queue[0];
        op.inflight = true;
        op.attempts = (op.attempts || 0) + 1;
        this._persistQueue();
        let stored;
        try {
          if (op.op === 'append') stored = await backend.append(op.tab, op.record, { retry: op.attempts > 1 });
          else stored = await backend.update(op.tab, op.key, op.patch, op.baseAt, this.data[op.tab].get(op.key));
        } catch (e) {
          if (!permanent(e)) throw e;
          // Retrying won't help: set it aside and carry on with the rest of the queue.
          delete op.inflight;
          failedOps.push(queue.shift());
          this._persistQueue();
          lastPermanent = e;
          console.warn('[planner] write rejected', op, e);
          continue;
        }
        queue.shift();
        this._persistQueue();
        if (stored) {
          for (const l of landedDuringRefresh) l.push({ tab: op.tab, key: op.key, rec: stored });
          // The backend's copy includes remote fields; keep any newer local edits on top.
          const later = queue.filter(q => q.tab === op.tab && q.key === op.key);
          let rec = { ...(this.data[op.tab].get(op.key) || {}), ...stored };
          for (const q of later) rec = { ...rec, ...(q.op === 'append' ? q.record : q.patch) };
          const cur = this.data[op.tab].get(op.key);
          if (JSON.stringify(cur) !== JSON.stringify(rec)) { this.data[op.tab].set(op.key, rec); this.emit('data'); }
        }
      }
      if (failedOps.length) this.setStatus('failed', lastPermanent || this.lastError);
      else this.setStatus('saved');
    } catch (e) {
      if (queue[0]) delete queue[0].inflight;
      const offline = e.offline || (globalThis.navigator && navigator.onLine === false);
      this.setStatus(e.auth ? 'auth' : offline ? 'offline' : 'failed', e);
      retryTimer = setTimeout(() => this.flush(), e.auth ? 60_000 : 15_000);
    } finally {
      flushing = false;
    }
  },
};

// ---------------------------------------------------------------------------
// Store-bound conveniences used by the views

export const today = () => P.today();
export const remindDefault = () => Number(store.setting('default_remind_days')) || 3;

export function tasks(filter = () => true) { return store.all('Tasks').filter(filter).sort(cmpTask); }
export function openTasks(filter = () => true) { return tasks(t => !t.done && filter(t)); }

/** Tasks scheduled exactly at `period` (e.g. week-level todos with no day). List items excluded. */
export function tasksAt(period, { includeDone = true } = {}) {
  return tasks(t => !t.list_id && t.when === period && (includeDone || !t.done));
}

/** Tasks with a deadline on `day`. */
export function dueOn(day) { return tasks(t => t.due === day && !t.done); }

/** Open, undone day-scheduled tasks before `day` (carried over). */
export function carriedOver(day) {
  return openTasks(t => !t.list_id && P.precision(t.when) === 'day' && t.when < day);
}

/** Overdue + due-soon tasks, soonest first. */
export function dueSoon(day = today()) {
  const rd = remindDefault();
  return openTasks(t => t.due && dueState(t, day, rd) && dueState(t, day, rd) !== 'later')
    .sort((a, b) => a.due.localeCompare(b.due));
}

export function areaOf(rec) { return rec?.area_id ? store.get('Areas', rec.area_id) : null; }
export function areas() { return store.all('Areas').filter(a => !a.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }

export function activeGoalsFor(periods) {
  return store.all('Goals').filter(g => periods.includes(g.when) && g.status !== 'dropped' && g.status !== 'achieved')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function goalProgress(g) {
  const computed = computedProgress(g.id, { tasks: store.all('Tasks'), projects: store.all('Projects'), goals: store.all('Goals') });
  return { manual: g.progress, computed, shown: g.progress ?? computed ?? 0 };
}

export function trips() { return store.all('Trips').sort((a, b) => (a.start || '').localeCompare(b.start || '')); }
export function tripColor(trip) { return trip.color || areaOf(trip)?.color || '#c4703f'; }
export function packingList(tripId) { return store.all('Lists').find(l => l.trip_id === tripId) || null; }
export function listItems(listId) { return tasks(t => t.list_id === listId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.created_at || '').localeCompare(b.created_at || '')); }

// ---- habits

export function habits() {
  return store.all('Habits').filter(h => !h.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.created_at || '').localeCompare(b.created_at || ''));
}

/** Set of "habitId|day" keys for ticked days. */
export function habitLog() {
  const s = new Set();
  for (const r of store.data.HabitLog.values()) if (r.done && !r.deleted) s.add(r.key);
  return s;
}

export function toggleHabit(habitId, day) {
  const key = `${habitId}|${day}`;
  const cur = store.data.HabitLog.get(key);
  const done = !(cur && cur.done);
  store.update('HabitLog', key, { habit_id: habitId, day, done });
  // Backfilling before the habit's start moves the start back, so the day counts.
  const habit = store.get('Habits', habitId);
  if (done && habit && habit.start && day < habit.start) store.update('Habits', habitId, { start: day });
}

/** Has the period ended without a review? */
export function reviewDue(period, day = today()) {
  const e = P.end(period);
  return !!e && e < day && !store.period(period).reviewed_at;
}
