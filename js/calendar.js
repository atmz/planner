// Calendar: read events live for the visible range, create events from todos/deadlines/trips.
// Events are never copied into the Sheet. The provider is swappable (Google or mock):
//   provider.listCalendars()                       → [{id, summary, backgroundColor, primary}]
//   provider.listEvents(calendarId, start, end)    → raw Google-shaped events
//   provider.insert(calendarId, body)              → event
//   provider.patch(calendarId, eventId, body)      → event
//   provider.remove(calendarId, eventId)
import * as P from './periods.js';
import { store } from './store.js';

let provider = null;
const cache = new Map(); // "start|end" → {at, events, background, promise}
let calendarMeta = new Map(); // id → {summary, color, accessRole, primary}; 'primary' is an alias
let calendarList = [];
const TTL = 5 * 60_000;

export function setProvider(p) { provider = p; cache.clear(); }
export function available() { return !!provider; }
/** Mark cached ranges stale: they refetch on next read but keep showing until fresh data lands. */
export function invalidate() { for (const c of cache.values()) c.at = 0; }

const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const pad = n => String(n).padStart(2, '0');
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export async function listCalendars() {
  if (!provider) return [];
  const cals = await provider.listCalendars();
  calendarList = cals;
  calendarMeta = new Map(cals.map(c => [c.id, { summary: c.summary, color: c.backgroundColor, accessRole: c.accessRole, primary: !!c.primary }]));
  const primary = cals.find(c => c.primary);
  if (primary) calendarMeta.set('primary', calendarMeta.get(primary.id));
  return cals;
}

/** Calendars new events can go into (owner/writer), primary first. */
export function writableCalendars() {
  return calendarList
    .filter(c => ['owner', 'writer'].includes(c.accessRole))
    .map(c => ({ id: c.primary ? 'primary' : c.id, summary: c.summary, color: c.backgroundColor, primary: !!c.primary }))
    .sort((a, b) => b.primary - a.primary || a.summary.localeCompare(b.summary));
}
export const calendarName = id => calendarMeta.get(id)?.summary || (id === 'primary' ? 'Main calendar' : id);
const canEdit = (calendarId, ev) => {
  const role = calendarMeta.get(calendarId)?.accessRole ?? (calendarId === 'primary' ? 'owner' : 'reader');
  return ['owner', 'writer'].includes(role) && !['birthday', 'fromGmail'].includes(ev.eventType);
};

function selected(key) {
  return store.setting(key).split(',').map(s => s.trim()).filter(Boolean);
}

/** Normalise a Google event to {id, calendarId, title, allDay, start, end (inclusive), startTime, endTime, color, link}. */
export function normalise(ev, calendarId) {
  const base = {
    id: ev.id, calendarId, title: ev.summary || '(busy)', color: calendarMeta.get(calendarId)?.color, link: ev.htmlLink,
    location: ev.location || '', description: ev.description || '', recurring: !!ev.recurringEventId, editable: canEdit(calendarId, ev),
  };
  if (ev.start?.date) return { ...base, allDay: true, start: ev.start.date, end: P.addDays(ev.end?.date || P.addDays(ev.start.date, 1), -1) };
  const s = new Date(ev.start?.dateTime), e = new Date(ev.end?.dateTime || ev.start?.dateTime);
  // An event ending exactly at midnight belongs to the day it started.
  const endDay = P.dayOf(new Date(Math.max(s.getTime(), e.getTime() - 1)));
  return { ...base, allDay: false, start: P.dayOf(s), end: endDay, startTime: hhmm(s), endTime: hhmm(e) };
}

/**
 * Synchronous read for views: returns what's cached for [start, end] and kicks off a fetch if needed.
 * When the fetch lands, the store emits 'calendar' so views re-render.
 */
export function events(start, end) {
  if (!provider) return { events: [], background: [], loading: false };
  const key = `${start}|${end}`;
  let c = cache.get(key);
  if (!c || (Date.now() - c.at > TTL && !c.promise)) {
    c = { at: Date.now(), events: c?.events || [], background: c?.background || [], promise: null, error: null };
    cache.set(key, c);
    c.promise = fetchRange(start, end).then(r => {
      Object.assign(c, r, { at: Date.now(), promise: null });
      store.emit('calendar');
    }, err => {
      c.promise = null;
      c.error = err;
      console.warn('[planner] calendar fetch failed', err);
    });
  }
  return { events: c.events, background: c.background, loading: !!c.promise };
}

