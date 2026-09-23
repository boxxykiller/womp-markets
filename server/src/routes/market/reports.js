// Report handlers. Each one backs a pop-out dialog on the Reports page and
// returns both the rows and whatever summary the dialog puts above them, so
// the client never has to re-derive a total from a truncated list.
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { classifyHistory, withTrailingMean } from '../../lib/marketMath.js';
import { resolveSource } from './index.js';
import { marketHandlers } from './index.js';

// Reports run against the full tracked list / book, not a page of it.
const FULL = 500;

async function browseAll(args) {
  return marketHandlers.getMarketBrowse.fn({ ...args, limit: FULL });
}

async function watchlistAll(args) {
  return marketHandlers.getMarketWatchlist.fn({ ...args });
}

// 1. Everything below its minimum, with what to buy to fix it.
async function reportRestock({ structureId } = {}) {
  const { rows, source } = await watchlistAll({ structureId });
  const needing = rows
    .filter((r) => r.status !== 'ok' && r.restockQuantity > 0)
    .sort((a, b) => b.restockQuantity - a.restockQuantity);

  const estimatedCost = needing.reduce(
    // Prefer the Jita ask as the restock cost basis: restocking usually means
    // buying at the hub and hauling, not buying from your own citadel.
    (sum, r) => sum + r.restockQuantity * (r.jitaBestSell ?? r.bestSell ?? 0),
    0,
  );

  return { source, rows: needing, summary: { items: needing.length, estimatedCost } };
}

// 2. What runs out first.
async function reportStockoutForecast({ structureId, withinDays = 30 } = {}) {
  const { rows, source } = await watchlistAll({ structureId });
  const limit = Number(withinDays) || 30;

  const forecast = rows
    .filter((r) => r.daysOfCover30 != null && Number.isFinite(r.daysOfCover30) && r.daysOfCover30 <= limit)
    .map((r) => ({
      ...r,
      // A concrete date is easier to plan around than "4.2 days".
      stockoutAt: new Date(Date.now() + r.daysOfCover30 * 86400000).toISOString(),
    }))
    .sort((a, b) => a.daysOfCover30 - b.daysOfCover30);

  return { source, rows: forecast, summary: { items: forecast.length, withinDays: limit } };
}

// 3. Where local pricing diverges most from Jita, both directions.
async function reportJitaSpread({ structureId, minAbsPct = 0.05 } = {}) {
  const { rows, source } = await browseAll({ structureId });
  const threshold = Number(minAbsPct) || 0;

  const priced = rows
    .filter((r) => r.vsJitaSellPct != null && Math.abs(r.vsJitaSellPct) >= threshold)
    .sort((a, b) => Math.abs(b.vsJitaSellPct) - Math.abs(a.vsJitaSellPct));

  return {
    source,
    rows: priced,
    summary: {
      items: priced.length,
      // Split rather than averaged: the two directions mean opposite things.
      above: priced.filter((r) => r.vsJitaSellPct > 0).length,
      below: priced.filter((r) => r.vsJitaSellPct < 0).length,
    },
  };
}

