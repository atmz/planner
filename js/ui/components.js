// Small DOM helpers and shared widgets: h(), chips, progress bars, period picker, dialogs, toasts.
import * as P from '../periods.js';
import { store, areas, areaOf } from '../store.js';

/** h('div.class#id', {attrs, on*: handlers}, ...children) */
export function h(tag, attrs, ...children) {
  if (attrs === null || typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs)) { children.unshift(attrs); attrs = {}; }
  const [, name = 'div', rest = ''] = /^([a-z0-9-]*)(.*)$/i.exec(tag);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') for (const [prop, val] of Object.entries(v)) { if (val === undefined || val === null) continue; if (prop.startsWith('--')) el.style.setProperty(prop, String(val)); else el.style[prop] = val; }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const link = (href, ...children) => h('a', { href }, ...children);

/** A user/sheet-supplied URL made safe for href: http(s) only; bare domains get https. */
export function safeHref(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}
export const go = hash => { location.hash = hash; };

export function section(title, ...children) {
  return h('section.panel', h('h3.panel-title', title), ...children);
}

export function empty(text) { return h('p.empty', text); }

export function areaDot(rec) {
  const a = areaOf(rec);
  return a ? h('span.area-dot', { style: { background: a.color }, title: a.name }) : null;
}

export function chip(text, { cls = '', href, title, onClick } = {}) {
  if (href) return h('a.chip', { class: cls, href, title }, text);
  return h(onClick ? 'button.chip' : 'span.chip', { class: cls, title, onclick: onClick, type: onClick ? 'button' : undefined }, text);
}

export function progressBar(pct, { label } = {}) {
  const v = Math.max(0, Math.min(100, Math.round(pct || 0)));
  return h('div.progress', { title: label || `${v}%`, role: 'progressbar', 'aria-valuenow': v, 'aria-valuemin': 0, 'aria-valuemax': 100 },
    h('div.progress-fill', { style: { width: v + '%' } }));
}

export function selectEl(options, value, onChange, attrs = {}) {
  const sel = h('select', { ...attrs, onchange: e => onChange(e.target.value) },
    options.map(([v, label]) => h('option', { value: v, selected: v === (value ?? '') }, label)));
  return sel;
}

export function areaSelect(value, onChange, attrs = {}) {
  return selectEl([['', '— no area —'], ...areas().map(a => [a.id, a.name])], value, onChange, attrs);
}

export function recordSelect(tab, value, onChange, { blank = '— none —', filter = () => true, labelOf = r => r.title } = {}) {
  const recs = store.all(tab).filter(r => filter(r) || r.id === value).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
  return selectEl([['', blank], ...recs.map(r => [r.id, labelOf(r)])], value, onChange);
}

/** Text input that commits on blur / Enter (not on every key). */
export function inlineInput(value, onCommit, attrs = {}) {
  const el = h(attrs.multiline ? 'textarea' : 'input', { ...attrs, multiline: undefined, value: value ?? '' });
  if (attrs.multiline) el.value = value ?? '';
  let committed = value ?? '';
  const commit = () => { if (el.value !== committed) { committed = el.value; onCommit(el.value); } };
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (!attrs.multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); if (!attrs.multiline) el.blur(); }
    if (e.key === 'Escape') { el.value = committed; el.blur(); }
  });
  return el;
}

/** Three numbered focus lines for a period. */
export function focusBlock(period, title = 'Focus') {
  const rec = store.period(period);
  return h('section.panel.focus',
    h('h3.panel-title', title),
    h('ol.focus-list', [1, 2, 3].map(i => h('li',
      inlineInput(rec[`focus_${i}`], v => store.setPeriod(period, { [`focus_${i}`]: v }), { placeholder: `Priority ${i}`, 'aria-label': `${title} ${i}` })))));
}

export function notesBlock(period, title = 'Notes') {
  const rec = store.period(period);
  return h('section.panel.notes',
    h('h3.panel-title', title),
    inlineInput(rec.notes, v => store.setPeriod(period, { notes: v }), { multiline: true, class: 'ruled', rows: 5, placeholder: 'Notes…', 'aria-label': title }));
}

// ---- period picker ---------------------------------------------------------

