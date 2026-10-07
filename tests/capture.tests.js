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