// 4. What actually moves.
async function reportVelocity({ structureId, days = 30 } = {}) {
  const source = await resolveSource(structureId);
  if (!source) return { source: null, rows: [], summary: {} };

  const windowDays = Math.min(Number(days) || 30, 365);
  const since = new Date(Date.now() - windowDays * 86400000);

  const grouped = await prisma.marketDailyStat.groupBy({
    by: ['typeId'],
    where: { structureId: source.structureId, date: { gte: since } },
    _sum: {
      unitsSoldConfirmed: true,
      unitsSoldEstimated: true,
      iskTradedConfirmed: true,
      iskTradedEstimated: true,
    },
  });

  const typeIds = grouped.map((g) => g.typeId);
  const { resolveItemNames } = await import('./index.js');
  const nameMap = await resolveItemNames(typeIds);

  const rows = grouped
    .map((g) => {
      const unitsConfirmed = g._sum.unitsSoldConfirmed || 0;
      const unitsEstimated = g._sum.unitsSoldEstimated || 0;
      const iskConfirmed = g._sum.iskTradedConfirmed || 0;
      const iskEstimated = g._sum.iskTradedEstimated || 0;
      return {
        typeId: g.typeId,
        itemName: nameMap.get(g.typeId)?.name ?? null,
        // Confirmed and estimated stay separate so the table can show how
        // much of a number is observed versus inferred.
        unitsConfirmed,
        unitsEstimated,
        units: unitsConfirmed + unitsEstimated,
        iskConfirmed,
        iskEstimated,
        isk: iskConfirmed + iskEstimated,
        unitsPerDay: (unitsConfirmed + unitsEstimated) / windowDays,
      };
    })
    .filter((r) => r.units > 0)
    .sort((a, b) => b.isk - a.isk);

  return {
    source: { id: source.id, structureId: source.structureId, name: source.name },
    rows,
    summary: {
      items: rows.length,
      totalIsk: rows.reduce((s, r) => s + r.isk, 0),
      totalUnits: rows.reduce((s, r) => s + r.units, 0),
      windowDays,
    },
  };
}

// 5. Stock that isn't selling, and the ISK sitting in it.
async function reportDeadStock({ structureId, days = 30 } = {}) {
  const { rows, source } = await browseAll({ structureId });
  const windowDays = Number(days) || 30;

  const dead = rows
    .filter((r) => r.sellVolume > 0 && (r.avgDaily30 == null || r.avgDaily30 === 0))
    .map((r) => ({ ...r, iskTiedUp: r.sellVolume * (r.bestSell ?? 0) }))
    .sort((a, b) => b.iskTiedUp - a.iskTiedUp);

  return {
    source,
    rows: dead,
    summary: { items: dead.length, iskTiedUp: dead.reduce((s, r) => s + r.iskTiedUp, 0), windowDays },
  };
}

// 6. Items with depth on one side only.
async function reportBuySellBalance({ structureId } = {}) {
  const { rows, source } = await browseAll({ structureId });

  const balanced = rows
    .filter((r) => r.sellVolume > 0 || r.buyVolume > 0)
    .map((r) => ({
      ...r,
      // Flagged because an item nobody is bidding on can't be liquidated at
      // any speed, however healthy its sell side looks.
      noBuySide: r.buyVolume === 0,
      noSellSide: r.sellVolume === 0,
    }))
    .sort((a, b) => (a.buySellSplit ?? 0) - (b.buySellSplit ?? 0));

  return {
    source,
    rows: balanced,
    summary: {
      items: balanced.length,
      noBuySide: balanced.filter((r) => r.noBuySide).length,
      noSellSide: balanced.filter((r) => r.noSellSide).length,
    },
  };
}

// 7. Is the data any good?
async function reportDataHealth({ structureId } = {}) {
  const source = await resolveSource(structureId);
  if (!source) return { source: null, rows: [], summary: {} };

  const [sources, sdeBuilds, oldestStat, statDays, eventCount, archiveCount] = await Promise.all([
    prisma.marketSource.findMany({ orderBy: { created_date: 'asc' } }),
    prisma.sdeMeta.findMany({ orderBy: { buildNumber: 'desc' }, take: 10 }),
    prisma.marketDailyStat.findFirst({ where: { structureId: source.structureId }, orderBy: { date: 'asc' } }),
    prisma.marketDailyStat.groupBy({ by: ['date'], where: { structureId: source.structureId }, _count: { _all: true } }),
    prisma.marketOrderEvent.count({ where: { structureId: source.structureId } }),
    prisma.marketOrderArchive.count({ where: { structureId: source.structureId } }),
  ]);

  return {
    source: { id: source.id, structureId: source.structureId, name: source.name },
    rows: sources.map((s) => ({
      id: s.id,
      structureId: s.structureId,
      name: s.name,
      enabled: s.enabled,
      lastPolledAt: s.lastPolledAt,
      nextPollAt: s.nextPollAt,
      lastPollStatus: s.lastPollStatus,
      lastPollError: s.lastPollError,
      pollIntervalMinutes: s.pollIntervalMinutes,
    })),
    sdeBuilds: sdeBuilds.map((b) => ({
      buildNumber: b.buildNumber,
      releaseDate: b.releaseDate,
      ingestedAt: b.ingestedAt,
      datasetCount: Object.keys(b.datasetCounts || {}).length,
    })),
    summary: {
      // Distinct days with data, not a span — a gap from downtime should show
      // up as missing coverage rather than being papered over.
      daysWithData: statDays.length,
      firstDataAt: oldestStat?.date ?? null,
      eventCount,
      archivedOrders: archiveCount,
    },
  };
}

