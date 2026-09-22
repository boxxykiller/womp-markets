// Report handlers. Each one backs a pop-out dialog on the Reports page and
// returns both the rows and whatever summary the dialog puts above them, so
// the client never has to re-derive a total from a truncated list.
import { prisma } from '../../db/prisma.js';
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
      retentionDays: s.retentionDays,
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
};
