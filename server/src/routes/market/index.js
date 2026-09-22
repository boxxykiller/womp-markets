// The market read API: browse the citadel's book, inspect one item, and
// manage the global tracked list.
//
// Item names and market groups are resolved by joining against SdeRecord at
// read time rather than being copied onto market rows. That costs one extra
// query per request and means an SDE update is reflected immediately with no
// backfill — the alternative is a denormalized name column that silently goes
// stale every time CCP renames something.
import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../middleware/errorHandler.js';
import { pollSource } from '../../lib/marketPoller.js';
import { cacheWrap } from '../../lib/cache.js';
import { esiFetch, mapWithConcurrency } from '../../lib/esiClient.js';
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
} from '../../lib/marketMath.js';

const DEFAULT_BROWSE_LIMIT = 100;
const MAX_BROWSE_LIMIT = 500;

// Long enough to cover the 30-day window plus a little slack for items whose
// data is sparse at the edges.
const DAILY_WINDOW_DAYS = 35;

export async function resolveSource(structureId) {
  if (structureId) {
    const byStructure = await prisma.marketSource.findUnique({ where: { structureId } });
    if (byStructure) return byStructure;
  }
  // Falls back to the primary source, then to whatever exists, so the
  // frontend doesn't have to know an id before its first request.
  return (
    (await prisma.marketSource.findFirst({ where: { isPrimary: true, enabled: true } })) ||
    (await prisma.marketSource.findFirst({ where: { enabled: true }, orderBy: { created_date: 'asc' } }))
  );
}

async function resolveItemNames(typeIds) {
  if (typeIds.length === 0) return new Map();
  const keys = typeIds.map(String);
  const rows = await prisma.$queryRaw`
    SELECT "key", "data"->'name'->>'en' AS name, "data"->>'groupID' AS group_id,
           "data"->>'marketGroupID' AS market_group_id, "data"->>'volume' AS volume
    FROM "SdeRecord"
    WHERE "dataset" = 'types' AND "key" = ANY(${keys}::text[])
  `;
  return new Map(
    rows.map((r) => [
      Number(r.key),
      {
        name: r.name,
        groupId: r.group_id != null ? Number(r.group_id) : null,
        marketGroupId: r.market_group_id != null ? Number(r.market_group_id) : null,
        volume: r.volume != null ? Number(r.volume) : null,
      },
    ]),
  );
}

// Narrows a candidate type list by name search and/or market group. Done
// against SdeRecord so filtering works across the whole book, not just the
// page the client happens to be holding.
async function filterTypeIds(typeIds, { search, marketGroupId }) {
  if (typeIds.length === 0) return [];
  if (!search && !marketGroupId) return typeIds;

  const keys = typeIds.map(String);
  const term = search ? `%${String(search).trim()}%` : null;

  const rows = await prisma.$queryRaw`
    SELECT "key" FROM "SdeRecord"
    WHERE "dataset" = 'types'
      AND "key" = ANY(${keys}::text[])
      AND (${term}::text IS NULL OR ("data"->'name'->>'en') ILIKE ${term})
      AND (${marketGroupId ?? null}::int IS NULL OR ("data"->>'marketGroupID')::int = ${marketGroupId ?? null}::int)
  `;
  return rows.map((r) => Number(r.key));
}

async function getDistinctListedTypeIds(structureId) {
  const rows = await prisma.marketOrder.findMany({
    where: { structureId },
    select: { typeId: true },
    distinct: ['typeId'],
  });
  return rows.map((r) => r.typeId);
}

// Aggregates the CURRENT book (not history) into per-type depth and best
// prices. groupBy is used rather than loading orders because the book runs to
// tens of thousands of rows and only six numbers per type are needed.
async function aggregateBook(structureId, typeIds) {
  const result = new Map();
  if (typeIds.length === 0) return result;

  const grouped = await prisma.marketOrder.groupBy({
    by: ['typeId', 'isBuyOrder'],
    where: { structureId, typeId: { in: typeIds } },
    _sum: { volumeRemain: true },
    _min: { price: true },
    _max: { price: true },
    _count: { _all: true },
  });

  for (const row of grouped) {
    const entry =
      result.get(row.typeId) ||
      { sellVolume: 0, buyVolume: 0, bestSell: null, bestBuy: null, sellOrderCount: 0, buyOrderCount: 0 };

    if (row.isBuyOrder) {
      entry.buyVolume = row._sum.volumeRemain || 0;
      // Best buy is the highest someone will pay; best sell the lowest asked.
      entry.bestBuy = row._max.price;
      entry.buyOrderCount = row._count._all;
    } else {
      entry.sellVolume = row._sum.volumeRemain || 0;
      entry.bestSell = row._min.price;
      entry.sellOrderCount = row._count._all;
    }
    result.set(row.typeId, entry);
  }
  return result;
}

