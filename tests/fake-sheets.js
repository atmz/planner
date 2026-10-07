// A small in-memory emulation of the Sheets v4 endpoints sheet.js uses, for node tests.
// Cells hold JS values (strings, numbers, booleans). FORMATTED_VALUE stringifies; UNFORMATTED_VALUE returns as stored.

const colNum = s => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

export function fakeSheets(initial = {}) {
  const tabs = new Map(Object.entries(initial).map(([k, rows]) => [k, rows.map(r => [...r])]));
  const ids = new Map([...tabs.keys()].map((k, i) => [k, i + 1]));
  const log = [];

  function parseRange(raw) {
    const m = /^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?)?$/.exec(raw);
    if (!m) throw Object.assign(new Error('bad range ' + raw), { status: 400 });
    const tab = m[1].replace(/''/g, "'");
    if (!tabs.has(tab)) throw Object.assign(new Error('Unable to parse range: ' + raw), { status: 400 });
    return { tab, c1: m[2] ? colNum(m[2]) : 1, r1: m[3] ? Number(m[3]) : 1, c2: m[4] ? colNum(m[4]) : null, r2: m[5] ? Number(m[5]) : null };
  }
  const render = (v, opt) => (opt === 'UNFORMATTED_VALUE' ? v : v === true ? 'TRUE' : v === false ? 'FALSE' : String(v));
  function read(raw, opt) {
    const { tab, c1, r1, c2, r2 } = parseRange(raw);
    const rows = tabs.get(tab);
    const out = [];
    const lastR = r2 ?? rows.length;
    for (let r = r1; r <= lastR; r++) {
      const row = rows[r - 1] || [];
      const lastC = c2 ?? row.length;
      const vals = [];
      for (let c = c1; c <= lastC; c++) vals.push(row[c - 1] ?? '');
      while (vals.length && vals[vals.length - 1] === '') vals.pop();
      out.push(vals.map(v => render(v, opt)));
    }
    while (out.length && !out[out.length - 1].length) out.pop();
    return { range: raw, values: out };
  }
  function write(raw, values) {
    const { tab, c1, r1 } = parseRange(raw);
    const rows = tabs.get(tab);
    values.forEach((vals, i) => {
      const r = r1 - 1 + i;
      while (rows.length <= r) rows.push([]);
      vals.forEach((v, j) => { while (rows[r].length < c1 - 1 + j) rows[r].push(''); rows[r][c1 - 1 + j] = v; });
    });
  }

  async function api(url, { method = 'GET', body } = {}) {
    log.push({ method, url, body: body && JSON.parse(JSON.stringify(body)) });
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.replace(/^\/v4\/spreadsheets\/[^/:]+/, ''));
    const opt = u.searchParams.get('valueRenderOption');
    if (path === '' && method === 'GET') return { sheets: [...tabs.keys()].map(title => ({ properties: { title, sheetId: ids.get(title) } })) };
    if (path === ':batchUpdate') {
      for (const r of body.requests) if (r.addSheet) { const t = r.addSheet.properties.title; if (tabs.has(t)) throw Object.assign(new Error('already exists'), { status: 400 }); tabs.set(t, []); ids.set(t, ids.size + 1); }
      return {};
    }
    if (path === '/values:batchUpdate') { for (const d of body.data) write(d.range, d.values); return {}; }
    if (path === '/values:batchGet') return { valueRanges: u.searchParams.getAll('ranges').map(r => read(r, opt)) };
    const m = /^\/values\/(.+?)(:append)?$/.exec(path);
    if (m && m[2]) {
      const { tab } = parseRange(m[1]);
      const rows = tabs.get(tab);
      rows.push([...body.values[0]]);
      return { updates: { updatedRange: `'${tab}'!A${rows.length}:Z${rows.length}` } };
    }
    if (m && method === 'PUT') { write(m[1], body.values); return {}; }
    if (m) return read(m[1], opt);
    throw new Error('fake sheets: unhandled ' + method + ' ' + url);
  }
  return { api, tabs, log };
}
