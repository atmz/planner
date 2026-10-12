// Meals: weekly meal plan (Everyone / Us / Kids per slot), eaten tracking, and the recipe box.
import * as P from '../periods.js';
import * as M from '../meals.js';
import { store, addMeal, copyWeek, today } from '../store.js';
import { h, section, empty, selectEl, modal, confirmAction, toast, safeHref, isMobile } from './components.js';

let recipeFilter = '';

const meals = () => store.all('Meals');
const recipes = () => store.all('Recipes').sort((a, b) => a.title.localeCompare(b.title));
const nextWho = w => ({ all: 'adults', adults: 'kids', kids: 'all' }[w] || 'all');
const shortWho = w => ({ all: 'All', adults: 'Us', kids: 'Kids' }[w] || 'All');
const whoBadge = who => (who && who !== 'all' ? h('span.who', { class: who }, M.whoLabel(who)) : null);

function link(url, label = '↗') {
  const href = safeHref(url);
  return href ? h('a.recipe-link', { href, target: '_blank', rel: 'noopener', title: 'Open recipe', onclick: e => e.stopPropagation() }, label) : null;
}

// ---- editors ----------------------------------------------------------------

function mealEditor(id) {
  const m = store.get('Meals', id);
  if (!m) return;
  const f = { ...m };
  modal(close => h('form.editor', { onsubmit: e => {
    e.preventDefault();
    store.update('Meals', id, { title: f.title.trim() || m.title, url: f.url.trim(), who: f.who, slot: f.slot, day: f.day, notes: f.notes });
    close();
  } },
    h('h3', 'Meal'),
    h('label.field', h('span', 'What'), h('input.title-input', { type: 'text', value: f.title, oninput: e => { f.title = e.target.value; } })),
    h('label.field', h('span', 'Recipe link'), h('input', { type: 'url', value: f.url, placeholder: 'https://…', oninput: e => { f.url = e.target.value; } })),
    h('div.field-row',
      h('label.field', h('span', 'For'), selectEl(M.WHO, f.who || 'all', v => { f.who = v; })),
      h('label.field', h('span', 'Meal'), selectEl(M.SLOTS, f.slot, v => { f.slot = v; })),
      h('label.field', h('span', 'Day'), h('input', { type: 'date', value: f.day, onchange: e => { if (e.target.value) f.day = e.target.value; } }))),
    h('label.field', h('span', 'Notes'), h('textarea', { rows: 2, oninput: e => { f.notes = e.target.value; } }, f.notes || '')),
    h('div.actions',
      h('button.danger', { type: 'button', onclick: () => { store.remove('Meals', id); close(); toast('Meal removed', { action: 'Undo', onAction: () => store.update('Meals', id, { deleted: false }) }); } }, 'Remove'),
      h('span.spacer'),
      h('button', { type: 'button', onclick: close }, 'Cancel'),
      h('button.primary', { type: 'submit' }, 'Save'))));
}

function recipeEditor(id) {
  const r = store.get('Recipes', id);
  if (!r) return;
  const f = { ...r };
  const use = M.recipeUsage(id, meals(), today());
  modal(close => h('form.editor', { onsubmit: e => {
    e.preventDefault();
    store.update('Recipes', id, { title: f.title.trim() || r.title, url: f.url.trim(), who: f.who, tags: f.tags, notes: f.notes });
    close();
  } },
    h('h3', 'Recipe'),
    h('label.field', h('span', 'Name'), h('input.title-input', { type: 'text', value: f.title, oninput: e => { f.title = e.target.value; } })),
    h('label.field', h('span', 'Link'), h('input', { type: 'url', value: f.url, placeholder: 'https://…', oninput: e => { f.url = e.target.value; } })),
    h('div.field-row',
      h('label.field', h('span', 'Usually for'), selectEl(M.WHO, f.who || 'all', v => { f.who = v; })),
      h('label.field', h('span', 'Tags'), h('input', { type: 'text', value: f.tags, placeholder: 'quick, veggie, batch', oninput: e => { f.tags = e.target.value; } }))),
    h('label.field', h('span', 'Notes'), h('textarea', { rows: 3, placeholder: 'Swaps, timings, what the kids thought…', oninput: e => { f.notes = e.target.value; } }, f.notes || '')),
    h('p.muted.small', use.count ? `Planned ${use.count}×${use.last ? ` · last ${P.fmtDayShort(use.last)}` : ''}${use.next ? ` · next ${P.fmtDayShort(use.next)}` : ''}` : 'Not planned yet.'),
    h('div.actions',
      h('button.danger', { type: 'button', onclick: () => confirmAction(`Delete “${r.title}” from the recipe box? Planned meals keep their name and link.`, () => { store.remove('Recipes', id); close(); }) }, 'Delete'),
      f.url && safeHref(f.url) ? h('a.button', { href: safeHref(f.url), target: '_blank', rel: 'noopener' }, 'Open ↗') : null,
      h('span.spacer'),
      h('button', { type: 'button', onclick: close }, 'Cancel'),
      h('button.primary', { type: 'submit' }, 'Save'))));
}