async function referencePriceMap(typeIds) {
  if (typeIds.length === 0) return new Map();
  const rows = await prisma.referencePrice.findMany({ where: { typeId: { in: typeIds } } });
  return new Map(rows.map((r) => [r.typeId, r]));
}

async function dailyLookupFor(structureId, typeIds) {
  if (typeIds.length === 0) return new Map();
  const rows = await prisma.marketDailyStat.findMany({
    where: {
      structureId,
      typeId: { in: typeIds },
      date: { gte: new Date(Date.now() - DAILY_WINDOW_DAYS * 86400000) },
    },
    select: { typeId: true, date: true, unitsSoldConfirmed: true, unitsSoldEstimated: true },
  });
  return buildDailyLookup(rows);
}

const EMPTY_BOOK = { sellVolume: 0, buyVolume: 0, bestSell: null, bestBuy: null, sellOrderCount: 0, buyOrderCount: 0 };

/**
 * Builds the row shape used by Browse, Tracked and the reports — one object
 * per item carrying local depth, the three sales rates, days of cover, the
 * buy/sell split and the Jita comparison. Every surface reads the same shape
 * so a number means the same thing wherever it appears.
 */
function buildRow(typeId, { book, meta, reference, dailyByType, watch, now }) {
  const b = book || EMPTY_BOOK;

  const avgDaily1 = avgDailyVolume(dailyByType, typeId, 1, now);
  const avgDaily7 = avgDailyVolume(dailyByType, typeId, 7, now);
  const avgDaily30 = avgDailyVolume(dailyByType, typeId, 30, now);

  const effectiveMin = watch ? effectiveMinimum(watch, avgDaily30) : 0;
  const targetQuantity = watch ? (watch.targetQuantity ?? effectiveMin) : null;

  return {
    typeId,
    itemName: meta?.name ?? watch?.itemName ?? null,
    marketGroupId: meta?.marketGroupId ?? null,
    volumePerUnit: meta?.volume ?? null,

    // Local book
    bestSell: b.bestSell,
    bestBuy: b.bestBuy,
    sellVolume: b.sellVolume,
    buyVolume: b.buyVolume,
    sellOrderCount: b.sellOrderCount,
    buyOrderCount: b.buyOrderCount,
    buySellSplit: buySellSplit(b.buyVolume, b.sellVolume),
    localSpreadPct: spreadPct(b.bestBuy, b.bestSell),

    // Velocity — daily / weekly / monthly rates and how long stock lasts.
    avgDaily1,
    avgDaily7,
    avgDaily30,
    daysOfCover7: daysOfCover(b.sellVolume, avgDaily7),
    daysOfCover30: daysOfCover(b.sellVolume, avgDaily30),

    // Jita 4-4 comparison
    jitaBestSell: reference?.bestSell ?? null,
    jitaBestBuy: reference?.bestBuy ?? null,
    jitaSource: reference?.source ?? null,
    jitaFetchedAt: reference?.fetchedAt ?? null,
    vsJitaSellPct: vsReferencePct(b.bestSell, reference?.bestSell),
    vsJitaBuyPct: vsReferencePct(b.bestBuy, reference?.bestBuy),

    // Watchlist, null for untracked items
    watchId: watch?.id ?? null,
    tracked: !!watch,
    minQuantity: watch?.minQuantity ?? null,
    minDaysCover: watch?.minDaysCover ?? null,
    targetQuantity,
    critical: watch?.critical ?? false,
    notes: watch?.notes ?? null,
    effectiveMin: watch ? effectiveMin : null,
    restockQuantity: watch ? restockQuantity(b.sellVolume, targetQuantity) : null,
    status: watch ? watchStatus(b.sellVolume, effectiveMin) : null,
  };
}

