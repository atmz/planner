// Trips list and trip page: itinerary, bookings, prep todos, packing list, calendar sync.
import * as P from '../periods.js';
import { store, tasks, trips as allTrips, tripColor, packingList, listItems, today } from '../store.js';
import * as cal from '../calendar.js';
import { h, section, empty, chip, selectEl, areaSelect, inlineInput, modal, liveModal, toast, confirmAction, go, safeHref } from './components.js';
import { taskList, addLine } from './task.js';

const STATUSES = ['idea', 'planning', 'booked', 'done', 'cancelled'];
const KINDS = [['flight', '✈ Flight'], ['stay', '🛏 Stay'], ['transport', '🚗 Transport'], ['activity', '★ Activity'], ['food', '🍴 Food'], ['note', '✎ Note']];
const KIND_ICON = Object.fromEntries(KINDS.map(([k, l]) => [k, l.split(' ')[0]]));
const PREP_SUGGESTIONS = [
  ['Book flights', -56], ['Check passports are valid', -42], ['Arrange pet sitter', -14],
  ['Book airport parking', -10], ['Online check-in', -1], ['Pack', -1],
];

// ---- list -------------------------------------------------------------------

function countdown(trip, td) {
  if (trip.start <= td && td <= trip.end) return `day ${P.diffDays(trip.start, td) + 1} of ${P.diffDays(trip.start, trip.end) + 1}`;
  const n = P.diffDays(td, trip.start);
  if (n > 0) return n === 1 ? 'tomorrow' : `in ${n} days`;
  return '';
}

function tripCard(trip, td) {
  const prep = tasks(t => t.trip_id === trip.id && !t.list_id && !t.done);
  const nextDue = prep.filter(t => t.due).sort((a, b) => a.due.localeCompare(b.due))[0];
  return h('a.trip-card', { href: `#/trip/${trip.id}`, style: { '--trip': tripColor(trip) }, class: trip.status },
    h('div.trip-card-head', h('strong', trip.title), chip(trip.status, { cls: 'status ' + trip.status })),
    h('div.muted', [trip.destination, trip.start && trip.end ? P.fmtRange(trip.start, trip.end) : 'dates tbc'].filter(Boolean).join(' · ')),
    h('div.trip-card-foot',
      countdown(trip, td) ? h('span.countdown', countdown(trip, td)) : null,
      prep.length ? h('span', `${prep.length} prep todo${prep.length > 1 ? 's' : ''}`) : null,
      nextDue ? h('span', `next: ${nextDue.title} · ${P.fmtDayShort(nextDue.due)}`) : null));
}

export function newTripDialog() {
  modal(close => {
    const title = h('input', { type: 'text', placeholder: 'e.g. Lakeside — half term', required: true });
    const start = h('input', { type: 'date' }), end = h('input', { type: 'date' });
    start.addEventListener('change', () => { if (!end.value || end.value < start.value) end.value = start.value; });
    return h('form.editor', { onsubmit: e => {
      e.preventDefault();
      if (!title.value.trim()) return;
      const trip = store.add('Trips', { title: title.value.trim(), start: start.value, end: end.value || start.value, status: start.value ? 'planning' : 'idea' });
      store.add('Lists', { title: `Packing — ${trip.title}`, trip_id: trip.id });
      close();
      go(`#/trip/${trip.id}`);
    } },
      h('h3', 'New trip'),
      h('label.field', h('span', 'Title'), title),
      h('div.field-row', h('label.field', h('span', 'From'), start), h('label.field', h('span', 'To'), end)),
      h('div.actions', h('button', { type: 'button', onclick: close }, 'Cancel'), h('button.primary', { type: 'submit' }, 'Create trip')));
  });
}

export function renderList() {
  const td = today();
  const all = allTrips();
  const current = all.filter(t => t.status !== 'cancelled' && t.start && t.start <= td && td <= t.end);
  const upcoming = all.filter(t => !['idea', 'cancelled', 'done'].includes(t.status) && t.start > td);
  const ideas = all.filter(t => t.status === 'idea' && !(t.end && t.end < td));
  const past = all.filter(t => t.status !== 'cancelled' && !current.includes(t) && !upcoming.includes(t) && !ideas.includes(t)).reverse();
  const cancelled = all.filter(t => t.status === 'cancelled');
  const grid = list => h('div.trip-grid', list.map(t => tripCard(t, td)));
  return h('div.page.trips-page',
    h('div.page-head', h('h2', 'Trips'), h('button.primary', { type: 'button', onclick: newTripDialog }, '+ New trip')),
    current.length ? section('Now', grid(current)) : null,
    section('Upcoming', upcoming.length ? grid(upcoming) : empty('Nothing booked yet.')),
    section('Ideas', ideas.length ? grid(ideas) : empty('No trip ideas.')),
    past.length ? section('Past', grid(past)) : null,
    cancelled.length ? h('details.panel', h('summary', `Cancelled (${cancelled.length})`), grid(cancelled)) : null);
}

