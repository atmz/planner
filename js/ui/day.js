// Day page: focus, events timeline, todos, due items, trip items, "also this week", carried over.
import * as P from '../periods.js';
import { store, tasksAt, carriedOver, today } from '../store.js';
import { h, section, focusBlock, notesBlock, empty } from './components.js';
import { taskList, addLine, moveTask } from './task.js';
import { dueSoonStrip, tripBanners, calRange, eventList, holidayLabels, dueMarkers } from './shared.js';

const KIND_ICON = { flight: '✈', stay: '🛏', transport: '🚗', activity: '★', food: '🍴', note: '✎' };

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
        dueMarkers(day) ? section('Due today', dueMarkers(day)) : null,
        carried.length ? section('Carried over', taskList(carried, {
          actions: t => h('button.chip', { type: 'button', onclick: () => moveTask(t.id, td) }, 'Do today'),
        })) : null),
      h('div.page-paper.right',
        section('Schedule' + (loading ? ' …' : ''), eventList(events, day) || empty(loading ? 'Loading calendar…' : 'No events.')),
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
