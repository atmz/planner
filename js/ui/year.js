// Year: the wall planner. 12 month rows × 31 day columns with trip bars, deadline markers,
// event density and holiday shading; mini calendars on phones. Also used by the Quarter view.
import * as P from '../periods.js';
import { store, dueState, remindDefault, tripColor, goalProgress, areas, today } from '../store.js';
import * as cal from '../calendar.js';
import { h, section, focusBlock, notesBlock, progressBar, areaDot, modal, go, isMobile, empty } from './components.js';
import { calRange, reviewLink, printTools } from './shared.js';
import { tripLanes } from './month.js';

const LAYER_KEY = 'planner-year-layers';
const LAYERS = [['trips', 'Trips'], ['deadlines', 'Deadlines'], ['events', 'Events'], ['holidays', 'Holidays']];
function getLayers() {
  try { return { trips: true, deadlines: true, events: true, holidays: true, ...JSON.parse(localStorage.getItem(LAYER_KEY) || '{}') }; }
  catch { return { trips: true, deadlines: true, events: true, holidays: true }; }
}
function setLayer(k, v) {
  const l = getLayers(); l[k] = v;
  try { localStorage.setItem(LAYER_KEY, JSON.stringify(l)); } catch { /* ignore */ }
  store.emit('data');
}

export function layerToggles() {
  const l = getLayers();
  return h('div.layers', { role: 'group', 'aria-label': 'Layers' }, LAYERS.map(([k, label]) =>
    h('label.chip', { class: l[k] ? 'on' : '' }, h('input', { type: 'checkbox', checked: l[k], onchange: e => setLayer(k, e.target.checked) }), label)));
}

/** Data for a set of months: events, holidays, deadlines indexed by day. */
function gather(months) {
  const start = P.start(months[0]), end = P.end(months[months.length - 1]);
  const { events, background } = calRange(start, end);
  const deadlines = new Map();
  for (const t of store.all('Tasks')) if (t.due && !t.done && t.due >= start && t.due <= end) {
    if (!deadlines.has(t.due)) deadlines.set(t.due, []);
    deadlines.get(t.due).push(t);
  }
  return { start, end, events, background, deadlines };
}

function showDeadlines(day, list) {
  modal(close => h('div.popover-list',
    h('h3', `Due ${P.label(day)}`),
    h('ul', list.map(t => h('li', h('button.link', { type: 'button', onclick: () => { close(); import('./task.js').then(m => m.openTaskEditor(t.id)); } }, t.title)))),
    h('div.actions', h('a.button', { href: `#/day/${day}`, onclick: close }, 'Open day'), h('button', { type: 'button', onclick: close }, 'Close'))));
}

function deadlineMarker(day, list, td, rd) {
  const worst = list.some(t => dueState(t, td, rd) === 'overdue') ? 'overdue' : list.some(t => dueState(t, td, rd) === 'soon') ? 'soon' : 'later';
  return h('button.dl', { type: 'button', class: worst, title: list.map(t => '⚑ ' + t.title).join('\n'), 'aria-label': `${list.length} due`, onclick: e => { e.stopPropagation(); showDeadlines(day, list); } },
    list.length > 1 ? String(list.length) : '');
}

/** Desktop wall planner rows for `months`. */
export function wallPlanner(months) {
  const td = today(), rd = remindDefault();
  const layers = getLayers();
  const { start, end, events, background, deadlines } = gather(months);
  const trips = layers.trips ? tripLanes(store.all('Trips'), start, end).list : [];

  const rows = months.map(month => {
    const days = P.daysIn(month);
    const mStart = days[0], mEnd = days[days.length - 1];
    const { lanes, count } = tripLanes(trips, mStart, mEnd);
    const multi = layers.events ? events.filter(e => e.start !== e.end && e.start <= mEnd && e.end >= mStart) : [];
    const cells = [];
    for (let d = 1; d <= 31; d++) {
      const day = days[d - 1];
      if (!day) { cells.push(h('div.wp-cell.void')); continue; }
      const hol = layers.holidays ? cal.onDay(background, day) : [];
      const singles = layers.events ? events.filter(e => e.start === day && e.end === day) : [];
      const dl = layers.deadlines ? deadlines.get(day) : null;
      cells.push(h('div.wp-cell', {
        class: [P.dow(day) >= 5 ? 'weekend' : '', day === td ? 'today' : '', hol.length ? 'holiday' : '', day < td ? 'past' : ''].join(' '),
        title: [P.fmtDay(day), ...hol.map(e => e.title)].join('\n'),
        onclick: () => go(`#/day/${day}`),
      },
        h('span.wp-dow', P.DOW3[P.dow(day)][0]),
        h('span.wp-num', String(d)),
        singles.length ? h('span.ev-dots', { title: singles.map(e => `${e.startTime || ''} ${e.title}`).join('\n') }, '•'.repeat(Math.min(3, singles.length))) : null,
        dl ? deadlineMarker(day, dl, td, rd) : null));
    }
    const pos = (s, e) => {
      const a = Math.max(1, s < mStart ? 1 : Number(s.slice(8))), b = e > mEnd ? days.length : Number(e.slice(8));
      return { left: `${((a - 1) / 31) * 100}%`, width: `${((b - a + 1) / 31) * 100}%` };
    };
    const bars = [
      ...trips.filter(t => lanes.has(t.id)).map(t => h('a.wp-trip', {
        href: `#/trip/${t.id}`, title: `${t.title} · ${P.fmtRange(t.start, t.end)} · ${t.status}`,
        class: [t.status === 'idea' ? 'idea' : '', t.start < mStart ? 'cont-left' : '', t.end > mEnd ? 'cont-right' : ''].join(' '),
        style: { ...pos(t.start, t.end), top: `calc(var(--wp-head) + ${lanes.get(t.id)} * var(--wp-lane))`, '--trip': tripColor(t) },
        onclick: e => e.stopPropagation(),
      }, t.title)),
      ...multi.map((e, i) => h('span.wp-event', { title: `${e.title} · ${P.fmtRange(e.start, e.end)}`, style: { ...pos(e.start, e.end), bottom: `${2 + (i % 2) * 4}px`, '--ev': e.color || 'var(--accent)' } })),
    ];
    return h('div.wp-row', { style: { '--lanes': Math.max(1, count) } },
      h('a.wp-month', { href: `#/month/${month}`, class: P.contains(month, td) ? 'current' : '' }, P.MON3[Number(month.slice(5)) - 1], months.some(m => m.slice(0, 4) !== months[0].slice(0, 4)) ? h('span.muted.small', ' ' + month.slice(2, 4)) : null),
      h('div.wp-days', cells, bars));
  });
  return h('div.wall-planner', h('div.wp-row.wp-header', h('span.wp-month', ''), h('div.wp-days.wp-numbers', Array.from({ length: 31 }, (_, i) => h('span', String(i + 1))))), rows);
}