// Every item in this source that is NOT on the tracked list: anything listed
// now, plus anything that sold in the last 30 days but has since sold out —
// the latter would otherwise vanish from a book-derived list exactly when it
// matters. Built directly rather than via browse, whose 500-row page cap would
// silently cut off part of the book.
async function untrackedRows(structureId) {
  const source = await resolveSource(structureId);
  if (!source) return { source: null, rows: [] };

  const sId = source.structureId;
  const since = new Date(Date.now() - 30 * 86400000);
  const { getDistinctListedTypeIds, aggregateBook, resolveItemNames, dailyLookupFor, buildRow } = await import('./index.js');

  const [listed, sold, watch] = await Promise.all([
    getDistinctListedTypeIds(sId),
    prisma.marketDailyStat.findMany({
      where: {
        structureId: sId,
        date: { gte: since },
        OR: [{ unitsSoldConfirmed: { gt: 0 } }, { unitsSoldEstimated: { gt: 0 } }],
      },
      select: { typeId: true },
      distinct: ['typeId'],
    }),
    prisma.marketWatchItem.findMany({ where: { structureId: sId }, select: { typeId: true } }),
  ]);

  const tracked = new Set(watch.map((w) => w.typeId));
  const typeIds = [...new Set([...listed, ...sold.map((s) => s.typeId)])].filter((id) => !tracked.has(id));

  const [bookMap, nameMap, refRows, dailyByType] = await Promise.all([
    aggregateBook(sId, typeIds),
    resolveItemNames(typeIds),
    typeIds.length ? prisma.referencePrice.findMany({ where: { typeId: { in: typeIds } } }) : [],
    dailyLookupFor(sId, typeIds),
  ]);
  const refMap = new Map(refRows.map((r) => [r.typeId, r]));

  const now = new Date();
  const rows = typeIds.map((typeId) =>
    buildRow(typeId, {
      book: bookMap.get(typeId),
      meta: nameMap.get(typeId),
      reference: refMap.get(typeId),
      dailyByType,
      watch: null,
      now,
    }),
  );

  return { source: { id: source.id, structureId: sId, name: source.name }, rows };
}

// Local price where there is one; Jita otherwise, since a sold-out item has
// no local ask left to value it at.
const unitValue = (r) => r.bestSell ?? r.jitaBestSell ?? 0;

// 8. Untracked items that sell — candidates for the tracked list.
async function reportUntrackedMovers({ structureId, minPerDay = 0 } = {}) {
  const { source, rows } = await untrackedRows(structureId);
  const floor = Number(minPerDay) || 0;

  const movers = rows
    .filter((r) => (r.avgDaily30 ?? 0) > 0 && r.avgDaily30 >= floor)
    .map((r) => ({ ...r, iskPerDay: r.avgDaily30 * unitValue(r) }))
    .sort((a, b) => b.iskPerDay - a.iskPerDay);

  return {
    source,
    rows: movers,
    summary: {
      items: movers.length,
      iskPerDay: movers.reduce((s, r) => s + r.iskPerDay, 0),
      soldOut: movers.filter((r) => r.sellVolume === 0).length,
    },
  };
}

