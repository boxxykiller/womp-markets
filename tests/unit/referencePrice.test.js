import { describe, expect, it, vi } from 'vitest';
import {
  JITA_STATION_ID,
  chunk,
  fetchFuzzworkChunk,
  parseFuzzworkEntry,
} from '../../server/src/lib/referencePricePoller.js';

function fuzzworkEntry({ buyMax = 0, sellMin = 0, buyVolume = 0, sellVolume = 0, buyMedian = 0, sellMedian = 0 } = {}) {
  return {
    buy: { max: String(buyMax), min: '0', median: String(buyMedian), volume: String(buyVolume) },
    sell: { max: '0', min: String(sellMin), median: String(sellMedian), volume: String(sellVolume) },
  };
}

describe('chunk', () => {
  it('splits into batches of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns a single batch when everything fits', () => {
    expect(chunk([1, 2], 200)).toEqual([[1, 2]]);
  });

  it('returns nothing for an empty list', () => {
    expect(chunk([], 200)).toEqual([]);
  });
});

describe('parseFuzzworkEntry', () => {
  it('maps buy max to best buy and sell min to best sell', () => {
    const row = parseFuzzworkEntry(34, fuzzworkEntry({ buyMax: 4.5, sellMin: 5.5, buyVolume: 10, sellVolume: 20 }));
    expect(row).toMatchObject({ typeId: 34, bestBuy: 4.5, bestSell: 5.5, buyVolume: 10, sellVolume: 20, source: 'fuzzwork' });
  });

  it('treats a zero price as "no orders", not as a price of zero ISK', () => {
    // Fuzzwork always returns both sides, using 0 to mean absent.
    const row = parseFuzzworkEntry(34, fuzzworkEntry({ buyMax: 0, sellMin: 5.5 }));
    expect(row.bestBuy).toBeNull();
    expect(row.bestSell).toBe(5.5);
  });

  it('returns null when neither side has any orders', () => {
    expect(parseFuzzworkEntry(34, fuzzworkEntry())).toBeNull();
  });

  it('returns null for a missing entry', () => {
    expect(parseFuzzworkEntry(34, undefined)).toBeNull();
  });

  it('carries the medians through', () => {
    const row = parseFuzzworkEntry(34, fuzzworkEntry({ buyMax: 4, sellMin: 6, buyMedian: 4.2, sellMedian: 5.8 }));
    expect(row).toMatchObject({ medianBuy: 4.2, medianSell: 5.8 });
  });
});

describe('fetchFuzzworkChunk', () => {
  it('requests the Jita 4-4 station and the given types', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await fetchFuzzworkChunk([34, 35], { fetchImpl });

    const url = fetchImpl.mock.calls[0][0];
    expect(url).toContain(`station=${JITA_STATION_ID}`);
    expect(url).toContain('types=34,35');
  });

  it('returns only the types that actually had orders', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        34: fuzzworkEntry({ buyMax: 4, sellMin: 5 }),
        35: fuzzworkEntry(), // listed but no orders
      }),
    }));

    const rows = await fetchFuzzworkChunk([34, 35], { fetchImpl });
    // 35 is left out so it falls through to the ESI fallback rather than
    // being written as a bogus zero price.
    expect(rows.map((r) => r.typeId)).toEqual([34]);
  });

  it('throws on a non-OK response so the caller can fall back', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(fetchFuzzworkChunk([34], { fetchImpl })).rejects.toThrow('Fuzzwork 503');
  });
});
