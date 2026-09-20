import { describe, expect, it } from 'vitest';
import { formatMultibuy, formatMultibuyLine, parseMultibuy } from '../../src/lib/multibuy.js';

describe('formatMultibuyLine', () => {
  it('separates name and quantity with a tab', () => {
    expect(formatMultibuyLine('Tritanium', 1000)).toBe('Tritanium\t1000');
  });

  it('never emits thousands separators — EVE rejects the whole paste', () => {
    expect(formatMultibuyLine('Tritanium', 1234567)).toBe('Tritanium\t1234567');
  });

  it('rounds partial units up, since a fraction is not buyable', () => {
    expect(formatMultibuyLine('Tritanium', 10.2)).toBe('Tritanium\t11');
  });

  it('clamps negatives to zero rather than emitting a negative quantity', () => {
    expect(formatMultibuyLine('Tritanium', -5)).toBe('Tritanium\t0');
  });

  it('trims stray whitespace from the name', () => {
    expect(formatMultibuyLine('  Tritanium  ', 5)).toBe('Tritanium\t5');
  });
});

describe('formatMultibuy', () => {
  it('renders one line per item', () => {
    const out = formatMultibuy([
      { itemName: 'Tritanium', quantity: 100 },
      { itemName: 'Pyerite', quantity: 50 },
    ]);
    expect(out).toBe('Tritanium\t100\nPyerite\t50');
  });

  it('drops items with nothing to buy', () => {
    const out = formatMultibuy([
      { itemName: 'Tritanium', quantity: 100 },
      { itemName: 'Pyerite', quantity: 0 },
    ]);
    expect(out).toBe('Tritanium\t100');
  });

  it('accepts either itemName or name', () => {
    expect(formatMultibuy([{ name: 'Tritanium', quantity: 5 }])).toBe('Tritanium\t5');
  });

  it('is empty for an empty cart', () => {
    expect(formatMultibuy([])).toBe('');
  });
});

describe('parseMultibuy', () => {
  it('parses tab-separated lines', () => {
    expect(parseMultibuy('Tritanium\t100\nPyerite\t50')).toEqual([
      { name: 'Tritanium', quantity: 100 },
      { name: 'Pyerite', quantity: 50 },
    ]);
  });

  it('parses space-separated lines', () => {
    expect(parseMultibuy('Tritanium 100')).toEqual([{ name: 'Tritanium', quantity: 100 }]);
  });

  it('keeps multi-word item names intact', () => {
    expect(parseMultibuy('Medium Shield Extender II\t3')).toEqual([
      { name: 'Medium Shield Extender II', quantity: 3 },
    ]);
  });

  it("accepts thousands separators, which EVE's own copy output includes", () => {
    expect(parseMultibuy('Tritanium\t1,234,567')).toEqual([{ name: 'Tritanium', quantity: 1234567 }]);
    expect(parseMultibuy('Tritanium\t1.234.567')).toEqual([{ name: 'Tritanium', quantity: 1234567 }]);
  });

  it('keeps a bare name with quantity 0 so the caller can pick a default', () => {
    expect(parseMultibuy('Tritanium')).toEqual([{ name: 'Tritanium', quantity: 0 }]);
  });

  it('skips blank lines and trims surrounding whitespace', () => {
    expect(parseMultibuy('\n  Tritanium\t100  \n\n')).toEqual([{ name: 'Tritanium', quantity: 100 }]);
  });

  it('handles CRLF line endings', () => {
    expect(parseMultibuy('Tritanium\t1\r\nPyerite\t2')).toHaveLength(2);
  });

  it('round-trips its own formatted output', () => {
    const items = [
      { itemName: 'Tritanium', quantity: 1234567 },
      { itemName: 'Medium Shield Extender II', quantity: 3 },
    ];
    expect(parseMultibuy(formatMultibuy(items))).toEqual([
      { name: 'Tritanium', quantity: 1234567 },
      { name: 'Medium Shield Extender II', quantity: 3 },
    ]);
  });
});
