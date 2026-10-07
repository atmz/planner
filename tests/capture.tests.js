import { suite, eq } from './harness.js';
import { parseCapture, describeCapture } from '../js/capture.js';

// Wednesday 7 Oct 2026 (ISO W41)
const ctx = {
  today: '2026-10-07',
  areas: [{ id: 'a-work', name: 'Work' }, { id: 'a-home', name: 'Home' }, { id: 'a-fam', name: 'Family' }],
  projects: [{ id: 'p-kit', title: 'Kitchen renovation', area_id: 'a-home' }, { id: 'p-house', title: 'House admin', area_id: 'a-home' }],
  trips: [{ id: 't-lake', title: 'Lakeside — half term' }, { id: 't-winter', title: 'Winter by the sea' }],
};
const pick = (r, keys) => Object.fromEntries(keys.map(k => [k, r[k]]));
const ALL = ['title', 'when', 'time', 'due', 'due_time', 'area_id', 'project_id', 'trip_id', 'priority'];
const blank = { title: '', when: '', time: '', due: '', due_time: '', area_id: '', project_id: '', trip_id: '', priority: '' };
const expect = (text, fields) => eq(pick(parseCapture(text, ctx), ALL), { ...blank, ...fields }, text);

suite('capture: plan examples', t => {
  t('day + time + project by tag', () => expect('Call tiler fri 10am #house',
    { title: 'Call tiler', when: '2026-10-09', time: '10:00', project_id: 'p-house', area_id: 'a-home' }));
  t('deadline with day-month', () => expect('Renew insurance due 31 oct', { title: 'Renew insurance', due: '2026-10-31' }));
  t('relative deadline + trip by tag', () => expect('Book flights due 2w @half-term', { title: 'Book flights', due: '2026-10-21', trip_id: 't-lake' }));
});

suite('capture: scheduling', t => {
  t('plain text goes to the inbox', () => expect('Look into solar panels', { title: 'Look into solar panels' }));
  t('today / tomorrow', () => {
    expect('Gym today', { title: 'Gym', when: '2026-10-07' });
    expect('Dentist tomorrow 9:15', { title: 'Dentist', when: '2026-10-08', time: '09:15' });
  });
  t('weekday is the next occurrence, today included', () => {
    expect('Bins wed', { title: 'Bins', when: '2026-10-07' });
    expect('Bins tuesday', { title: 'Bins', when: '2026-10-13' });
  });
  t('next <weekday> is that day in next week', () => expect('Haircut next fri', { title: 'Haircut', when: '2026-10-16' }));
  t('on/at connectors are absorbed', () => expect('Lunch with Sam on fri at 1pm', { title: 'Lunch with Sam', when: '2026-10-09', time: '13:00' }));
  t('a time alone means today', () => expect('Call mum 6pm', { title: 'Call mum', when: '2026-10-07', time: '18:00' }));
  t('day-month dates roll to next year once passed', () => {
    expect('Party 12 nov', { title: 'Party', when: '2026-11-12' });
    expect('Party nov 12', { title: 'Party', when: '2026-11-12' });
    expect('New year plan 2 jan', { title: 'New year plan', when: '2027-01-02' });
  });
  t('ISO and d/m dates', () => {
    expect('Thing 2026-11-12', { title: 'Thing', when: '2026-11-12' });
    expect('Thing 12/11', { title: 'Thing', when: '2026-11-12' });
  });
  t('coarse periods', () => {
    expect('Plan garden next week', { title: 'Plan garden', when: '2026-W42' });
    expect('Sort photos this week', { title: 'Sort photos', when: '2026-W41' });
    expect('Accounts this month', { title: 'Accounts', when: '2026-10' });
    expect('Accounts next month', { title: 'Accounts', when: '2026-11' });
    expect('Learn Greek someday', { title: 'Learn Greek', when: 'someday' });
  });
  t('times: 24h, am/pm, half hours, noon', () => {
    expect('A 15:30', { title: 'A', when: '2026-10-07', time: '15:30' });
    expect('A 12am', { title: 'A', when: '2026-10-07', time: '00:00' });
    expect('A 12pm', { title: 'A', when: '2026-10-07', time: '12:00' });
    expect('A 7.45pm', { title: 'A', when: '2026-10-07', time: '19:45' });
    expect('A noon', { title: 'A', when: '2026-10-07', time: '12:00' });
  });
});

suite('capture: deadlines', t => {
  t('due + weekday + time sets due_time', () => expect('Submit VAT due fri 5pm', { title: 'Submit VAT', due: '2026-10-09', due_time: '17:00' }));
  t('due today / tomorrow / 3d / 1m', () => {
    expect('X due today', { title: 'X', due: '2026-10-07' });
    expect('X due tomorrow', { title: 'X', due: '2026-10-08' });
    expect('X due 3d', { title: 'X', due: '2026-10-10' });
    expect('X due 1m', { title: 'X', due: '2026-11-07' });
  });
  t('schedule and deadline together', () => expect('Draft report mon due fri', { title: 'Draft report', when: '2026-10-12', due: '2026-10-09' }));
  t('"due" without a date stays in the title', () => expect('Pay what is due', { title: 'Pay what is due' }));
});

