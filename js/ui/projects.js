// Projects: board by status with next actions, and the project page.
import * as P from '../periods.js';
import { store, tasks, nextAction, areas } from '../store.js';
import { h, section, selectEl, areaSelect, recordSelect, inlineInput, areaDot, chip, periodPicker, confirmAction, go } from './components.js';
import { taskList, addLine } from './task.js';

export const STATUSES = [['active', 'Active'], ['waiting', 'Waiting'], ['on_hold', 'On hold'], ['someday', 'Someday'], ['done', 'Done'], ['dropped', 'Dropped']];

function card(p) {
  const open = tasks(t => t.project_id === p.id && !t.done && !t.list_id);
  const next = nextAction(open);
  const goal = p.goal_id ? store.get('Goals', p.goal_id) : null;
  return h('a.project-card', { href: `#/project/${p.id}` },
    h('div.project-card-head', areaDot(p), h('strong', p.title)),
    goal ? h('div.muted.small', '◎ ', goal.title) : null,
    next ? h('div.next-action', h('span.muted.small', 'Next: '), next.title, next.when ? h('span.muted.small', ' · ' + P.relLabel(next.when)) : null)
      : p.status === 'active' ? h('div.next-action.missing', 'No next action') : null,
    h('div.project-card-foot', open.length ? h('span', `${open.length} open`) : null, p.target ? chip('→ ' + P.relLabel(p.target), { cls: 'when' }) : null));
}

export function renderBoard(_, query = {}) {
  const area = query.area || '';
  const all = store.all('Projects').filter(p => !area || p.area_id === area).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  const col = ([status, label]) => {
    const ps = all.filter(p => p.status === status);
    return h('div.board-col', { class: status },
      h('h3.panel-title', label, h('span.count', ps.length)),
      ps.map(card),
      status !== 'done' ? newProjectInput(status, area) : null);
  };
  return h('div.page.projects-page',
    h('div.page-head', h('h2', 'Projects'),
      h('label', 'Area ', selectEl([['', 'All areas'], ...areas().map(a => [a.id, a.name])], area, v => location.replace(`#/projects${v ? '?area=' + v : ''}`)))),
    h('div.board', STATUSES.slice(0, 5).map(col)),
    all.some(p => p.status === 'dropped') ? h('details.panel', h('summary', 'Dropped'), h('div.board-col', all.filter(p => p.status === 'dropped').map(card))) : null);
}

function newProjectInput(status, area) {
  const input = h('input.add-line', { type: 'text', placeholder: '+ New project', 'aria-label': `New ${status} project` });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      store.add('Projects', { title: input.value.trim(), status, area_id: area, order: store.all('Projects').length });
      input.value = '';
    }
  });
  return input;
}

export function renderProject(id) {
  const p = store.get('Projects', id);
  if (!p) return h('div.page', h('h2', 'Project not found'), h('a', { href: '#/projects' }, '← Projects'));
  const set = patch => store.update('Projects', id, patch);
  const all = tasks(t => t.project_id === id && !t.list_id);
  const open = all.filter(t => !t.done), done = all.filter(t => t.done);
  const next = nextAction(open);
  return h('div.page.project-page',
    h('a.small', { href: '#/projects' }, '← All projects'),
    h('div.goal-layout',
      h('div.page-paper',
        inlineInput(p.title, v => v.trim() && set({ title: v.trim() }), { class: 'title-input big', 'aria-label': 'Project' }),
        h('div.field-row',
          h('label.field', h('span', 'Status'), selectEl(STATUSES, p.status, v => set({ status: v }))),
          h('label.field', h('span', 'Area'), areaSelect(p.area_id, v => set({ area_id: v }))),
          h('label.field', h('span', 'Goal'), recordSelect('Goals', p.goal_id, v => set({ goal_id: v }), { filter: g => g.status === 'active' }))),
        h('label.field', h('span', 'Target (when it should land)'), periodPicker(p.target, v => set({ target: v === 'someday' ? '' : v }))),
        section('Notes', inlineInput(p.notes, v => set({ notes: v }), { multiline: true, rows: 6, class: 'ruled' })),
        h('button.danger.small', { type: 'button', onclick: () => confirmAction(`Delete the project “${p.title}”? Its todos stay.`, () => { store.remove('Projects', id); go('#/projects'); }) }, 'Delete project')),
      h('div.page-paper',
        section(`Todos (${open.length} open)`,
          next ? h('p.next-action', h('span.muted.small', 'Next action: '), next.title) : null,
          taskList(open, { hide: ['project'], emptyText: 'No open todos.' }),
          addLine({ project_id: id, area_id: p.area_id, goal_id: p.goal_id }, { placeholder: 'Add a todo to this project…' }),
          done.length ? h('details', h('summary', `Done (${done.length})`), taskList(done, { hide: ['project'] })) : null))));
}
