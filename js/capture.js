// Quick-capture parser. Small and predictable: it reads whole words left to right and
// takes only what it recognises; everything else is the title.
//   today · tomorrow · fri · next fri · 12 nov · nov 12 · 2026-11-12 · 12/11   → when (day)
//   this week · next week · this month · next month · someday                   → when (coarser)
//   10am · 7.45pm · 15:30 · noon  (optionally after "at")                          → time
//   due <date> [time] · due 3d / 2w / 1m                                          → deadline
//   #area-or-project · @trip · ! / !high                                          → links & priority
import * as P from './periods.js';

const WEEKDAYS = { mon: 0, monday: 0, tue: 1, tues: 1, tuesday: 1, wed: 2, weds: 2, wednesday: 2, thu: 3, thur: 3, thurs: 3, thursday: 3, fri: 4, friday: 4, sat: 5, saturday: 5, sun: 6, sunday: 6 };
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function monthIndex(word) {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return -1;
  const i = MONTHS.indexOf(w.slice(0, 3));
  if (i < 0) return -1;
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i];
  return full.startsWith(w) || w === 'sept' ? i : -1;
}
function dayNum(word) {
  const m = /^(\d{1,2})(st|nd|rd|th)?$/i.exec(word);
  return m ? Number(m[1]) : null;
}
/** Day/month without a year → the next occurrence on or after today. */
function nextDate(today, m, d, y) {
  const make = yy => `${yy}-${pad(m + 1)}-${pad(d)}`;
  if (y) return P.precision(make(y)) === 'day' ? make(y) : null;
  const ty = Number(today.slice(0, 4));
  let s = make(ty);
  if (P.precision(s) !== 'day') return null;
  if (s < today) s = make(ty + 1);
  return P.precision(s) === 'day' ? s : null;
}
function weekdayFrom(today, wd) { return P.addDays(today, (wd - P.dow(today) + 7) % 7); }

/** A day expression at tokens[i] → { day, n } (n tokens consumed) or null. */
function dateAt(tokens, i, today, { relative = false } = {}) {
  const w = (tokens[i] || '').toLowerCase();
  const w2 = (tokens[i + 1] || '').toLowerCase();
  if (!w) return null;
  if (w === 'today' || w === 'tonight') return { day: today, n: 1 };
  if (w === 'tomorrow' || w === 'tmrw' || w === 'tmr') return { day: P.addDays(today, 1), n: 1 };
  if (w in WEEKDAYS) return { day: weekdayFrom(today, WEEKDAYS[w]), n: 1 };
  if (w === 'next' && w2 in WEEKDAYS) return { day: P.addDays(P.start(P.next(P.periodOf('week', today))), WEEKDAYS[w2]), n: 2 };
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(w)) && P.precision(w) === 'day') return { day: w, n: 1 };
  if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(w))) {
    const day = nextDate(today, Number(m[2]) - 1, Number(m[1]), m[3] && Number(m[3]));
    return day ? { day, n: 1 } : null;
  }
  const d = dayNum(w);
  if (d !== null && monthIndex(w2) >= 0) { const day = nextDate(today, monthIndex(w2), d); return day ? { day, n: 2 } : null; }
  if (monthIndex(w) >= 0 && dayNum(w2) !== null) { const day = nextDate(today, monthIndex(w), dayNum(w2)); return day ? { day, n: 2 } : null; }
  if (relative && (m = /^(\d+)([dwm])$/.exec(w))) {
    const k = Number(m[1]);
    if (m[2] === 'd') return { day: P.addDays(today, k), n: 1 };
    if (m[2] === 'w') return { day: P.addDays(today, 7 * k), n: 1 };
    const target = P.shift(P.periodOf('month', today), k);
    const dd = Math.min(Number(today.slice(8)), P.daysIn(target).length);
    return { day: `${target}-${pad(dd)}`, n: 1 };
  }
  return null;
}

