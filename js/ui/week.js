// Week: two-page spread (Mon–Wed + focus | Thu–Sun + notes) with a side rail. Stacks day-by-day on phones.
import * as P from '../periods.js';
import { tasksAt, carriedOver, today } from '../store.js';
import { h, section, focusBlock, notesBlock } from './components.js';
import { taskList, addLine, moveTask } from './task.js';
import { dueSoonStrip, calRange, eventList, holidayLabels, dueMarkers, tripBanners, goalsInPlay, reviewLink, addEventButton } from './shared.js';
import * as cal from '../calendar.js';

export function render(week) {
  const td = today();
  const days = P.daysIn(week);
  const { events, background } = calRange(days[0], days[6]);
  const month = P.convert(week, 'month');
  const quarter = P.convert(week, 'quarter');
  const isThisWeek = P.contains(week, td);

  const dayCell = (day, cls = '') => h('div.day-cell', { class: [cls, day === td ? 'today' : '', P.dow(day) >= 5 ? 'weekend' : ''].join(' '), dataset: { dropWhen: day } },
    h('div.day-cell-top',
      h('a.day-cell-head', { href: `#/day/${day}` },
        h('span.dow', P.DOW3[P.dow(day)]), h('span.date', String(Number(day.slice(8)))),
        day.slice(8) === '01' || day === days[0] ? h('span.muted.small', P.MON3[Number(day.slice(5, 7)) - 1]) : null),
      cal.available() ? addEventButton(day) : null),
    holidayLabels(background, day),
    tripBanners(day),
    eventList(events, day, { compact: true }),
    taskList(tasksAt(day), { hide: ['when'] }),
    dueMarkers(day),
    addLine({ when: day }, { placeholder: `Add to ${P.DOW3[P.dow(day)]}…` }));

  const rail = h('aside.rail',
    reviewLink(week),
    section('This week, no day yet', h('div.drop-zone', { dataset: { dropWhen: week } },
      taskList(tasksAt(week, { includeDone: false }), { hide: ['when'], actions: t => dayPicker(t, days) }),
      addLine({ when: week }, { placeholder: 'Add to this week…' }))),
    section('From this month', h('div.drop-zone', { dataset: { dropWhen: month } },
      taskList(tasksAt(month, { includeDone: false }), {
        hide: ['when'],
        actions: t => h('button.chip', { type: 'button', onclick: () => moveTask(t.id, week), title: 'Pull into this week' }, '→ week'),
        emptyText: 'Nothing waiting at month level.',
      }))),
    isThisWeek && carriedOver(days[0]).length ? section('Carried over', taskList(carriedOver(days[0]), {
      actions: t => h('button.chip', { type: 'button', onclick: () => moveTask(t.id, td) }, 'Today'),
    })) : null,
    goalsInPlay([month, quarter]));

  return h('div.page.week-page',
    isThisWeek ? dueSoonStrip(td) : null,
    h('div.week-layout',
      h('div.spread',
        h('div.page-paper.left',
          days.slice(0, 3).map(d => dayCell(d)),
          focusBlock(week, 'Week focus')),
        h('div.spine', { 'aria-hidden': 'true' }),
        h('div.page-paper.right',
          days.slice(3, 5).map(d => dayCell(d)),
          h('div.weekend-pair', dayCell(days[5], 'half'), dayCell(days[6], 'half')),
          notesBlock(week))),
      rail));
}

function dayPicker(t, days) {
  return h('span.day-picker', days.map(d => h('button.chip.tiny', { type: 'button', title: P.fmtDayShort(d), onclick: () => moveTask(t.id, d) }, P.DOW3[P.dow(d)][0])));
}
