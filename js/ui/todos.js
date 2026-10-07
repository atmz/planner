// Todos: every open todo in one place — grouped by deadline (default), area, project or schedule.
import * as P from '../periods.js';
import { store, tasks, deadlineGroup, cmpWhen, cmpTask, areas, today } from '../store.js';
import { h, section, selectEl, recordSelect, areaSelect } from './components.js';
import { taskList, addLine } from './task.js';

const GROUPS = [['deadline', 'Deadline'], ['area', 'Area'], ['project', 'Project'], ['when', 'Scheduled']];
const DEADLINE_GROUPS = [['overdue', 'Overdue'], ['week', 'Due this week'], ['month', 'Due this month'], ['later', 'Due later'], ['none', 'No deadline']];

function setQuery(query, patch) {
  const q = new URLSearchParams({ ...query, ...patch });
  for (const [k, v] of [...q]) if (!v) q.delete(k);
  const s = q.toString();
  location.replace(`#/todos${s ? '?' + s : ''}`);
}

export function render(_, query = {}) {
  const td = today();
  const group = query.group || 'deadline';
  const f = {
    area: query.area || '', project: query.project || '', trip: query.trip || '',
    priority: query.priority === '1', deadline: query.deadline === '1', done: query.done === '1',
  };
  const list = tasks(t => !t.list_id
    && (f.done || !t.done)
    && (!f.area || t.area_id === f.area)
    && (!f.project || t.project_id === f.project)
    && (!f.trip || t.trip_id === f.trip)
    && (!f.priority || t.priority === 'high')
    && (!f.deadline || !!t.due));

  const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999') || cmpTask(a, b);
  let groups;
  if (group === 'deadline') {
    groups = DEADLINE_GROUPS.map(([k, label]) => [label, list.filter(t => deadlineGroup(t, td) === k).sort(byDue), k]);
  } else if (group === 'area') {
    groups = [...areas().map(a => [a.name, list.filter(t => t.area_id === a.id)]), ['No area', list.filter(t => !t.area_id || !store.get('Areas', t.area_id))]];
  } else if (group === 'project') {
    const projects = store.all('Projects').filter(p => list.some(t => t.project_id === p.id)).sort((a, b) => a.title.localeCompare(b.title));
    groups = [...projects.map(p => [p.title, list.filter(t => t.project_id === p.id)]), ['No project', list.filter(t => !t.project_id || !store.get('Projects', t.project_id))]];
  } else {
    const keys = [...new Set(list.map(t => t.when || ''))].sort(cmpWhen);
    groups = keys.map(k => [k ? P.relLabel(k, td) : 'Inbox', list.filter(t => (t.when || '') === k)]);
  }

  const toggle = (key, label) => h('label.chip', { class: f[key] ? 'on' : '' },
    h('input', { type: 'checkbox', checked: f[key], onchange: e => setQuery(query, { [key]: e.target.checked ? '1' : '' }) }), label);

  const defaults = () => ({
    area_id: f.area || (f.project ? store.get('Projects', f.project)?.area_id || '' : ''),
    project_id: f.project, trip_id: f.trip, priority: f.priority ? 'high' : '',
  });

  return h('div.page.todos-page',
    h('div.page-paper',
      h('div.page-head', h('h2', 'Todos'), h('span.muted', `${list.filter(t => !t.done).length} open`)),
      h('div.toolbar',
        h('label', 'Group by ', selectEl(GROUPS, group, v => setQuery(query, { group: v === 'deadline' ? '' : v }))),
        h('label', 'Area ', areaSelect(f.area, v => setQuery(query, { area: v }))),
        h('label', 'Project ', recordSelect('Projects', f.project, v => setQuery(query, { project: v }), { blank: 'Any', filter: p => !['done', 'dropped'].includes(p.status) })),
        h('label', 'Trip ', recordSelect('Trips', f.trip, v => setQuery(query, { trip: v }), { blank: 'Any' })),
        toggle('priority', 'High priority'), toggle('deadline', 'Has deadline'), toggle('done', 'Show done')),
      addLine(defaults, { placeholder: 'Add a todo (goes to the Inbox)…' }),
      groups.filter(([, items]) => items.length || (group === 'deadline')).map(([label, items, key]) =>
        section(h('span', label, h('span.count', items.length)),
          items.length ? taskList(items, { hide: group === 'when' ? ['when'] : [] }) : h('p.empty', key === 'overdue' ? 'Nothing overdue. 🎉' : '—')))));
}
