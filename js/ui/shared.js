// View blocks shared by several pages: due-soon strip, trip banners, events, goals in play.
import * as P from '../periods.js';
import { store, dueSoon, dueState, remindDefault, tripsOn, tripColor, goalProgress, areaOf, today } from '../store.js';
import * as cal from '../calendar.js';
import { h, section, progressBar, areaDot, empty } from './components.js';
import { taskRow } from './task.js';

export function dueSoonStrip(day = today()) {
  const items = dueSoon(day);
  if (!items.length) return null;
  return h('section.due-strip', { 'aria-label': 'Due soon' },
    h('span.due-strip-title', 'Due soon'),
    h('div.due-strip-items', items.map(t => taskRow(t, { compact: false, hide: ['when', 'project', 'goal', 'trip'] }))));
}

export function tripBanners(day) {
  return tripsOn(day, store.all('Trips')).map(trip => {
    const n = P.diffDays(trip.start, day) + 1, total = P.diffDays(trip.start, trip.end) + 1;
    return h('a.trip-banner', { href: `#/trip/${trip.id}`, style: { '--trip': tripColor(trip) }, class: trip.status === 'idea' ? 'idea' : '' },
      '✈ ', trip.title, h('span.muted', ` · day ${n}/${total}`));
  });
}

/** Calendar data for a range (sync, cached; re-renders when it arrives). */
export function calRange(start, end) { return cal.events(start, end); }

export function holidayLabels(background, day) {
  const hs = cal.onDay(background, day);
  return hs.length ? h('div.holidays', hs.map(e => h('span.holiday', { title: e.title }, e.title))) : null;
}

export function eventList(events, day, { compact = false } = {}) {
  const todays = cal.onDay(events, day);
  if (!todays.length) return null;
  const allDay = todays.filter(e => e.allDay || e.start !== e.end);
  const timed = todays.filter(e => !e.allDay && e.start === e.end);
  return h('div.events', { class: compact ? 'compact' : '' },
    allDay.map(e => h('div.event.all-day', { style: { '--ev': e.color || 'var(--accent)' }, title: e.title }, e.title)),
    timed.map(e => h('div.event', { style: { '--ev': e.color || 'var(--accent)' }, title: `${e.startTime}–${e.endTime} ${e.title}` },
      h('span.ev-time', e.startTime), ' ', e.title)));
}

/** Tasks due on `day` that aren't scheduled on that day (they'd otherwise be invisible there). */
export function dueMarkers(day, { exclude = new Set() } = {}) {
  const rd = remindDefault(), td = today();
  const list = store.all('Tasks').filter(t => t.due === day && !t.done && !exclude.has(t.id) && t.when !== day && !t.list_id);
  if (!list.length) return null;
  return h('div.due-markers', list.map(t =>
    h('button.due-marker', { type: 'button', class: dueState(t, td, rd) || '', onclick: () => import('./task.js').then(m => m.openTaskEditor(t.id)), title: `Due ${t.due_time || ''}: ${t.title}` },
      '⚑ ', t.title)));
}

export function goalsInPlay(periods, title = 'Goals in play') {
  const goals = store.all('Goals').filter(g => periods.includes(g.when) && g.status === 'active')
    .sort((a, b) => P.RANK[P.precision(b.when)] - P.RANK[P.precision(a.when)] || (a.order ?? 0) - (b.order ?? 0));
  return section(title, goals.length ? h('ul.goal-list', goals.map(goalLine)) : empty('No active goals.'));
}

export function goalLine(g) {
  const pr = goalProgress(g);
  return h('li.goal-line',
    areaDot(g),
    h('a', { href: `#/goal/${g.id}` }, g.title),
    h('span.muted.small', ' ', P.relLabel(g.when)),
    progressBar(pr.shown, { label: `${pr.shown}%${pr.computed !== null && pr.manual !== null ? ` (todos: ${pr.computed}%)` : ''}` }));
}

export function reviewLink(period) {
  const rec = store.period(period);
  const t = P.precision(period);
  if (t === 'day') return null;
  return h('a.button.review-btn', { href: `#/review/${period}` }, rec.reviewed_at ? `✓ Reviewed · review again` : `Review this ${t}`);
}

/** Print button + a title that only appears on paper (the header with the period name is hidden when printing). */
export function printTools(title) {
  return [
    window.PLANNER_DEMO ? null : h('div.page-tools', h('button', { type: 'button', class: 'print-btn', onclick: () => window.print(), title: 'Print this page (landscape works best)' }, 'Print')),
    h('h1.print-title', title),
  ];
}

export { areaOf };
