// Habits: the Habits page, the week grid and the day panel.
import * as P from '../periods.js';
import * as Hb from '../habits.js';
import { store, habits, habitLog, toggleHabit, today } from '../store.js';
import { h, section, empty, selectEl, areaSelect, areaDot, progressBar, modal, confirmAction, toast } from './components.js';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function streakLabel(hb, log) {
  const n = Hb.streak(hb, log, today());
  if (!n) return null;
  const unit = hb.schedule === 'weekly' ? (n === 1 ? 'week' : 'weeks') : (n === 1 ? 'day' : 'days');
  return h('span.streak', { title: 'Current streak' }, `🔥 ${n} ${unit}`);
}

/** Schedule fields shared by the add form and the editor. */
function scheduleFields(f, redraw) {
  const dayBoxes = h('span.day-boxes', DAY_KEYS.map((d, i) => h('label.chip', { class: Hb.scheduledDays(f).includes(d) ? 'on' : '' },
    h('input', { type: 'checkbox', checked: Hb.scheduledDays(f).includes(d), onchange: e => {
      const set = new Set(Hb.scheduledDays(f));
      e.target.checked ? set.add(d) : set.delete(d);
      f.days = DAY_KEYS.filter(k => set.has(k)).join(',');
      redraw();
    } }), P.DOW3[i])));
  return h('div.field-row',
    h('label.field', h('span', 'Type'), selectEl([['do', 'Do it'], ['avoid', 'Avoid it']], f.kind || 'do', v => { f.kind = v; redraw(); })),
    h('label.field', h('span', 'How often'), selectEl([['daily', 'Every day'], ['weekly', 'Times a week'], ['days', 'Set days']], f.schedule || 'daily', v => { f.schedule = v; redraw(); })),
    f.schedule === 'weekly' ? h('label.field', h('span', 'Times'), h('input', { type: 'number', min: 1, max: 7, value: f.target || 3, onchange: e => { f.target = Number(e.target.value) || 1; } })) : null,
    f.schedule === 'days' ? h('div.field', h('span', 'Days'), dayBoxes) : null);
}

function habitEditor(id) {
  const hb = store.get('Habits', id);
  if (!hb) return;
  const f = { ...hb };
  modal(close => {
    const body = h('div');
    const draw = () => body.replaceChildren(
      h('label.field', h('span', 'Habit'), h('input.title-input', { type: 'text', value: f.title, oninput: e => { f.title = e.target.value; } })),
      scheduleFields(f, draw),
      h('div.field-row',
        h('label.field', h('span', 'Area'), areaSelect(f.area_id, v => { f.area_id = v; })),
        h('label.field', h('span', 'Started'), h('input', { type: 'date', value: f.start, onchange: e => { f.start = e.target.value; } }))));
    draw();
    return h('form.editor', { onsubmit: e => {
      e.preventDefault();
      if (!f.title.trim()) return;
      store.update('Habits', id, { title: f.title.trim(), kind: f.kind, schedule: f.schedule, days: f.days || '', target: f.schedule === 'weekly' ? (f.target || 3) : null, area_id: f.area_id || '', start: f.start });
      close();
    } },
      h('h3', 'Edit habit'), body,
      h('div.actions',
        h('button.danger', { type: 'button', onclick: () => confirmAction(`Delete “${hb.title}” and its history?`, () => { store.remove('Habits', id); close(); }) }, 'Delete'),
        h('button', { type: 'button', onclick: () => { store.update('Habits', id, { archived: true }); close(); toast(`Archived “${hb.title}”`, { action: 'Undo', onAction: () => store.update('Habits', id, { archived: false }) }); } }, 'Archive'),
        h('span.spacer'),
        h('button', { type: 'button', onclick: close }, 'Cancel'),
        h('button.primary', { type: 'submit' }, 'Save')));
  });
}

/** 12 weeks of history as a 7-row dot grid (columns are weeks, oldest left). */
function historyGrid(hb, log) {
  const td = today();
  const end = P.end(P.periodOf('week', td));
  const days = P.daysBetween(P.addDays(end, -83), end);
  return h('div.habit-history', { 'aria-label': 'Last 12 weeks' }, days.map(day => {
    const future = day > td;
    const due = Hb.isDue(hb, day);
    const done = Hb.isDone(hb, log, day);
    return h('span.hdot', { class: [done ? 'on' : '', !due ? 'off' : '', future ? 'future' : '', day === td ? 'today' : ''].join(' '), title: `${P.fmtDay(day)}${done ? ' ✓' : ''}` });
  }));
}

