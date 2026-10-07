// Quick capture (todos and calendar events) and the calendar event editor.
import * as P from '../periods.js';
import { store } from '../store.js';
import * as cal from '../calendar.js';
import { parseCapture, describeCapture, parseEvent, describeEvent, isEventText } from '../capture.js';
import { h, modal, toast, confirmAction, selectEl, safeHref } from './components.js';

const MODE_KEY = 'planner-capture-mode';
const CAL_KEY = 'planner-event-calendar';
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function captureContext() {
  return {
    today: P.today(),
    areas: store.all('Areas'),
    projects: store.all('Projects').filter(p => !['done', 'dropped'].includes(p.status)),
    trips: store.all('Trips').filter(t => t.status !== 'cancelled' && t.status !== 'done'),
  };
}

/** A calendar <select> for new events, filled once the calendar list has loaded. */
function calendarPicker(value, onChange) {
  const wrap = h('span.cal-picker');
  const draw = () => {
    const cals = cal.writableCalendars();
    if (!cals.length) { wrap.replaceChildren(h('span.muted.small', 'Main calendar')); return; }
    const v = cals.some(c => c.id === value()) ? value() : cals[0].id;
    if (v !== value()) onChange(v);
    wrap.replaceChildren(selectEl(cals.map(c => [c.id, c.summary]), v, onChange, { 'aria-label': 'Calendar' }));
  };
  draw();
  if (!cal.writableCalendars().length && cal.available()) cal.listCalendars().then(draw, () => {});
  return wrap;
}

/**
 * Quick capture. opts.mode 'todo' | 'event'; opts.day / opts.time prefill where the box was opened from.
 * In event mode the text becomes a Google Calendar event; otherwise a todo.
 */
export function openCapture(opts = {}) {
  let mode = opts.mode || lsGet(MODE_KEY) || 'todo';
  if (mode === 'event' && !cal.available()) mode = 'todo';
  let calendarId = lsGet(CAL_KEY) || 'primary';
  modal(close => {
    const input = h('input.capture-input', { type: 'text', 'aria-label': 'Quick capture' });
    const preview = h('div.capture-preview');
    const toggle = h('div.mode-toggle', { role: 'group', 'aria-label': 'Add as' });
    const calRow = h('div.cal-row');
    const saveBtn = h('button.primary', { type: 'button' });
    const evCtx = () => ({ ...captureContext(), defaultDay: opts.day, defaultTime: opts.time });

    const setMode = m => {
      if (m === 'event' && !cal.available()) { toast('Sign in to add calendar events.'); return; }
      mode = m;
      lsSet(MODE_KEY, m);
      draw();
      input.focus();
    };
    const draw = () => {
      toggle.replaceChildren(...[['todo', 'Todo'], ['event', 'Event']].map(([m, label]) =>
        h('button.chip', { type: 'button', class: m === mode ? 'on' : '', 'aria-pressed': String(m === mode), onclick: () => setMode(m) }, label)),
        h('span.muted.small', ' Tab switches'));
      input.placeholder = mode === 'event'
        ? 'e.g. Lunch with Sam fri 1pm for 90m  ·  Ski weekend 12-14 feb'
        : 'e.g. Call tiler fri 10am #home  ·  Renew insurance due 31 oct';
      calRow.replaceChildren(...(mode === 'event' ? [h('span.muted.small', 'Calendar '), calendarPicker(() => calendarId, v => { calendarId = v; lsSet(CAL_KEY, v); })] : []));
      saveBtn.textContent = mode === 'event' ? 'Add event' : 'Add todo';
      update();
    };
    const update = () => {
      if (isEventText(input.value) && mode !== 'event' && cal.available()) { mode = 'event'; draw(); return; }
      const text = input.value.trim();
      if (mode === 'event') {
        const e = parseEvent(input.value, evCtx());
        preview.replaceChildren(text
          ? h('span.chip.when', describeEvent(e))
          : h('span.muted', opts.day ? `${P.fmtDayShort(opts.day)}${opts.time ? ' · ' + opts.time : ''} · add a title, time (1-2pm), length (for 90m) or dates (12-14 feb)` : 'Title, then a day, a time (1-2pm or 10am for 90m) or dates (12-14 feb). No time = all day.'));
        return;
      }
      const ctx = captureContext();
      const r = parseCapture(input.value, ctx);
      if (!r.when && opts.day) r.when = opts.day;
      preview.replaceChildren(...(text ? describeCapture(r, ctx).map(([k, v]) => h('span.chip', { class: k }, `${k}: ${v}`))
        : [h('span.muted', 'Tags: #area or #project · @trip · due <date> · today, fri, 12 nov, 10am, next week, someday, !')]));
    };
    const save = async () => {
      if (mode === 'event') {
        const e = parseEvent(input.value, evCtx());
        if (!e.title) return;
        saveBtn.disabled = true;
        try {
          await cal.createEvent(calendarId, e);
          close();
          toast(`Added to ${cal.calendarName(calendarId)}: ${describeEvent(e)}`);
        } catch (err) { saveBtn.disabled = false; toast('Couldn’t add the event: ' + err.message); }
        return;
      }
      const r = parseCapture(input.value, captureContext());
      if (!r.title) return;
      const { title, when, time, due, area_id, project_id, trip_id, priority } = r;
      const rec = store.add('Tasks', { title, when: when || opts.day || '', time, due, area_id, project_id, trip_id, priority });
      close();
      toast(`Added to ${P.relLabel(rec.when) || 'Inbox'}`, { action: 'Edit', onAction: () => import('./task.js').then(m => m.openTaskEditor(rec.id)) });
    };
    saveBtn.addEventListener('click', save);
    input.addEventListener('input', update);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); save(); }
      if (e.key === 'Tab' && !e.shiftKey) { e.preventDefault(); setMode(mode === 'event' ? 'todo' : 'event'); }
    });
    draw();
    setTimeout(() => input.focus(), 0);
    return h('div.capture', h('div.capture-head', h('h3', 'Quick capture'), toggle), input, preview, calRow,
      h('div.actions', h('button', { type: 'button', onclick: close }, 'Cancel'), saveBtn));
  }, { cls: 'capture-dialog' });
}

