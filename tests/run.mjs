// Node runner: `node tests/run.mjs [suite-file-substring]`
import { run } from './harness.js';
const files = ['./periods.tests.js', './capture.tests.js', './logic.tests.js', './sheet.tests.js', './store.tests.js', './auth.tests.js'];
const filter = process.argv[2];
let total = 0, failed = 0;
for (const f of files) {
  if (filter && !f.includes(filter)) continue;
  try { await import(f); } catch (e) { failed++; total++; console.log(`✗ ${f} failed to load — ${e.message.split('\n')[0]}`); continue; }
  for (const r of await run()) {
    total++;
    if (!r.pass) { failed++; console.log(`✗ ${r.suite} › ${r.title} — ${r.error}`); }
  }
}
console.log(failed ? `\n${failed} of ${total} failed` : `\nAll ${total} passed`);
process.exit(failed ? 1 : 0);