/** Phone layout: compact 7-column month blocks with the same markers. */
export function miniMonths(months) {
  const td = today(), rd = remindDefault();
  const layers = getLayers();
  const { events, background, deadlines } = gather(months);
  const trips = layers.trips ? store.all('Trips').filter(t => t.status !== 'cancelled') : [];
  return h('div.mini-months', months.map(month => {
    const days = P.daysIn(month);
    const lead = P.dow(days[0]);
    return h('div.mini-month',
      h('a.mini-title', { href: `#/month/${month}` }, P.label(month)),
      h('div.mini-grid',
        P.DOW3.map(d => h('span.mini-dow', d[0])),
        Array.from({ length: lead }, () => h('span')),
        days.map(day => {
          const hol = layers.holidays ? cal.onDay(background, day) : [];
          const tr = trips.filter(t => t.start <= day && day <= t.end).slice(0, 2);
          const evs = layers.events ? cal.onDay(events, day) : [];
          const dl = layers.deadlines ? deadlines.get(day) : null;
          return h('a.mini-day', {
            href: `#/day/${day}`,
            class: [P.dow(day) >= 5 ? 'weekend' : '', day === td ? 'today' : '', hol.length ? 'holiday' : ''].join(' '),
            title: [...hol.map(e => e.title), ...tr.map(t => '✈ ' + t.title), ...(dl || []).map(t => '⚑ ' + t.title)].join('\n') || undefined,
          },
            String(Number(day.slice(8))),
            tr.map((t, i) => h('span.mini-trip', { class: [day === t.start ? 'start' : '', day === t.end ? 'end' : '', t.status === 'idea' ? 'idea' : ''].join(' '), style: { '--trip': tripColor(t), bottom: `${1 + i * 4}px` } })),
            evs.length ? h('span.mini-ev') : null,
            dl ? h('span.mini-dl', { class: dl.some(t => dueState(t, td, rd) === 'overdue') ? 'overdue' : dl.some(t => dueState(t, td, rd) === 'soon') ? 'soon' : '' }) : null);
        })));
  }));
}

function goalTree(goal, all) {
  const pr = goalProgress(goal);
  const kids = all.filter(g => g.parent_id === goal.id).sort((a, b) => P.cmp(P.start(a.when) || '', P.start(b.when) || ''));
  const projects = store.all('Projects').filter(p => p.goal_id === goal.id && p.status !== 'dropped');
  const head = h('span.goal-head', areaDot(goal), h('a', { href: `#/goal/${goal.id}` }, goal.title), h('span.muted.small', ` ${P.relLabel(goal.when)} · ${goal.status}`), progressBar(pr.shown));
  if (!kids.length && !projects.length) return h('li.goal-node', head);
  return h('li.goal-node', h('details', h('summary', head),
    h('ul', kids.map(k => goalTree(k, all)), projects.map(p => h('li.project-node', '▸ ', h('a', { href: `#/project/${p.id}` }, p.title), h('span.muted.small', ' ' + p.status))))));
}

export function yearGoals(yearPeriod) {
  const all = store.all('Goals');
  const top = all.filter(g => g.when === yearPeriod && g.status !== 'dropped');
  const byArea = [...areas(), { id: '', name: 'No area' }].map(a => [a, top.filter(g => (g.area_id || '') === a.id)]).filter(([, gs]) => gs.length);
  return section('Year goals', byArea.length ? byArea.map(([a, gs]) => h('div.area-group', h('h4', a.color ? h('span.area-dot', { style: { background: a.color } }) : null, a.name), h('ul.goal-tree', gs.map(g => goalTree(g, all))))) : empty('No goals for this year yet.'),
    h('a.small', { href: '#/goals' }, 'All goals →'));
}

export function render(year, query = {}) {
  const rolling = query.rolling === '1';
  const months = rolling ? Array.from({ length: 12 }, (_, i) => P.shift(P.periodOf('month', today()), i)) : P.monthsIn(year);
  return h('div.page.year-page',
    printTools(rolling ? `${P.label(months[0])} – ${P.label(months[11])}` : year),
    h('div.year-tools',
      layerToggles(),
      h('a.chip', { href: rolling ? `#/year/${year}` : `#/year/${year}?rolling=1`, class: rolling ? 'on' : '' }, rolling ? 'Next 12 months ✓' : 'Next 12 months')),
    h('div.page-paper.wall', isMobile() ? miniMonths(months) : wallPlanner(months)),
    h('div.year-bottom',
      focusBlock(year, 'Year focus'),
      yearGoals(year),
      h('div', reviewLink(year), notesBlock(year))));
}
