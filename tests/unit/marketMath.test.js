import { describe, expect, it } from 'vitest';
import {
  avgDailyVolume,
  buildDailyLookup,
  buySellSplit,
  daysOfCover,
  effectiveMinimum,
  groupOrdersIntoLadder,
  restockQuantity,
  spreadPct,
  vsReferencePct,
  watchStatus,
  withMovingAverage,
} from '../../server/src/lib/marketMath.js';

const NOW = new Date('2026-09-20T12:00:00.000Z');

function dayRow(typeId, daysAgo, confirmed, estimated = 0) {
  return {
    typeId,
    date: new Date(NOW.getTime() - daysAgo * 86400000),
    unitsSoldConfirmed: confirmed,
    unitsSoldEstimated: estimated,
  };
}

describe('buildDailyLookup', () => {
  it('sums confirmed and estimated units per day', () => {
    const lookup = buildDailyLookup([dayRow(34, 1, 100, 50)]);
    const perDay = lookup.get(34);
    expect([...perDay.values()]).toEqual([150]);
  });

  it('merges rows that land on the same day', () => {
    const date = new Date(NOW.getTime() - 86400000);
    const lookup = buildDailyLookup([
      { typeId: 34, date, unitsSoldConfirmed: 10, unitsSoldEstimated: 0 },
      { typeId: 34, date, unitsSoldConfirmed: 5, unitsSoldEstimated: 0 },
    ]);
    expect([...lookup.get(34).values()]).toEqual([15]);
  });
});

describe('avgDailyVolume', () => {
  it('divides by days that have data, not by the window length', () => {
    // 3 days of data, 300 units total, asked over a 30-day window.
    const lookup = buildDailyLookup([dayRow(34, 1, 100), dayRow(34, 2, 100), dayRow(34, 3, 100)]);
    // 300/3 = 100, NOT 300/30 = 10. This is the whole point: a young item
    // must not look like it moves ten times slower than it does.
    expect(avgDailyVolume(lookup, 34, 30, NOW)).toBe(100);
  });

  it('ignores days outside the window', () => {
    const lookup = buildDailyLookup([dayRow(34, 1, 100), dayRow(34, 20, 999)]);
    expect(avgDailyVolume(lookup, 34, 7, NOW)).toBe(100);
  });

  it('returns null rather than zero when there is no data at all', () => {
    expect(avgDailyVolume(new Map(), 34, 30, NOW)).toBeNull();
  });

  it('returns null when every row falls outside the window', () => {
    const lookup = buildDailyLookup([dayRow(34, 40, 500)]);
    expect(avgDailyVolume(lookup, 34, 7, NOW)).toBeNull();
  });
});

describe('daysOfCover', () => {
  it('divides stock by the rate', () => {
    expect(daysOfCover(500, 100)).toBe(5);
  });

  it('returns null when the rate is unknown', () => {
    expect(daysOfCover(500, null)).toBeNull();
  });

  it('returns Infinity for stock that never sells', () => {
    expect(daysOfCover(500, 0)).toBe(Infinity);
  });

  it('returns 0 when there is no stock and no sales', () => {
    expect(daysOfCover(0, 0)).toBe(0);
  });
});

describe('effectiveMinimum', () => {
  it('takes the flat floor when it is the stricter policy', () => {
    expect(effectiveMinimum({ minQuantity: 1000, minDaysCover: 2 }, 100)).toBe(1000);
  });

  it('takes the dynamic floor when it is the stricter policy', () => {
    expect(effectiveMinimum({ minQuantity: 100, minDaysCover: 5 }, 100)).toBe(500);
  });

  it('falls back to the flat floor when the rate is unknown', () => {
    expect(effectiveMinimum({ minQuantity: 100, minDaysCover: 5 }, null)).toBe(100);
  });

  it('is zero when neither policy is set', () => {
    expect(effectiveMinimum({}, 100)).toBe(0);
  });
});

describe('watchStatus', () => {
  it('reads "out" with nothing on the market, whatever the minimum', () => {
    expect(watchStatus(0, 1000)).toBe('out');
    expect(watchStatus(0, 0)).toBe('out');
  });

  // The boundaries exactly at each edge — the cases most likely to drift.
  it('reads "ok" exactly at the minimum', () => {
    expect(watchStatus(1000, 1000)).toBe('ok');
  });

  it('reads "low" just below the minimum', () => {
    expect(watchStatus(999, 1000)).toBe('low');
  });

  it('reads "low" exactly at half the minimum', () => {
    expect(watchStatus(500, 1000)).toBe('low');
  });

  it('reads "critical" just below half the minimum', () => {
    expect(watchStatus(499, 1000)).toBe('critical');
  });

  it('reads "ok" for stocked items with no minimum set', () => {
    expect(watchStatus(5, 0)).toBe('ok');
  });
});

