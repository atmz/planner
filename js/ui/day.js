// Day page: focus, events timeline, todos, due items, trip items, "also this week", carried over.
import * as P from '../periods.js';
import { store, tasksAt, carriedOver, today } from '../store.js';
import { h, section, focusBlock, notesBlock } from './components.js';
import { taskList, addLine, moveTask } from './task.js';
import { dueSoonStrip, tripBanners, calRange, holidayLabels, dueMarkers, eventChip, addEventButton } from './shared.js';
import * as cal from '../calendar.js';
import { openCapture } from './event.js';
import { habitsPanel } from './habits.js';

const KIND_ICON = { flight: '✈', stay: '🛏', transport: '🚗', activity: '★', food: '🍴', note: '✎' };

const pad = n => String(n).padStart(2, '0');

/** All-day events, then one row per hour; empty rows are clickable to add an event at that time. */
function timeline(events, day) {
  const todays = cal.onDay(events, day);
  const allDay = todays.filter(e => e.allDay || e.start !== e.end);
  const timed = todays.filter(e => !e.allDay && e.start === e.end).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const hours = timed.map(e => Number(e.startTime.slice(0, 2)));
  const first = Math.min(7, ...hours), last = Math.max(21, ...hours);
  const nowH = day === today() ? new Date().getHours() : -1;
  const canAdd = cal.available();
  const rows = [];
  for (let hr = first; hr <= last; hr++) {
    const time = `${pad(hr)}:00`;
    const here = timed.filter(e => Number(e.startTime.slice(0, 2)) === hr);
    rows.push(h('div.slot', {
      class: [here.length ? 'busy' : '', hr === nowH ? 'now' : '', canAdd ? 'addable' : ''].join(' '),
      dataset: { time },
      title: canAdd ? `Add an event at ${time}` : undefined,
      onclick: canAdd ? e => { if (!e.target.closest('button.event')) openCapture({ mode: 'event', day, time }); } : undefined,
    },
      h('span.slot-time', time),
      h('span.slot-events', here.map(e => eventChip(e, { label: [h('span.ev-time', `${e.startTime}–${e.endTime}`), ' ', e.title], title: `${e.startTime}–${e.endTime} ${e.title}${e.location ? ' · ' + e.location : ''}` })))));
  }
  return h('div.timeline',
    allDay.length ? h('div.events.all-day-row', allDay.map(e => eventChip(e, { cls: 'all-day' }))) : null,
    rows);
}

export function render(day) {
  const td = today();
  const week = P.periodOf('week', day);
  const { events, background, loading } = calRange(day, day);
  const dayTasks = tasksAt(day).sort((a, b) => (a.done - b.done) || (a.time || '99').localeCompare(b.time || '99') || (a.order ?? 0) - (b.order ?? 0));
  const tripItems = store.all('TripItems').filter(i => i.date === day || (i.kind === 'stay' && i.date < day && day < (i.end_date || i.date)))
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const alsoWeek = tasksAt(week, { includeDone: false });
  const carried = day === td ? carriedOver(td) : [];

  return h('div.page.day-page',
    day === td ? dueSoonStrip(td) : null,
    tripBanners(day),
    h('div.day-grid',
      h('div.page-paper.left',
        h('div.day-head', h('span.big-date', String(Number(day.slice(8)))), h('div', h('div.dow', P.DOW3[P.dow(day)]), h('div.muted', P.label(P.periodOf('month', day)))), holidayLabels(background, day)),
        focusBlock(day, 'Focus today'),
        section('Todos',
          h('div.drop-zone', { dataset: { dropWhen: day } },
            taskList(dayTasks, { hide: ['when'], emptyText: 'Nothing planned yet.' }),
            addLine({ when: day }, { placeholder: 'Add a todo for this day…' }))),
        habitsPanel(day),
        dueMarkers(day) ? section('Due today', dueMarkers(day)) : null,
        carried.length ? section('Carried over', taskList(carried, {
          actions: t => h('button.chip', { type: 'button', onclick: () => moveTask(t.id, td) }, 'Do today'),
        })) : null),
      h('div.page-paper.right',
        section(h('span', 'Schedule' + (loading ? ' …' : ''), cal.available() ? addEventButton(day) : null), timeline(events, day)),
        tripItems.length ? section('Trip plans', h('ul.trip-items', tripItems.map(i => h('li',
          h('span.kind', KIND_ICON[i.kind] || '•'), ' ',
          i.date < day ? h('span', 'Staying: ') : (i.time ? h('span.ev-time', i.time + ' ') : null),
          h('a', { href: `#/trip/${i.trip_id}` }, i.title),
          i.location ? h('span.muted', ' · ' + i.location) : null)))) : null,
        alsoWeek.length ? section('Also this week', h('div.drop-zone', { dataset: { dropWhen: week } }, taskList(alsoWeek, {
          hide: ['when'],
          actions: t => h('button.chip', { type: 'button', onclick: () => moveTask(t.id, day) }, day === td ? 'Do today' : 'Do this day'),
        }))) : null,
        notesBlock(day))));
}