// Sorts that can't be pushed into SQL (they're computed from several sources)
// are applied here, after the rows are built.
const SORTERS = {
  name: (a, b) => String(a.itemName || '').localeCompare(String(b.itemName || '')),
  sellVolume: (a, b) => b.sellVolume - a.sellVolume,
  buyVolume: (a, b) => b.buyVolume - a.buyVolume,
  bestSell: (a, b) => (a.bestSell ?? Infinity) - (b.bestSell ?? Infinity),
  bestBuy: (a, b) => (b.bestBuy ?? -Infinity) - (a.bestBuy ?? -Infinity),
  volume: (a, b) => (b.avgDaily30 ?? -1) - (a.avgDaily30 ?? -1),
  // Nulls (no data) sort last rather than first, so "soonest to run out"
  // doesn't open with a screen of unknowns.
  daysOfCover: (a, b) => (a.daysOfCover30 ?? Infinity) - (b.daysOfCover30 ?? Infinity),
  spread: (a, b) => (b.vsJitaSellPct ?? -Infinity) - (a.vsJitaSellPct ?? -Infinity),
  status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
};

const STATUS_ORDER = ['out', 'critical', 'low', 'ok', null];

function applySort(rows, sort) {
  const key = String(sort || 'name').replace(/^-/, '');
  const desc = String(sort || '').startsWith('-');
  const sorter = SORTERS[key] || SORTERS.name;
  const sorted = [...rows].sort(sorter);
  return desc ? sorted.reverse() : sorted;
}

// ── Handlers ────────────────────────────────────────────────────────────

async function getMarketOverview({ structureId } = {}) {
  const source = await resolveSource(structureId);
  if (!source) return { source: null, sources: [] };

  const sources = await prisma.marketSource.findMany({ orderBy: [{ isPrimary: 'desc' }, { created_date: 'asc' }] });
  const [listedTypes, watchCount, orderCount, bookRows] = await Promise.all([
    prisma.marketOrder.findMany({ where: { structureId: source.structureId }, select: { typeId: true }, distinct: ['typeId'] }),
    prisma.marketWatchItem.count({ where: { structureId: source.structureId } }),
    prisma.marketOrder.count({ where: { structureId: source.structureId } }),
    // Whole-book totals in one grouped query: order count, units and ISK
    // value (price x remaining volume) per side.
    prisma.$queryRaw`
      SELECT "isBuyOrder" AS is_buy,
             COUNT(*)::int AS orders,
             COALESCE(SUM("volumeRemain"), 0)::float8 AS units,
             COALESCE(SUM("volumeRemain" * "price"), 0)::float8 AS isk
      FROM "MarketOrder"
      WHERE "structureId" = ${source.structureId}
      GROUP BY "isBuyOrder"
    `,
  ]);
  const side = (isBuy) => {
    const r = bookRows.find((x) => x.is_buy === isBuy);
    return { orders: r?.orders ?? 0, units: r?.units ?? 0, isk: r?.isk ?? 0 };
  };

  const oldestStat = await prisma.marketDailyStat.findFirst({
    where: { structureId: source.structureId },
    orderBy: { date: 'asc' },
    select: { date: true },
  });

  return {
    source: {
      id: source.id,
      structureId: source.structureId,
      name: source.name,
      systemName: source.systemName,
      regionName: source.regionName,
      lastPolledAt: source.lastPolledAt,
      nextPollAt: source.nextPollAt,
      lastPollStatus: source.lastPollStatus,
      lastPollError: source.lastPollError,
      pollIntervalMinutes: source.pollIntervalMinutes,
      retentionDays: source.retentionDays,
    },
    sources: sources.map((s) => ({ id: s.id, structureId: s.structureId, name: s.name, isPrimary: s.isPrimary })),
    distinctItems: listedTypes.length,
    orderCount,
    book: { sell: side(false), buy: side(true) },
    trackedCount: watchCount,
    // How much history actually exists, so the UI can caveat young numbers
    // rather than presenting a three-day average as a monthly one.
    dataCoverageDays: oldestStat ? Math.ceil((Date.now() - new Date(oldestStat.date)) / 86400000) : 0,
  };
}

