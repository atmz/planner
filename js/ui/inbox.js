// Inbox (unscheduled todos, quick triage) and Someday (todos + projects to revisit).
import * as P from '../periods.js';
import { store, openTasks, today } from '../store.js';
import { h, section, empty, recordSelect } from './components.js';
import { taskList, addLine, moveTask } from './task.js';

function triage(t) {
  const td = today();
  const btn = (label, when) => h('button.chip', { type: 'button', onclick: () => moveTask(t.id, when) }, label);
  return h('span.triage',
    btn('Today', td), btn('This week', P.periodOf('week', td)), btn('This month', P.periodOf('month', td)),
    h('input.tiny-date', { type: 'date', 'aria-label': 'Pick a date', title: 'Pick a date', onchange: e => e.target.value && moveTask(t.id, e.target.value) }),
    btn('Someday', 'someday'),
    recordSelect('Projects', t.project_id, v => store.update('Tasks', t.id, { project_id: v, ...(v && !t.area_id ? { area_id: store.get('Projects', v)?.area_id || '' } : {}) }), { blank: 'Project…', filter: p => !['done', 'dropped'].includes(p.status) }),
    recordSelect('Goals', t.goal_id, v => store.update('Tasks', t.id, { goal_id: v }), { blank: 'Goal…', filter: g => g.status === 'active' }));
}

export function renderInbox() {
  const items = openTasks(t => !t.when && !t.list_id);
  return h('div.page.inbox-page',
    h('div.page-paper.narrow', { dataset: { dropWhen: '' } },
      h('div.page-head', h('h2', 'Inbox'), h('span.muted', items.length ? `${items.length} to sort` : '')),
      addLine({ when: '' }, { placeholder: 'Capture something…' }),
      items.length ? h('div.task-list.triage-list', items.map(t => h('div.triage-row', taskList([t], { hide: ['when'] }), triage(t))))
        : empty('Inbox zero. Everything has a place.')));
}

export function renderSomeday() {
  const items = openTasks(t => t.when === 'someday' && !t.list_id);
  const projects = store.all('Projects').filter(p => p.status === 'someday');
  return h('div.page.someday-page',
    h('div.page-paper.narrow', { dataset: { dropWhen: 'someday' } },
      h('div.page-head', h('h2', 'Someday'), h('span.muted', 'Ideas to revisit in reviews')),
      section('Todos', taskList(items, { hide: ['when'], actions: t => h('button.chip', { type: 'button', onclick: () => moveTask(t.id, P.periodOf('month', today())) }, '→ this month'), emptyText: 'Nothing parked here.' }),
        addLine({ when: 'someday' }, { placeholder: 'Park an idea…' })),
      section('Projects', projects.length ? h('ul.plain', projects.map(p => h('li',
        h('a', { href: `#/project/${p.id}` }, p.title), ' ',
        h('button.chip', { type: 'button', onclick: () => store.update('Projects', p.id, { status: 'active' }) }, 'Activate')))) : empty('No someday projects.'))));
}
