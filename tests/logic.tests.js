import { suite, eq, ok } from './harness.js';
import { TABS, fromRow, toRow, newRecord } from '../js/schema.js';
import * as S from '../js/store.js';

suite('schema: header-driven row mapping', t => {
  t('fromRow reads by header name, not position, and coerces types', () => {
    const headers = ['title', 'id', 'done', 'order', 'extra_col', 'deleted'];
    const rec = fromRow('Tasks', ['Buy milk', 'abc', 'TRUE', '3', 'x', 'FALSE'], headers);
    eq(rec.id, 'abc');
    eq(rec.title, 'Buy milk');
    eq(rec.done, true);
    eq(rec.order, 3);
    eq(rec.deleted, false);
    eq(rec.when, '', 'missing columns default to blank');
  });
  t('short rows (trailing blanks trimmed by Sheets) are fine', () => {
    const rec = fromRow('Tasks', ['abc'], ['id', 'title', 'done']);
    eq(rec.title, '');
    eq(rec.done, false);
  });
  t('toRow writes in header order and keeps unknown columns untouched', () => {
    const headers = ['id', 'mystery', 'title', 'done'];
    const row = toRow('Tasks', { id: 'a', title: 'T', done: true }, headers, ['a', 'keep me', 'old', 'FALSE']);
    eq(row, ['a', 'keep me', 'T', true]);
  });
  t('numbers serialise as numbers, blanks as empty strings', () => {
    const row = toRow('Goals', { id: 'g', progress: 40, order: null }, ['id', 'progress', 'order']);
    eq(row, ['g', 40, '']);
  });
  t('every tab defines id-ish key and audit columns', () => {
    for (const [name, def] of Object.entries(TABS)) {
      ok(def.columns.includes(def.key), `${name} has key ${def.key}`);
    }
    ok(TABS.Tasks.columns.includes('due_event_id'));
    ok(TABS.TripItems.columns.includes('reference'));
  });
  t('newRecord fills id and timestamps', () => {
    const r = newRecord('Tasks', { title: 'x' }, '2026-10-07T10:00:00.000Z');
    ok(r.id && r.id.length > 10);
    eq(r.created_at, '2026-10-07T10:00:00.000Z');
    eq(r.updated_at, '2026-10-07T10:00:00.000Z');
    eq(r.deleted, false);
    eq(r.done, false);
    eq(r.when, '');
  });
});

suite('store: deadlines', t => {
  const today = '2026-10-07'; // Wednesday, W41
  t('dueState', () => {
    eq(S.dueState({ due: '2026-10-06' }, today, 3), 'overdue');
    eq(S.dueState({ due: '2026-10-07' }, today, 3), 'soon');
    eq(S.dueState({ due: '2026-10-10' }, today, 3), 'soon');
    eq(S.dueState({ due: '2026-10-11' }, today, 3), 'later');
    eq(S.dueState({ due: '2026-10-11', remind_days: 7 }, today, 3), 'soon');
    eq(S.dueState({ due: '2026-10-06', done: true }, today, 3), null);
    eq(S.dueState({ due: '' }, today, 3), null);
  });
  t('remind_days 0 means only due day counts as soon', () => {
    eq(S.dueState({ due: '2026-10-08', remind_days: 0 }, today, 3), 'later');
    eq(S.dueState({ due: '2026-10-07', remind_days: 0 }, today, 3), 'soon');
  });
  t('dueChip', () => {
    eq(S.dueChip('2026-10-07', today), 'Due today');
    eq(S.dueChip('2026-10-08', today), 'Due tomorrow');
    eq(S.dueChip('2026-10-09', today), 'Due Fri');
    eq(S.dueChip('2026-10-19', today), 'Due in 12 days');
    eq(S.dueChip('2026-10-04', today), '3 days late');
    eq(S.dueChip('2026-10-06', today), '1 day late');
  });
  t('deadlineGroup', () => {
    eq(S.deadlineGroup({ due: '2026-10-01' }, today), 'overdue');
    eq(S.deadlineGroup({ due: '2026-10-11' }, today), 'week');
    eq(S.deadlineGroup({ due: '2026-10-25' }, today), 'month');
    eq(S.deadlineGroup({ due: '2026-11-02' }, today), 'later');
    eq(S.deadlineGroup({ due: '' }, today), 'none');
  });
});

