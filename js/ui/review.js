// Reviews: a guided five-step flow for a week, month, quarter or year.
import * as P from '../periods.js';
import { store, tasks, goalProgress, carryTarget } from '../store.js';
import { h, section, empty, selectEl, inlineInput, progressBar, areaDot, toast } from './components.js';
import { taskList, moveTask } from './task.js';
import { newGoalDialog } from './goals.js';

const STEPS = ['Look back', 'Carry forward', 'Goals check', 'Reflect', 'Plan next'];
const stepOf = new Map(); // period → current step (kept while the page is open)

const inPeriod = (period, t) => P.contains(period, t.when);
const doneIn = (period, t) => t.done && t.done_at && P.contains(period, P.dayOf(new Date(t.done_at)));

/** Goals relevant to a period review: at the same horizon, or (for a week) the month it belongs to. */
function reviewGoals(period) {
  const t = P.precision(period);
  const horizons = t === 'week' ? [P.convert(period, 'month')] : [period];
  return store.all('Goals').filter(g => horizons.includes(g.when) || (t !== 'week' && P.contains(period, g.when) && g.when !== period && P.precision(g.when) !== 'day'));
}

export function render(period) {
  const type = P.precision(period);
  if (!['week', 'month', 'quarter', 'year'].includes(type)) return h('div.page', h('h2', 'Reviews are for weeks, months, quarters and years.'));
  const step = stepOf.get(period) ?? 0;
  const go = n => { stepOf.set(period, n); store.emit('data'); window.scrollTo(0, 0); };
  const nextPeriod = P.next(period);
  const rec = store.period(period);

  const body = [lookBack, carryForward, goalsCheck, reflect, planNext][step](period, nextPeriod);

  return h('div.page.review-page',
    h('a.small', { href: `#/${type}/${period}` }, `← ${P.label(period)}`),
    h('div.page-paper.narrow',
      h('div.page-head', h('h2', `Review · ${P.label(period)}`), rec.reviewed_at ? h('span.chip.on', `Reviewed ${P.fmtDayShort(P.dayOf(new Date(rec.reviewed_at)))}`) : null),
      h('ol.steps', STEPS.map((s, i) => h('li', { class: i === step ? 'on' : i < step ? 'past' : '' }, h('button.link', { type: 'button', onclick: () => go(i) }, s)))),
      body,
      h('div.actions',
        step > 0 ? h('button', { type: 'button', onclick: () => go(step - 1) }, '← Back') : h('span'),
        h('span.spacer'),
        step < STEPS.length - 1
          ? h('button.primary', { type: 'button', onclick: () => go(step + 1) }, `Next: ${STEPS[step + 1]} →`)
          : h('button.primary', { type: 'button', onclick: () => {
            store.setPeriod(period, { reviewed_at: new Date().toISOString() });
            stepOf.delete(period);
            toast(`${P.label(period)} reviewed`);
            location.hash = `#/${type}/${nextPeriod}`;
          } }, 'Finish review ✓'))));
}

function lookBack(period) {
  const done = tasks(t => !t.list_id && doneIn(period, t));
  const notDone = tasks(t => !t.list_id && !t.done && inPeriod(period, t));
  const achieved = reviewGoals(period).filter(g => g.status === 'achieved');
  return h('div',
    h('p.lede', `${done.length} done · ${notDone.length} still open`),
    section('Got done', taskList(done, { emptyText: 'Nothing ticked off in this period.' })),
    achieved.length ? section('Goals achieved', h('ul.plain', achieved.map(g => h('li', '◎ ', g.title)))) : null,
    section('Didn’t happen', taskList(notDone, { emptyText: 'Everything planned got done.' })));
}

