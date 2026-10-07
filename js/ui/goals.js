// Goals: year → quarter → month tree grouped by area, and the goal detail page.
import * as P from '../periods.js';
import { store, tasks, goalProgress, areas, today } from '../store.js';
import { h, section, empty, selectEl, areaSelect, recordSelect, inlineInput, progressBar, areaDot, modal, confirmAction, go, chip } from './components.js';
import { taskList, addLine } from './task.js';

const STATUSES = [['active', 'Active'], ['achieved', 'Achieved'], ['paused', 'Paused'], ['dropped', 'Dropped']];
const FINER = { year: 'quarter', quarter: 'month', month: 'month' };

function horizonPicker(value, onChange) {
  const t = P.precision(value);
  const types = [['year', 'Year'], ['quarter', 'Quarter'], ['month', 'Month']];
  return h('span.horizon-picker',
    selectEl(types, t, nt => onChange(P.convert(value, nt)), { 'aria-label': 'Horizon' }),
    h('button.icon', { type: 'button', onclick: () => onChange(P.prev(value)), 'aria-label': 'Earlier' }, '‹'),
    h('span', P.label(value)),
    h('button.icon', { type: 'button', onclick: () => onChange(P.next(value)), 'aria-label': 'Later' }, '›'));
}

export function newGoalDialog(defaults = {}) {
  let when = defaults.when || P.periodOf('quarter', today());
  modal(close => {
    const title = h('input', { type: 'text', placeholder: 'What do you want to achieve?', required: true });
    let area = defaults.area_id || '';
    const whenBox = h('span');
    const draw = () => whenBox.replaceChildren(horizonPicker(when, v => { when = v; draw(); }));
    draw();
    return h('form.editor', { onsubmit: e => {
      e.preventDefault();
      if (!title.value.trim()) return;
      const g = store.add('Goals', { title: title.value.trim(), when, area_id: area, parent_id: defaults.parent_id || '', status: 'active' });
      close();
      if (!defaults.stay) go(`#/goal/${g.id}`);
    } },
      h('h3', defaults.parent_id ? 'New sub-goal' : 'New goal'),
      h('label.field', h('span', 'Goal'), title),
      h('label.field', h('span', 'When'), whenBox),
      h('label.field', h('span', 'Area'), areaSelect(area, v => { area = v; })),
      h('div.actions', h('button', { type: 'button', onclick: close }, 'Cancel'), h('button.primary', { type: 'submit' }, 'Add goal')));
  });
}

function node(g, all, statusFilter) {
  const kids = all.filter(k => k.parent_id === g.id && statusFilter(k)).sort((a, b) => P.cmp(P.start(a.when) || '', P.start(b.when) || '') || (a.order ?? 0) - (b.order ?? 0));
  const pr = goalProgress(g);
  return h('li.goal-node', { class: g.status },
    h('div.goal-row',
      areaDot(g),
      h('a', { href: `#/goal/${g.id}` }, g.title),
      chip(P.relLabel(g.when), { cls: 'when' }),
      g.status !== 'active' ? chip(g.status, { cls: 'status ' + g.status }) : null,
      progressBar(pr.shown, { label: `${pr.shown}%` })),
    kids.length ? h('ul', kids.map(k => node(k, all, statusFilter))) : null);
}

export function renderList(_, query = {}) {
  const year = query.year && P.precision(query.year) === 'year' ? query.year : P.periodOf('year', today());
  const status = query.status || 'open';
  const statusFilter = g => status === 'all' ? true : status === 'open' ? g.status === 'active' || g.status === 'paused' : g.status === status;
  const all = store.all('Goals');
  const inYear = all.filter(g => P.contains(year, g.when));
  const ids = new Set(inYear.map(g => g.id));
  // Roots: goals in this year whose parent isn't also in this year's tree.
  const roots = inYear.filter(g => statusFilter(g) && (!g.parent_id || !ids.has(g.parent_id)))
    .sort((a, b) => P.RANK[P.precision(b.when)] - P.RANK[P.precision(a.when)] || P.cmp(P.start(a.when), P.start(b.when)) || (a.order ?? 0) - (b.order ?? 0));
  const groups = [...areas(), { id: '', name: 'No area' }].map(a => [a, roots.filter(g => (g.area_id || '') === a.id || (!a.id && g.area_id && !store.get('Areas', g.area_id)))]).filter(([, gs]) => gs.length);
  const setQ = patch => { const q = new URLSearchParams({ ...query, ...patch }); location.replace(`#/goals?${q}`); };

  return h('div.page.goals-page',
    h('div.page-paper',
      h('div.page-head',
        h('h2', 'Goals'),
        h('span.stepper',
          h('button.icon', { type: 'button', onclick: () => setQ({ year: P.prev(year) }), 'aria-label': 'Previous year' }, '‹'),
          h('strong', year),
          h('button.icon', { type: 'button', onclick: () => setQ({ year: P.next(year) }), 'aria-label': 'Next year' }, '›')),
        selectEl([['open', 'Active & paused'], ['active', 'Active'], ['achieved', 'Achieved'], ['paused', 'Paused'], ['dropped', 'Dropped'], ['all', 'All']], status, v => setQ({ status: v })),
        h('button.primary', { type: 'button', onclick: () => newGoalDialog({ when: year }) }, '+ New goal')),
      groups.length ? groups.map(([a, gs]) => h('div.area-group',
        h('h3', a.color ? h('span.area-dot', { style: { background: a.color } }) : null, a.name),
        h('ul.goal-tree', gs.map(g => node(g, inYear, statusFilter))))) : empty(`No goals for ${year} with this filter.`)));
}