function habitCard(hb, log) {
  const week = P.periodOf('week', today());
  const pr = Hb.weekProgress(hb, log, week);
  const td = today();
  const doneToday = Hb.isDone(hb, log, td);
  return h('article.habit-card', { class: hb.kind === 'avoid' ? 'avoid' : '' },
    h('div.habit-card-head',
      h('h3', areaDot(hb), hb.title),
      Hb.isDue(hb, td) ? h('button.chip', { type: 'button', class: doneToday ? 'on' : '', 'aria-pressed': String(doneToday), onclick: () => toggleHabit(hb.id, td) }, doneToday ? '✓ Today' : 'Tick today') : null),
    h('div.habit-meta',
      h('span', Hb.describeSchedule(hb), hb.kind === 'avoid' ? ' · avoid' : ''),
      streakLabel(hb, log),
      h('span.muted', `${pr.done}/${pr.target} this week`)),
    progressBar((pr.done / pr.target) * 100),
    historyGrid(hb, log),
    h('div.habit-card-foot', h('button.link.small', { type: 'button', onclick: () => habitEditor(hb.id) }, 'Edit')));
}

function addForm() {
  const f = { title: '', kind: 'do', schedule: 'daily', target: 3, days: 'mon,wed,fri' };
  const fields = h('div');
  const draw = () => fields.replaceChildren(scheduleFields(f, draw));
  draw();
  const title = h('input#new-habit-title', { type: 'text', placeholder: 'e.g. Ride bike, No alcohol, Read 20 minutes', 'aria-label': 'New habit', oninput: e => { f.title = e.target.value; } });
  return h('form.panel.habit-add', { onsubmit: e => {
    e.preventDefault();
    f.title = title.value;
    if (!f.title.trim()) return;
    store.add('Habits', { title: f.title.trim(), kind: f.kind, schedule: f.schedule, days: f.schedule === 'days' ? f.days : '', target: f.schedule === 'weekly' ? f.target : null, start: today(), order: store.all('Habits').length });
  } },
    h('h3.panel-title', 'New habit'),
    h('div.habit-add-row', title, h('button.primary', { type: 'submit' }, 'Add')),
    fields);
}

export function renderHabits() {
  const log = habitLog();
  const list = habits();
  const archived = store.all('Habits').filter(x => x.archived);
  return h('div.page.habits-page',
    h('div.page-head', h('h2', 'Habits'), h('span.muted', 'Tick them off in the week view, the day view or here.')),
    list.length ? h('div.habit-grid-cards', list.map(hb => habitCard(hb, log))) : empty('No habits yet. Add your first below.'),
    h('div.page-paper.narrow', addForm()),
    archived.length ? h('details.panel', h('summary', `Archived (${archived.length})`), h('ul.plain', archived.map(hb => h('li', hb.title, ' ',
      h('button.link.small', { type: 'button', onclick: () => store.update('Habits', hb.id, { archived: false }) }, 'Restore'))))) : null);
}

/** Habits × days grid for a week, with weekly progress. */
export function habitWeekGrid(week) {
  const list = habits();
  if (!list.length) return null;
  const log = habitLog();
  const days = P.daysIn(week);
  const td = today();
  return h('section.page-paper.habit-grid-wrap',
    h('table.habit-grid',
      h('thead', h('tr', h('th', h('a', { href: '#/habits' }, 'Habits')), days.map(d => h('th', { class: d === td ? 'today' : '' }, P.DOW3[P.dow(d)][0])), h('th.num', 'Week'))),
      h('tbody', list.map(hb => {
        const pr = Hb.weekProgress(hb, log, week);
        return h('tr', { class: hb.kind === 'avoid' ? 'avoid' : '' },
          h('th', h('span.habit-name', areaDot(hb), hb.title), streakLabel(hb, log)),
          days.map(d => {
            const due = Hb.isDue(hb, d), done = Hb.isDone(hb, log, d), future = d > td;
            return h('td', h('button.habit-cell', {
              type: 'button', class: [done ? 'on' : '', !due ? 'off' : '', d === td ? 'today' : ''].join(' '),
              disabled: !due || future, dataset: { key: Hb.logKey(hb.id, d) },
              'aria-pressed': String(done), 'aria-label': `${hb.title}, ${P.fmtDay(d)}${done ? ', done' : ''}`,
              onclick: () => toggleHabit(hb.id, d),
            }, done ? '✓' : ''));
          }),
          h('td.num', { class: pr.done >= pr.target ? 'met' : '' }, `${pr.done}/${pr.target}`));
      }))));
}

/** Today's habits as checkboxes, for the Day view. */
export function habitsPanel(day) {
  const list = habits().filter(hb => Hb.isDue(hb, day));
  if (!list.length) return null;
  const log = habitLog();
  const future = day > today();
  return section(h('span', 'Habits ', h('a.small', { href: '#/habits' }, 'all →')), h('div.habits-panel', list.map(hb => {
    const done = Hb.isDone(hb, log, day);
    const pr = Hb.weekProgress(hb, log, P.periodOf('week', day));
    return h('label.check-item', { class: [done ? 'done-habit' : '', hb.kind === 'avoid' ? 'avoid' : ''].join(' ') },
      h('input', { type: 'checkbox', checked: done, disabled: future, onchange: () => toggleHabit(hb.id, day) }),
      h('span', hb.title),
      hb.schedule === 'weekly' ? h('span.muted.small', `${pr.done}/${pr.target} this week`) : streakLabel(hb, log));
  })));
}
