import { suite, eq, ok } from './harness.js';
import * as Hb from '../js/habits.js';

// Thursday 8 Oct 2026 (W41: Mon 5 – Sun 11)
const today = '2026-10-08';
const daily = { id: 'd', title: 'No alcohol', schedule: 'daily', start: '2026-09-01' };
const gym = { id: 'g', title: 'Gym', schedule: 'days', days: 'mon,wed,fri', start: '2026-09-01' };
const bike = { id: 'b', title: 'Ride bike', schedule: 'weekly', target: 3, start: '2026-09-01' };
const logOf = (id, days) => new Set(days.map(d => Hb.logKey(id, d)));

suite('habits: schedule', t => {
  t('daily habits are due every day from their start', () => {
    ok(Hb.isDue(daily, '2026-10-08'));
    ok(!Hb.isDue(daily, '2026-08-31'), 'before start');
  });
  t('weekday habits are due on their days only', () => {
    ok(Hb.isDue(gym, '2026-10-05')); // Mon
    ok(!Hb.isDue(gym, '2026-10-06')); // Tue
  });
  t('weekly habits can be done on any day', () => ok(Hb.isDue(bike, '2026-10-06')));
  t('targets per week', () => {
    eq(Hb.weeklyTarget(daily), 7);
    eq(Hb.weeklyTarget(gym), 3);
    eq(Hb.weeklyTarget(bike), 3);
  });
  t('describe schedule', () => {
    eq(Hb.describeSchedule(daily), 'Every day');
    eq(Hb.describeSchedule(gym), 'Mon, Wed, Fri');
    eq(Hb.describeSchedule(bike), '3× a week');
    eq(Hb.describeSchedule({ schedule: 'weekly', target: 1 }), 'Once a week');
  });
});

suite('habits: progress', t => {
  t('week progress counts ticks in the ISO week', () => {
    const log = logOf('b', ['2026-10-04', '2026-10-05', '2026-10-07']); // Sun 4th is last week
    eq(Hb.weekProgress(bike, log, '2026-W41'), { done: 2, target: 3 });
  });
  t('weekday habits only count their scheduled days', () => {
    const log = logOf('g', ['2026-10-05', '2026-10-06', '2026-10-07']);
    eq(Hb.weekProgress(gym, log, '2026-W41'), { done: 2, target: 3 });
  });
});

suite('habits: streaks', t => {
  t('daily: consecutive ticked days; an unticked today does not break it', () => {
    const log = logOf('d', ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
    eq(Hb.streak(daily, log, today), 4);
  });
  t('daily: today ticked counts', () => {
    const log = logOf('d', ['2026-10-07', '2026-10-08']);
    eq(Hb.streak(daily, log, today), 2);
  });
  t('daily: a missed day ends the streak', () => {
    const log = logOf('d', ['2026-10-04', '2026-10-06', '2026-10-07']);
    eq(Hb.streak(daily, log, today), 2);
  });
  t('weekday habits skip unscheduled days', () => {
    // Fri 2, Mon 5, Wed 7 ticked; today Thu not scheduled
    const log = logOf('g', ['2026-10-02', '2026-10-05', '2026-10-07']);
    eq(Hb.streak(gym, log, today), 3);
  });
  t('streaks stop at the start date', () => {
    const fresh = { ...daily, start: '2026-10-07' };
    eq(Hb.streak(fresh, logOf('d', ['2026-10-07']), today), 1);
  });
  t('weekly: consecutive weeks that hit the target; current week counts once met', () => {
    const log = logOf('b', [
      '2026-09-21', '2026-09-23', '2026-09-25', // W39: 3 ✓
      '2026-09-28', '2026-09-30', '2026-10-02', // W40: 3 ✓
      '2026-10-05', // W41 so far: 1 (in progress, doesn't break)
    ]);
    eq(Hb.streak(bike, log, today), 2);
    const met = new Set([...log, Hb.logKey('b', '2026-10-06'), Hb.logKey('b', '2026-10-07')]);
    eq(Hb.streak(bike, met, today), 3);
  });
  t('history: one entry per day, oldest first', () => {
    const h = Hb.history(daily, logOf('d', ['2026-10-08']), today, 3);
    eq(h, [{ day: '2026-10-06', done: false, due: true }, { day: '2026-10-07', done: false, due: true }, { day: '2026-10-08', done: true, due: true }]);
  });
});