// ---- trip page ----------------------------------------------------------------

function setTrip(trip, patch) {
  const before = { ...trip };
  if (patch.start && (!trip.end || trip.end < patch.start) && !patch.end) patch.end = patch.start;
  store.update('Trips', trip.id, patch);
  const after = store.get('Trips', trip.id);
  if (after.event_id && cal.available() && (before.start !== after.start || before.end !== after.end || before.title !== after.title || before.destination !== after.destination) && after.start && after.end) {
    cal.updateTripEvent(after).then(() => toast('Calendar event updated'), e => toast('Calendar: ' + e.message));
  }
  if (patch.title) {
    const pl = packingList(trip.id);
    if (pl && pl.title === `Packing — ${before.title}`) store.update('Lists', pl.id, { title: `Packing — ${patch.title}` });
  }
}

function itemEditor(id) {
  liveModal(close => {
    const it = store.get('TripItems', id);
    if (!it) { close(); return h('p', 'Deleted.'); }
    const set = patch => store.update('TripItems', id, patch);
    const field = (label, key, type = 'text', attrs = {}) => h('label.field', h('span', label),
      type === 'text' || type === 'url'
        ? inlineInput(it[key], v => set({ [key]: v }), { type, ...attrs })
        : h('input', { type, value: it[key] ?? '', ...attrs, onchange: e => set({ [key]: type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value }) }));
    return h('form.editor', { onsubmit: e => { e.preventDefault(); close(); } },
      h('div.editor-head', selectEl(KINDS, it.kind, v => set({ kind: v })), inlineInput(it.title, v => set({ title: v }), { class: 'title-input', 'aria-label': 'Title' }), h('button.icon', { type: 'button', onclick: close, 'aria-label': 'Close' }, '×')),
      h('div.field-row', field('Date', 'date', 'date'), field('Time', 'time', 'time')),
      h('div.field-row', field(it.kind === 'stay' ? 'Check-out' : 'End date', 'end_date', 'date'), field('End time', 'end_time', 'time')),
      field('Location', 'location'), field('Booking reference', 'reference'), field('Link', 'link', 'url'),
      h('div.field-row', field('Cost', 'cost', 'number', { step: '0.01', min: 0 }), field('Currency', 'currency', 'text', { placeholder: 'EUR', maxlength: 3 })),
      h('label.field', h('span', 'Notes'), inlineInput(it.notes, v => set({ notes: v }), { multiline: true, rows: 3 })),
      h('div.actions', h('span.spacer'),
        h('button.danger', { type: 'button', onclick: () => confirmAction(`Delete “${it.title}”?`, () => { store.remove('TripItems', id); close(); }) }, 'Delete'),
        h('button.primary', { type: 'submit' }, 'Done')));
  });
}

function addItemForm(trip, day) {
  const kind = selectEl(KINDS, 'activity', () => {}, { 'aria-label': 'Kind' });
  const title = h('input', { type: 'text', placeholder: 'Add flight, stay, activity…', 'aria-label': 'Item title' });
  const time = h('input', { type: 'time', 'aria-label': 'Time' });
  return h('form.add-item', { onsubmit: e => {
    e.preventDefault();
    if (!title.value.trim()) return;
    const order = store.all('TripItems').filter(i => i.trip_id === trip.id).length;
    store.add('TripItems', { trip_id: trip.id, kind: kind.value, title: title.value.trim(), date: day, time: time.value, end_date: kind.value === 'stay' ? P.addDays(day, 1) : '', order });
  } }, kind, title, time, h('button', { type: 'submit' }, 'Add'));
}

function itemLine(it, day) {
  const staying = it.kind === 'stay' && it.date < day;
  const nights = it.kind === 'stay' && it.end_date ? P.diffDays(it.date, it.end_date) : 0;
  return h('li.trip-item', { class: it.kind },
    h('span.kind', KIND_ICON[it.kind] || '•'),
    staying ? h('span.muted', `Night ${P.diffDays(it.date, day) + 1}/${nights} · `) : it.time ? h('span.ev-time', it.time + (it.end_time ? '–' + it.end_time : '') + ' ') : null,
    h('button.link', { type: 'button', onclick: () => itemEditor(it.id) }, it.title),
    !staying && it.kind === 'stay' && nights ? h('span.muted', ` · ${nights} night${nights > 1 ? 's' : ''}`) : null,
    it.location && !staying ? h('span.muted', ' · ' + it.location) : null,
    it.reference && !staying ? h('span.ref', it.reference) : null,
    it.link && !staying && safeHref(it.link) ? h('a.small', { href: safeHref(it.link), target: '_blank', rel: 'noopener' }, ' link ↗') : null);
}

