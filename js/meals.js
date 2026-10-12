// Meals: pure helpers for the meal planner and recipe box.
// Meal:   { id, day, slot ('breakfast'|'lunch'|'dinner'), who ('all'|'adults'|'kids'), title, url, recipe_id, notes, eaten, order }
// Recipe: { id, title, url, who, tags, notes }
import * as P from './periods.js';

export const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner']];
export const WHO = [['all', 'Everyone'], ['adults', 'Us'], ['kids', 'Kids']];
const WHO_ORDER = { all: 0, adults: 1, kids: 2 };
const URL_RE = /https?:\/\/\S+/i;

export const whoLabel = who => (WHO.find(([k]) => k === who) || WHO[0])[1];

/** A readable name from a recipe link, or null if it isn't a link. */
export function titleFromUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./, '');
  const segs = u.pathname.split('/').filter(Boolean).reverse();
  for (const seg of segs) {
    const words = decodeURIComponent(seg).replace(/\.(html?|php|aspx?)$/i, '').replace(/^\d+[-_]/, '').replace(/[-_+]+/g, ' ').trim();
    if (!words || /^\d+$/.test(words) || /^(recipes?|blog|food|cooking|en|www)$/i.test(words)) continue;
    return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
  }
  return `Recipe from ${host}`;
}

/** What was typed into a meal slot → { title, url, recipe_id }, or null when empty. */
export function parseMealInput(text, recipes = []) {
  const s = String(text || '').trim();
  if (!s) return null;
  const m = URL_RE.exec(s);
  const url = m ? m[0] : '';
  const rest = (m ? s.replace(m[0], '') : s).replace(/\s+/g, ' ').trim();
  const live = recipes.filter(r => !r.deleted);
  const byUrl = url && live.find(r => r.url && r.url === url);
  if (byUrl) return { title: rest || byUrl.title, url, recipe_id: byUrl.id };
  if (!url) {
    const byName = live.find(r => r.title.toLowerCase() === rest.toLowerCase());
    if (byName) return { title: byName.title, url: byName.url || '', recipe_id: byName.id };
  }
  return { title: rest || titleFromUrl(url) || url, url, recipe_id: '' };
}

/** Meals for one day and slot: Everyone, then Us, then Kids. */
export function mealsIn(meals, day, slot) {
  return meals.filter(m => !m.deleted && m.day === day && m.slot === slot)
    .sort((a, b) => (WHO_ORDER[a.who] ?? 0) - (WHO_ORDER[b.who] ?? 0) || (a.order ?? 0) - (b.order ?? 0));
}

/** How often a recipe has been planned, and the last/next time around today. */
export function recipeUsage(recipeId, meals, today) {
  const days = meals.filter(m => !m.deleted && m.recipe_id === recipeId).map(m => m.day).sort();
  return {
    count: days.length,
    last: days.filter(d => d <= today).pop() || '',
    next: days.find(d => d > today) || '',
  };
}

/** Copies of one week's meals moved into another week (new, uneaten). */
export function copyWeekPlan(meals, fromWeek, toWeek) {
  const shift = P.diffDays(P.start(fromWeek), P.start(toWeek));
  return meals.filter(m => !m.deleted && P.contains(fromWeek, m.day)).map(m => ({
    day: P.addDays(m.day, shift), slot: m.slot, who: m.who || 'all', title: m.title, url: m.url || '',
    recipe_id: m.recipe_id || '', notes: m.notes || '', order: m.order ?? 0, eaten: false,
  }));
}

const JUNK_TITLE = /^(loading|#n\/a|#error|#ref|just a moment|access denied|attention required|forbidden|page not found|not found|40[34]\b|error\b)/i;

/** A page title tidied into a recipe name: no site name, no "Recipe" suffix, no {…}/[…] asides. Null if useless. */
export function cleanTitle(raw) {
  let s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s || JUNK_TITLE.test(s)) return null;
  s = s.split(/\s+[|–—:]{1,2}\s+|\s+-\s+/)[0];
  s = s.replace(/\{[^}]*\}|\[[^\]]*\]/g, ' ').replace(/\brecipes?\s*$/i, '').replace(/\s+/g, ' ').trim();
  return s.length >= 2 ? s : null;
}