/** Put a recipe into a slot of the shown week. */
function planRecipe(r, week) {
  const days = P.daysIn(week);
  const td = today();
  const f = { day: P.contains(week, td) ? td : days[0], slot: 'dinner', who: r.who || 'all' };
  modal(close => h('form.editor', { onsubmit: e => {
    e.preventDefault();
    store.add('Meals', { day: f.day, slot: f.slot, who: f.who, title: r.title, url: r.url, recipe_id: r.id, order: M.mealsIn(meals(), f.day, f.slot).length });
    close();
    toast(`${r.title} → ${P.fmtDayShort(f.day)} ${f.slot}`);
  } },
    h('h3', `Plan “${r.title}”`),
    h('div.field-row',
      h('label.field', h('span', 'Day'), selectEl(days.map(d => [d, P.fmtDayShort(d)]), f.day, v => { f.day = v; })),
      h('label.field', h('span', 'Meal'), selectEl(M.SLOTS, f.slot, v => { f.slot = v; })),
      h('label.field', h('span', 'For'), selectEl(M.WHO, f.who, v => { f.who = v; }))),
    h('div.actions', h('span.spacer'), h('button', { type: 'button', onclick: close }, 'Cancel'), h('button.primary', { type: 'submit' }, 'Add to plan'))));
}

// ---- plan -------------------------------------------------------------------

function mealEntry(m) {
  return h('div.meal-entry', { class: [m.eaten ? 'eaten' : '', m.who || 'all'].join(' ') },
    h('input', { type: 'checkbox', checked: m.eaten, title: 'Eaten', 'aria-label': `Eaten: ${m.title}`, onchange: e => store.update('Meals', m.id, { eaten: e.target.checked }) }),
    whoBadge(m.who),
    h('button.meal-title', { type: 'button', onclick: () => mealEditor(m.id), title: m.notes || 'Edit' }, m.title),
    link(m.url));
}

function mealCell(day, slot) {
  let who = 'all';
  const whoBtn = h('button.who-toggle', { type: 'button', dataset: { who }, title: 'Who is this for? All → Us → Kids' }, shortWho(who));
  whoBtn.addEventListener('click', () => {
    who = nextWho(who);
    whoBtn.dataset.who = who;
    whoBtn.textContent = shortWho(who);
  });
  const input = h('input.meal-add', { type: 'text', placeholder: 'Add… or paste a link', 'aria-label': `Add to ${P.fmtDayShort(day)} ${slot}`, list: 'recipe-names' });
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    e.preventDefault();
    addMeal(input.value, { day, slot, who });
    input.value = '';
  });
  // paste a link and it's added straight away
  input.addEventListener('paste', () => setTimeout(() => {
    if (/^https?:\/\/\S+$/i.test(input.value.trim())) { addMeal(input.value, { day, slot, who }); input.value = ''; }
  }, 0));
  return h('div.meal-cell', { dataset: { day, slot }, class: day < today() ? 'past' : '' },
    h('span.slot-label', M.SLOTS.find(([k]) => k === slot)[1]),
    M.mealsIn(meals(), day, slot).map(mealEntry),
    h('div.meal-add-row', whoBtn, input));
}

function mealPlan(week) {
  const td = today();
  return h('div.meal-plan', { class: isMobile() ? 'stacked' : '' },
    h('div.mp-head', h('span'), M.SLOTS.map(([, label]) => h('span', label))),
    P.daysIn(week).map(day => h('div.mp-day', { class: [day === td ? 'today' : '', P.dow(day) >= 5 ? 'weekend' : ''].join(' ') },
      h('a.mp-date', { href: `#/day/${day}` }, h('span.dow', P.DOW3[P.dow(day)]), h('span.date', String(Number(day.slice(8))))),
      M.SLOTS.map(([slot]) => mealCell(day, slot)))));
}

// ---- recipe box ----------------------------------------------------------------

