// Hash routing: #/week/2026-W41, #/trip/<id>, #/todos?group=area …
import * as P from './periods.js';

export const HORIZONS = ['day', 'week', 'month', 'quarter', 'year'];

/** → { view, param, query } with period params validated and defaulted to today. */
export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const [view = '', ...rest] = path.split('/').filter(Boolean).map(decodeURIComponent);
  const param = rest.join('/');
  const query = Object.fromEntries(new URLSearchParams(qs));
  if (!view) return { view: 'week', param: P.periodOf('week', P.today()), query };
  if (HORIZONS.includes(view)) {
    const ok = param && P.precision(param) === view;
    return { view, param: ok ? param : P.periodOf(view, P.today()), query };
  }
  return { view, param, query };
}

export function periodHash(period) {
  const t = P.precision(period);
  return HORIZONS.includes(t) ? `#/${t}/${period}` : '#/inbox';
}

export function onRoute(fn) {
  window.addEventListener('hashchange', () => fn(parseHash()));
}
