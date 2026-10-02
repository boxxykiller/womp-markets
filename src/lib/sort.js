// Column sorting shared by every table. Missing values (null, undefined, NaN)
// always sink to the bottom whichever way the column runs, so flipping a
// sort never opens with a screen of dashes.

const isMissing = (v) => v == null || (typeof v === 'number' && Number.isNaN(v));

export function compareValues(a, b) {
  if (a === b) return 0;
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : 1;
  if (a instanceof Date && b instanceof Date) return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Returns a sorted copy of `rows`. `getValue(row, key)` picks the value to
 * compare; ties keep their incoming order so a secondary order survives.
 */
export function sortRows(rows, getValue, key, dir = 'asc') {
  if (!key) return rows;
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, v: getValue(row, key) }))
    .sort((x, y) => {
      const xm = isMissing(x.v);
      const ym = isMissing(y.v);
      if (xm || ym) return xm === ym ? x.i - y.i : xm ? 1 : -1;
      return sign * compareValues(x.v, y.v) || x.i - y.i;
    })
    .map((x) => x.row);
}

/**
 * The next { key, dir } after a heading is clicked. A new column starts in
 * its natural direction (`first`), a second click flips it, and a third
 * clears the sort (`fallback`) so the data's own order comes back.
 */
export function nextSort(state, key, first = 'asc', fallback = { key: null, dir: 'asc' }) {
  if (state.key !== key) return { key, dir: first };
  if (state.dir === first) return { key, dir: first === 'asc' ? 'desc' : 'asc' };
  return fallback;
}
