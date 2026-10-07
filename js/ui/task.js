// Todo item row + editor, shared by every view. Also drag & drop and the "move to…" sheet.
import * as P from '../periods.js';
import { store, dueState, dueChip, remindDefault, today } from '../store.js';
import { h, chip, areaDot, modal, liveModal, periodPicker, areaSelect, recordSelect, selectEl, inlineInput, toast, confirmAction } from './components.js';
import * as cal from '../calendar.js';

/**
 * A todo row: checkbox, title, chips.
 * opts.hide: set of chip kinds to omit ('when','due','project','goal','trip','area','time')
 */
export function taskRow(t, opts = {}) {
  const hide = new Set(opts.hide || []);
  const td = today();
  const state = dueState(t, td, remindDefault());
  const chips = [];
  if (t.priority === 'high') chips.push(chip('!', { cls: 'prio', title: 'High priority' }));
  if (!hide.has('time') && t.time && P.precision(t.when) === 'day') chips.push(chip(t.time, { cls: 'time' }));
  if (!hide.has('when') && t.when) chips.push(chip(P.relLabel(t.when, td), { cls: 'when', title: P.label(t.when) }));
  if (!hide.has('due') && t.due && !t.done) chips.push(chip(dueChip(t.due, td) + (t.due_time ? ' ' + t.due_time : ''), { cls: `due ${state || ''}`, title: `Due ${P.label(t.due)}` }));
  if (!hide.has('project') && t.project_id) { const p = store.get('Projects', t.project_id); if (p) chips.push(chip(p.title, { cls: 'project', href: `#/project/${p.id}` })); }
  if (!hide.has('goal') && t.goal_id) { const g = store.get('Goals', t.goal_id); if (g) chips.push(chip('◎ ' + g.title, { cls: 'goal', href: `#/goal/${g.id}` })); }
  if (!hide.has('trip') && t.trip_id) { const tr = store.get('Trips', t.trip_id); if (tr) chips.push(chip('✈ ' + tr.title, { cls: 'trip', href: `#/trip/${tr.id}` })); }
  if (t.event_id) chips.push(chip('📅', { cls: 'cal', title: 'In Google Calendar' }));

  const row = h('div.task', {
    class: [t.done ? 'done' : '', state ? 'due-' + state : '', opts.compact ? 'compact' : ''].join(' '),
    draggable: !opts.noDrag && matchMedia('(pointer: fine)').matches ? 'true' : undefined,
    dataset: { taskId: t.id },
  },
    h('input.check', { type: 'checkbox', checked: !!t.done, 'aria-label': `Done: ${t.title}`, onchange: e => store.update('Tasks', t.id, { done: e.target.checked }) }),
    hide.has('area') ? null : areaDot(t),
    h('button.task-title', { type: 'button', onclick: () => openTaskEditor(t.id), title: t.notes || '' }, t.title || '(untitled)'),
    opts.compact ? null : h('span.chips', chips),
    opts.actions ? h('span.row-actions', opts.actions(t)) : null,
    opts.noMove ? null : h('button.icon.move-btn', { type: 'button', 'aria-label': 'Move to…', title: 'Move to…', onclick: () => openMoveSheet(t.id) }, '⇢'),
  );
  return row;
}

export function taskList(tasks, opts = {}) {
  if (!tasks.length && opts.emptyText) return h('p.empty', opts.emptyText);
  return h('div.task-list', tasks.map(t => taskRow(t, opts)));
}

/** An "add…" line that creates a todo with preset fields. */
export function addLine(defaults, { placeholder = 'Add…', onAdded } = {}) {
  const input = h('input.add-line', { type: 'text', placeholder, 'aria-label': placeholder });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      const fields = typeof defaults === 'function' ? defaults() : defaults;
      const rec = store.add('Tasks', { ...fields, title: input.value.trim() });
      input.value = '';
      onAdded?.(rec);
      // keep focus for rapid entry after the re-render
      requestAnimationFrame(() => {
        const again = document.querySelector(`input.add-line[placeholder="${CSS.escape(placeholder)}"]`);
        again?.focus();
      });
    }
  });
  return input;
}

// ---- editor ----------------------------------------------------------------