/** A time at tokens[i] → { time: 'HH:MM', n } or null. */
function timeAt(tokens, i) {
  const w = (tokens[i] || '').toLowerCase();
  if (w === 'noon' || w === 'midday') return { time: '12:00', n: 1 };
  let m = /^(\d{1,2})(?:[:.](\d{2}))?(am|pm)$/.exec(w);
  if (m) {
    let hh = Number(m[1]); const mm = Number(m[2] || 0);
    if (hh < 1 || hh > 12 || mm > 59) return null;
    if (m[3] === 'am') hh = hh === 12 ? 0 : hh; else hh = hh === 12 ? 12 : hh + 12;
    return { time: `${pad(hh)}:${pad(mm)}`, n: 1 };
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(w);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return { time: `${pad(Number(m[1]))}:${m[2]}`, n: 1 };
  return null;
}

function coarseAt(tokens, i, today) {
  const w = (tokens[i] || '').toLowerCase(), w2 = (tokens[i + 1] || '').toLowerCase();
  if (w === 'someday') return { when: 'someday', n: 1 };
  if ((w === 'this' || w === 'next') && (w2 === 'week' || w2 === 'month')) {
    const cur = P.periodOf(w2, today);
    return { when: w === 'this' ? cur : P.next(cur), n: 2 };
  }
  return null;
}

function matchTag(tag, { areas = [], projects = [] }) {
  const s = slug(tag);
  if (!s) return null;
  const area = areas.find(a => slug(a.name) === s);
  if (area) return { area_id: area.id };
  const words = p => [slug(p.title), ...String(p.title).toLowerCase().split(/\s+/).map(slug)];
  const project = projects.find(p => words(p).some(x => x.startsWith(s)));
  if (project) return { project_id: project.id, area_id: project.area_id || '' };
  const areaPrefix = areas.find(a => slug(a.name).startsWith(s));
  if (areaPrefix) return { area_id: areaPrefix.id };
  return null;
}

export function parseCapture(text, ctx = {}) {
  const today = ctx.today || P.today();
  const tokens = String(text || '').trim().split(/\s+/).filter(Boolean);
  const r = { title: '', when: '', time: '', due: '', due_time: '', area_id: '', project_id: '', trip_id: '', priority: '' };
  const title = [];
  for (let i = 0; i < tokens.length;) {
    const raw = tokens[i], w = raw.toLowerCase();
    let hit;
    if (w === 'due' && (hit = dateAt(tokens, i + 1, today, { relative: true }))) {
      r.due = hit.day;
      i += 1 + hit.n;
      const t = timeAt(tokens, i) || (tokens[i]?.toLowerCase() === 'at' && timeAt(tokens, i + 1) && { ...timeAt(tokens, i + 1), n: 2 });
      if (t) { r.due_time = t.time; i += t.n; }
      continue;
    }
    if ((w === 'on' || w === 'at') && (hit = dateAt(tokens, i + 1, today) || timeAt(tokens, i + 1))) {
      i += 1; continue; // connector; the expression itself is handled next round
    }
    if ((hit = coarseAt(tokens, i, today))) { r.when = hit.when; i += hit.n; continue; }
    if ((hit = dateAt(tokens, i, today))) { r.when = hit.day; i += hit.n; continue; }
    if ((hit = timeAt(tokens, i))) { r.time = hit.time; i += hit.n; continue; }
    if (raw.startsWith('#') && raw.length > 1 && (hit = matchTag(raw.slice(1), ctx))) {
      if (hit.project_id) r.project_id = hit.project_id;
      if (hit.area_id) r.area_id = hit.area_id;
      i++; continue;
    }
    if (raw.startsWith('@') && raw.length > 1) {
      const s = slug(raw.slice(1));
      const trip = (ctx.trips || []).find(t => slug(t.title).includes(s) || slug(t.destination).includes(s));
      if (trip) { r.trip_id = trip.id; i++; continue; }
    }
    if (w === '!' || w === '!!' || w === '!high') { r.priority = 'high'; i++; continue; }
    title.push(raw);
    i++;
  }
  if (r.time && P.precision(r.when) !== 'day') r.when = today; // a time alone means today
  r.title = title.join(' ').trim();
  return r;
}

/** [[kind, label]] pairs describing what was parsed, for the capture preview. */
export function describeCapture(r, ctx = {}) {
  const today = ctx.today || P.today();
  const out = [];
  if (r.when) out.push(['when', P.relLabel(r.when, today)]);
  if (r.time) out.push(['time', r.time]);
  if (r.due) out.push(['due', P.fmtDayShort(r.due) + (r.due_time ? ' ' + r.due_time : '')]);
  if (r.project_id) out.push(['project', (ctx.projects || []).find(p => p.id === r.project_id)?.title || '?']);
  if (r.area_id) out.push(['area', (ctx.areas || []).find(a => a.id === r.area_id)?.name || '?']);
  if (r.trip_id) out.push(['trip', (ctx.trips || []).find(t => t.id === r.trip_id)?.title || '?']);
  if (r.priority) out.push(['priority', 'high']);
  if (!r.when) out.push(['when', 'Inbox']);
  return out;
}