async function getMarketBrowse({ structureId, search, marketGroupId, sort, limit, skip, trackedOnly } = {}) {
  const source = await resolveSource(structureId);
  if (!source) return { rows: [], total: 0, source: null };

  const sId = source.structureId;
  const take = Math.min(Number(limit) || DEFAULT_BROWSE_LIMIT, MAX_BROWSE_LIMIT);
  const offset = Number(skip) || 0;

  const watchItems = await prisma.marketWatchItem.findMany({ where: { structureId: sId } });
  const watchByType = new Map(watchItems.map((w) => [w.typeId, w]));

  let candidates = trackedOnly ? watchItems.map((w) => w.typeId) : await getDistinctListedTypeIds(sId);
  // A tracked item that has sold out has no orders left, so it would vanish
  // from a listing-derived candidate set — exactly when it most needs to be
  // visible. Union it back in.
  if (!trackedOnly) candidates = [...new Set([...candidates, ...watchItems.map((w) => w.typeId)])];

  const filtered = await filterTypeIds(candidates, { search, marketGroupId: marketGroupId ? Number(marketGroupId) : null });
  if (filtered.length === 0) return { rows: [], total: 0, source: { id: source.id, structureId: sId, name: source.name } };

  const [bookMap, nameMap, refMap, dailyByType] = await Promise.all([
    aggregateBook(sId, filtered),
    resolveItemNames(filtered),
    referencePriceMap(filtered),
    dailyLookupFor(sId, filtered),
  ]);

  const now = new Date();
  let rows = filtered.map((typeId) =>
    buildRow(typeId, {
      book: bookMap.get(typeId),
      meta: nameMap.get(typeId),
      reference: refMap.get(typeId),
      dailyByType,
      watch: watchByType.get(typeId),
      now,
    }),
  );

  rows = applySort(rows, sort);
  return {
    rows: rows.slice(offset, offset + take),
    total: rows.length,
    source: { id: source.id, structureId: sId, name: source.name },
  };
}

// Market groups present in this citadel's book, for the category filter.
// Derived from what's actually listed rather than the full SDE tree, so the
// dropdown only offers categories that will return something.
async function getMarketCategories({ structureId } = {}) {
  const source = await resolveSource(structureId);
  if (!source) return { categories: [] };

  const typeIds = await getDistinctListedTypeIds(source.structureId);
  if (typeIds.length === 0) return { categories: [] };

  const rows = await prisma.$queryRaw`
    SELECT mg."key" AS id, mg."data"->'name'->>'en' AS name, count(*)::int AS item_count
    FROM "SdeRecord" t
    JOIN "SdeRecord" mg ON mg."dataset" = 'marketGroups' AND mg."key" = (t."data"->>'marketGroupID')
    WHERE t."dataset" = 'types' AND t."key" = ANY(${typeIds.map(String)}::text[])
    GROUP BY mg."key", name
    ORDER BY name
  `;
  return { categories: rows.map((r) => ({ id: Number(r.id), name: r.name, itemCount: r.item_count })) };
}

