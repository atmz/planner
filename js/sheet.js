// Google Sheets backend. Implements the store's backend interface:
//   loadAll() · append(tab, record, {retry}) · update(tab, key, patch, baseAt, full)
// Column order always comes from each tab's header row; missing tabs/columns are added.
// Updates write only the changed cells, so formulas, formatting, unknown columns and
// another person's concurrent edits to other fields of the same row are left alone.
import { TABS, TAB_NAMES, fromRow, toRow, newRecord, writeCell, isTextColumn, DEFAULT_AREAS, DEFAULT_SETTINGS } from './schema.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const READ = 'valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';

export function colLetter(n) { // 1 → A, 27 → AA
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const q = name => `'${name.replace(/'/g, "''")}'`;
const isBlank = v => v === '' || v === null || v === undefined;

const KNOWN = new Set(Object.values(TABS).flatMap(t => t.columns));

/** repeatCell requests that format every known text column of a tab as plain text (unknown columns are left alone). */
function textFormatRequests(sheetId, headers) {
  return headers.flatMap((h, i) => (KNOWN.has(h) && isTextColumn(h)
    ? [{ repeatCell: { range: { sheetId, startColumnIndex: i, endColumnIndex: i + 1, startRowIndex: 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'TEXT' } } }, fields: 'userEnteredFormat.numberFormat' } }]
    : []));
}

