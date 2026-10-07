// Period strings: the one scheduling format used everywhere.
//   day 2026-10-09 · week 2026-W41 (ISO) · month 2026-10 · quarter 2026-Q4 · year 2026
//   'someday' · '' (inbox)
// Pure functions only. Dates are handled as UTC day numbers so DST never matters.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON3 = MONTHS.map(m => m.slice(0, 3));
const DOW3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const RANK = { day: 0, week: 1, month: 2, quarter: 3, year: 4 };
export const TYPES = ['day', 'week', 'month', 'quarter', 'year'];
export { MONTHS, MON3, DOW3 };

const pad = n => String(n).padStart(2, '0');

// ---- day numbers ---------------------------------------------------------

function dnOf(y, m, d) { return Math.round(Date.UTC(y, m - 1, d) / 864e5); }
function ymdOf(dn) {
  const dt = new Date(dn * 864e5);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function dayStr(dn) { const { y, m, d } = ymdOf(dn); return `${y}-${pad(m)}-${pad(d)}`; }
function dn(day) { const [y, m, d] = day.split('-').map(Number); return dnOf(y, m, d); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/** Monday-based weekday: 0 = Mon … 6 = Sun */
export function dow(day) { return (((dn(day) + 3) % 7) + 7) % 7; } // 1970-01-01 was a Thursday
export function addDays(day, n) { return dayStr(dn(day) + n); }
export function diffDays(a, b) { return dn(b) - dn(a); }
export function dayOf(date = new Date()) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
export function today() { return dayOf(new Date()); }
export function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

// ---- ISO weeks -------------------------------------------------------------

function isoWeekOf(day) {
  const thu = dn(day) - dow(day) + 3;
  const y = ymdOf(thu).y;
  const w = Math.floor((thu - dnOf(y, 1, 1)) / 7) + 1;
  return { y, w };
}
function weekStartDn(y, w) {
  const jan4 = dnOf(y, 1, 4);
  const jan4dow = (((jan4 + 3) % 7) + 7) % 7;
  return jan4 - jan4dow + (w - 1) * 7;
}
function weeksInYear(y) { return isoWeekOf(`${y}-12-28`).w; }

// ---- parse ---------------------------------------------------------------

const RE = {
  day: /^(\d{4})-(\d{2})-(\d{2})$/,
  week: /^(\d{4})-W(\d{2})$/,
  month: /^(\d{4})-(\d{2})$/,
  quarter: /^(\d{4})-Q([1-4])$/,
  year: /^(\d{4})$/,
};

/** Parse a period string → {type, y, m?, d?, w?, q?} or null if invalid. Blank → inbox. */
export function parse(s) {
  if (s === undefined || s === null || s === '') return { type: 'inbox' };
  s = String(s).trim();
  if (s === '') return { type: 'inbox' };
  if (s === 'someday') return { type: 'someday' };
  let m;
  if ((m = RE.day.exec(s))) {
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
    return { type: 'day', y, m: mo, d };
  }
  if ((m = RE.week.exec(s))) {
    const y = +m[1], w = +m[2];
    if (w < 1 || w > weeksInYear(y)) return null;
    return { type: 'week', y, w };
  }
  if ((m = RE.month.exec(s))) {
    const y = +m[1], mo = +m[2];
    if (mo < 1 || mo > 12) return null;
    return { type: 'month', y, m: mo };
  }
  if ((m = RE.quarter.exec(s))) return { type: 'quarter', y: +m[1], q: +m[2] };
  if ((m = RE.year.exec(s))) return { type: 'year', y: +m[1] };
  return null;
}

/** 'day' | 'week' | 'month' | 'quarter' | 'year' | 'someday' | 'inbox' | null */
export function precision(s) { const p = parse(s); return p ? p.type : null; }
export function isValid(s) { return parse(s) !== null; }
/** `s` (trimmed) if it is a valid period of precision `type`, else null — for validating typed input. */
export function ofType(s, type) { const v = String(s ?? '').trim(); return precision(v) === type ? v : null; }
export function isDated(s) { const t = precision(s); return t in RANK; }

// ---- ranges --------------------------------------------------------------

function rangeDn(s) {
  const p = parse(s);
  if (!p) return null;
  switch (p.type) {
    case 'day': { const x = dnOf(p.y, p.m, p.d); return [x, x]; }
    case 'week': { const x = weekStartDn(p.y, p.w); return [x, x + 6]; }
    case 'month': return [dnOf(p.y, p.m, 1), dnOf(p.y, p.m, daysInMonth(p.y, p.m))];
    case 'quarter': { const m0 = (p.q - 1) * 3 + 1; return [dnOf(p.y, m0, 1), dnOf(p.y, m0 + 2, daysInMonth(p.y, m0 + 2))]; }
    case 'year': return [dnOf(p.y, 1, 1), dnOf(p.y, 12, 31)];
    default: return null;
  }
}
export function start(s) { const r = rangeDn(s); return r ? dayStr(r[0]) : null; }
export function end(s) { const r = rangeDn(s); return r ? dayStr(r[1]) : null; }

/** The day a period "belongs" by: a week's Thursday (ISO rule), otherwise its first day. */
function anchorDn(s) {
  const p = parse(s);
  if (!p || !(p.type in RANK)) return null;
  return p.type === 'week' ? weekStartDn(p.y, p.w) + 3 : rangeDn(s)[0];
}

/** The period of `type` containing `day`. */
export function periodOf(type, day) {
  const { y, m } = ymdOf(dn(day));
  switch (type) {
    case 'day': return day;
    case 'week': { const iw = isoWeekOf(day); return `${iw.y}-W${pad(iw.w)}`; }
    case 'month': return `${y}-${pad(m)}`;
    case 'quarter': return `${y}-Q${Math.ceil(m / 3)}`;
    case 'year': return String(y);
    default: return null;
  }
}

/** Does period `a` contain period `b`? Weeks belong to the month/quarter/year of their Thursday. */
export function contains(a, b) {
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb || !(pa.type in RANK) || !(pb.type in RANK)) return false;
  if (String(a) === String(b)) return true;
  if (RANK[pa.type] <= RANK[pb.type]) return false;
  const [s, e] = rangeDn(a);
  if (pa.type === 'week') { const x = rangeDn(b)[0]; return x >= s && x <= e; } // only days are finer
  // month/quarter/year contain finer periods by their anchor day; a month inside quarter/year by start
  const x = anchorDn(b);
  return x >= s && x <= e;
}

/** Convert a period to another precision via its anchor (week → Thursday, else first day). */
export function convert(s, type) {
  const x = anchorDn(s);
  return x === null ? null : periodOf(type, dayStr(x));
}

export function parent(s) {
  const t = precision(s);
  const up = { day: 'week', week: 'month', month: 'quarter', quarter: 'year' }[t];
  return up ? convert(s, up) : null;
}

// ---- navigation ------------------------------------------------------------

export function shift(s, n) {
  const p = parse(s);
  if (!p || !(p.type in RANK)) return s ?? '';
  switch (p.type) {
    case 'day': return addDays(s, n);
    case 'week': return periodOf('week', dayStr(weekStartDn(p.y, p.w) + 7 * n));
    case 'month': { const k = p.y * 12 + (p.m - 1) + n; return `${Math.floor(k / 12)}-${pad((k % 12) + 1)}`; }
    case 'quarter': { const k = p.y * 4 + (p.q - 1) + n; return `${Math.floor(k / 4)}-Q${(k % 4) + 1}`; }
    case 'year': return String(p.y + n);
  }
}
export const next = s => shift(s, 1);
export const prev = s => shift(s, -1);

// ---- lists -------------------------------------------------------------------

export function daysIn(s) {
  const r = rangeDn(s);
  if (!r) return [];
  const out = [];
  for (let x = r[0]; x <= r[1]; x++) out.push(dayStr(x));
  return out;
}
export function daysBetween(a, b) {
  const out = [];
  for (let x = dn(a); x <= dn(b); x++) out.push(dayStr(x));
  return out;
}
/** Weeks belonging (by Thursday) to a month/quarter/year. */
export function weeksIn(s) {
  const r = rangeDn(s);
  if (!r) return [];
  const out = [];
  let w = periodOf('week', dayStr(r[0]));
  if (!contains(s, w)) w = next(w);
  while (contains(s, w)) { out.push(w); w = next(w); }
  return out;
}
export function monthsIn(s) {
  const r = rangeDn(s);
  if (!r) return [];
  const out = [];
  for (let m = periodOf('month', dayStr(r[0])); start(m) <= dayStr(r[1]); m = next(m)) out.push(m);
  return out;
}

// ---- labels --------------------------------------------------------------

export function fmtDayShort(day) {
  const { m, d } = ymdOf(dn(day));
  return `${DOW3[dow(day)]} ${d} ${MON3[m - 1]}`;
}
export function fmtDay(day) { return `${fmtDayShort(day)} ${ymdOf(dn(day)).y}`; }
export function fmtDayMonth(day) { const { m, d } = ymdOf(dn(day)); return `${d} ${MON3[m - 1]}`; }

export function fmtRange(a, b) {
  if (a === b) return fmtDay(a);
  const A = ymdOf(dn(a)), B = ymdOf(dn(b));
  if (A.y !== B.y) return `${A.d} ${MON3[A.m - 1]} ${A.y} – ${B.d} ${MON3[B.m - 1]} ${B.y}`;
  if (A.m !== B.m) return `${A.d} ${MON3[A.m - 1]} – ${B.d} ${MON3[B.m - 1]} ${B.y}`;
  return `${A.d}–${B.d} ${MON3[A.m - 1]} ${A.y}`;
}

export function label(s) {
  const p = parse(s);
  if (!p) return String(s);
  switch (p.type) {
    case 'inbox': return 'Inbox';
    case 'someday': return 'Someday';
    case 'day': return fmtDay(s);
    case 'week': {
      const a = ymdOf(weekStartDn(p.y, p.w)), b = ymdOf(weekStartDn(p.y, p.w) + 6);
      const range = a.m === b.m ? `${a.d}–${b.d} ${MON3[b.m - 1]}` : `${a.d} ${MON3[a.m - 1]} – ${b.d} ${MON3[b.m - 1]}`;
      return `W${pad(p.w)} · ${range}`;
    }
    case 'month': return `${MONTHS[p.m - 1]} ${p.y}`;
    case 'quarter': return `Q${p.q} ${p.y}`;
    case 'year': return String(p.y);
  }
}

/** Short label relative to today: "Today", "Next week", "W45", "Mar 2027"… */
export function relLabel(s, todayDay = today()) {
  const p = parse(s);
  if (!p) return String(s);
  if (!(p.type in RANK)) return label(s);
  const cur = periodOf(p.type, todayDay);
  const n = s === cur ? 0 : s === next(cur) ? 1 : s === prev(cur) ? -1 : null;
  const sameYear = p.y === ymdOf(dn(todayDay)).y;
  switch (p.type) {
    case 'day': {
      if (n === 0) return 'Today';
      if (n === 1) return 'Tomorrow';
      if (n === -1) return 'Yesterday';
      return sameYear ? fmtDayShort(s) : fmtDay(s);
    }
    case 'week': return n === 0 ? 'This week' : n === 1 ? 'Next week' : n === -1 ? 'Last week' : `W${pad(p.w)}${sameYear ? '' : ' ' + p.y}`;
    case 'month': return n === 0 ? 'This month' : n === 1 ? 'Next month' : n === -1 ? 'Last month' : `${MON3[p.m - 1]}${sameYear ? '' : ' ' + p.y}`;
    case 'quarter': return n === 0 ? 'This quarter' : n === 1 ? 'Next quarter' : n === -1 ? 'Last quarter' : `Q${p.q}${sameYear ? '' : ' ' + p.y}`;
    case 'year': return n === 0 ? 'This year' : n === 1 ? 'Next year' : n === -1 ? 'Last year' : String(p.y);
  }
}
