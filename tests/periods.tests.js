import { suite, eq, ok } from './harness.js';
import * as P from '../js/periods.js';

suite('periods: parse & precision', t => {
  t('recognises every precision', () => {
    eq(P.precision('2026-10-09'), 'day');
    eq(P.precision('2026-W41'), 'week');
    eq(P.precision('2026-10'), 'month');
    eq(P.precision('2026-Q4'), 'quarter');
    eq(P.precision('2026'), 'year');
    eq(P.precision('someday'), 'someday');
    eq(P.precision(''), 'inbox');
    eq(P.precision(undefined), 'inbox');
  });
  t('rejects garbage and impossible values', () => {
    eq(P.parse('2026-13'), null);
    eq(P.parse('2026-02-30'), null);
    eq(P.parse('2026-W54'), null);
    eq(P.parse('2025-W53'), null, '2025 has 52 ISO weeks');
    eq(P.parse('2026-Q5'), null);
    eq(P.parse('next tuesday'), null);
    eq(P.precision('nonsense'), null);
  });
  t('accepts W53 in a 53-week year', () => {
    ok(P.parse('2026-W53'), '2026 has 53 ISO weeks');
    ok(P.parse('2020-W53'));
  });
});

suite('periods: day arithmetic', t => {
  t('addDays crosses month, year and DST boundaries', () => {
    eq(P.addDays('2026-10-31', 1), '2026-11-01');
    eq(P.addDays('2026-12-31', 1), '2027-01-01');
    eq(P.addDays('2026-03-29', 1), '2026-03-30');
    eq(P.addDays('2026-10-25', 1), '2026-10-26');
    eq(P.addDays('2026-03-01', -1), '2026-02-28');
  });
  t('diffDays', () => {
    eq(P.diffDays('2026-10-07', '2026-10-09'), 2);
    eq(P.diffDays('2026-10-09', '2026-10-07'), -2);
    eq(P.diffDays('2026-03-28', '2026-03-30'), 2);
  });
  t('dow is Monday-based', () => {
    eq(P.dow('2026-10-05'), 0);
    eq(P.dow('2026-10-11'), 6);
  });
  t('dayOf formats a Date in local time', () => {
    eq(P.dayOf(new Date(2026, 9, 9, 23, 59)), '2026-10-09');
    eq(P.dayOf(new Date(2026, 0, 1, 0, 0)), '2026-01-01');
  });
});

suite('periods: periodOf (ISO weeks)', t => {
  t('week of a mid-year day', () => {
    eq(P.periodOf('week', '2026-10-09'), '2026-W41');
    eq(P.periodOf('week', '2026-10-05'), '2026-W41');
    eq(P.periodOf('week', '2026-10-11'), '2026-W41');
    eq(P.periodOf('week', '2026-10-12'), '2026-W42');
  });
  t('year-boundary weeks', () => {
    eq(P.periodOf('week', '2025-12-29'), '2026-W01');
    eq(P.periodOf('week', '2026-01-01'), '2026-W01');
    eq(P.periodOf('week', '2027-01-03'), '2026-W53');
    eq(P.periodOf('week', '2027-01-04'), '2027-W01');
    eq(P.periodOf('week', '2021-01-03'), '2020-W53');
  });
  t('month, quarter, year, day', () => {
    eq(P.periodOf('month', '2026-10-09'), '2026-10');
    eq(P.periodOf('quarter', '2026-10-09'), '2026-Q4');
    eq(P.periodOf('quarter', '2026-03-31'), '2026-Q1');
    eq(P.periodOf('year', '2026-10-09'), '2026');
    eq(P.periodOf('day', '2026-10-09'), '2026-10-09');
  });
});

