// Quarter: three month columns (focus + goals), quarter goals with projects, a 3-month wall strip.
import * as P from '../periods.js';
import { store, tasksAt, goalProgress } from '../store.js';
import { h, section, focusBlock, notesBlock, progressBar, areaDot, empty } from './components.js';
import { taskList, addLine } from './task.js';
import { goalsInPlay, reviewLink } from './shared.js';
import { wallPlanner, miniMonths, layerToggles } from './year.js';
import { isMobile } from './components.js';

export function render(quarter) {
  const months = P.monthsIn(quarter);
  const qGoals = store.all('Goals').filter(g => g.when === quarter && g.status !== 'dropped');
  return h('div.page.quarter-page',
    h('div.year-tools', layerToggles()),
    h('div.page-paper.wall', isMobile() ? miniMonths(months) : wallPlanner(months)),
    h('div.quarter-cols', months.map(m => h('div.page-paper.quarter-month',
      h('h3', h('a', { href: `#/month/${m}` }, P.MONTHS[Number(m.slice(5)) - 1])),
      focusBlock(m, 'Focus'),
      goalsInPlay([m], 'Goals')))),
    h('div.quarter-bottom',
      h('div.page-paper',
        focusBlock(quarter, 'Quarter focus'),
        section('Quarter goals', qGoals.length ? h('ul.goal-cards', qGoals.map(g => {
          const pr = goalProgress(g);
          const projects = store.all('Projects').filter(p => p.goal_id === g.id && p.status !== 'dropped');
          return h('li.goal-card', h('div', areaDot(g), h('a', { href: `#/goal/${g.id}` }, g.title), h('span.muted.small', ' ' + g.status)),
            progressBar(pr.shown, { label: `${pr.shown}%` }),
            projects.length ? h('ul.projects-under', projects.map(p => h('li', '▸ ', h('a', { href: `#/project/${p.id}` }, p.title), h('span.muted.small', ' ' + p.status)))) : null);
        })) : empty('No quarter goals yet.'))),
      h('div.page-paper',
        reviewLink(quarter),
        section('This quarter, no month yet', h('div.drop-zone', { dataset: { dropWhen: quarter } },
          taskList(tasksAt(quarter, { includeDone: false }), { hide: ['when'] }),
          addLine({ when: quarter }, { placeholder: 'Add to this quarter…' }))),
        notesBlock(quarter))));
}
