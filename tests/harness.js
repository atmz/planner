// Tiny test harness shared by the browser test pages and the node runner.
const suites = [];

export function suite(name, fn) {
  const tests = [];
  fn((title, body) => tests.push({ title, body }));
  suites.push({ name, tests });
}

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
}

export function ok(cond, msg = 'expected truthy') {
  if (!cond) throw new Error(msg);
}

export async function run() {
  const results = [];
  for (const s of suites) {
    for (const t of s.tests) {
      try { await t.body(); results.push({ suite: s.name, title: t.title, pass: true }); }
      catch (e) { results.push({ suite: s.name, title: t.title, pass: false, error: e.message }); }
    }
  }
  suites.length = 0;
  return results;
}

export function renderResults(results, el) {
  const failed = results.filter(r => !r.pass);
  el.innerHTML = '';
  const h = document.createElement('h2');
  h.textContent = failed.length ? `${failed.length} of ${results.length} failed` : `All ${results.length} passed`;
  h.style.color = failed.length ? '#b3261e' : '#2e7d32';
  el.append(h);
  for (const r of results) {
    const p = document.createElement('div');
    p.textContent = `${r.pass ? '✓' : '✗'} ${r.suite} › ${r.title}${r.error ? ' — ' + r.error : ''}`;
    p.style.color = r.pass ? '#555' : '#b3261e';
    p.style.font = '13px/1.5 ui-monospace, monospace';
    el.append(p);
  }
}
