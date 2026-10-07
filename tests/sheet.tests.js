import { suite, eq, ok } from './harness.js';
import { fakeSheets } from './fake-sheets.js';
import { sheetBackend } from '../js/sheet.js';
import { TABS, TAB_NAMES } from '../js/schema.js';

const TASK_COLS = TABS.Tasks.columns;
const emptyTabs = () => Object.fromEntries(TAB_NAMES.map(t => [t, [TABS[t].columns]]));
const taskRow = f => TASK_COLS.map(c => f[c] ?? '');
const writes = log => log.filter(l => l.method !== 'GET');

suite('sheet: updates write only the changed cells', t => {
  t('patching the title leaves other cells (formulas, formatted numbers, unknown columns) untouched', async () => {
    const tabs = emptyTabs();
    tabs.Tasks = [[...TASK_COLS, 'calc'], [...taskRow({ id: 'a', title: 'Old', order: 3, updated_at: '2026-10-01T00:00:00Z' }), '=LEN(B2)']];
    const fs = fakeSheets(tabs);
    const be = sheetBackend(fs.api, 'S');
    await be.loadAll();
    fs.log.length = 0;
    await be.update('Tasks', 'a', { title: 'New', updated_at: '2026-10-07T10:00:00Z' }, '2026-10-01T00:00:00Z');
    const w = writes(fs.log);
    eq(w.length, 1, 'one write request');
    const ranges = w[0].body.data.map(d => d.range).sort();
    eq(ranges, ["'Tasks'!B2", `'Tasks'!${'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[TASK_COLS.indexOf('updated_at')]}2`].sort());
    const row = fs.tabs.get('Tasks')[1];
    eq(row[TASK_COLS.length], '=LEN(B2)', 'unknown column kept');
    eq(row[TASK_COLS.indexOf('order')], 3, 'order untouched');
    eq(row[1], 'New');
  });
  t('concurrent edits to different fields of one row both survive', async () => {
    const tabs = emptyTabs();
    tabs.Tasks = [TASK_COLS, taskRow({ id: 'a', title: 'T', notes: '' })];
    const fs = fakeSheets(tabs);
    const sam = sheetBackend(fs.api, 'S'), jo = sheetBackend(fs.api, 'S');
    await sam.loadAll(); await jo.loadAll();
    await sam.update('Tasks', 'a', { title: 'Sam title' });
    await jo.update('Tasks', 'a', { notes: 'Jo note' });
    const row = fs.tabs.get('Tasks')[1];
    eq([row[TASK_COLS.indexOf('title')], row[TASK_COLS.indexOf('notes')]], ['Sam title', 'Jo note']);
  });
  t('update returns the merged record including remote fields', async () => {
    const tabs = emptyTabs();
    tabs.Tasks = [TASK_COLS, taskRow({ id: 'a', title: 'T', notes: 'remote' })];
    const fs = fakeSheets(tabs);
    const be = sheetBackend(fs.api, 'S');
    await be.loadAll();
    const rec = await be.update('Tasks', 'a', { title: 'X' });
    eq([rec.title, rec.notes], ['X', 'remote']);
  });
  t('a sorted sheet is re-indexed before writing', async () => {
    const tabs = emptyTabs();
    tabs.Tasks = [TASK_COLS, taskRow({ id: 'a', title: 'A' }), taskRow({ id: 'b', title: 'B' })];
    const fs = fakeSheets(tabs);
    const be = sheetBackend(fs.api, 'S');
    await be.loadAll();
    const rows = fs.tabs.get('Tasks'); [rows[1], rows[2]] = [rows[2], rows[1]]; // someone sorts
    await be.update('Tasks', 'a', { title: 'A2' });
    eq(fs.tabs.get('Tasks').map(r => r[1]), ['title', 'B', 'A2']);
  });
  t('numbers and booleans are written as real values, not text', async () => {
    const tabs = emptyTabs();
    tabs.Tasks = [TASK_COLS, taskRow({ id: 'a', title: 'T', done: false })];
    const fs = fakeSheets(tabs);
    const be = sheetBackend(fs.api, 'S');
    await be.loadAll();
    await be.update('Tasks', 'a', { done: true, order: 4 });
    const row = fs.tabs.get('Tasks')[1];
    eq([row[TASK_COLS.indexOf('done')], row[TASK_COLS.indexOf('order')]], [true, 4]);
  });
});

suite('sheet: appends never duplicate', t => {
  t('a retried append whose first attempt landed becomes an update', async () => {
    const fs = fakeSheets(emptyTabs());
    const be = sheetBackend(fs.api, 'S');
    await be.loadAll();
    const rec = { ...Object.fromEntries(TASK_COLS.map(c => [c, ''])), id: 'n1', title: 'New', done: false, deleted: false };
    await be.append('Tasks', rec);
    const other = sheetBackend(fs.api, 'S'); // e.g. after reload, response was lost
    await other.loadAll();
    await other.append('Tasks', { ...rec, title: 'New!' }, { retry: true });
    const ids = fs.tabs.get('Tasks').slice(1).map(r => r[0]);
    eq(ids, ['n1']);
    eq(fs.tabs.get('Tasks')[1][1], 'New!');
  });
  t('Periods: two devices creating the same period upsert one row', async () => {
    const fs = fakeSheets(emptyTabs());
    const sam = sheetBackend(fs.api, 'S'), jo = sheetBackend(fs.api, 'S');
    await sam.loadAll(); await jo.loadAll();
    await sam.append('Periods', { period: '2026-W41', focus_1: 'Sam focus', updated_at: '1' });
    await jo.append('Periods', { period: '2026-W41', notes: 'Jo notes', updated_at: '2' });
    const rows = fs.tabs.get('Periods').slice(1);
    eq(rows.length, 1);
    const cols = TABS.Periods.columns;
    eq([rows[0][cols.indexOf('focus_1')], rows[0][cols.indexOf('notes')]], ['Sam focus', 'Jo notes']);
  });
});

suite('sheet: types round-trip', t => {
  t('loadAll reads unformatted values', async () => {
    const tabs = emptyTabs();
    tabs.TripItems = [TABS.TripItems.columns, TABS.TripItems.columns.map(c => ({ id: 'i', cost: 612, title: 'Flight' }[c] ?? ''))];
    const fs = fakeSheets(tabs);
    const data = await sheetBackend(fs.api, 'S').loadAll();
    eq(data.TripItems[0].cost, 612);
    ok(fs.log.some(l => /values:batchGet/.test(l.url) && /UNFORMATTED_VALUE/.test(l.url)));
  });
  t('date, time and period columns are formatted as plain text so typed dates stay strings', async () => {
    const fs = fakeSheets(emptyTabs());
    await sheetBackend(fs.api, 'S').loadAll();
    const fmt = fs.log.find(l => /:batchUpdate$/.test(l.url) && l.body.requests.some(r => r.repeatCell));
    ok(fmt, 'repeatCell request sent');
    const taskReqs = fmt.body.requests.filter(r => r.repeatCell && r.repeatCell.range.sheetId === TAB_NAMES.indexOf('Tasks') + 1);
    const cols = taskReqs.map(r => TASK_COLS[r.repeatCell.range.startColumnIndex]);
    for (const c of ['when', 'due', 'time', 'due_time', 'title']) ok(cols.includes(c), `${c} is text-formatted`);
    for (const c of ['done', 'order', 'remind_days']) ok(!cols.includes(c), `${c} is not text-formatted`);
  });
});