function carryForward(period, nextPeriod) {
  const open = tasks(t => !t.list_id && !t.done && inPeriod(period, t));
  const target = carryTarget(period);
  return h('div',
    h('p.lede', open.length ? `Decide what happens to each unfinished item. “Next” moves it to ${P.label(target)}.` : 'Nothing left to carry forward.'),
    open.length ? h('div.carry-list', open.map(t => h('div.carry-row',
      taskList([t], { noDrag: true }),
      h('span.triage',
        h('button.chip', { type: 'button', onclick: () => moveTask(t.id, target) }, `→ ${P.relLabel(target)}`),
        h('input.tiny-date', { type: 'date', 'aria-label': 'Reschedule', title: 'Reschedule to a date', onchange: e => e.target.value && moveTask(t.id, e.target.value) }),
        h('button.chip', { type: 'button', onclick: () => moveTask(t.id, 'someday') }, 'Someday'),
        h('button.chip.danger', { type: 'button', onclick: () => { store.remove('Tasks', t.id); toast('Dropped', { action: 'Undo', onAction: () => store.update('Tasks', t.id, { deleted: false }) }); } }, 'Drop'))))) : null,
    open.length > 1 ? h('button', { type: 'button', onclick: () => open.forEach(t => moveTask(t.id, target)) }, `Move all ${open.length} to ${P.relLabel(target)}`) : null,
    h('p.muted.small', `Moving to ${P.label(nextPeriod)} keeps them visible at that level until you give them a day.`));
}

function goalsCheck(period) {
  const goals = reviewGoals(period).filter(g => g.status !== 'dropped');
  return h('div',
    h('p.lede', 'Update status and progress.'),
    goals.length ? h('ul.goal-review', goals.map(g => {
      const pr = goalProgress(g);
      return h('li',
        h('div', areaDot(g), h('a', { href: `#/goal/${g.id}` }, g.title), h('span.muted.small', ' ' + P.relLabel(g.when))),
        h('div.goal-review-controls',
          selectEl([['active', 'Active'], ['achieved', 'Achieved'], ['paused', 'Paused'], ['dropped', 'Dropped']], g.status, v => store.update('Goals', g.id, { status: v })),
          h('input', { type: 'range', min: 0, max: 100, step: 5, value: pr.shown, 'aria-label': `Progress for ${g.title}`, onchange: e => store.update('Goals', g.id, { progress: Number(e.target.value) }) }),
          h('span.small', `${pr.shown}%`),
          pr.computed !== null ? h('span.muted.small', ` (todos ${pr.computed}%)`) : null),
        progressBar(pr.shown));
    })) : empty('No goals at this horizon.'));
}

function reflect(period) {
  const rec = store.period(period);
  return h('div',
    h('p.lede', 'What went well? What got in the way? What will you do differently?'),
    inlineInput(rec.review, v => store.setPeriod(period, { review: v }), { multiline: true, rows: 10, class: 'ruled', placeholder: 'Write your reflection…', 'aria-label': 'Reflection' }));
}

function planNext(period, nextPeriod) {
  const rec = store.period(nextPeriod);
  const type = P.precision(period);
  const parent = P.parent(nextPeriod);
  const pullable = parent ? tasks(t => !t.list_id && !t.done && t.when === parent) : [];
  const nextGoals = store.all('Goals').filter(g => (g.when === nextPeriod || (type === 'week' && g.when === P.convert(nextPeriod, 'month'))) && g.status === 'active');
  return h('div',
    h('p.lede', `Set up ${P.label(nextPeriod)}.`),
    section('Focus (3)', h('ol.focus-list', [1, 2, 3].map(i => h('li', inlineInput(rec[`focus_${i}`], v => store.setPeriod(nextPeriod, { [`focus_${i}`]: v }), { placeholder: `Priority ${i}`, 'aria-label': `Focus ${i}` }))))),
    section('Goals', nextGoals.length ? h('ul.plain', nextGoals.map(g => h('li', areaDot(g), h('a', { href: `#/goal/${g.id}` }, g.title), h('span.muted.small', ' ' + P.relLabel(g.when))))) : empty('No goals set yet.'),
      h('button', { type: 'button', onclick: () => newGoalDialog({ when: type === 'week' ? P.convert(nextPeriod, 'month') : nextPeriod, stay: true }) }, '+ Add a goal')),
    parent ? section(`Pull in from ${P.label(parent)}`, taskList(pullable, {
      noDrag: true,
      actions: t => h('button.chip', { type: 'button', onclick: () => moveTask(t.id, nextPeriod) }, `→ ${P.relLabel(nextPeriod)}`),
      emptyText: 'Nothing waiting at that level.',
    })) : null);
}
