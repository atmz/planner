// Lists: paper-planner "notes pages" — packing lists, books, gifts… Items are Tasks with list_id.
import { store, listItems } from '../store.js';
import { h, empty, inlineInput, areaDot, areaSelect, confirmAction, go } from './components.js';
import { addLine } from './task.js';

export function renderLists() {
  const all = store.all('Lists').sort((a, b) => (!!a.trip_id - !!b.trip_id) || (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  const input = h('input.add-line', { type: 'text', placeholder: '+ New list', 'aria-label': 'New list' });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) { const l = store.add('Lists', { title: input.value.trim(), order: all.length }); go(`#/list/${l.id}`); }
  });
  const card = l => {
    const items = listItems(l.id);
    const left = items.filter(i => !i.done).length;
    const trip = l.trip_id ? store.get('Trips', l.trip_id) : null;
    return h('a.list-card', { href: `#/list/${l.id}` },
      h('div', areaDot(l), h('strong', l.title)),
      trip ? h('div.muted.small', '✈ ', trip.title) : null,
      h('div.muted.small', items.length ? `${left} of ${items.length} left` : 'Empty'),
      h('ul.preview', items.filter(i => !i.done).slice(0, 4).map(i => h('li', i.title))));
  };
  const plain = all.filter(l => !l.trip_id), trips = all.filter(l => l.trip_id && store.get('Trips', l.trip_id));
  return h('div.page.lists-page',
    h('div.page-head', h('h2', 'Lists')),
    h('div.list-grid', plain.map(card), h('div.list-card.new', input)),
    trips.length ? [h('h3.panel-title', 'Packing lists'), h('div.list-grid', trips.map(card))] : null);
}

export function renderList(id) {
  const l = store.get('Lists', id);
  if (!l) return h('div.page', h('h2', 'List not found'), h('a', { href: '#/lists' }, '← Lists'));
  const items = listItems(id);
  const trip = l.trip_id ? store.get('Trips', l.trip_id) : null;
  return h('div.page.list-page',
    h('a.small', { href: trip ? `#/trip/${trip.id}` : '#/lists' }, trip ? `← ${trip.title}` : '← All lists'),
    h('div.page-paper.narrow',
      inlineInput(l.title, v => v.trim() && store.update('Lists', id, { title: v.trim() }), { class: 'title-input big', 'aria-label': 'List title' }),
      h('div.field-row', h('label.field', h('span', 'Area'), areaSelect(l.area_id, v => store.update('Lists', id, { area_id: v })))),
      h('div.checklist', items.length ? items.map(t => h('div.check-item', { class: t.done ? 'done' : '' },
        h('input', { type: 'checkbox', checked: t.done, 'aria-label': t.title, onchange: e => store.update('Tasks', t.id, { done: e.target.checked }) }),
        inlineInput(t.title, v => v.trim() ? store.update('Tasks', t.id, { title: v.trim() }) : store.remove('Tasks', t.id), { class: 'bare', 'aria-label': 'Item' }),
        h('button.icon.small', { type: 'button', 'aria-label': `Remove ${t.title}`, onclick: () => store.remove('Tasks', t.id) }, '×'))) : empty('Nothing here yet.')),
      addLine({ list_id: id, trip_id: l.trip_id, order: items.length }, { placeholder: 'Add an item…' }),
      h('div.toolbar',
        items.some(i => i.done) ? h('button', { type: 'button', onclick: () => items.filter(i => i.done).forEach(i => store.update('Tasks', i.id, { done: false })) }, 'Untick all') : null,
        items.some(i => i.done) ? h('button', { type: 'button', onclick: () => items.filter(i => i.done).forEach(i => store.remove('Tasks', i.id)) }, 'Clear ticked') : null,
        h('span.spacer'),
        h('button.danger.small', { type: 'button', onclick: () => confirmAction(`Delete the list “${l.title}”?`, () => { store.remove('Lists', id); go('#/lists'); }) }, 'Delete list')),
      listNotes(l)));
}

function listNotes(l) {
  return h('section.panel', h('h3.panel-title', 'Notes'), inlineInput(l.notes, v => store.update('Lists', l.id, { notes: v }), { multiline: true, rows: 3, class: 'ruled' }));
}