function itinerary(trip, items) {
  if (!trip.start || !trip.end) return empty('Set the trip dates to plan the itinerary.');
  const days = P.daysBetween(trip.start, trip.end);
  const onDay = day => items.filter(i => i.date === day || (i.kind === 'stay' && i.date < day && day < (i.end_date || i.date)))
    .sort((a, b) => (a.date < day) - (b.date < day) || (a.time || '99').localeCompare(b.time || '99') || (a.order ?? 0) - (b.order ?? 0));
  const outside = items.filter(i => i.date && (i.date < trip.start || i.date > trip.end));
  const undated = items.filter(i => !i.date);
  return h('div.itinerary',
    days.map((day, i) => h('div.itin-day', { class: day === today() ? 'today' : '' },
      h('div.itin-head', h('a', { href: `#/day/${day}` }, `Day ${i + 1} · ${P.fmtDayShort(day)}`)),
      h('ul.trip-items', onDay(day).map(it => itemLine(it, day))),
      addItemForm(trip, day))),
    outside.length || undated.length ? h('div.itin-day',
      h('div.itin-head', 'Outside the trip dates / undated'),
      h('ul.trip-items', [...outside, ...undated].map(it => itemLine(it, it.date)))) : null);
}

function bookings(items) {
  const bk = items.filter(i => ['flight', 'stay', 'transport'].includes(i.kind)).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || ''));
  const totals = {};
  for (const i of items) if (i.cost) { const c = (i.currency || '—').toUpperCase(); totals[c] = (totals[c] || 0) + Number(i.cost); }
  return h('div',
    bk.length ? h('table.bookings',
      h('thead', h('tr', h('th', ''), h('th', 'What'), h('th', 'When'), h('th', 'Ref'), h('th.num', 'Cost'))),
      h('tbody', bk.map(i => h('tr',
        h('td', KIND_ICON[i.kind]),
        h('td', h('button.link', { type: 'button', onclick: () => itemEditor(i.id) }, i.title), i.location ? h('div.muted.small', i.location) : null),
        h('td', i.date ? P.fmtDayShort(i.date) : '', i.time ? ' ' + i.time : '', i.end_date && i.end_date !== i.date ? ` → ${P.fmtDayShort(i.end_date)}` : ''),
        h('td.ref', i.reference || ''),
        h('td.num', i.cost ? `${Number(i.cost).toFixed(2)} ${i.currency || ''}` : ''))))) : empty('No bookings yet — add flights, stays and transport in the itinerary.'),
    Object.keys(totals).length ? h('p.totals', 'Total (all items): ', Object.entries(totals).map(([c, v]) => h('strong', `${v.toFixed(2)} ${c} `))) : null);
}

function prepTodos(trip) {
  const prep = tasks(t => t.trip_id === trip.id && !t.list_id).sort((a, b) => (a.done - b.done) || (a.due || '9999').localeCompare(b.due || '9999'));
  const existing = new Set(prep.map(t => t.title.toLowerCase()));
  const suggestions = trip.start ? PREP_SUGGESTIONS.filter(([title]) => !existing.has(title.toLowerCase())) : [];
  return h('div',
    taskList(prep, { hide: ['trip'], emptyText: 'No prep todos yet.' }),
    addLine({ trip_id: trip.id, area_id: trip.area_id }, { placeholder: 'Add a prep todo…' }),
    suggestions.length ? h('div.suggestions', h('span.muted.small', 'Suggestions: '), suggestions.map(([title, offset]) => {
      const due = P.addDays(trip.start, offset);
      const rel = offset === -1 ? '1 day before' : offset % 7 === 0 ? `${-offset / 7} weeks before` : `${-offset} days before`;
      return h('button.chip', { type: 'button', title: `Due ${P.fmtDay(due)}`, onclick: () => store.add('Tasks', { title, trip_id: trip.id, area_id: trip.area_id, due: due < today() ? today() : due }) }, `+ ${title} (${rel})`);
    })) : null);
}