// 9. Untracked items that sell and are about to run out (or already have),
// with a suggested quantity to bring them up to `targetDays` of cover. The
// suggestion goes in restockQuantity so the dialog's multibuy and cost
// columns treat it exactly like a tracked restock.
async function reportUntrackedLowStock({ structureId, targetDays = 14 } = {}) {
  const { source, rows } = await untrackedRows(structureId);
  const days = Number(targetDays) || 14;

  const low = rows
    .filter((r) => (r.avgDaily30 ?? 0) > 0 && r.daysOfCover30 != null && r.daysOfCover30 < days)
    .map((r) => ({
      ...r,
      restockQuantity: Math.max(0, Math.ceil(r.avgDaily30 * days - r.sellVolume)),
    }))
    .filter((r) => r.restockQuantity > 0)
    .sort((a, b) => a.daysOfCover30 - b.daysOfCover30 || b.avgDaily30 * unitValue(b) - a.avgDaily30 * unitValue(a));

  const estimatedCost = low.reduce((sum, r) => sum + r.restockQuantity * (r.jitaBestSell ?? r.bestSell ?? 0), 0);

  return {
    source,
    rows: low,
    summary: {
      items: low.length,
      estimatedCost,
      soldOut: low.filter((r) => r.sellVolume === 0).length,
      targetDays: days,
    },
  };
}

// ── History reports ─────────────────────────────────────────────────────
//
// Both read the daily rollup over a chosen period. Market data is never
// pruned, so "all" really does mean since the first poll.

const DAY_MS = 86400000;

function utcDayStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

// `days` of 0, "all" or anything unparseable means the whole history. The
// moving-average window is clamped to the period so it can't reach past it.
function historyWindow({ days, maDays }) {
  const today = utcDayStart();
  const periodDays = Number(days) > 0 ? Math.floor(Number(days)) : null;
  const since = periodDays ? new Date(today.getTime() - (periodDays - 1) * DAY_MS) : new Date(0);
  let ma = Math.max(1, Math.floor(Number(maDays)) || 7);
  if (periodDays) ma = Math.min(ma, periodDays);
  const recentSince = new Date(today.getTime() - (ma - 1) * DAY_MS);
  return { today, periodDays, since, maDays: ma, recentSince };
}

// Days the poller actually recorded anything for this source. Rates divide by
// these rather than by calendar days: a day the server was down says nothing
// about demand, but a polled day on which an item didn't appear really was a
// day it sold nothing.
async function coveredDays(structureId, since) {
  const rows = await prisma.$queryRaw`
    SELECT DISTINCT "date" FROM "MarketDailyStat"
    WHERE "structureId" = ${structureId} AND "date" >= ${since}
    ORDER BY "date"
  `;
  return rows.map((r) => new Date(r.date));
}

/**
 * Per-item volume and price over the period and over its trailing
 * moving-average window, plus the last sale ever recorded. Shared by the
 * market-wide seeding report and the single-item history.
 */