/** View or edit a calendar event (read-only for calendars you can't write to, birthdays, Gmail events). */
export function openEventEditor(ev) {
  const link = safeHref(ev.link);
  modal(close => {
    if (!ev.editable) {
      return h('div.event-editor.readonly',
        h('div.editor-head', h('span.area-dot', { style: { background: ev.color || 'var(--accent)' } }), h('h3', ev.title), h('button.icon', { type: 'button', onclick: close, 'aria-label': 'Close' }, '×')),
        h('p', describeEvent(ev)),
        ev.location ? h('p.muted', ev.location) : null,
        h('p.muted.small', `${cal.calendarName(ev.calendarId)} · read-only here`),
        h('div.actions', link ? h('a.button', { href: link, target: '_blank', rel: 'noopener' }, 'Open in Google Calendar ↗') : null, h('span.spacer'), h('button', { type: 'button', onclick: close }, 'Close')));
    }
    const f = { ...ev };
    const title = h('input.title-input', { type: 'text', value: f.title, 'aria-label': 'Title' });
    const allDay = h('input', { type: 'checkbox', checked: f.allDay, id: 'ev-allday' });
    const startD = h('input', { type: 'date', value: f.start, 'aria-label': 'Start date' });
    const startT = h('input', { type: 'time', value: f.startTime || '09:00', 'aria-label': 'Start time' });
    const endD = h('input', { type: 'date', value: f.end, 'aria-label': 'End date' });
    const endT = h('input', { type: 'time', value: f.endTime || '09:30', 'aria-label': 'End time' });
    const loc = h('input', { type: 'text', value: f.location || '', placeholder: 'Location', 'aria-label': 'Location' });
    const notes = h('textarea', { rows: 3, placeholder: 'Notes', 'aria-label': 'Notes' });
    notes.value = f.description || '';
    const err = h('p.error-text');
    const times = [startT, endT];
    const syncAllDay = () => times.forEach(el => { el.hidden = allDay.checked; });
    allDay.addEventListener('change', syncAllDay);
    syncAllDay();
    startD.addEventListener('change', () => { if (!endD.value || endD.value < startD.value) endD.value = startD.value; });
    const save = async e => {
      e?.preventDefault();
      const next = {
        title: title.value.trim() || '(untitled)', allDay: allDay.checked, start: startD.value, end: endD.value || startD.value,
        startTime: startT.value, endTime: endT.value, location: loc.value, description: notes.value,
      };
      if (next.end < next.start || (!next.allDay && next.start === next.end && next.endTime <= next.startTime)) {
        err.textContent = 'The end must be after the start.';
        return;
      }
      try { await cal.updateEvent(ev.calendarId, ev.id, next); close(); toast('Event updated'); }
      catch (x) { err.textContent = 'Couldn’t save: ' + x.message; }
    };
    return h('form.editor.event-editor', { onsubmit: save },
      h('div.editor-head', h('span.area-dot', { style: { background: ev.color || 'var(--accent)' } }), title, h('button.icon', { type: 'button', onclick: close, 'aria-label': 'Close' }, '×')),
      h('label.field.inline', allDay, h('span', 'All day')),
      h('div.field-row', h('label.field', h('span', 'Starts'), startD), h('label.field', h('span', ' '), startT)),
      h('div.field-row', h('label.field', h('span', 'Ends'), endD), h('label.field', h('span', ' '), endT)),
      h('label.field', h('span', 'Location'), loc),
      h('label.field', h('span', 'Notes'), notes),
      h('p.muted.small', cal.calendarName(ev.calendarId), ev.recurring ? ' · repeating event: changes apply to this occurrence only' : ''),
      err,
      h('div.actions',
        h('button.danger', { type: 'button', onclick: () => confirmAction(`Delete “${ev.title}”${ev.recurring ? ' (this occurrence)' : ''} from ${cal.calendarName(ev.calendarId)}?`, async () => {
          try { await cal.deleteEvent(ev.calendarId, ev.id); close(); toast('Event deleted'); }
          catch (x) { toast('Couldn’t delete: ' + x.message); }
        }) }, 'Delete'),
        link ? h('a.button', { href: link, target: '_blank', rel: 'noopener' }, 'Google Calendar ↗') : null,
        h('span.spacer'),
        h('button', { type: 'button', onclick: close }, 'Cancel'),
        h('button.primary', { type: 'submit' }, 'Save')));
  }, { cls: 'event-dialog' });
}