suite('periods: start/end', t => {
  t('week', () => {
    eq(P.start('2026-W41'), '2026-10-05');
    eq(P.end('2026-W41'), '2026-10-11');
    eq(P.start('2026-W01'), '2025-12-29');
    eq(P.end('2026-W53'), '2027-01-03');
  });
  t('month (incl. leap Feb)', () => {
    eq(P.start('2026-02'), '2026-02-01');
    eq(P.end('2026-02'), '2026-02-28');
    eq(P.end('2028-02'), '2028-02-29');
  });
  t('quarter and year', () => {
    eq(P.start('2026-Q4'), '2026-10-01');
    eq(P.end('2026-Q4'), '2026-12-31');
    eq(P.end('2026-Q1'), '2026-03-31');
    eq(P.start('2026'), '2026-01-01');
    eq(P.end('2026'), '2026-12-31');
  });
  t('day is its own range; someday/inbox have none', () => {
    eq(P.start('2026-10-09'), '2026-10-09');
    eq(P.end('2026-10-09'), '2026-10-09');
    eq(P.start('someday'), null);
    eq(P.end(''), null);
  });
});

suite('periods: contains', t => {
  t('the plan example', () => {
    ok(P.contains('2026-Q4', '2026-W41'));
    ok(P.contains('2026-Q4', '2026-10-09'));
  });
  t('a period contains itself', () => {
    ok(P.contains('2026-W41', '2026-W41'));
    ok(P.contains('2026', '2026'));
  });
  t('finer never contains coarser', () => {
    ok(!P.contains('2026-W41', '2026-10'));
    ok(!P.contains('2026-10-09', '2026-W41'));
    ok(!P.contains('2026-10', '2026-Q4'));
  });
  t('weeks belong to the month/quarter/year of their Thursday', () => {
    // 2026-W44 is Mon 26 Oct – Sun 1 Nov; Thursday 29 Oct
    ok(P.contains('2026-10', '2026-W44'));
    ok(!P.contains('2026-11', '2026-W44'));
    // 2026-W53: Thursday 31 Dec 2026
    ok(P.contains('2026', '2026-W53'));
    ok(P.contains('2026-Q4', '2026-W53'));
    ok(!P.contains('2027', '2026-W53'));
    // 2026-W01: Thursday 1 Jan 2026
    ok(P.contains('2026', '2026-W01'));
    ok(!P.contains('2025', '2026-W01'));
  });
  t('a week contains its days even across months', () => {
    ok(P.contains('2026-W44', '2026-11-01'));
    ok(P.contains('2026-W44', '2026-10-26'));
    ok(!P.contains('2026-W44', '2026-11-02'));
  });
  t('a month contains its days by date, not by week', () => {
    ok(P.contains('2026-11', '2026-11-01'));
    ok(!P.contains('2026-10', '2026-11-01'));
  });
  t('quarter contains months; year contains quarters', () => {
    ok(P.contains('2026-Q4', '2026-12'));
    ok(!P.contains('2026-Q4', '2026-09'));
    ok(P.contains('2026', '2026-Q2'));
  });
  t('someday and inbox contain nothing and are contained by nothing', () => {
    ok(!P.contains('2026', 'someday'));
    ok(!P.contains('2026', ''));
    ok(!P.contains('someday', '2026-10-09'));
  });
});

suite('periods: navigation', t => {
  t('next/prev at every precision', () => {
    eq(P.next('2026-12-31'), '2027-01-01');
    eq(P.prev('2026-01-01'), '2025-12-31');
    eq(P.next('2026-W52'), '2026-W53');
    eq(P.next('2026-W53'), '2027-W01');
    eq(P.prev('2027-W01'), '2026-W53');
    eq(P.prev('2026-W01'), '2025-W52');
    eq(P.next('2026-12'), '2027-01');
    eq(P.prev('2026-01'), '2025-12');
    eq(P.next('2026-Q4'), '2027-Q1');
    eq(P.prev('2026-Q1'), '2025-Q4');
    eq(P.next('2026'), '2027');
  });
  t('shift by n', () => {
    eq(P.shift('2026-10', 3), '2027-01');
    eq(P.shift('2026-W41', -2), '2026-W39');
    eq(P.shift('2026-10-09', 30), '2026-11-08');
  });
  t('next of someday/inbox is itself', () => {
    eq(P.next('someday'), 'someday');
    eq(P.next(''), '');
  });
  t('parent', () => {
    eq(P.parent('2026-10-09'), '2026-W41');
    eq(P.parent('2026-W44'), '2026-10');
    eq(P.parent('2026-W01'), '2026-01');
    eq(P.parent('2026-10'), '2026-Q4');
    eq(P.parent('2026-Q4'), '2026');
    eq(P.parent('2026'), null);
  });
  t('convert a period to another precision (via its start / Thursday)', () => {
    eq(P.convert('2026-W44', 'month'), '2026-10');
    eq(P.convert('2026-10', 'week'), '2026-W40');
    eq(P.convert('2026-Q4', 'month'), '2026-10');
    eq(P.convert('2026-10-09', 'quarter'), '2026-Q4');
  });
});