async function historyMetrics(structureId, typeIds, win, coverage) {
  const result = new Map();
  if (typeIds.length === 0) return result;

  const [agg, lastSales] = await Promise.all([
    prisma.$queryRaw`
      SELECT "typeId" AS type_id,
             SUM("unitsSoldConfirmed" + "unitsSoldEstimated")::float8 AS units,
             SUM("iskTradedConfirmed" + "iskTradedEstimated")::float8 AS isk,
             SUM(CASE WHEN "date" >= ${win.recentSince}
                      THEN "unitsSoldConfirmed" + "unitsSoldEstimated" ELSE 0 END)::float8 AS recent_units,
             AVG("lowSell")::float8 AS avg_low_sell,
             AVG(CASE WHEN "date" >= ${win.recentSince} THEN "lowSell" END)::float8 AS recent_low_sell,
             MIN("lowSell")::float8 AS min_low_sell,
             MAX("lowSell")::float8 AS max_low_sell,
             (COUNT(*) FILTER (WHERE "endSellVolume" > 0))::int AS days_listed
      FROM "MarketDailyStat"
      WHERE "structureId" = ${structureId} AND "date" >= ${win.since} AND "typeId" = ANY(${typeIds}::int[])
      GROUP BY "typeId"
    `,
    // All time, not just the period: "no sale in 30 days" and "never sold"
    // are different answers to whether something is stale.
    prisma.$queryRaw`
      SELECT "typeId" AS type_id, MAX("date") AS last_sale
      FROM "MarketDailyStat"
      WHERE "structureId" = ${structureId} AND "typeId" = ANY(${typeIds}::int[])
        AND "unitsSoldConfirmed" + "unitsSoldEstimated" > 0
      GROUP BY "typeId"
    `,
  ]);

  const aggMap = new Map(agg.map((r) => [Number(r.type_id), r]));
  const lastSaleMap = new Map(lastSales.map((r) => [Number(r.type_id), new Date(r.last_sale)]));
  const periodCovered = coverage.length;
  const recentCovered = coverage.filter((d) => d >= win.recentSince).length;

  for (const typeId of typeIds) {
    const a = aggMap.get(typeId);
    const lastSaleAt = lastSaleMap.get(typeId) ?? null;
    const periodUnits = a?.units ?? 0;
    const recentUnits = a?.recent_units ?? 0;
    const periodPerDay = periodCovered > 0 ? periodUnits / periodCovered : null;
    const maPerDay = recentCovered > 0 ? recentUnits / recentCovered : null;
    const avgPrice = a?.avg_low_sell ?? null;
    const maPrice = a?.recent_low_sell ?? null;
    const daysListed = a?.days_listed ?? 0;

    result.set(typeId, {
      periodUnits,
      periodIsk: a?.isk ?? 0,
      periodPerDay,
      maPerDay,
      // Recent pace against the whole period: +0.5 means selling 50% faster
      // lately than on average.
      volumeTrendPct: periodPerDay > 0 && maPerDay != null ? maPerDay / periodPerDay - 1 : null,
      avgPrice,
      maPrice,
      minPrice: a?.min_low_sell ?? null,
      maxPrice: a?.max_low_sell ?? null,
      priceTrendPct: avgPrice > 0 && maPrice != null ? maPrice / avgPrice - 1 : null,
      daysListed,
      daysOutOfStock: Math.max(0, periodCovered - daysListed),
      lastSaleAt,
      daysSinceSale: lastSaleAt ? Math.round((win.today - lastSaleAt) / DAY_MS) : null,
    });
  }
  return result;
}

/**
 * Jita (The Forge) volume and volume-weighted price over the same period and
 * moving-average window. ESI's history lags a day — today never has a row —
 * so both windows are shifted back one day and divided by calendar days: a
 * day missing from ESI's history is a day nothing traded.
 */
