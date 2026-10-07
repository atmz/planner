// Month: calendar grid (events, day todos, due markers, trip bars) + focus, goals, undated todos, notes.
import * as P from '../periods.js';
import { store, tasksAt, dueState, remindDefault, tripColor, today } from '../store.js';
import * as cal from '../calendar.js';
import { h, section, focusBlock, notesBlock, go } from './components.js';
import { taskList, addLine } from './task.js';
import { calRange, goalsInPlay, reviewLink, printTools } from './shared.js';

/** Assign each trip overlapping [start,end] a lane so overlapping trips stack. */
export function tripLanes(trips, start, end) {
  const list = trips.filter(t => t.status !== 'cancelled' && t.start && t.end && t.start <= end && t.end >= start)
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
  const laneEnds = [];
  const lanes = new Map();
  for (const t of list) {
    let i = laneEnds.findIndex(e => e < t.start);
    if (i < 0) { i = laneEnds.length; laneEnds.push(t.end); } else laneEnds[i] = t.end;
    lanes.set(t.id, i);
  }
  return { list, lanes, count: laneEnds.length };
}

export function render(month) {
  const td = today();
  const weeks = [];
  for (let w = P.periodOf('week', P.start(month)); P.start(w) <= P.end(month); w = P.next(w)) weeks.push(w);
  const gridStart = P.start(weeks[0]), gridEnd = P.end(weeks[weeks.length - 1]);
  const { events, background } = calRange(gridStart, gridEnd);
  const { list: trips, lanes, count: laneCount } = tripLanes(store.all('Trips'), gridStart, gridEnd);
  const rd = remindDefault();

  const cell = day => {
    const inMonth = P.contains(month, day);
    const holidays = cal.onDay(background, day);
    const evs = cal.onDay(events, day);
    const dayTodos = tasksAt(day);
    const due = store.all('Tasks').filter(t => t.due === day && !t.done && !t.list_id);
    const strips = Array.from({ length: laneCount }, (_, lane) => {
      const t = trips.find(x => lanes.get(x.id) === lane && x.start <= day && day <= x.end);
      if (!t) return h('div.trip-strip.empty');
      const first = day === t.start || P.dow(day) === 0;
      return h('a.trip-strip', {
        href: `#/trip/${t.id}`, title: `${t.title} · ${P.fmtRange(t.start, t.end)}`,
        class: [day === t.start ? 'start' : '', day === t.end ? 'end' : '', t.status === 'idea' ? 'idea' : ''].join(' '),
        style: { '--trip': tripColor(t) },
      }, first ? t.title : ' ');
    });
    return h('div.month-cell', {
      class: [inMonth ? '' : 'outside', day === td ? 'today' : '', P.dow(day) >= 5 ? 'weekend' : '', holidays.length ? 'holiday' : ''].join(' '),
      dataset: { dropWhen: day },
      title: holidays.map(e => e.title).join(', ') || undefined,
      onclick: e => { if (!e.target.closest('a,button,input,select')) go(`#/day/${day}`); },
    },
      h('div.month-cell-head',
        h('a.month-day', { href: `#/day/${day}` }, String(Number(day.slice(8)))),
        holidays.length ? h('span.holiday-label', holidays[0].title) : null),
      h('div.strips', strips),
      evs.slice(0, 3).map(e => h('div.mini-event', { style: { '--ev': e.color || 'var(--accent)' }, title: e.title }, e.allDay ? '' : e.startTime + ' ', e.title)),
      evs.length > 3 ? h('div.more', `+${evs.length - 3} more`) : null,
      dayTodos.length ? taskList(dayTodos, { compact: true }) : null,
      due.map(t => h('div.mini-due', { class: dueState(t, td, rd) || '', title: `Due: ${t.title}` }, '⚑ ', t.title)));
  };

  return h('div.page.month-page',
    printTools(P.label(month)),
    h('div.month-layout',
      h('div.page-paper.month-grid-wrap',
        h('div.month-grid',
          h('div.mg-head.wk', ''),
          P.DOW3.map(d => h('div.mg-head', d)),
          weeks.map(w => [
            h('a.wk', { href: `#/week/${w}`, title: P.label(w) }, 'W' + w.slice(-2)),
            ...P.daysIn(w).map(cell),
          ]))),
      h('aside.rail',
        reviewLink(month),
        focusBlock(month, 'Month focus'),
        goalsInPlay([month], 'Month goals'),
        section('This month, no date yet', h('div.drop-zone', { dataset: { dropWhen: month } },
          taskList(tasksAt(month, { includeDone: false }), { hide: ['when'] }),
          addLine({ when: month }, { placeholder: 'Add to this month…' }))),
        notesBlock(month))));
}