export function openTaskEditor(id) {
  liveModal((close) => {
    const t = store.get('Tasks', id);
    if (!t) { close(); return h('p', 'Deleted.'); }
    const set = patch => { const before = { ...t }; store.update('Tasks', id, patch); afterTaskChange(before, store.get('Tasks', id)); };
    const td = today();
    return h('form.editor', { onsubmit: e => { e.preventDefault(); close(); } },
      h('div.editor-head',
        h('input.check', { type: 'checkbox', checked: !!t.done, 'aria-label': 'Done', onchange: e => set({ done: e.target.checked }) }),
        inlineInput(t.title, v => set({ title: v }), { class: 'title-input', 'aria-label': 'Title' }),
        h('button.icon', { type: 'button', onclick: close, 'aria-label': 'Close' }, '×')),
      h('label.field', h('span', 'When'), periodPicker(t.when, v => set({ when: v, ...(P.precision(v) !== 'day' ? { time: '' } : {}) }), { today: td })),
      P.precision(t.when) === 'day' ? h('label.field', h('span', 'Time'), h('input', { type: 'time', value: t.time, onchange: e => set({ time: e.target.value }) })) : null,
      h('div.field-row',
        h('label.field', h('span', 'Due'), h('input', { type: 'date', value: t.due, onchange: e => set({ due: e.target.value }) })),
        t.due ? h('label.field', h('span', 'by'), h('input', { type: 'time', value: t.due_time, onchange: e => set({ due_time: e.target.value }) })) : null,
        t.due ? h('label.field', h('span', 'Remind days before'), h('input', { type: 'number', min: 0, max: 60, value: t.remind_days ?? '', placeholder: String(remindDefault()), onchange: e => set({ remind_days: e.target.value === '' ? null : Number(e.target.value) }) })) : null),
      h('div.field-row',
        h('label.field', h('span', 'Priority'), selectEl([['', 'Normal'], ['high', 'High']], t.priority, v => set({ priority: v }))),
        h('label.field', h('span', 'Area'), areaSelect(t.area_id, v => set({ area_id: v })))),
      h('div.field-row',
        h('label.field', h('span', 'Project'), recordSelect('Projects', t.project_id, v => set({ project_id: v }), { filter: p => !['done', 'dropped'].includes(p.status) })),
        h('label.field', h('span', 'Goal'), recordSelect('Goals', t.goal_id, v => set({ goal_id: v }), { filter: g => g.status === 'active' }))),
      h('div.field-row',
        h('label.field', h('span', 'Trip'), recordSelect('Trips', t.trip_id, v => set({ trip_id: v }), { filter: x => x.status !== 'cancelled' && x.status !== 'done' })),
        h('label.field', h('span', 'List'), recordSelect('Lists', t.list_id, v => set({ list_id: v })))),
      h('label.field', h('span', 'Notes'), inlineInput(t.notes, v => set({ notes: v }), { multiline: true, rows: 3 })),
      h('div.actions',
        calendarButtons(t),
        h('span.spacer'),
        h('button.danger', { type: 'button', onclick: () => confirmAction(`Delete “${t.title}”?`, () => { store.remove('Tasks', id); close(); toast('Todo deleted', { action: 'Undo', onAction: () => store.update('Tasks', id, { deleted: false }) }); }) }, 'Delete'),
        h('button.primary', { type: 'submit' }, 'Done')),
    );
  }, { cls: 'task-editor' });
}

function calendarButtons(t) {
  if (!cal.available()) return null;
  const out = [];
  if (P.precision(t.when) === 'day' && t.time && !t.event_id) {
    out.push(h('button', { type: 'button', onclick: async () => {
      try { const ev = await cal.insertTaskEvent(t); store.update('Tasks', t.id, { event_id: ev.id }); toast('Added to calendar'); }
      catch (e) { toast('Calendar: ' + e.message); }
    } }, '📅 Add to calendar'));
  }
  if (t.due && !t.due_event_id) {
    out.push(h('button', { type: 'button', onclick: async () => {
      try { const ev = await cal.insertDeadlineEvent(t); store.update('Tasks', t.id, { due_event_id: ev.id }); toast('Deadline added to calendar'); }
      catch (e) { toast('Calendar: ' + e.message); }
    } }, '📅 Add deadline to calendar'));
  }
  return out;
}

/** After a todo changes, offer to keep its calendar events in step. */
export function afterTaskChange(before, after) {
  if (!after || !cal.available()) return;
  if (after.event_id && (before.when !== after.when || before.time !== after.time || before.title !== after.title)) {
    if (P.precision(after.when) === 'day' && after.time) {
      toast('This todo has a calendar event.', { action: 'Update event', onAction: () => cal.updateTaskEvent(after).then(() => toast('Calendar event updated'), e => toast('Calendar: ' + e.message)) });
    }
  }
  if (after.due_event_id && (before.due !== after.due || before.title !== after.title) && after.due) {
    toast('This deadline is in your calendar.', { action: 'Update event', onAction: () => cal.updateDeadlineEvent(after).then(() => toast('Calendar event updated'), e => toast('Calendar: ' + e.message)) });
  }
}

/** Schedule a todo (used by drag & drop, triage and move-to). */
export function moveTask(id, when) {
  const before = store.get('Tasks', id);
  if (!before) return;
  const patch = { when };
  if (P.precision(when) !== 'day') patch.time = '';
  store.update('Tasks', id, patch);
  afterTaskChange(before, store.get('Tasks', id));
}

/** Mobile-friendly "move to…" sheet. */
export function openMoveSheet(id) {
  const t = store.get('Tasks', id);
  if (!t) return;
  modal(close => h('div.move-sheet',
    h('h3', `Move “${t.title}”`),
    periodPicker(t.when, v => { moveTask(id, v); close(); })), { cls: 'sheet' });
}

// ---- drag & drop (desktop) ------------------------------------------------------
// Rows carry data-task-id; drop targets carry data-drop-when="<period string>" (blank = inbox).

export function enableDragAndDrop(root) {
  root.addEventListener('dragstart', e => {
    const row = e.target.closest?.('[data-task-id]');
    if (!row) return;
    e.dataTransfer.setData('text/x-task', row.dataset.taskId);
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  root.addEventListener('dragend', e => e.target.closest?.('[data-task-id]')?.classList.remove('dragging'));
  root.addEventListener('dragover', e => {
    const target = e.target.closest?.('[data-drop-when]');
    if (!target || !e.dataTransfer.types.includes('text/x-task')) return;
    e.preventDefault();
    target.classList.add('drop-over');
  });
  root.addEventListener('dragleave', e => {
    const target = e.target.closest?.('[data-drop-when]');
    if (target && !target.contains(e.relatedTarget)) target.classList.remove('drop-over');
  });
  root.addEventListener('drop', e => {
    const target = e.target.closest?.('[data-drop-when]');
    if (!target) return;
    e.preventDefault();
    target.classList.remove('drop-over');
    const id = e.dataTransfer.getData('text/x-task');
    if (id) moveTask(id, target.dataset.dropWhen);
  });
}