async function jitaMetrics(typeIds, win) {
  const result = new Map();
  if (typeIds.length === 0) return result;

  const since = new Date(win.since.getTime() - DAY_MS);
  const recentSince = new Date(win.recentSince.getTime() - DAY_MS);
  const rows = await prisma.$queryRaw`
    SELECT "typeId" AS type_id,
           SUM("volume")::float8 AS volume,
           SUM(CASE WHEN "date" >= ${recentSince} THEN "volume" ELSE 0 END)::float8 AS recent_volume,
           (SUM("average" * "volume") / NULLIF(SUM("volume"), 0))::float8 AS vwap,
           (SUM(CASE WHEN "date" >= ${recentSince} THEN "average" * "volume" END)
             / NULLIF(SUM(CASE WHEN "date" >= ${recentSince} THEN "volume" END), 0))::float8 AS recent_vwap,
           MIN("date") AS first_date
    FROM "ReferenceDailyStat"
    WHERE "typeId" = ANY(${typeIds}::int[]) AND "date" >= ${since} AND "date" < ${win.today}
    GROUP BY "typeId"
  `;

  for (const r of rows) {
    const periodDays =
      win.periodDays ?? Math.max(1, Math.round((win.today - new Date(r.first_date)) / DAY_MS));
    const avgPrice = r.vwap ?? null;
    const maPrice = r.recent_vwap ?? null;
    result.set(Number(r.type_id), {
      jitaPerDay: (r.volume ?? 0) / periodDays,
      jitaMaPerDay: (r.recent_volume ?? 0) / win.maDays,
      jitaAvgPrice: avgPrice,
      jitaMaPrice: maPrice,
      jitaPriceTrendPct: avgPrice > 0 && maPrice != null ? maPrice / avgPrice - 1 : null,
    });
  }
  return result;
}

const EMPTY_JITA = { jitaPerDay: null, jitaMaPerDay: null, jitaAvgPrice: null, jitaMaPrice: null, jitaPriceTrendPct: null };

// The moving average is the rate to plan on; the period average backs it up
// when the window is too short to have caught a sale.
const planningRate = (m) => (m.maPerDay > 0 ? m.maPerDay : (m.periodPerDay ?? 0));

// 10. What to seed and what has gone stale, from the stored history.
async function reportSeedingHistory({
  structureId,
  days = 30,
  maDays = 7,
  targetDays = 14,
  staleDays = 14,
  verdict,
} = {}) {
  const source = await resolveSource(structureId);
  if (!source) return { source: null, rows: [], summary: {} };

  const sId = source.structureId;
  const win = historyWindow({ days, maDays });
  const target = Number(targetDays) || 14;
  const stale = Number(staleDays) || 14;
  const { getDistinctListedTypeIds, aggregateBook, resolveItemNames, dailyLookupFor, buildRow } = await import('./index.js');

  const [coverage, listed, sold, watch] = await Promise.all([
    coveredDays(sId, win.since),
    getDistinctListedTypeIds(sId),
    prisma.marketDailyStat.findMany({
      where: {
        structureId: sId,
        date: { gte: win.since },
        OR: [{ unitsSoldConfirmed: { gt: 0 } }, { unitsSoldEstimated: { gt: 0 } }],
      },
      select: { typeId: true },
      distinct: ['typeId'],
    }),
    prisma.marketWatchItem.findMany({ where: { structureId: sId } }),
  ]);

  // Anything on the book now, anything that sold in the period (so sold-out
  // items stay visible — they are the seeding candidates), and every tracked
  // item.
  const watchByType = new Map(watch.map((w) => [w.typeId, w]));
  const typeIds = [...new Set([...listed, ...sold.map((r) => r.typeId), ...watchByType.keys()])];

  const [metrics, jitaMap, bookMap, nameMap, refRows, dailyByType] = await Promise.all([
    historyMetrics(sId, typeIds, win, coverage),
    jitaMetrics(typeIds, win),
    aggregateBook(sId, typeIds),
    resolveItemNames(typeIds),
    typeIds.length ? prisma.referencePrice.findMany({ where: { typeId: { in: typeIds } } }) : [],
    dailyLookupFor(sId, typeIds),
  ]);
  const refMap = new Map(refRows.map((r) => [r.typeId, r]));

  const now = new Date();
  let rows = typeIds.map((typeId) => {
    const base = buildRow(typeId, {
      book: bookMap.get(typeId),
      meta: nameMap.get(typeId),
      reference: refMap.get(typeId),
      dailyByType,
      watch: watchByType.get(typeId),
      now,
    });
    const m = metrics.get(typeId);
    const rate = planningRate(m);
    const v = classifyHistory({
      ratePerDay: rate,
      sellVolume: base.sellVolume,
      daysSinceSale: m.daysSinceSale,
      targetDays: target,
      staleDays: stale,
    });
    return {
      ...base,
      ...m,
      ...(jitaMap.get(typeId) ?? EMPTY_JITA),
      verdict: v,
      historyCover: rate > 0 ? base.sellVolume / rate : null,
      // In restockQuantity so the dialog's multibuy and cost columns treat a
      // seeding suggestion exactly like a tracked restock.
      restockQuantity: v === 'seed' ? Math.max(0, Math.ceil(rate * target - base.sellVolume)) : 0,
      iskTiedUp: v === 'stale' ? base.sellVolume * (base.bestSell ?? 0) : 0,
    };
  });

  const counts = { seed: 0, stale: 0, ok: 0, idle: 0 };
  for (const r of rows) counts[r.verdict] += 1;

  // Idle rows (nothing listed, nothing sold) are noise unless asked for.
  rows = verdict && verdict !== 'all' ? rows.filter((r) => r.verdict === verdict) : rows.filter((r) => r.verdict !== 'idle');

  const ORDER = { seed: 0, stale: 1, ok: 2, idle: 3 };
  rows.sort(
    (a, b) =>
      ORDER[a.verdict] - ORDER[b.verdict] ||
      (a.verdict === 'stale' ? b.iskTiedUp - a.iskTiedUp : b.periodIsk - a.periodIsk),
  );

  return {
    source: { id: source.id, structureId: sId, name: source.name },
    rows,
    summary: {
      items: rows.length,
      counts,
      estimatedCost: rows.reduce((s, r) => s + r.restockQuantity * (r.jitaBestSell ?? r.bestSell ?? 0), 0),
      iskTiedUp: rows.reduce((s, r) => s + r.iskTiedUp, 0),
      coveredDays: coverage.length,
      firstDataAt: coverage[0] ?? null,
      periodDays: win.periodDays,
      maDays: win.maDays,
    },
  };
}

