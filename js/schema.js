// Sheet schema: one entry per tab. Column order here is only used when creating
// the sheet — reading and writing always go by the header row.

const AUDIT = ['created_at', 'updated_at', 'deleted'];

export const TABS = {
  Areas: { key: 'id', columns: ['id', 'name', 'color', 'order', 'archived', ...AUDIT] },
  Goals: { key: 'id', columns: ['id', 'title', 'when', 'area_id', 'parent_id', 'why', 'measure', 'status', 'progress', 'order', 'notes', ...AUDIT] },
  Projects: { key: 'id', columns: ['id', 'title', 'area_id', 'goal_id', 'status', 'target', 'notes', 'order', 'created_at', 'updated_at', 'done_at', 'deleted'] },
  Tasks: {
    key: 'id',
    columns: ['id', 'title', 'when', 'time', 'due', 'due_time', 'remind_days', 'due_event_id', 'priority', 'done',
      'area_id', 'project_id', 'goal_id', 'trip_id', 'list_id', 'notes', 'order', 'event_id',
      'created_at', 'updated_at', 'done_at', 'deleted'],
  },
  Periods: { key: 'period', columns: ['period', 'focus_1', 'focus_2', 'focus_3', 'notes', 'review', 'reviewed_at', 'updated_at'] },
  Trips: { key: 'id', columns: ['id', 'title', 'destination', 'start', 'end', 'status', 'who', 'area_id', 'color', 'event_id', 'notes', ...AUDIT] },
  TripItems: {
    key: 'id',
    columns: ['id', 'trip_id', 'kind', 'title', 'date', 'time', 'end_date', 'end_time', 'location', 'reference', 'link',
      'cost', 'currency', 'notes', 'order', ...AUDIT],
  },
  Lists: { key: 'id', columns: ['id', 'title', 'area_id', 'trip_id', 'notes', 'order', ...AUDIT] },
  Settings: { key: 'key', columns: ['key', 'value', 'updated_at'] },
  Habits: { key: 'id', columns: ['id', 'title', 'kind', 'schedule', 'days', 'target', 'area_id', 'color', 'start', 'order', 'archived', 'notes', ...AUDIT] },
  HabitLog: { key: 'key', columns: ['key', 'habit_id', 'day', 'done', 'note', 'updated_at'] },
};

export const TAB_NAMES = Object.keys(TABS);

const BOOL = new Set(['done', 'deleted', 'archived']);
const NUM = new Set(['order', 'progress', 'remind_days', 'cost', 'target']);
const DATE = new Set(['due', 'start', 'end', 'date', 'end_date', 'day']);
const PERIOD = new Set(['when', 'target']);
const TIME = new Set(['time', 'due_time', 'end_time']);

/** Columns stored as plain text in the sheet (so Sheets doesn't turn typed dates into serials). */
export const isTextColumn = col => !BOOL.has(col) && !NUM.has(col);

// Sheets date serials count days from 1899-12-30.
const serialToDay = n => new Date(Math.round((Math.floor(n) - 25569) * 864e5)).toISOString().slice(0, 10);
const fractionToTime = n => { const m = Math.round((n % 1) * 1440); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

export const DEFAULT_AREAS = [
  { name: 'Work', color: '#3d6b9e' },
  { name: 'Home', color: '#b0703a' },
  { name: 'Family', color: '#8a4f8f' },
  { name: 'Personal', color: '#4c8a5a' },
];

export const DEFAULT_SETTINGS = {
  calendars: 'primary',
  background_calendars: '',
  week_start: 'mon',
  review_day: 'sun',
  default_remind_days: '3',
};

function readCell(col, v) {
  if (v === undefined || v === null) v = '';
  if (BOOL.has(col)) return v === true || String(v).toUpperCase() === 'TRUE';
  if (NUM.has(col)) { if (v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (typeof v === 'number') {
    // A value typed straight into the sheet and parsed by Sheets as a date/time.
    if (DATE.has(col)) return serialToDay(v);
    if (PERIOD.has(col)) return v < 10000 ? String(v) : serialToDay(v); // a bare year like 2026 is a period
    if (TIME.has(col)) return fractionToTime(v);
  }
  return String(v);
}
function writeCell(col, v) {
  if (BOOL.has(col)) return !!v;
  if (v === undefined || v === null) return '';
  if (NUM.has(col)) { const n = Number(v); return v === '' || !Number.isFinite(n) ? '' : n; }
  return String(v);
}
export { writeCell };

/** Sheet row → record, by header names. Unknown columns are kept as strings. */
export function fromRow(tab, row, headers) {
  const rec = {};
  for (const col of TABS[tab].columns) rec[col] = readCell(col, undefined);
  headers.forEach((h, i) => { if (h) rec[h] = readCell(h, row[i]); });
  return rec;
}

/** Record → sheet row in header order. Columns the record doesn't know keep `prev` values. */
export function toRow(tab, rec, headers, prev = []) {
  return headers.map((h, i) => (h && h in rec ? writeCell(h, rec[h]) : (prev[i] ?? '')));
}

export function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** A fresh record for `tab` with defaults, id and timestamps. */
export function newRecord(tab, fields = {}, now = new Date().toISOString()) {
  const def = TABS[tab];
  const rec = {};
  for (const col of def.columns) rec[col] = readCell(col, undefined);
  if (def.key === 'id') rec.id = uuid();
  if ('created_at' in rec) rec.created_at = now;
  rec.updated_at = now;
  return Object.assign(rec, fields);
}