async function getMarketItem({ structureId, typeId, days = 90 } = {}) {
  if (!typeId) throw new HttpError(400, 'typeId required');
  const source = await resolveSource(structureId);
  if (!source) throw new HttpError(404, 'No market source configured');

  const sId = source.structureId;
  const id = Number(typeId);
  const windowDays = Math.min(Number(days) || 90, 365);
  const since = new Date(Date.now() - windowDays * 86400000);

  const [orders, dailyStats, events, watch, reference, nameMap, jitaHistory, snapshots] = await Promise.all([
    prisma.marketOrder.findMany({ where: { structureId: sId, typeId: id } }),
    prisma.marketDailyStat.findMany({ where: { structureId: sId, typeId: id, date: { gte: since } }, orderBy: { date: 'asc' } }),
    prisma.marketOrderEvent.findMany({
      where: { structureId: sId, typeId: id },
      orderBy: { occurredAt: 'desc' },
      take: 300,
    }),
    prisma.marketWatchItem.findUnique({ where: { structureId_typeId: { structureId: sId, typeId: id } } }),
    prisma.referencePrice.findUnique({ where: { typeId: id } }),
    resolveItemNames([id]),
    prisma.referenceDailyStat.findMany({ where: { typeId: id, date: { gte: since } }, orderBy: { date: 'asc' } }),
    prisma.marketSnapshot.findMany({
      where: { structureId: sId, typeId: id, takenAt: { gte: since } },
      orderBy: { takenAt: 'asc' },
    }),
  ]);

  const dailyByType = buildDailyLookup(dailyStats);
  const book = (await aggregateBook(sId, [id])).get(id);
  const row = buildRow(id, { book, meta: nameMap.get(id), reference, dailyByType, watch, now: new Date() });

  // The charted series: raw daily values plus 7- and 30-day trailing averages.
  let series = dailyStats.map((d) => ({
    date: new Date(d.date).toISOString().slice(0, 10),
    units: (d.unitsSoldConfirmed || 0) + (d.unitsSoldEstimated || 0),
    unitsConfirmed: d.unitsSoldConfirmed || 0,
    unitsEstimated: d.unitsSoldEstimated || 0,
    isk: (d.iskTradedConfirmed || 0) + (d.iskTradedEstimated || 0),
    lowSell: d.lowSell,
    highBuy: d.highBuy,
    sellVolume: d.endSellVolume,
    buyVolume: d.endBuyVolume,
  }));
  series = withMovingAverage(series, 7, 'units');
  series = withMovingAverage(series, 30, 'units');

  return {
    item: row,
    source: { id: source.id, structureId: sId, name: source.name },
    orders: orders.map((o) => ({
      orderId: o.orderId,
      isBuyOrder: o.isBuyOrder,
      price: o.price,
      volumeRemain: o.volumeRemain,
      volumeTotal: o.volumeTotal,
      issued: o.issued,
      duration: o.duration,
    })),
    sellLadder: groupOrdersIntoLadder(orders, { isBuy: false }),
    buyLadder: groupOrdersIntoLadder(orders, { isBuy: true }),
    series,
    jitaSeries: jitaHistory.map((h) => ({
      date: new Date(h.date).toISOString().slice(0, 10),
      average: h.average,
      highest: h.highest,
      lowest: h.lowest,
      volume: h.volume,
    })),
    stockSeries: snapshots.map((s) => ({
      takenAt: s.takenAt,
      sellVolume: s.sellVolume,
      buyVolume: s.buyVolume,
      bestSell: s.bestSell,
      bestBuy: s.bestBuy,
    })),
    events,
    dataCoverageDays: dailyStats.length,
  };
}