async function fetchRange(start, end) {
  if (!calendarMeta.size) { try { await listCalendars(); } catch { /* colours are optional */ } }
  const fg = selected('calendars');
  const bg = selected('background_calendars');
  const load = async ids => (await Promise.all(ids.map(async id => {
    try { return (await provider.listEvents(id, start, end)).filter(e => e.status !== 'cancelled').map(e => normalise(e, id)); }
    catch (e) { console.warn('[planner] calendar', id, e); return []; }
  }))).flat();
  const [events, background] = await Promise.all([load(fg.length ? fg : ['primary']), load(bg)]);
  const sortEv = (a, b) => a.start.localeCompare(b.start) || (a.allDay ? -1 : b.allDay ? 1 : (a.startTime || '').localeCompare(b.startTime || ''));
  return { events: events.sort(sortEv), background: background.sort(sortEv) };
}

/** Events touching a day. */
export function onDay(list, day) { return list.filter(e => e.start <= day && day <= e.end); }

// ---- creating events ---------------------------------------------------------

function timedBody(title, day, time, minutes = 30, description = '') {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const s = new Date(y, m - 1, d, hh, mm);
  const e = new Date(s.getTime() + minutes * 60_000);
  const iso = x => `${P.dayOf(x)}T${hhmm(x)}:00`;
  return { summary: title, description, start: { dateTime: iso(s), timeZone: tz() }, end: { dateTime: iso(e), timeZone: tz() } };
}
function allDayBody(title, startDay, endDay, description = '') {
  return { summary: title, description, start: { date: startDay }, end: { date: P.addDays(endDay, 1) } };
}
const done = r => { invalidate(); store.emit('calendar'); return r; };

/** Google event body from {title, allDay, start, end (inclusive), startTime, endTime, location?, description?}. */
export function eventBody(e) {
  const body = { summary: e.title };
  if (e.location !== undefined && e.location !== '') body.location = e.location;
  if (e.description !== undefined && e.description !== '') body.description = e.description;
  if (e.allDay) return { ...body, start: { date: e.start }, end: { date: P.addDays(e.end || e.start, 1) } };
  return { ...body, start: { dateTime: `${e.start}T${e.startTime}:00`, timeZone: tz() }, end: { dateTime: `${e.end || e.start}T${e.endTime}:00`, timeZone: tz() } };
}

export const createEvent = (calendarId, e) => provider.insert(calendarId || 'primary', eventBody(e)).then(done);
export const updateEvent = (calendarId, id, e) => provider.patch(calendarId, id, eventBody(e)).then(done);
export const deleteEvent = (calendarId, id) => provider.remove(calendarId, id).then(done);

export const insertTaskEvent = t => provider.insert('primary', timedBody(t.title, t.when, t.time, 30, t.notes)).then(done);
export const updateTaskEvent = t => provider.patch('primary', t.event_id, timedBody(t.title, t.when, t.time, 30, t.notes)).then(done);
export const insertDeadlineEvent = t => provider.insert('primary', allDayBody(`Due: ${t.title}`, t.due, t.due)).then(done);
export const updateDeadlineEvent = t => provider.patch('primary', t.due_event_id, allDayBody(`Due: ${t.title}`, t.due, t.due)).then(done);

const tripTitle = trip => `${trip.title}${trip.destination ? ' — ' + trip.destination : ''}`;
export const insertTripEvent = trip => provider.insert('primary', allDayBody(tripTitle(trip), trip.start, trip.end, trip.notes)).then(done);
export const updateTripEvent = trip => provider.patch('primary', trip.event_id, allDayBody(tripTitle(trip), trip.start, trip.end, trip.notes)).then(done);

// ---- Google provider -----------------------------------------------------------

export function googleProvider(api) {
  const base = 'https://www.googleapis.com/calendar/v3';
  return {
    async listCalendars() {
      const r = await api(`${base}/users/me/calendarList?maxResults=250`);
      return r.items || [];
    },
    async listEvents(calendarId, start, end) {
      const out = [];
      let pageToken = '';
      do {
        const q = new URLSearchParams({
          singleEvents: 'true', orderBy: 'startTime', maxResults: '2500',
          timeMin: new Date(`${start}T00:00:00`).toISOString(),
          timeMax: new Date(`${P.addDays(end, 1)}T00:00:00`).toISOString(),
        });
        if (pageToken) q.set('pageToken', pageToken);
        const r = await api(`${base}/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
        out.push(...(r.items || []));
        pageToken = r.nextPageToken || '';
      } while (pageToken);
      return out;
    },
    insert(calendarId, body) {
      return api(`${base}/calendars/${encodeURIComponent(calendarId)}/events`, { method: 'POST', body });
    },
    patch(calendarId, id, body) {
      return api(`${base}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'PATCH', body });
    },
    remove(calendarId, id) {
      return api(`${base}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}