suite('capture: tags and priority', t => {
  t('#area', () => expect('Fix tap #home', { title: 'Fix tap', area_id: 'a-home' }));
  t('#project matches a word prefix', () => expect('Order tiles #kitchen', { title: 'Order tiles', project_id: 'p-kit', area_id: 'a-home' }));
  t('unknown #tag stays in the title', () => expect('Read #fiction', { title: 'Read #fiction' }));
  t('@trip by slug', () => expect('Buy adaptor @winter', { title: 'Buy adaptor', trip_id: 't-winter' }));
  t('! marks high priority', () => {
    expect('Call bank !', { title: 'Call bank', priority: 'high' });
    expect('Call bank !high', { title: 'Call bank', priority: 'high' });
  });
  t('case-insensitive', () => expect('Call Tiler FRI 10AM #House', { title: 'Call Tiler', when: '2026-10-09', time: '10:00', project_id: 'p-house', area_id: 'a-home' }));
});

suite('capture: predictability', t => {
  t('invalid dates are left as text', () => expect('Thing 31 feb', { title: 'Thing 31 feb' }));
  t('month name without a day is just a word', () => expect('Ask may about it', { title: 'Ask may about it' }));
  t('describe lists what was parsed', () => {
    const r = parseCapture('Call tiler fri 10am #house due 2w', ctx);
    eq(describeCapture(r, ctx), [['when', 'Fri 9 Oct'], ['time', '10:00'], ['due', 'Wed 21 Oct'], ['project', 'House admin'], ['area', 'Home']]);
  });
  t('empty input', () => eq(parseCapture('   ', ctx).title, ''));
});

// ---- events ---------------------------------------------------------------
import { parseEvent, describeEvent } from '../js/capture.js';
const ev = (text, opts = {}) => {
  const r = parseEvent(text, { ...ctx, ...opts });
  return { title: r.title, allDay: r.allDay, start: r.start, end: r.end, startTime: r.startTime, endTime: r.endTime };
};

suite('capture: events', t => {
  t('day + time gets the default 30 minutes', () =>
    eq(ev('Dentist 12 nov 9:15'), { title: 'Dentist', allDay: false, start: '2026-11-12', end: '2026-11-12', startTime: '09:15', endTime: '09:45' }));
  t('duration with for 90m / 1h / 1.5h / 2 hours / 45 min', () => {
    eq(ev('Lunch with Sam fri 1pm for 90m').endTime, '14:30');
    eq(ev('Lunch fri 1pm for 1h').endTime, '14:00');
    eq(ev('Lunch fri 1pm for 1.5h').endTime, '14:30');
    eq(ev('Lunch fri 1pm for 2 hours').endTime, '15:00');
    eq(ev('Call fri 1pm for 45 min').endTime, '13:45');
    eq(ev('Lunch with Sam fri 1pm for 90m').title, 'Lunch with Sam');
  });
  t('time ranges', () => {
    eq(ev('Meeting fri 1-2pm'), { title: 'Meeting', allDay: false, start: '2026-10-09', end: '2026-10-09', startTime: '13:00', endTime: '14:00' });
    eq(ev('Meeting fri 10am-12:30pm').endTime, '12:30');
    eq(ev('Meeting fri 13:00-14:30').endTime, '14:30');
    eq(ev('Meeting fri 11am to 1pm').endTime, '13:00');
    eq(ev('Meeting fri 11-1pm').startTime, '11:00');
  });
  t('no time means all day; no date means today', () => {
    eq(ev('Holiday 12 nov'), { title: 'Holiday', allDay: true, start: '2026-11-12', end: '2026-11-12', startTime: '', endTime: '' });
    eq(ev('Focus block 3pm').start, '2026-10-07');
    eq(ev('Something'), { title: 'Something', allDay: true, start: '2026-10-07', end: '2026-10-07', startTime: '', endTime: '' });
  });
  t('date ranges become multi-day all-day events', () => {
    eq(ev('Ski weekend 12-14 feb'), { title: 'Ski weekend', allDay: true, start: '2027-02-12', end: '2027-02-14', startTime: '', endTime: '' });
    eq(ev('Ski weekend 12–14 feb').end, '2027-02-14');
    eq(ev('Conference 30 oct - 2 nov'), { title: 'Conference', allDay: true, start: '2026-10-30', end: '2026-11-02', startTime: '', endTime: '' });
    eq(ev('Trip fri to sun').end, '2026-10-11');
  });
  t('an event running past midnight ends the next day', () => {
    const r = ev('Party sat 10pm for 3h');
    eq([r.start, r.end, r.startTime, r.endTime], ['2026-10-10', '2026-10-11', '22:00', '01:00']);
  });
  t('event: prefix is stripped', () => eq(ev('event: Dentist tomorrow 9am').title, 'Dentist'));
  t('defaults from where the box was opened (a day, a time)', () => {
    eq(ev('Coffee', { defaultDay: '2026-10-15', defaultTime: '10:00' }), { title: 'Coffee', allDay: false, start: '2026-10-15', end: '2026-10-15', startTime: '10:00', endTime: '10:30' });
    eq(ev('Coffee 2pm', { defaultDay: '2026-10-15' }).start, '2026-10-15', 'typed time keeps the opened day');
    eq(ev('Coffee mon', { defaultDay: '2026-10-15', defaultTime: '10:00' }).start, '2026-10-12', 'typed date wins');
  });
  t('describeEvent', () => {
    eq(describeEvent(parseEvent('Lunch fri 1pm for 90m', ctx), ctx), 'Fri 9 Oct · 13:00–14:30');
    eq(describeEvent(parseEvent('Ski 12-14 feb', ctx), ctx), '12–14 Feb 2027 · all day');
    eq(describeEvent(parseEvent('Dentist 12 nov', ctx), ctx), 'Thu 12 Nov · all day');
  });
});
