import { suite, eq, ok } from './harness.js';
import * as M from '../js/meals.js';

const recipes = [
  { id: 'r1', title: 'Thai green curry', url: 'https://example.com/recipes/thai-green-curry' },
  { id: 'r2', title: 'Fish fingers & peas', url: '' },
];

suite('meals: names from recipe links', t => {
  t('last meaningful path segment, title-cased first word', () => {
    eq(M.titleFromUrl('https://www.bbcgoodfood.com/recipes/easy-chicken-curry'), 'Easy chicken curry');
    eq(M.titleFromUrl('https://cooking.nytimes.com/recipes/1017937-mississippi-roast'), 'Mississippi roast');
    eq(M.titleFromUrl('https://example.com/blog/pasta-bake.html'), 'Pasta bake');
    eq(M.titleFromUrl('https://example.com/recipes/pasta_bake/'), 'Pasta bake');
    eq(M.titleFromUrl('https://www.example.com/recipe/12345/'), 'Recipe from example.com');
    eq(M.titleFromUrl('https://example.com/'), 'Recipe from example.com');
  });
  t('not a URL → null', () => eq(M.titleFromUrl('Fish fingers'), null));
});

suite('meals: what you type into a slot', t => {
  t('plain text', () => eq(M.parseMealInput('Leftovers', recipes), { title: 'Leftovers', url: '', recipe_id: '' }));
  t('a pasted link names itself', () => eq(M.parseMealInput('https://x.com/recipes/pasta-bake', recipes), { title: 'Pasta bake', url: 'https://x.com/recipes/pasta-bake', recipe_id: '' }));
  t('text plus a link keeps your text', () => eq(M.parseMealInput('Pasta night https://x.com/r/pasta-bake', recipes), { title: 'Pasta night', url: 'https://x.com/r/pasta-bake', recipe_id: '' }));
  t('a saved recipe name links it (case-insensitive)', () => eq(M.parseMealInput('thai green curry', recipes), { title: 'Thai green curry', url: 'https://example.com/recipes/thai-green-curry', recipe_id: 'r1' }));
  t('a link already in the recipe box links that recipe', () => eq(M.parseMealInput('https://example.com/recipes/thai-green-curry', recipes).recipe_id, 'r1'));
  t('empty', () => eq(M.parseMealInput('   ', recipes), null));
});

suite('meals: plan helpers', t => {
  const meals = [
    { id: 'a', day: '2026-10-12', slot: 'dinner', who: 'kids', title: 'Fish fingers', order: 1 },
    { id: 'b', day: '2026-10-12', slot: 'dinner', who: 'adults', title: 'Curry', order: 0 },
    { id: 'c', day: '2026-10-12', slot: 'breakfast', who: 'all', title: 'Porridge', order: 0 },
    { id: 'd', day: '2026-10-13', slot: 'dinner', who: 'all', title: 'Tacos', order: 0 },
    { id: 'e', day: '2026-10-12', slot: 'dinner', who: 'all', title: 'Salad', deleted: true },
  ];
  t('mealsIn: one day and slot, Everyone then Us then Kids', () => {
    eq(M.mealsIn(meals, '2026-10-12', 'dinner').map(m => m.id), ['b', 'a']);
    eq(M.mealsIn(meals, '2026-10-12', 'breakfast').map(m => m.id), ['c']);
  });
  t('who labels', () => {
    eq(M.whoLabel('all'), 'Everyone');
    eq(M.whoLabel('adults'), 'Us');
    eq(M.whoLabel('kids'), 'Kids');
    eq(M.whoLabel(''), 'Everyone');
  });
  t('recipeUsage counts meals and finds the last date (up to today)', () => {
    const ms = [
      { recipe_id: 'r1', day: '2026-09-01' }, { recipe_id: 'r1', day: '2026-10-01' },
      { recipe_id: 'r1', day: '2026-10-20' }, { recipe_id: 'r2', day: '2026-10-02', deleted: true },
    ];
    eq(M.recipeUsage('r1', ms, '2026-10-12'), { count: 3, last: '2026-10-01', next: '2026-10-20' });
    eq(M.recipeUsage('r2', ms, '2026-10-12'), { count: 0, last: '', next: '' });
  });
  t('copyWeekPlan shifts every meal by whole weeks', () => {
    const copies = M.copyWeekPlan(meals, '2026-W42', '2026-W43');
    eq(copies.map(c => [c.day, c.title]), [['2026-10-19', 'Fish fingers'], ['2026-10-19', 'Curry'], ['2026-10-19', 'Porridge'], ['2026-10-20', 'Tacos']]);
    ok(copies.every(c => !c.id && c.eaten === false), 'fresh, uneaten');
  });
});

suite('meals: cleaning fetched page titles', t => {
  t('drops site names and "recipe" suffixes', () => {
    eq(M.cleanTitle('Easy chicken curry recipe | BBC Good Food'), 'Easy chicken curry');
    eq(M.cleanTitle('Mississippi Roast Recipe - NYT Cooking'), 'Mississippi Roast');
    eq(M.cleanTitle('Pasta Bake – Jamie Oliver'), 'Pasta Bake');
    eq(M.cleanTitle('The Best Lasagna Recipe {Easy & Classic} | Natasha’s Kitchen'), 'The Best Lasagna');
    eq(M.cleanTitle('  Shakshuka  '), 'Shakshuka');
  });
  t('keeps titles whose dash is part of the name', () => eq(M.cleanTitle('Slow-cooker beef stew'), 'Slow-cooker beef stew'));
  t('useless titles → null', () => {
    eq(M.cleanTitle(''), null);
    eq(M.cleanTitle('Loading...'), null);
    eq(M.cleanTitle('#N/A'), null);
    eq(M.cleanTitle('Just a moment...'), null);
    eq(M.cleanTitle('Access Denied'), null);
  });
});