suite('store: scheduling helpers', t => {
  t('whenSortKey orders by start date, then precision, someday/inbox last', () => {
    const ws = ['', 'someday', '2026-10', '2026-10-09', '2026-W41', '2026-10-01'];
    const sorted = [...ws].sort((a, b) => S.cmpWhen(a, b));
    eq(sorted, ['2026-10-01', '2026-10', '2026-W41', '2026-10-09', 'someday', '']);
  });
  t('nextAction picks first open todo by when then order', () => {
    const tasks = [
      { id: 'a', project_id: 'p', when: '2026-11', order: 1, done: false },
      { id: 'b', project_id: 'p', when: '2026-10-09', order: 2, done: false },
      { id: 'c', project_id: 'p', when: '2026-10-09', order: 1, done: false },
      { id: 'd', project_id: 'p', when: '2026-10-01', order: 0, done: true },
      { id: 'e', project_id: 'p', when: '2026-10-01', order: 0, done: false, deleted: true },
    ];
    eq(S.nextAction(tasks).id, 'c');
  });
  t('carryTarget moves unfinished items to the next period at the reviewed precision', () => {
    eq(S.carryTarget('2026-W41'), '2026-W42');
    eq(S.carryTarget('2026-10'), '2026-11');
    eq(S.carryTarget('2026-Q4'), '2027-Q1');
  });
  t('computedProgress from linked todos', () => {
    const tasks = [
      { goal_id: 'g', done: true }, { goal_id: 'g', done: false },
      { goal_id: 'g', done: true }, { goal_id: 'g', done: true, deleted: true },
      { goal_id: 'x', done: false },
    ];
    eq(S.computedProgress('g', { tasks, projects: [], goals: [] }), 67);
    eq(S.computedProgress('none', { tasks, projects: [], goals: [] }), null);
  });
  t('computedProgress counts projects and sub-goals', () => {
    const projects = [{ id: 'p1', goal_id: 'g', status: 'done' }, { id: 'p2', goal_id: 'g', status: 'active' }];
    const goals = [{ id: 's', parent_id: 'g', status: 'achieved' }];
    eq(S.computedProgress('g', { tasks: [], projects, goals }), 67);
  });
  t('tripOn: trips covering a day', () => {
    const trips = [{ id: 't', start: '2026-10-24', end: '2026-11-01', status: 'booked' },
                   { id: 'c', start: '2026-10-24', end: '2026-10-30', status: 'cancelled' }];
    eq(S.tripsOn('2026-10-31', trips).map(x => x.id), ['t']);
    eq(S.tripsOn('2026-11-02', trips).length, 0);
  });
});

suite('schema: values typed into the sheet', t => {
  t('date serials in date columns become ISO days', () => {
    const rec = fromRow('Tasks', ['a', 46304, 0.4375], ['id', 'due', 'time']);
    eq(rec.due, '2026-10-09');
    eq(rec.time, '10:30');
  });
  t('a serial in a period column becomes a day', () => {
    eq(fromRow('Tasks', ['a', 46304], ['id', 'when']).when, '2026-10-09');
  });
  t('booleans typed as checkboxes read as booleans', () => {
    eq(fromRow('Tasks', ['a', true], ['id', 'done']).done, true);
  });
  t('numbers stay numbers when written', () => {
    eq(toRow('Tasks', { id: 'a', order: 2, done: false }, ['id', 'order', 'done']), ['a', 2, false]);
  });
});

suite('ui helpers', t => {
  t('safeHref only allows http(s) links', async () => {
    const { safeHref } = await import('../js/ui/components.js');
    eq(safeHref('https://example.com/x'), 'https://example.com/x');
    eq(safeHref('javascript:alert(1)'), null);
    eq(safeHref(' JaVaScript:alert(1)'), null);
    eq(safeHref('example.com'), 'https://example.com/');
    eq(safeHref(''), null);
  });
});