export function renderGoal(id) {
  const g = store.get('Goals', id);
  if (!g) return h('div.page', h('h2', 'Goal not found'), h('a', { href: '#/goals' }, '← Goals'));
  const set = patch => store.update('Goals', id, patch);
  const pr = goalProgress(g);
  const subs = store.all('Goals').filter(x => x.parent_id === id);
  const parent = g.parent_id ? store.get('Goals', g.parent_id) : null;
  const projects = store.all('Projects').filter(p => p.goal_id === id);
  const linked = tasks(t => t.goal_id === id && !t.list_id);
  const open = linked.filter(t => !t.done), done = linked.filter(t => t.done);

  return h('div.page.goal-page',
    h('a.small', { href: '#/goals' }, '← All goals'),
    parent ? h('div.muted.small', 'Part of ', h('a', { href: `#/goal/${parent.id}` }, parent.title)) : null,
    h('div.goal-layout',
      h('div.page-paper',
        inlineInput(g.title, v => v.trim() && set({ title: v.trim() }), { class: 'title-input big', 'aria-label': 'Goal' }),
        h('div.field-row',
          h('label.field', h('span', 'When'), horizonPicker(g.when, v => set({ when: v }))),
          h('label.field', h('span', 'Status'), selectEl(STATUSES, g.status, v => set({ status: v }))),
          h('label.field', h('span', 'Area'), areaSelect(g.area_id, v => set({ area_id: v }))),
          h('label.field', h('span', 'Part of'), recordSelect('Goals', g.parent_id, v => set({ parent_id: v }), { filter: x => x.id !== id && P.RANK[P.precision(x.when)] > P.RANK[P.precision(g.when)] }))),
        h('label.field', h('span', 'Why it matters'), inlineInput(g.why, v => set({ why: v }), { placeholder: 'One line on why this matters' })),
        h('label.field', h('span', 'How I’ll know it’s done'), inlineInput(g.measure, v => set({ measure: v }))),
        h('div.field.progress-field',
          h('span', 'Progress'),
          progressBar(pr.shown),
          h('input', { type: 'range', min: 0, max: 100, step: 5, value: pr.manual ?? pr.computed ?? 0, 'aria-label': 'Manual progress', onchange: e => set({ progress: Number(e.target.value) }) }),
          h('span.muted.small', pr.manual !== null && pr.manual !== undefined ? `${pr.manual}% (manual)` : 'not set', pr.computed !== null ? ` · from linked items: ${pr.computed}%` : ''),
          pr.manual !== null && pr.manual !== undefined ? h('button.link.small', { type: 'button', onclick: () => set({ progress: null }) }, 'use computed') : null),
        section('Notes', inlineInput(g.notes, v => set({ notes: v }), { multiline: true, rows: 4, class: 'ruled' })),
        h('button.danger.small', { type: 'button', onclick: () => confirmAction(`Delete the goal “${g.title}”?`, () => { store.remove('Goals', id); go('#/goals'); }) }, 'Delete goal')),
      h('div',
        h('div.page-paper', section('Sub-goals',
          subs.length ? h('ul.goal-list', subs.map(s => h('li.goal-line', areaDot(s), h('a', { href: `#/goal/${s.id}` }, s.title), h('span.muted.small', ` ${P.relLabel(s.when)} · ${s.status}`), progressBar(goalProgress(s).shown)))) : empty('None.'),
          h('button', { type: 'button', onclick: () => newGoalDialog({ parent_id: id, area_id: g.area_id, when: P.convert(g.when, FINER[P.precision(g.when)] || 'month'), stay: true }) }, '+ Sub-goal'))),
        h('div.page-paper', section('Projects',
          projects.length ? h('ul.plain', projects.map(p => h('li', h('a', { href: `#/project/${p.id}` }, p.title), h('span.muted.small', ' ' + p.status)))) : empty('No linked projects.'),
          h('div.toolbar', recordSelect('Projects', '', v => v && store.update('Projects', v, { goal_id: id }), { blank: 'Link a project…', filter: p => p.goal_id !== id && !['done', 'dropped'].includes(p.status) })))),
        h('div.page-paper', section(`Todos (${open.length} open)`,
          taskList(open, { hide: ['goal'] }),
          addLine({ goal_id: id, area_id: g.area_id }, { placeholder: 'Add a todo for this goal…' }),
          done.length ? h('details', h('summary', `Done (${done.length})`), taskList(done, { hide: ['goal'] })) : null)))));
}