// 11. One item's daily history with moving averages over a chosen period.
async function reportItemHistory({ structureId, typeId, days = 90, maDays = 7, targetDays = 14, staleDays = 14 } = {}) {
  if (!typeId) throw new HttpError(400, 'typeId required');
  const source = await resolveSource(structureId);
  if (!source) return { source: null, rows: [], summary: {} };

  const sId = source.structureId;
  const id = Number(typeId);
  const win = historyWindow({ days, maDays });
  const { aggregateBook, resolveItemNames, dailyLookupFor, buildRow } = await import('./index.js');

  const coverage = await coveredDays(sId, win.since);
  const [stats, metrics, jitaMap, jitaHistory, bookMap, nameMap, reference, dailyByType, watch] = await Promise.all([
    prisma.marketDailyStat.findMany({
      where: { structureId: sId, typeId: id, date: { gte: win.since } },
      orderBy: { date: 'asc' },
    }),
    historyMetrics(sId, [id], win, coverage),
    jitaMetrics([id], win),
    prisma.referenceDailyStat.findMany({
      where: { typeId: id, date: { gte: new Date(win.since.getTime() - DAY_MS) } },
      orderBy: { date: 'asc' },
    }),
    aggregateBook(sId, [id]),
    resolveItemNames([id]),
    prisma.referencePrice.findUnique({ where: { typeId: id } }),
    dailyLookupFor(sId, [id]),
    prisma.marketWatchItem.findUnique({ where: { structureId_typeId: { structureId: sId, typeId: id } } }),
  ]);

  const item = buildRow(id, {
    book: bookMap.get(id),
    meta: nameMap.get(id),
    reference,
    dailyByType,
    watch,
    now: new Date(),
  });

  // One point per polled day. A polled day with no row for this item means it
  // was neither listed nor sold that day, which is a real zero — not a gap.
  const byDate = new Map(stats.map((d) => [new Date(d.date).toISOString().slice(0, 10), d]));
  let rows = coverage.map((day) => {
    const date = day.toISOString().slice(0, 10);
    const d = byDate.get(date);
    const unitsConfirmed = d?.unitsSoldConfirmed ?? 0;
    const unitsEstimated = d?.unitsSoldEstimated ?? 0;
    return {
      date,
      units: unitsConfirmed + unitsEstimated,
      unitsConfirmed,
      unitsEstimated,
      isk: (d?.iskTradedConfirmed ?? 0) + (d?.iskTradedEstimated ?? 0),
      lowSell: d?.lowSell ?? null,
      highBuy: d?.highBuy ?? null,
      sellVolume: d?.endSellVolume ?? 0,
      buyVolume: d?.endBuyVolume ?? 0,
      sellOrderCount: d?.sellOrderCount ?? 0,
    };
  });
  rows = withTrailingMean(rows, win.maDays, 'units');
  rows = withTrailingMean(rows, win.maDays, 'lowSell');
  rows = withTrailingMean(rows, win.maDays, 'highBuy');
  rows = withTrailingMean(rows, win.maDays, 'sellVolume');

  // Jita's own series, one point per calendar day: ESI omits days on which
  // nothing traded, and those are real zeros for volume (and gaps for price).
  const jitaByDate = new Map(jitaHistory.map((h) => [new Date(h.date).toISOString().slice(0, 10), h]));
  let jitaRows = [];
  if (jitaHistory.length) {
    const last = new Date(jitaHistory[jitaHistory.length - 1].date);
    for (let t = new Date(jitaHistory[0].date).getTime(); t <= last.getTime(); t += DAY_MS) {
      const date = new Date(t).toISOString().slice(0, 10);
      const h = jitaByDate.get(date);
      jitaRows.push({
        date,
        volume: h?.volume ?? 0,
        average: h?.average ?? null,
        highest: h?.highest ?? null,
        lowest: h?.lowest ?? null,
        orderCount: h?.orderCount ?? 0,
      });
    }
    jitaRows = withTrailingMean(jitaRows, win.maDays, 'volume');
    jitaRows = withTrailingMean(jitaRows, win.maDays, 'average');
  }

  const m = metrics.get(id);

  return {
    source: { id: source.id, structureId: sId, name: source.name },
    item,
    rows,
    jitaRows,
    summary: {
      ...m,
      ...(jitaMap.get(id) ?? EMPTY_JITA),
      verdict: classifyHistory({
        ratePerDay: planningRate(m),
        sellVolume: item.sellVolume,
        daysSinceSale: m.daysSinceSale,
        targetDays: Number(targetDays) || 14,
        staleDays: Number(staleDays) || 14,
      }),
      coveredDays: coverage.length,
      firstDataAt: coverage[0] ?? null,
      periodDays: win.periodDays,
      maDays: win.maDays,
    },
  };
}

export const reportHandlers = {
  reportRestock: { fn: reportRestock, auth: 'auth' },
  reportStockoutForecast: { fn: reportStockoutForecast, auth: 'auth' },
  reportJitaSpread: { fn: reportJitaSpread, auth: 'auth' },
  reportVelocity: { fn: reportVelocity, auth: 'auth' },
  reportDeadStock: { fn: reportDeadStock, auth: 'auth' },
  reportBuySellBalance: { fn: reportBuySellBalance, auth: 'auth' },
  reportDataHealth: { fn: reportDataHealth, auth: 'auth' },
  reportUntrackedMovers: { fn: reportUntrackedMovers, auth: 'auth' },
  reportUntrackedLowStock: { fn: reportUntrackedLowStock, auth: 'auth' },
  reportSeedingHistory: { fn: reportSeedingHistory, auth: 'auth' },
  reportItemHistory: { fn: reportItemHistory, auth: 'auth' },
};