export function sheetBackend(api, spreadsheetId) {
  const url = `${BASE}/${encodeURIComponent(spreadsheetId)}`;
  // tab → { headers: string[], rowOf: Map(key → 1-based sheet row) }
  const meta = {};
  const sheetIds = {};
  let ensured = false;
  let formatted = false;

  async function ensureTabs() {
    if (ensured) return;
    const info = await api(`${url}?fields=sheets.properties(sheetId,title)`);
    for (const s of info.sheets || []) sheetIds[s.properties.title] = s.properties.sheetId;
    const missing = TAB_NAMES.filter(t => !(t in sheetIds));
    if (missing.length) {
      try {
        await api(`${url}:batchUpdate`, { method: 'POST', body: { requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) } });
      } catch (e) {
        if (e.status !== 400) throw e; // another device added them first
      }
      const again = await api(`${url}?fields=sheets.properties(sheetId,title)`);
      for (const s of again.sheets || []) sheetIds[s.properties.title] = s.properties.sheetId;
      await api(`${url}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data: missing.map(t => ({ range: `${q(t)}!A1`, values: [TABS[t].columns] })) } });
    }
    ensured = true;
  }

  /** Once per session: keep date/time/period/text columns as plain text so typed values stay strings. */
  async function ensureFormats() {
    if (formatted) return;
    const requests = TAB_NAMES.flatMap(t => (t in sheetIds && meta[t] ? textFormatRequests(sheetIds[t], meta[t].headers) : []));
    if (requests.length) await api(`${url}:batchUpdate`, { method: 'POST', body: { requests } });
    formatted = true;
  }

  function indexTab(tab, values) {
    const headers = (values[0] || []).map(h => String(h).trim());
    const keyCol = headers.indexOf(TABS[tab].key);
    const rowOf = new Map();
    const records = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const key = keyCol >= 0 ? row[keyCol] : '';
      if (isBlank(key)) continue;
      rowOf.set(String(key), i + 1);
      records.push(fromRow(tab, row, headers));
    }
    meta[tab] = { headers, rowOf };
    return records;
  }

  /** Add any schema columns the sheet's header row lacks (so new fields are never silently dropped). */
  async function ensureColumns(tab) {
    const m = meta[tab];
    const missing = TABS[tab].columns.filter(c => !m.headers.includes(c));
    if (!missing.length) return;
    const startCol = m.headers.length + 1;
    await api(`${url}/values/${encodeURIComponent(`${q(tab)}!${colLetter(startCol)}1`)}?valueInputOption=RAW`, { method: 'PUT', body: { values: [missing] } });
    m.headers = [...m.headers, ...missing];
  }

  async function loadTab(tab) {
    const r = await api(`${url}/values/${encodeURIComponent(q(tab))}?${READ}`);
    return indexTab(tab, r.values || []);
  }

  async function readRow(tab, row) {
    const { headers } = meta[tab];
    const r = await api(`${url}/values/${encodeURIComponent(`${q(tab)}!A${row}:${colLetter(headers.length)}${row}`)}?${READ}`);
    const raw = r.values?.[0];
    return raw ? fromRow(tab, raw, headers) : null;
  }

  /** Find the current sheet row for `key`, re-indexing if rows moved. → { row, rec } or null */
  async function locate(tab, key) {
    if (!meta[tab]) await loadTab(tab);
    const k = TABS[tab].key;
    let row = meta[tab].rowOf.get(String(key));
    let rec = row ? await readRow(tab, row) : null;
    if (!rec || String(rec[k]) !== String(key)) {
      await loadTab(tab);
      row = meta[tab].rowOf.get(String(key));
      rec = row ? await readRow(tab, row) : null;
    }
    return rec ? { row, rec } : null;
  }

  async function writeCells(tab, row, patch) {
    const { headers } = meta[tab];
    const data = Object.entries(patch)
      .filter(([col]) => headers.includes(col))
      .map(([col, v]) => ({ range: `${q(tab)}!${colLetter(headers.indexOf(col) + 1)}${row}`, values: [[writeCell(col, v)]] }));
    if (data.length) await api(`${url}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data } });
  }

  const backend = {
    name: 'sheet',
    queueKey: `planner-queue:sheet:${spreadsheetId}`,

    async loadAll() {
      await ensureTabs();
      const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
      for (const t of TAB_NAMES) params.append('ranges', q(t));
      const r = await api(`${url}/values:batchGet?${params}`);
      const out = {};
      TAB_NAMES.forEach((t, i) => { out[t] = indexTab(t, r.valueRanges?.[i]?.values || []); });
      for (const t of TAB_NAMES) await ensureColumns(t);
      await ensureFormats();
      return out;
    },

    async append(tab, record, { retry = false } = {}) {
      if (!meta[tab]) await loadTab(tab);
      await ensureColumns(tab);
      const key = String(record[TABS[tab].key]);
      // A retry may follow an attempt that landed but whose response was lost; Periods/Settings rows
      // may have been created by another device meanwhile. Either way: upsert, never duplicate.
      if (retry || TABS[tab].key !== 'id') {
        await loadTab(tab);
        if (meta[tab].rowOf.has(key)) {
          const fields = Object.fromEntries(Object.entries(record).filter(([c, v]) => c !== TABS[tab].key && !isBlank(v)));
          return backend.update(tab, key, fields, null, record);
        }
      }
      const { headers, rowOf } = meta[tab];
      const res = await api(`${url}/values/${encodeURIComponent(`${q(tab)}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST', body: { values: [toRow(tab, record, headers)] },
      });
      const m = /![A-Z]+(\d+)/.exec(res.updates?.updatedRange || '');
      if (m) rowOf.set(key, Number(m[1]));
      return record;
    },

    async update(tab, key, patch, baseAt, full) {
      await ensureColumns(tab).catch(() => {});
      const found = await locate(tab, key);
      if (!found) {
        // Not in the sheet (e.g. a Periods/Settings row created offline): append it.
        const rec = { ...(full || newRecord(tab)), ...patch, [TABS[tab].key]: key };
        return backend.append(tab, rec);
      }
      await writeCells(tab, found.row, patch);
      return { ...found.rec, ...patch };
    },
  };
  return backend;
}

/** First run: create the "Planner" spreadsheet with every tab, headers, default areas and settings. */
export async function createSpreadsheet(api) {
  const res = await api(BASE, {
    method: 'POST',
    body: {
      properties: { title: 'Planner' },
      sheets: TAB_NAMES.map(title => ({ properties: { title, gridProperties: { frozenRowCount: 1 } } })),
    },
  });
  const id = res.spreadsheetId;
  const now = new Date().toISOString();
  const areaRows = DEFAULT_AREAS.map((a, i) => toRow('Areas', newRecord('Areas', { ...a, order: i }, now), TABS.Areas.columns));
  const settingRows = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => [key, value, now]);
  const data = TAB_NAMES.map(t => ({ range: `${q(t)}!A1`, values: [TABS[t].columns] }));
  data.push({ range: `${q('Areas')}!A2`, values: areaRows });
  data.push({ range: `${q('Settings')}!A2`, values: settingRows });
  await api(`${BASE}/${id}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data } });
  return id;
}