async function getMarketFeed({ structureId, limit = 100, eventType } = {}) {
  const source = await resolveSource(structureId);
  if (!source) return { events: [] };

  const events = await prisma.marketOrderEvent.findMany({
    where: {
      structureId: source.structureId,
      ...(eventType ? { eventType } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    take: Math.min(Number(limit) || 100, 500),
  });

  const nameMap = await resolveItemNames([...new Set(events.map((e) => e.typeId))]);
  return {
    events: events.map((e) => ({ ...e, itemName: nameMap.get(e.typeId)?.name ?? null })),
  };
}

async function getMarketWatchlist({ structureId, search, status, marketGroupId, sort } = {}) {
  const result = await getMarketBrowse({ structureId, search, marketGroupId, sort: sort || 'status', trackedOnly: true, limit: MAX_BROWSE_LIMIT });

  const statuses = Array.isArray(status) ? status : status ? [status] : [];
  const rows = statuses.length > 0 ? result.rows.filter((r) => statuses.includes(r.status)) : result.rows;

  // Counts are of the whole list, not the filtered view — the summary tiles
  // should not change when someone narrows the table.
  const counts = { out: 0, critical: 0, low: 0, ok: 0 };
  for (const r of result.rows) if (r.status in counts) counts[r.status] += 1;

  return { rows, total: rows.length, counts, source: result.source };
}

async function upsertMarketWatchItem(body = {}, req) {
  const { id, structureId, typeId, itemName, minQuantity, minDaysCover, targetQuantity, critical, notes } = body;
  if (!typeId) throw new HttpError(400, 'typeId required');

  const source = await resolveSource(structureId);
  if (!source) throw new HttpError(404, 'No market source configured');

  const data = {
    structureId: source.structureId,
    typeId: Number(typeId),
    itemName: itemName || null,
    minQuantity: Number(minQuantity) || 0,
    minDaysCover: Number(minDaysCover) || 0,
    targetQuantity: targetQuantity != null && targetQuantity !== '' ? Number(targetQuantity) : null,
    critical: !!critical,
    notes: notes || null,
    created_by: req?.user?.characterName ?? null,
  };

  const item = id
    ? await prisma.marketWatchItem.update({ where: { id }, data })
    : await prisma.marketWatchItem.upsert({
        where: { structureId_typeId: { structureId: source.structureId, typeId: Number(typeId) } },
        create: data,
        update: data,
      });

  return { item };
}

async function deleteMarketWatchItem({ id, ids } = {}) {
  const targets = Array.isArray(ids) && ids.length ? ids : id ? [id] : [];
  if (targets.length === 0) throw new HttpError(400, 'id or ids required');
  const { count } = await prisma.marketWatchItem.deleteMany({ where: { id: { in: targets } } });
  return { deleted: count };
}

async function bulkAddMarketWatchItems({ structureId, items } = {}, req) {
  if (!Array.isArray(items) || items.length === 0) throw new HttpError(400, 'items array required');
  const source = await resolveSource(structureId);
  if (!source) throw new HttpError(404, 'No market source configured');

  let added = 0;
  let updated = 0;
  for (const it of items) {
    if (!it.typeId) continue;
    const existing = await prisma.marketWatchItem.findUnique({
      where: { structureId_typeId: { structureId: source.structureId, typeId: Number(it.typeId) } },
    });

    const data = {
      structureId: source.structureId,
      typeId: Number(it.typeId),
      itemName: it.itemName || null,
      minQuantity: Number(it.minQuantity) || 0,
      minDaysCover: Number(it.minDaysCover) || 0,
      created_by: req?.user?.characterName ?? null,
    };

    if (existing) {
      // A re-paste updates the minimum rather than silently doing nothing —
      // bulk paste is how people revise the whole list at once.
      await prisma.marketWatchItem.update({ where: { id: existing.id }, data: { ...data, created_by: existing.created_by } });
      updated += 1;
    } else {
      await prisma.marketWatchItem.create({ data });
      added += 1;
    }
  }
  return { added, updated };
}

// Packaged volume per type, for freight. The SDE `volume` is the assembled
// size, which for ships is ~10x what a courier actually carries (a Raven is
// 470,000 m³ assembled, 50,000 packaged), so shipping estimates need ESI's
// packaged_volume. Cached in-process: it changes only with a game patch.
const PACKAGED_TTL_MS = 24 * 3600_000;

async function getPackagedVolumes({ typeIds } = {}) {
  const ids = [...new Set((Array.isArray(typeIds) ? typeIds : []).map(Number).filter(Boolean))].slice(0, 500);
  const entries = await mapWithConcurrency(ids, 10, async (id) => {
    try {
      const { data } = await cacheWrap(`packaged-volume:${id}`, PACKAGED_TTL_MS, async () => {
        const type = await esiFetch(`/universe/types/${id}/`);
        return type.packaged_volume ?? type.volume ?? null;
      });
      return [id, data];
    } catch {
      // One failed lookup shouldn't blank the rest; the client falls back
      // to the SDE volume for that item.
      return [id, null];
    }
  });
  return { volumes: Object.fromEntries(entries) };
}

async function pollMarketNow({ id, structureId } = {}) {
  const source = id ? await prisma.marketSource.findUnique({ where: { id } }) : await resolveSource(structureId);
  if (!source) throw new HttpError(404, 'Market source not found');
  return pollSource(source.id);
}

export const marketHandlers = {
  getMarketOverview: { fn: getMarketOverview, auth: 'auth' },
  getMarketBrowse: { fn: getMarketBrowse, auth: 'auth' },
  getMarketCategories: { fn: getMarketCategories, auth: 'auth' },
  getMarketItem: { fn: getMarketItem, auth: 'auth' },
  getMarketFeed: { fn: getMarketFeed, auth: 'auth' },
  getMarketWatchlist: { fn: getMarketWatchlist, auth: 'auth' },
  getPackagedVolumes: { fn: getPackagedVolumes, auth: 'auth' },

  // Managing the tracked list is admin-only. The UI hides these controls for
  // everyone else, but this is the boundary that actually enforces it.
  upsertMarketWatchItem: { fn: upsertMarketWatchItem, auth: 'admin' },
  deleteMarketWatchItem: { fn: deleteMarketWatchItem, auth: 'admin' },
  bulkAddMarketWatchItems: { fn: bulkAddMarketWatchItems, auth: 'admin' },
  pollMarketNow: { fn: pollMarketNow, auth: 'admin' },
};

export { aggregateBook, buildRow, filterTypeIds, resolveItemNames, getDistinctListedTypeIds, dailyLookupFor };
