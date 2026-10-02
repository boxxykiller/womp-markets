import { describe, expect, it } from 'vitest';
import { nextSort, sortRows } from '../../src/lib/sort.js';

const get = (row, key) => row[key];

describe('sortRows', () => {
  it('sorts numbers numerically, not as strings', () => {
    const rows = [{ v: 10 }, { v: 9 }, { v: 100 }];
    expect(sortRows(rows, get, 'v', 'asc').map((r) => r.v)).toEqual([9, 10, 100]);
    expect(sortRows(rows, get, 'v', 'desc').map((r) => r.v)).toEqual([100, 10, 9]);
  });

  it('sorts names case-insensitively with embedded numbers in order', () => {
    const rows = [{ n: 'b' }, { n: 'Item 10' }, { n: 'A' }, { n: 'Item 2' }];
    expect(sortRows(rows, get, 'n').map((r) => r.n)).toEqual(['A', 'b', 'Item 2', 'Item 10']);
  });

  it('keeps missing values last in both directions', () => {
    const rows = [{ v: null }, { v: 2 }, { v: undefined }, { v: 1 }, { v: NaN }];
    expect(sortRows(rows, get, 'v', 'asc').slice(0, 2).map((r) => r.v)).toEqual([1, 2]);
    expect(sortRows(rows, get, 'v', 'desc').slice(0, 2).map((r) => r.v)).toEqual([2, 1]);
  });

  it('keeps incoming order for ties', () => {
    const rows = [{ v: 1, id: 'a' }, { v: 1, id: 'b' }, { v: 0, id: 'c' }];
    expect(sortRows(rows, get, 'v', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns rows untouched with no key', () => {
    const rows = [{ v: 2 }, { v: 1 }];
    expect(sortRows(rows, get, null)).toBe(rows);
  });
});

describe('nextSort', () => {
  it('starts in the natural direction, flips, then clears', () => {
    let s = { key: null, dir: 'asc' };
    s = nextSort(s, 'isk', 'desc');
    expect(s).toEqual({ key: 'isk', dir: 'desc' });
    s = nextSort(s, 'isk', 'desc');
    expect(s).toEqual({ key: 'isk', dir: 'asc' });
    s = nextSort(s, 'isk', 'desc');
    expect(s).toEqual({ key: null, dir: 'asc' });
  });

  it('starts over when a different column is clicked', () => {
    expect(nextSort({ key: 'a', dir: 'desc' }, 'b')).toEqual({ key: 'b', dir: 'asc' });
  });
});
