// Habits: pure rules for schedules, weekly progress and streaks.
// A habit: { id, title, kind ('do'|'avoid'), schedule ('daily'|'days'|'weekly'), days ('mon,wed,fri'), target (per week), start }
// The log is a Set of logKey(habitId, day) for ticked days.
import * as P from './periods.js';

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const logKey = (habitId, day) => `${habitId}|${day}`;

export const scheduledDays = h => String(h.days || '').split(',').map(s => s.trim().toLowerCase()).filter(d => DAY_KEYS.includes(d));
const started = (h, day) => !h.start || day >= h.start;

/** Is the habit expected (for daily/weekday habits) or possible (weekly) on this day? */
export function isDue(h, day) {
  if (!started(h, day)) return false;
  if (h.schedule === 'days') return scheduledDays(h).includes(DAY_KEYS[P.dow(day)]);
  return true;
}

/** Scheduled on this weekday at all (ignores the start date). */
export const onSchedule = (h, day) => isDue({ ...h, start: '' }, day);

/** Can this day be ticked? Any past or current day the habit is scheduled for, even before its start (backfilling). */
export const canTick = (h, day, today) => day <= today && onSchedule(h, day);

export function weeklyTarget(h) {
  if (h.schedule === 'days') return scheduledDays(h).length || 1;
  if (h.schedule === 'weekly') return Math.max(1, Math.min(7, Number(h.target) || 1));
  return 7;
}

export function describeSchedule(h) {
  if (h.schedule === 'days') return scheduledDays(h).map(d => P.DOW3[DAY_KEYS.indexOf(d)]).join(', ') || 'No days chosen';
  if (h.schedule === 'weekly') { const n = weeklyTarget(h); return n === 1 ? 'Once a week' : `${n}× a week`; }
  return 'Every day';
}

export const isDone = (h, log, day) => log.has(logKey(h.id, day));

export function weekProgress(h, log, week) {
  const done = P.daysIn(week).filter(d => isDue(h, d) && isDone(h, log, d)).length;
  return { done, target: weeklyTarget(h) };
}

/** Current streak: days (daily/weekday habits) or weeks (weekly habits). Today/this week in progress never breaks it. */
export function streak(h, log, today) {
  if (h.schedule === 'weekly') {
    const target = weeklyTarget(h);
    let week = P.periodOf('week', today);
    let n = weekProgress(h, log, week).done >= target ? 1 : 0;
    for (week = P.prev(week); P.end(week) >= (h.start || '0000'); week = P.prev(week)) {
      if (weekProgress(h, log, week).done >= target) n++; else break;
    }
    return n;
  }
  let n = 0;
  let day = today;
  if (isDue(h, day) && !isDone(h, log, day)) day = P.addDays(day, -1); // today still in progress
  for (let guard = 0; guard < 3660 && started(h, day); guard++, day = P.addDays(day, -1)) {
    if (!isDue(h, day)) continue;
    if (isDone(h, log, day)) n++; else break;
  }
  return n;
}

/** The last `days` days (oldest first) with done/due flags, for history strips. */
export function history(h, log, today, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = P.addDays(today, -i);
    out.push({ day, done: isDone(h, log, day), due: isDue(h, day) });
  }
  return out;
}