function packing(trip) {
  const list = packingList(trip.id);
  if (!list) return h('button', { type: 'button', onclick: () => store.add('Lists', { title: `Packing — ${trip.title}`, trip_id: trip.id, area_id: trip.area_id }) }, 'Start a packing list');
  const items = listItems(list.id);
  const others = store.all('Lists').filter(l => l.trip_id && l.trip_id !== trip.id && listItems(l.id).length);
  const copyFrom = otherId => {
    const have = new Set(items.map(i => i.title.toLowerCase()));
    let n = 0;
    for (const it of listItems(otherId)) if (!have.has(it.title.toLowerCase())) { store.add('Tasks', { title: it.title, list_id: list.id, trip_id: trip.id, order: items.length + n++ }); }
    toast(n ? `Copied ${n} item${n > 1 ? 's' : ''}` : 'Nothing new to copy');
  };
  return h('div.packing',
    h('div.checklist', items.map(t => h('label.check-item', { class: t.done ? 'done' : '' },
      h('input', { type: 'checkbox', checked: t.done, onchange: e => store.update('Tasks', t.id, { done: e.target.checked }) }),
      h('span', t.title),
      h('button.icon.small', { type: 'button', 'aria-label': `Remove ${t.title}`, onclick: e => { e.preventDefault(); store.remove('Tasks', t.id); } }, '×')))),
    addLine({ list_id: list.id, trip_id: trip.id, order: items.length }, { placeholder: 'Add to packing list…' }),
    h('div.toolbar',
      h('span.muted.small', `${items.filter(i => i.done).length}/${items.length} packed`),
      others.length ? selectEl([['', 'Copy from a previous trip…'], ...others.map(l => [l.id, store.get('Trips', l.trip_id)?.title || l.title])], '', v => v && copyFrom(v)) : null,
      items.some(i => i.done) ? h('button', { type: 'button', onclick: () => items.filter(i => i.done).forEach(i => store.update('Tasks', i.id, { done: false })) }, 'Reset ticks') : null,
      h('a.small', { href: `#/list/${list.id}` }, 'Open as list →')));
}

export function renderTrip(id) {
  const trip = store.get('Trips', id);
  if (!trip) return h('div.page', h('h2', 'Trip not found'), h('a', { href: '#/trips' }, '← Trips'));
  const items = store.all('TripItems').filter(i => i.trip_id === id);
  const td = today();
  const calBtn = !cal.available() || !trip.start ? null : trip.event_id
    ? h('span.chip.cal', { title: 'Mirrored as an all-day event; date changes sync automatically' }, '📅 In calendar')
    : h('button', { type: 'button', onclick: async () => {
      try { const ev = await cal.insertTripEvent(trip); store.update('Trips', id, { event_id: ev.id }); toast('Trip added to calendar'); }
      catch (e) { toast('Calendar: ' + e.message); }
    } }, '📅 Add trip to calendar');

  return h('div.page.trip-page', { style: { '--trip': tripColor(trip) } },
    h('a.small', { href: '#/trips' }, '← All trips'),
    h('div.page-paper.trip-header',
      h('div.trip-title-row',
        inlineInput(trip.title, v => v.trim() && setTrip(trip, { title: v.trim() }), { class: 'title-input big', 'aria-label': 'Trip title' }),
        countdown(trip, td) ? h('span.countdown', countdown(trip, td)) : null),
      h('div.field-row',
        h('label.field', h('span', 'Destination'), inlineInput(trip.destination, v => setTrip(trip, { destination: v }))),
        h('label.field', h('span', 'From'), h('input', { type: 'date', value: trip.start, onchange: e => setTrip(trip, { start: e.target.value }) })),
        h('label.field', h('span', 'To'), h('input', { type: 'date', value: trip.end, min: trip.start, onchange: e => setTrip(trip, { end: e.target.value }) })),
        h('label.field', h('span', 'Who'), inlineInput(trip.who, v => setTrip(trip, { who: v })))),
      h('div.field-row',
        h('label.field', h('span', 'Status'), selectEl(STATUSES.map(s => [s, s]), trip.status, v => setTrip(trip, { status: v }))),
        h('label.field', h('span', 'Area'), areaSelect(trip.area_id, v => setTrip(trip, { area_id: v }))),
        h('label.field', h('span', 'Colour'), h('input', { type: 'color', value: tripColor(trip), onchange: e => setTrip(trip, { color: e.target.value }) })),
        h('div.field', h('span', ' '), calBtn))),
    h('div.trip-layout',
      h('div.page-paper', section('Itinerary', itinerary(trip, items))),
      h('div.trip-side',
        h('div.page-paper', section('Prep todos', prepTodos(trip))),
        h('div.page-paper', section('Packing list', packing(trip))),
        h('div.page-paper', section('Bookings', bookings(items))),
        h('div.page-paper', section('Notes', inlineInput(trip.notes, v => setTrip(trip, { notes: v }), { multiline: true, rows: 5, class: 'ruled' }))),
        h('button.danger.small', { type: 'button', onclick: () => confirmAction(`Delete the trip “${trip.title}”? Its itinerary stays in the sheet (soft-deleted).`, () => {
          store.remove('Trips', id);
          for (const i of items) store.remove('TripItems', i.id);
          const pl = packingList(id); if (pl) store.remove('Lists', pl.id);
          go('#/trips');
        }) }, 'Delete trip'))));
}