suite('periods: lists of days and weeks', t => {
  t('daysIn a week', () => {
    eq(P.daysIn('2026-W41'), ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
  });
  t('daysIn a month length', () => {
    eq(P.daysIn('2026-02').length, 28);
    eq(P.daysIn('2026').length, 365);
  });
  t('weeksIn a month uses the Thursday rule', () => {
    eq(P.weeksIn('2026-10'), ['2026-W40', '2026-W41', '2026-W42', '2026-W43', '2026-W44']);
    eq(P.weeksIn('2026-11'), ['2026-W45', '2026-W46', '2026-W47', '2026-W48']);
  });
  t('monthsIn quarter and year', () => {
    eq(P.monthsIn('2026-Q4'), ['2026-10', '2026-11', '2026-12']);
    eq(P.monthsIn('2026').length, 12);
  });
});

suite('periods: labels', t => {
  t('long labels', () => {
    eq(P.label('2026-10-09'), 'Fri 9 Oct 2026');
    eq(P.label('2026-W41'), 'W41 · 5–11 Oct');
    eq(P.label('2026-W44'), 'W44 · 26 Oct – 1 Nov');
    eq(P.label('2026-10'), 'October 2026');
    eq(P.label('2026-Q4'), 'Q4 2026');
    eq(P.label('2026'), '2026');
    eq(P.label('someday'), 'Someday');
    eq(P.label(''), 'Inbox');
  });
  t('relative labels from today', () => {
    const today = '2026-10-07';
    eq(P.relLabel('2026-10-07', today), 'Today');
    eq(P.relLabel('2026-10-08', today), 'Tomorrow');
    eq(P.relLabel('2026-10-06', today), 'Yesterday');
    eq(P.relLabel('2026-10-09', today), 'Fri 9 Oct');
    eq(P.relLabel('2027-01-09', today), 'Sat 9 Jan 2027');
    eq(P.relLabel('2026-W41', today), 'This week');
    eq(P.relLabel('2026-W42', today), 'Next week');
    eq(P.relLabel('2026-W45', today), 'W45');
    eq(P.relLabel('2026-10', today), 'This month');
    eq(P.relLabel('2026-11', today), 'Next month');
    eq(P.relLabel('2027-03', today), 'Mar 2027');
    eq(P.relLabel('2026-Q4', today), 'This quarter');
    eq(P.relLabel('2027-Q1', today), 'Next quarter');
    eq(P.relLabel('2027-Q2', today), 'Q2 2027');
    eq(P.relLabel('2026', today), 'This year');
    eq(P.relLabel('someday', today), 'Someday');
  });
  t('fmtDayShort and fmtRange', () => {
    eq(P.fmtDayShort('2026-10-09'), 'Fri 9 Oct');
    eq(P.fmtRange('2026-10-24', '2026-11-01'), '24 Oct – 1 Nov 2026');
    eq(P.fmtRange('2026-10-24', '2026-10-28'), '24–28 Oct 2026');
    eq(P.fmtRange('2026-12-20', '2027-01-03'), '20 Dec 2026 – 3 Jan 2027');
    eq(P.fmtRange('2026-10-24', '2026-10-24'), 'Sat 24 Oct 2026');
  });
});

suite('periods: picker input validation', t => {
  t('ofType accepts only a valid period of the expected precision', () => {
    eq(P.ofType('2026-W41', 'week'), '2026-W41');
    eq(P.ofType('Oct 2026', 'month'), null);
    eq(P.ofType('2026-10', 'week'), null);
    eq(P.ofType(' 2026-10 ', 'month'), '2026-10');
  });
});
