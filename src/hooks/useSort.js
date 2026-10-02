import { useMemo, useState } from 'react';
import { nextSort, sortRows } from '@/lib/sort';

/**
 * Click-to-sort state for a table sorted in the browser. A third click on a
 * column returns to the order the data arrived in — which for most reports is
 * the server's own ranking.
 */
export function useSort(rows, getValue, initial = {}) {
  const [state, setState] = useState({ key: initial.key ?? null, dir: initial.dir ?? 'asc' });

  const sorted = useMemo(() => sortRows(rows, getValue, state.key, state.dir), [rows, getValue, state]);

  return {
    rows: sorted,
    key: state.key,
    dir: state.dir,
    toggle: (key, first) => setState((s) => nextSort(s, key, first)),
    reset: () => setState({ key: initial.key ?? null, dir: initial.dir ?? 'asc' }),
  };
}

/**
 * The same heading behaviour with only the state kept: for a table the server
 * sorts (the page passes { key, dir } to its query) or for several tables
 * that share one ordering. Clearing goes back to `initial`.
 */
export function useSortState(initial = { key: null, dir: 'asc' }, onChange) {
  const [state, setState] = useState(initial);
  return {
    key: state.key,
    dir: state.dir,
    toggle: (key, first) => {
      setState((s) => nextSort(s, key, first, initial));
      onChange?.();
    },
  };
}
