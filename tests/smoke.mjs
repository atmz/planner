// Smoke test: serve the app, open every view in headless Chrome with sample data,
// fail on console errors / exceptions, and save screenshots.
//   node tests/smoke.mjs [outDir]   (CHROME=/path/to/chrome to override)
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, extname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const OUT = resolve(process.argv[2] || join(tmpdir(), 'planner-smoke'));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, path.endsWith('/') ? path + 'index.html' : path);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' }).end(body); }
  catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(OUT, { recursive: true });

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(tmpdir(), 'planner-smoke-profile-' + port)}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); wsUrl = list.find(t => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* starting */ }
  if (!wsUrl) await sleep(200);
}
if (!wsUrl) { console.error('Chrome did not start'); process.exit(2); }

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));
let nextId = 1;
const pending = new Map();
const problems = [];
let currentRoute = '';
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') problems.push(`[${currentRoute}] exception: ${msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text}`);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') problems.push(`[${currentRoute}] console.error: ${msg.params.args.map(a => a.value ?? a.description).join(' ')}`);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error' && !/fonts\.(googleapis|gstatic)/.test(msg.params.entry.url || '')) problems.push(`[${currentRoute}] log: ${msg.params.entry.text} ${msg.params.entry.url || ''}`);
});
const send = (method, params = {}) => new Promise(r => { const id = nextId++; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64'));
}
async function viewport(width, height, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
}

const ROUTES = ['habits', 'week', 'day', 'month', 'quarter', 'year', 'year/2026?rolling=1', 'todos', 'todos?group=area', 'todos?group=when', 'trips', 'goals', 'projects', 'lists', 'inbox', 'someday', 'settings', 'review/2026-W40'];

await viewport(1440, 1000);
await send('Page.navigate', { url: `${base}/index.html?mock=1` });
await sleep(1500);
await evaluate(`try { localStorage.clear() } catch {}`); // fresh sample data each run
await send('Page.navigate', { url: `${base}/index.html?mock=1#/week` });
await sleep(1500);

async function visit(route, prefix) {
  currentRoute = `${prefix}:${route}`;
  await evaluate(`location.hash = '#/${route}'`);
  await sleep(700);
  const text = await evaluate(`document.querySelector('main')?.innerText || ''`);
  if (/Something went wrong|Not found/.test(text)) problems.push(`[${currentRoute}] view error: ${text.slice(0, 300)}`);
  const overflow = await evaluate(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  if (overflow > 1) problems.push(`[${currentRoute}] horizontal overflow ${overflow}px`);
  await shot(`${prefix}-${route.replace(/[^a-z0-9-]+/gi, '_')}`);
}

for (const r of ROUTES) await visit(r, 'desktop');
// Detail pages: first trip, goal, project, list
for (const kind of ['trip', 'goal', 'project', 'list']) {
  const href = await evaluate(`(async () => { location.hash = '#/${kind === 'list' ? 'lists' : kind + 's'}'; await new Promise(r => setTimeout(r, 500)); return document.querySelector('main a[href^="#/${kind}/"]')?.getAttribute('href') })()`);
  if (href) await visit(href.slice(2), 'desktop'); else problems.push(`no ${kind} link found`);
}

// Interactions: quick capture, editor, review flow
currentRoute = 'interact:capture';
await evaluate(`location.hash = '#/week'`); await sleep(500);
await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))`); await sleep(300);
await evaluate(`(() => { const i = document.querySelector('.capture-input'); i.value = 'Call tiler fri 10am #kitchen due 2w'; i.dispatchEvent(new Event('input')); })()`); await sleep(200);
await shot('interact-capture');
const preview = await evaluate(`document.querySelector('.capture-preview')?.innerText`);
if (!/project/.test(preview || '')) problems.push(`[capture] preview missing project: ${preview}`);
await evaluate(`document.querySelector('.capture-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`); await sleep(500);
const added = await evaluate(`[...document.querySelectorAll('.task-title')].some(b => b.textContent === 'Call tiler')`);
if (!added) problems.push('[capture] new todo not visible in week view');
currentRoute = 'interact:editor';
await evaluate(`[...document.querySelectorAll('.task-title')].find(b => b.textContent === 'Call tiler')?.click()`); await sleep(400);
await shot('interact-editor');
await evaluate(`document.querySelector('dialog[open]')?.close()`); await sleep(200);
currentRoute = 'interact:tick';
const ticked = await evaluate(`(async () => { const c = document.querySelector('main .day-cell .task:not(.done) .check'); const id = c.closest('.task').dataset.taskId; c.click(); await new Promise(r => setTimeout(r, 400)); return document.querySelector('[data-task-id="' + id + '"]')?.classList.contains('done') })()`);
if (!ticked) problems.push('[tick] ticking a todo did not mark it done');
currentRoute = 'interact:add-line';
await evaluate(`location.hash = '#/week'`); await sleep(500);
await evaluate(`(() => { const i = [...document.querySelectorAll('input.add-line')].find(x => x.placeholder.startsWith('Add to Mon')); i.focus(); i.value = 'PROBE ONE'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
await sleep(400);
if (!(await evaluate(`[...document.querySelectorAll('main .task-title')].some(b => b.textContent === 'PROBE ONE')`))) problems.push('[add-line] new todo not shown until the input loses focus');
await evaluate(`document.activeElement?.blur()`); await sleep(300);

currentRoute = 'interact:editor-click';
await evaluate(`[...document.querySelectorAll('main .task-title')].find(b => b.textContent === 'PROBE ONE')?.click()`); await sleep(400);
await evaluate(`(() => { const t = document.querySelector('dialog[open] .title-input'); t.focus(); t.value = 'PROBE EDITED'; })()`);
const box = await evaluate(`(() => { const el = document.querySelector('dialog[open] input[type=date]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + 10, y: r.y + r.height / 2 }; })()`);
if (!box) problems.push('[editor] editor did not open for the added todo');
else {
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await sleep(400);
  if (!(await evaluate(`document.activeElement?.matches('dialog[open] input[type=date]')`))) problems.push('[editor] first click into another field after editing the title was lost');
  if (!(await evaluate(`[...document.querySelectorAll('main .task-title')].some(b => b.textContent === 'PROBE EDITED')`))) problems.push('[editor] title edit not saved');
}
await evaluate(`document.querySelector('dialog[open]')?.close()`); await sleep(200);

currentRoute = 'interact:zen';
await evaluate(`location.hash = '#/week'`); await sleep(500);
await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }))`); await sleep(400);
const zen = await evaluate(`(() => ({
  on: document.documentElement.classList.contains('zen'),
  rail: getComputedStyle(document.querySelector('.week-page .rail')).display,
  strip: document.querySelector('.due-strip') ? getComputedStyle(document.querySelector('.due-strip')).display : 'none',
  timed: [...document.querySelectorAll('.day-cell .event:not(.all-day)')].filter(e => getComputedStyle(e).display !== 'none').length,
}))()`);
if (!zen.on || zen.rail !== 'none' || zen.strip !== 'none' || zen.timed) problems.push('[zen] zen mode did not simplify the week: ' + JSON.stringify(zen));
await shot('interact-zen-week');
await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', bubbles: true }))`); await sleep(300);
if (await evaluate(`document.documentElement.classList.contains('zen')`)) problems.push('[zen] pressing z again did not turn zen off');

currentRoute = 'interact:events';
await evaluate(`location.hash = '#/week'`); await sleep(500);
if (!(await evaluate(`!!document.querySelector('.day-cell .add-event')`))) problems.push('[events] no "+ event" button on week days');
await evaluate(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }))`); await sleep(300);
await evaluate(`(() => { const i = document.querySelector('.capture-input'); i.value = 'event: Smoke meeting fri 1pm for 1h'; i.dispatchEvent(new Event('input')); })()`); await sleep(200);
const evPreview = await evaluate(`document.querySelector('.capture-preview')?.innerText || ''`);
if (!/13:00.14:00/.test(evPreview)) problems.push('[events] capture preview missing event time: ' + evPreview);
await evaluate(`document.querySelector('.capture-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`); await sleep(1200);
const evShown = () => evaluate(`[...document.querySelectorAll('.day-cell .event')].map(e => e.textContent).join('|')`);
if (!/Smoke meeting/.test(await evShown())) problems.push('[events] created event not shown in week view');
await evaluate(`[...document.querySelectorAll('.day-cell .event')].find(e => /Smoke meeting/.test(e.textContent))?.click()`); await sleep(400);
const edTitle = await evaluate(`document.querySelector('dialog[open] .event-editor input.title-input')?.value`);
if (edTitle !== 'Smoke meeting') problems.push('[events] clicking an event did not open its editor: ' + edTitle);
await evaluate(`(() => { const t = document.querySelector('dialog[open] .event-editor input.title-input'); t.value = 'Smoke edited'; t.dispatchEvent(new Event('input')); document.querySelector('dialog[open] .event-editor button.primary').click(); })()`); await sleep(1200);
if (!/Smoke edited/.test(await evShown())) problems.push('[events] edited title not shown');
await evaluate(`[...document.querySelectorAll('.day-cell .event')].find(e => /Smoke edited/.test(e.textContent))?.click()`); await sleep(400);
await evaluate(`document.querySelector('dialog[open] .event-editor button.danger')?.click()`); await sleep(300);
await evaluate(`[...document.querySelectorAll('dialog[open] .confirm button.danger')].pop()?.click()`); await sleep(1200);
if (/Smoke edited/.test(await evShown())) problems.push('[events] deleted event still shown');
await evaluate(`location.hash = '#/day'`); await sleep(600);
await evaluate(`document.querySelector('.timeline .slot[data-time="15:00"]')?.click()`); await sleep(300);
const slotPreview = await evaluate(`document.querySelector('dialog[open] .capture-preview')?.innerText || ''`);
if (!/15:00/.test(slotPreview)) problems.push('[events] clicking a free 15:00 slot did not prefill the time: ' + slotPreview);
await evaluate(`(() => { const i = document.querySelector('dialog[open] .capture-input'); i.value = 'Coffee with Jo for 45m'; i.dispatchEvent(new Event('input')); })()`); await sleep(200);
await shot('interact-event-capture');
await evaluate(`document.querySelector('dialog[open]')?.close()`); await sleep(200);

currentRoute = 'interact:habits';
await evaluate(`location.hash = '#/habits'`); await sleep(500);
const cards = await evaluate(`document.querySelectorAll('.habit-card').length`);
if (cards < 3) problems.push('[habits] expected sample habits on the Habits page, found ' + cards);
await evaluate(`(() => { const i = document.querySelector('#new-habit-title'); i.value = 'Smoke habit'; i.closest('form').requestSubmit(); })()`); await sleep(500);
if (!(await evaluate(`[...document.querySelectorAll('.habit-card h3')].some(e => e.textContent.includes('Smoke habit'))`))) problems.push('[habits] adding a habit did not show it');
await evaluate(`location.hash = '#/week'`); await sleep(500);
if (!(await evaluate(`!!document.querySelector('.habit-grid')`))) problems.push('[habits] no habit grid in the week view');
const toggled = await evaluate(`(async () => {
  const cell = [...document.querySelectorAll('.habit-grid button.habit-cell:not(.on)')].find(b => !b.disabled);
  if (!cell) return 'no cell';
  const key = cell.dataset.key; cell.click();
  await new Promise(r => setTimeout(r, 400));
  return document.querySelector('.habit-grid button.habit-cell[data-key="' + key + '"]').classList.contains('on');
})()`);
if (toggled !== true) problems.push('[habits] ticking a habit cell did not mark it: ' + toggled);
const backfill = await evaluate(`(async () => {
  const row = [...document.querySelectorAll('.habit-grid tbody tr')].find(r => r.textContent.includes('Smoke habit'));
  const mon = row?.querySelector('button.habit-cell');
  if (!mon || mon.disabled) return 'Monday cell disabled for a habit created today';
  const key = mon.dataset.key; mon.click();
  await new Promise(r => setTimeout(r, 400));
  return document.querySelector('button.habit-cell[data-key="' + key + '"]').classList.contains('on') || 'not ticked';
})()`);
if (backfill !== true) problems.push('[habits] backfilling a new habit: ' + backfill);
await evaluate(`document.querySelector('.habit-grid').scrollIntoView({ block: 'center' })`); await sleep(200);
await shot('interact-habit-grid');
await evaluate(`location.hash = '#/day'`); await sleep(500);
if (!(await evaluate(`document.querySelectorAll('.habits-panel input[type=checkbox]').length > 0`))) problems.push('[habits] no habit checkboxes in the day view');

currentRoute = 'interact:review';
await evaluate(`location.hash = '#/review/2026-W41'`); await sleep(400);
for (let i = 0; i < 4; i++) { await evaluate(`[...document.querySelectorAll('.review-page .actions button.primary')].pop()?.click()`); await sleep(300); }
await shot('interact-review-plan');

// Print: header and controls hidden, a Print button on month/year, PDFs saved for review
currentRoute = 'print';
for (const r of ['month', 'year']) {
  await evaluate(`location.hash = '#/${r}'`); await sleep(800);
  if (!(await evaluate(`!!document.querySelector('main .print-btn')`))) problems.push(`[print] no Print button on ${r}`);
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  const hidden = await evaluate(`['#header', '#fab', '.year-tools', '.page-tools', '.review-btn', 'input.add-line'].every(sel => [...document.querySelectorAll(sel)].every(el => getComputedStyle(el).display === 'none'))`);
  if (!hidden) problems.push(`[print] header/controls still visible when printing ${r}`);
  await send('Emulation.setEmulatedMedia', { media: '' });
  const pdf = await send('Page.printToPDF', { printBackground: true, preferCSSPageSize: true });
  if (pdf.result?.data) await writeFile(join(OUT, `print-${r}.pdf`), Buffer.from(pdf.result.data, 'base64'));
  else problems.push(`[print] printToPDF failed for ${r}`);
}

// Phone width
await viewport(375, 812, true);
for (const r of ['week', 'day', 'month', 'year', 'todos', 'trips', 'projects', 'inbox']) await visit(r, 'phone');

// Dark mode
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await viewport(1440, 1000);
for (const r of ['week', 'year']) await visit(r, 'dark');

ws.close();
chrome.kill();
server.close();
console.log(`Screenshots: ${OUT}`);
if (problems.length) { console.log(`\n${problems.length} problem(s):\n` + problems.join('\n')); process.exit(1); }
console.log('Smoke test passed: no console errors, exceptions, view errors or horizontal overflow.');
process.exit(0);
