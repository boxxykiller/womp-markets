import { describe, expect, it } from 'vitest';
import { latestEsiRefresh, parseHistory } from '../../server/src/lib/jitaHistoryPoller.js';

describe('latestEsiRefresh', () => {
  it('is today at 11:30 UTC once that has passed', () => {
    expect(latestEsiRefresh(new Date('2026-09-23T15:00:00Z')).toISOString()).toBe('2026-09-23T11:30:00.000Z');
  });

  it('is yesterday at 11:30 UTC before then', () => {
    expect(latestEsiRefresh(new Date('2026-09-23T09:00:00Z')).toISOString()).toBe('2026-09-22T11:30:00.000Z');
  });
});

describe('parseHistory', () => {
  const entries = [
    { date: '2026-09-20', average: 5.1, highest: 5.5, lowest: 4.9, volume: 1000, order_count: 12 },
    { date: '2026-09-21', average: 5.2, highest: 5.6, lowest: 5.0, volume: 2000, order_count: 15 },
    { date: '2026-09-22', average: 5.3, highest: 5.7, lowest: 5.1, volume: 3000, order_count: 18 },
  ];

  it('maps ESI entries onto UTC-midnight rows', () => {
    const rows = parseHistory(34, entries);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ typeId: 34, average: 5.1, volume: 1000, orderCount: 12 });
    expect(rows[0].date.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });

  it('keeps only days after the last one already stored', () => {
    const rows = parseHistory(34, entries, new Date('2026-09-21T00:00:00Z'));
    expect(rows.map((r) => r.date.toISOString().slice(0, 10))).toEqual(['2026-09-22']);
  });

  it('skips malformed entries and tolerates an empty answer', () => {
    expect(parseHistory(34, [{ date: 'nope' }, {}, null])).toEqual([]);
    expect(parseHistory(34, null)).toEqual([]);
  });
});