/** A compact "when" control: quick choices + precision-specific input. */
export function periodPicker(value, onChange, { today = P.today(), allowInbox = true } = {}) {
  const wrap = h('div.period-picker');
  const prec = P.precision(value) || 'inbox';
  const quick = [
    ['Today', today], ['Tomorrow', P.addDays(today, 1)],
    ['This week', P.periodOf('week', today)], ['Next week', P.next(P.periodOf('week', today))],
    ['This month', P.periodOf('month', today)], ['Next month', P.next(P.periodOf('month', today))],
    ['This quarter', P.periodOf('quarter', today)], ['This year', P.periodOf('year', today)],
    ['Someday', 'someday'], ...(allowInbox ? [['Inbox', '']] : []),
  ];
  const quickRow = h('div.quick-row', quick.map(([label, v]) =>
    h('button.chip', { type: 'button', class: v === (value ?? '') ? 'on' : '', onclick: () => onChange(v) }, label)));

  const typeSel = selectEl([['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['quarter', 'Quarter'], ['year', 'Year'], ['someday', 'Someday'], ...(allowInbox ? [['inbox', 'Inbox']] : [])],
    prec, t => {
      if (t === 'someday') return onChange('someday');
      if (t === 'inbox') return onChange('');
      const base = P.isDated(value) ? P.start(value) : today;
      onChange(P.periodOf(t, base));
    }, { 'aria-label': 'Precision' });

  let input = null;
  // Safari/Firefox desktop render week/month inputs as plain text: only accept well-formed values.
  const typed = t => e => {
    const v = P.ofType(e.target.value, t);
    if (v) onChange(v);
    else if (e.target.value) { e.target.setCustomValidity(`Use the format ${{ day: '2026-10-09', week: '2026-W41', month: '2026-10' }[t]}`); e.target.reportValidity(); }
  };
  if (prec === 'day') input = h('input', { type: 'date', value, onchange: typed('day') });
  else if (prec === 'week') input = h('input', { type: 'week', value, placeholder: '2026-W41', oninput: e => e.target.setCustomValidity(''), onchange: typed('week') });
  else if (prec === 'month') input = h('input', { type: 'month', value, placeholder: '2026-10', oninput: e => e.target.setCustomValidity(''), onchange: typed('month') });
  else if (prec === 'quarter' || prec === 'year') {
    input = h('span.stepper',
      h('button.icon', { type: 'button', onclick: () => onChange(P.prev(value)), 'aria-label': 'Earlier' }, '‹'),
      h('span', P.label(value)),
      h('button.icon', { type: 'button', onclick: () => onChange(P.next(value)), 'aria-label': 'Later' }, '›'));
  }
  wrap.append(quickRow, h('div.picker-row', typeSel, input, P.isDated(value) && prec !== 'quarter' && prec !== 'year' ? h('span.muted', P.label(value)) : null));
  return wrap;
}

// ---- dialogs & toasts ----------------------------------------------------------

/** Open a modal; `build(close)` returns the content. Returns close(). */
export function modal(build, { cls = '' } = {}) {
  const dlg = h('dialog.modal', { class: cls });
  const close = () => { dlg.close(); };
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });
  const content = build(close);
  dlg.append(h('div.modal-body', content));
  document.body.append(dlg);
  dlg.showModal();
  return close;
}

/** Re-render a modal's body in place: build(close, rerender). */
export function liveModal(build, opts) {
  let body;
  const close = modal(c => { body = h('div'); return body; }, opts);
  let dirty = false, timer = 0;
  const editing = () => { const a = document.activeElement; return a && body.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== 'checkbox'; };
  const render = () => {
    if (!body.isConnected) return;
    if (editing()) { dirty = true; return; } // don't clobber typing; catch up when focus leaves
    dirty = false;
    body.replaceChildren(build(close, render));
  };
  // Changes usually arrive from a field's blur commit while the pointer is moving to another field:
  // wait for that click to land before rebuilding, so the click isn't lost.
  const later = () => { clearTimeout(timer); timer = setTimeout(render, 200); };
  render();
  const unsub = store.subscribe(k => { if (k === 'data') later(); });
  const dlg = body.closest('dialog');
  dlg.addEventListener('focusout', () => { if (dirty) later(); });
  dlg.addEventListener('close', () => { unsub(); clearTimeout(timer); });
  return close;
}

export function toast(text, { action, onAction, timeout = 5000 } = {}) {
  let box = document.getElementById('toasts');
  if (!box) { box = h('div#toasts', { 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div.toast', h('span', text),
    action ? h('button', { type: 'button', onclick: () => { t.remove(); onAction(); } }, action) : null,
    h('button.icon', { type: 'button', 'aria-label': 'Dismiss', onclick: () => t.remove() }, '×'));
  box.append(t);
  if (timeout) setTimeout(() => t.remove(), action ? timeout * 2 : timeout);
}

export function confirmAction(text, onYes, yesLabel = 'Delete') {
  modal(close => h('div.confirm',
    h('p', text),
    h('div.actions',
      h('button', { type: 'button', onclick: close }, 'Cancel'),
      h('button.danger', { type: 'button', onclick: () => { close(); onYes(); } }, yesLabel))));
}

export function isMobile() { return matchMedia('screen and (max-width: 760px)').matches; }