describe('restockQuantity', () => {
  it('is the shortfall against target', () => {
    expect(restockQuantity(300, 1000)).toBe(700);
  });

  it('is zero when already at or above target', () => {
    expect(restockQuantity(1200, 1000)).toBe(0);
  });

  it('rounds up, since a partial unit is not buyable', () => {
    expect(restockQuantity(0, 10.2)).toBe(11);
  });
});

describe('buySellSplit', () => {
  it('is the buy share of total depth', () => {
    expect(buySellSplit(250, 750)).toBe(0.25);
  });

  it('is null with no depth at all, to distinguish it from "all sell"', () => {
    expect(buySellSplit(0, 0)).toBeNull();
    expect(buySellSplit(0, 100)).toBe(0);
  });
});

describe('spreadPct and vsReferencePct', () => {
  it('computes spread as a fraction of the ask', () => {
    expect(spreadPct(80, 100)).toBeCloseTo(0.2);
  });

  it('returns null when either side is missing', () => {
    expect(spreadPct(null, 100)).toBeNull();
    expect(spreadPct(80, null)).toBeNull();
  });

  it('signs the reference comparison: positive means local is dearer', () => {
    expect(vsReferencePct(120, 100)).toBeCloseTo(0.2);
    expect(vsReferencePct(80, 100)).toBeCloseTo(-0.2);
  });

  it('returns null rather than dividing by a zero reference', () => {
    expect(vsReferencePct(100, 0)).toBeNull();
  });
});

describe('withMovingAverage', () => {
  const series = [{ units: 10 }, { units: 20 }, { units: 30 }, { units: 40 }];

  it('averages over however many points exist at the start of the series', () => {
    const out = withMovingAverage(series, 3, 'units');
    expect(out[0].unitsMA3).toBe(10); // just itself
    expect(out[1].unitsMA3).toBe(15); // (10+20)/2
    expect(out[2].unitsMA3).toBe(20); // (10+20+30)/3
  });

  it('is trailing — the last point averages the window ending at it', () => {
    const out = withMovingAverage(series, 3, 'units');
    expect(out[3].unitsMA3).toBe(30); // (20+30+40)/3
  });

  it('keeps the original fields', () => {
    const out = withMovingAverage([{ units: 10, date: '2026-09-01' }], 7, 'units');
    expect(out[0].date).toBe('2026-09-01');
  });
});

describe('groupOrdersIntoLadder', () => {
  const orders = [
    { isBuyOrder: false, price: 100, volumeRemain: 10 },
    { isBuyOrder: false, price: 101, volumeRemain: 20 },
    { isBuyOrder: false, price: 150, volumeRemain: 5 },
    { isBuyOrder: true, price: 90, volumeRemain: 7 },
    { isBuyOrder: true, price: 80, volumeRemain: 3 },
  ];

  it('keeps every distinct price when groupPct is 0', () => {
    const ladder = groupOrdersIntoLadder(orders, { isBuy: false, groupPct: 0 });
    expect(ladder.map((l) => l.price)).toEqual([100, 101, 150]);
  });

  it('sorts sell levels cheapest-first and buy levels dearest-first', () => {
    expect(groupOrdersIntoLadder(orders, { isBuy: false })[0].price).toBe(100);
    expect(groupOrdersIntoLadder(orders, { isBuy: true })[0].price).toBe(90);
  });

  it('accumulates a running cumulative volume', () => {
    const ladder = groupOrdersIntoLadder(orders, { isBuy: false });
    expect(ladder.map((l) => l.cumulative)).toEqual([10, 30, 35]);
  });

  it('buckets nearby prices together and labels the bucket with its best price', () => {
    // 2% of the 100 ISK best ask is a 2 ISK bucket, so 100 and 101 collapse.
    const ladder = groupOrdersIntoLadder(orders, { isBuy: false, groupPct: 2 });
    expect(ladder[0]).toMatchObject({ price: 100, volume: 30, orderCount: 2 });
    expect(ladder).toHaveLength(2);
  });

  it('returns an empty ladder for a side with no orders', () => {
    expect(groupOrdersIntoLadder([], { isBuy: true })).toEqual([]);
  });
});
