// Settings: calendars (shown + background), review day, reminders, areas.
import { store } from '../store.js';
import * as cal from '../calendar.js';
import { resetMock } from '../mock.js';
import { h, section, selectEl, inlineInput, confirmAction, toast } from './components.js';

let calendarsCache = null;

function calendarPicker() {
  if (!cal.available()) return h('p.muted', 'Sign in to choose calendars.');
  if (!calendarsCache) {
    calendarsCache = 'loading';
    cal.listCalendars().then(c => { calendarsCache = c; store.emit('data'); }, e => { calendarsCache = null; toast('Couldn’t list calendars: ' + e.message); });
  }
  if (calendarsCache === 'loading') return h('p.muted', 'Loading calendars…');
  const fg = new Set(store.setting('calendars').split(',').filter(Boolean));
  const bg = new Set(store.setting('background_calendars').split(',').filter(Boolean));
  const save = () => { store.setSetting('calendars', [...fg].join(',')); store.setSetting('background_calendars', [...bg].join(',')); cal.invalidate(); };
  return h('table.cal-table',
    h('thead', h('tr', h('th', 'Calendar'), h('th', 'Show events'), h('th', 'Background (shading)'))),
    h('tbody', calendarsCache.map(c => h('tr',
      h('td', h('span.area-dot', { style: { background: c.backgroundColor } }), c.summary, c.primary ? h('span.muted.small', ' (primary)') : null),
      h('td', h('input', { type: 'checkbox', checked: fg.has(c.id), 'aria-label': `Show ${c.summary}`, onchange: e => { e.target.checked ? (fg.add(c.id), bg.delete(c.id)) : fg.delete(c.id); save(); } })),
      h('td', h('input', { type: 'checkbox', checked: bg.has(c.id), 'aria-label': `Shade ${c.summary}`, onchange: e => { e.target.checked ? (bg.add(c.id), fg.delete(c.id)) : bg.delete(c.id); save(); } }))))));
}

function areaEditor() {
  const all = store.all('Areas').sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const input = h('input.add-line', { type: 'text', placeholder: '+ New area', 'aria-label': 'New area' });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) { store.add('Areas', { name: input.value.trim(), color: '#7a7f8c', order: all.length }); input.value = ''; }
  });
  const move = (a, dir) => {
    const i = all.indexOf(a), j = i + dir;
    if (j < 0 || j >= all.length) return;
    store.update('Areas', a.id, { order: j });
    store.update('Areas', all[j].id, { order: i });
  };
  return h('div',
    h('ul.area-editor', all.map((a, i) => h('li', { class: a.archived ? 'archived' : '' },
      h('input', { type: 'color', value: a.color || '#7a7f8c', 'aria-label': `Colour for ${a.name}`, onchange: e => store.update('Areas', a.id, { color: e.target.value }) }),
      inlineInput(a.name, v => v.trim() && store.update('Areas', a.id, { name: v.trim() }), { 'aria-label': 'Area name' }),
      h('button.icon', { type: 'button', disabled: i === 0, 'aria-label': 'Move up', onclick: () => move(a, -1) }, '↑'),
      h('button.icon', { type: 'button', disabled: i === all.length - 1, 'aria-label': 'Move down', onclick: () => move(a, 1) }, '↓'),
      h('label.small', h('input', { type: 'checkbox', checked: a.archived, onchange: e => store.update('Areas', a.id, { archived: e.target.checked }) }), ' archived')))),
    input);
}

export function render() {
  const isMock = document.documentElement.classList.contains('mock');
  return h('div.page.settings-page',
    h('div.page-paper.narrow',
      h('div.page-head', h('h2', 'Settings')),
      section('Calendars', h('p.muted.small', 'Events are read live and never copied into the sheet. Add public holiday calendars (one per country you live in) in Google Calendar first, then tick them as background here.'), calendarPicker()),
      section('Planning',
        h('div.field-row',
          h('label.field', h('span', 'Weekly review day'), selectEl([['mon', 'Monday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']], store.setting('review_day'), v => store.setSetting('review_day', v))),
          h('label.field', h('span', 'Default “due soon” warning (days)'), h('input', { type: 'number', min: 0, max: 60, value: store.setting('default_remind_days'), onchange: e => store.setSetting('default_remind_days', e.target.value || '3') })),
          h('label.field', h('span', 'Week starts'), h('span.muted', 'Monday (ISO weeks)')))),
      section('Areas', areaEditor()),
      isMock ? section('Sample data', h('p.muted.small', 'You’re using sample data stored in this browser only.'),
        h('button.danger', { type: 'button', onclick: () => confirmAction('Reset all sample data to its starting state?', () => { resetMock(); location.reload(); }, 'Reset') }, 'Reset sample data')) : null,
      section('Keyboard', h('p.small', h('kbd', 'n'), ' capture · ', h('kbd', '←'), h('kbd', '→'), ' previous/next · ', h('kbd', 't'), ' today · ', h('kbd', 'd w m q y'), ' horizon · ', h('kbd', 'g'), ' goals · ', h('kbd', 'p'), ' projects · ', h('kbd', 'i'), ' inbox'))));
}