function recipeBox(week) {
  const td = today();
  const all = recipes();
  const q = recipeFilter.toLowerCase();
  const list = all.filter(r => !q || `${r.title} ${r.tags} ${r.notes}`.toLowerCase().includes(q));
  const add = h('input.add-line', { type: 'text', placeholder: 'Paste a recipe link (or type a name)', 'aria-label': 'Add a recipe' });
  const addRecipe = () => {
    const p = M.parseMealInput(add.value, all);
    if (!p) return;
    if (p.recipe_id) { toast('Already in the recipe box'); add.value = ''; return; }
    store.add('Recipes', { title: p.title, url: p.url, who: 'all' });
    add.value = '';
  };
  add.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addRecipe(); } });
  add.addEventListener('paste', () => setTimeout(() => { if (/^https?:\/\/\S+$/i.test(add.value.trim())) addRecipe(); }, 0));
  const search = h('input', { type: 'search', placeholder: 'Search recipes', value: recipeFilter, 'aria-label': 'Search recipes', oninput: e => { recipeFilter = e.target.value; store.emit('data'); } });
  return h('aside.recipe-box.rail',
    section(h('span', 'Recipe box', h('span.count', all.length)),
      add,
      all.length > 6 ? search : null,
      list.length ? h('ul.plain.recipe-list', list.map(r => {
        const use = M.recipeUsage(r.id, meals(), td);
        return h('li.recipe', { draggable: 'true', dataset: { recipeId: r.id } },
          h('div.recipe-main',
            h('button.link.recipe-title', { type: 'button', onclick: () => recipeEditor(r.id) }, r.title),
            link(r.url),
            whoBadge(r.who)),
          h('div.recipe-meta',
            h('span.muted.small', use.count ? `${use.count}×${use.last ? ' · last ' + P.fmtDayMonth(use.last) : ''}` : 'not planned yet'),
            r.tags ? h('span.muted.small', ' · ' + r.tags) : null,
            h('button.chip.tiny', { type: 'button', onclick: () => planRecipe(r, week) }, '+ plan')));
      })) : empty(all.length ? 'No matches.' : 'Paste recipe links here, or into any meal slot.'),
      h('datalist#recipe-names', all.map(r => h('option', { value: r.title })))),
    h('p.muted.small', isMobile() ? '' : 'Tip: drag a recipe onto a meal slot.'));
}

// drag a recipe onto a slot (desktop)
function enableRecipeDrop(root) {
  root.addEventListener('dragstart', e => {
    const r = e.target.closest?.('[data-recipe-id]');
    if (r) { e.dataTransfer.setData('text/x-recipe', r.dataset.recipeId); e.dataTransfer.effectAllowed = 'copy'; }
  });
  root.addEventListener('dragover', e => {
    const cell = e.target.closest?.('.meal-cell');
    if (cell && e.dataTransfer.types.includes('text/x-recipe')) { e.preventDefault(); cell.classList.add('drop-over'); }
  });
  root.addEventListener('dragleave', e => {
    const cell = e.target.closest?.('.meal-cell');
    if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove('drop-over');
  });
  root.addEventListener('drop', e => {
    const cell = e.target.closest?.('.meal-cell');
    const id = e.dataTransfer.getData('text/x-recipe');
    if (!cell || !id) return;
    e.preventDefault();
    cell.classList.remove('drop-over');
    const r = store.get('Recipes', id);
    if (r) store.add('Meals', { day: cell.dataset.day, slot: cell.dataset.slot, who: r.who || 'all', title: r.title, url: r.url, recipe_id: r.id, order: M.mealsIn(meals(), cell.dataset.day, cell.dataset.slot).length });
  });
}

export function renderMeals(param) {
  const week = P.ofType(param, 'week') || P.periodOf('week', today());
  const prevCount = meals().filter(m => P.contains(P.prev(week), m.day)).length;
  const thisCount = meals().filter(m => P.contains(week, m.day)).length;
  const page = h('div.page.meals-page',
    h('div.page-head',
      h('h2', 'Meals'),
      h('span.stepper',
        h('a.icon', { href: `#/meals/${P.prev(week)}`, 'aria-label': 'Previous week' }, '‹'),
        h('a.today', { href: '#/meals' }, 'This week'),
        h('a.icon', { href: `#/meals/${P.next(week)}`, 'aria-label': 'Next week' }, '›'),
        h('strong', P.label(week))),
      prevCount ? h('button.copy-week', { type: 'button', onclick: () => {
        const go = () => toast(`Copied ${copyWeek(P.prev(week), week)} meals from last week`);
        thisCount ? confirmAction(`This week already has ${thisCount} meal${thisCount > 1 ? 's' : ''}. Add last week’s ${prevCount} as well?`, go, 'Copy') : go();
      } }, `Copy last week (${prevCount})`) : h('button.copy-week', { type: 'button', disabled: true, title: 'Nothing planned last week' }, 'Copy last week')),
    h('div.meals-layout', h('div.page-paper', mealPlan(week)), recipeBox(week)));
  enableRecipeDrop(page);
  return page;
}

/** Today's meals, for the Day view. */
export function mealsToday(day) {
  const all = meals().filter(m => m.day === day);
  return section(h('span', 'Meals ', h('a.small', { href: `#/meals/${P.periodOf('week', day)}` }, 'plan →')),
    h('div.meals-today', all.length ? M.SLOTS.map(([slot, label]) => {
      const list = M.mealsIn(all, day, slot);
      return list.length ? h('div.mt-slot', h('span.slot-label', label), list.map(mealEntry)) : null;
    }) : h('p.empty', 'Nothing planned.')));
}
