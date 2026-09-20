// Polls a player-owned structure's market (GET /markets/structures/{id}/) on
// a timer and diffs consecutive snapshots to derive fills, price changes and
// volume.
//
// This diffing is not an optimisation — it is the only way to get history at
// all. ESI publishes no history endpoint for player-owned structures (only
// the live order book) and confirms no trades, so every number this app shows
// about how fast something sells is derived here, by comparing what the book
// looked like last poll to what it looks like now.
//
// When an order disappears it is one of:
//   - past issued+duration                       -> "expired" (not a trade)
//   - still valid, and was best-priced last poll -> "fill_estimated"
//   - still valid, and was not best-priced       -> "cancelled"
//
// ...unless the gap since the last successful poll exceeds 3x the configured
// interval (the server was down, ticks were missed), in which case
// disappearances are not attributed to fills at all: too much could have
// happened in between to guess honestly.
//
// Confirmed and estimated volume are tracked in separate columns and never
// summed into one. A caller that wants the optimistic figure adds them
// explicitly, so an inferred number can never be mistaken for an observed one.
import { prisma } from '../db/prisma.js';
import { esiFetch, esiFetchPaged } from './esiClient.js';
import { ensureFreshToken } from './eveSso.js';

let pollTimer = null;
let cleanupTimer = null;
const inFlight = new Set();

// Seeds the configured citadel when MARKET_STRUCTURE_ID is set. With no env
// configuration nothing is seeded and the Settings wizard creates the source
// instead — so a fresh clone starts clean rather than pointing at somebody
// else's structure.
export async function ensureConfiguredSource() {
  const structureId = String(process.env.MARKET_STRUCTURE_ID || '').trim();
  if (!structureId) return null;

  const existing = await prisma.marketSource.findUnique({ where: { structureId } });
  if (existing) return existing;

  const created = await prisma.marketSource.create({
    data: {
      structureId,
      sourceType: 'structure',
      readerCharacterName: String(process.env.MARKET_READER_CHARACTER || '').trim() || null,
      isPrimary: true,
      pollIntervalMinutes: Number(process.env.MARKET_POLL_INTERVAL_MINUTES) || 15,
      retentionDays: Number(process.env.MARKET_RETENTION_DAYS) || 180,
    },
  });
  console.log(`[market] Seeded market source from environment: ${structureId}`);
  return created;
}

async function updateCharacterToken(id, patch) {
  await prisma.eveCharacter.update({ where: { id }, data: patch });
}

// Resolves by id first, then by case-insensitive name — so a source can be
// configured with just a character name before that character has ever
// logged in.
async function resolveReaderCharacter(source) {
  if (source.readerCharacterId) {
    const byId = await prisma.eveCharacter.findFirst({
      where: { characterId: source.readerCharacterId, active: true, banned: false },
    });
    if (byId) return byId;
  }
  if (source.readerCharacterName) {
    const byName = await prisma.eveCharacter.findFirst({
      where: {
        characterName: { equals: source.readerCharacterName, mode: 'insensitive' },
        active: true,
        banned: false,
      },
    });
    if (byName) return byName;
  }
  return null;
}

async function markPollResult(id, status, error, polledAt, pollIntervalMinutes) {
  await prisma.marketSource.update({
    where: { id },
    data: {
      lastPollStatus: status,
      lastPollError: error || null,
      ...(polledAt
        ? { lastPolledAt: polledAt, nextPollAt: new Date(polledAt.getTime() + pollIntervalMinutes * 60000) }
        : {}),
    },
  });
}

// Fills in name/system/region once, the first time a poll succeeds with a
// usable token, so nothing about the structure has to be typed by hand
// beyond its id.
async function resolveSourceMeta(source, token) {
  if (source.systemId && source.regionId) return;
  try {
    const info = await esiFetch(`/universe/structures/${source.structureId}/`, { token });
    const systemId = info?.solar_system_id || null;
    let systemName = null;
    let regionId = null;
    let regionName = null;

    if (systemId) {
      const sys = await esiFetch(`/universe/systems/${systemId}/`).catch(() => null);
      systemName = sys?.name || null;
      if (sys?.constellation_id) {
        const cons = await esiFetch(`/universe/constellations/${sys.constellation_id}/`).catch(() => null);
        regionId = cons?.region_id || null;
        if (regionId) {
          const reg = await esiFetch(`/universe/regions/${regionId}/`).catch(() => null);
          regionName = reg?.name || null;
        }
      }
    }

    await prisma.marketSource.update({
      where: { id: source.id },
      data: { name: info?.name || source.name, systemId, systemName, regionId, regionName },
    });
  } catch {
    // Leave unresolved — retried on the next successful poll.
  }
}

async function fetchOrdersForSource(source) {
  // Region sources are public ESI data: no reader, no structure metadata.
  if (source.sourceType === 'region') {
    return esiFetchPaged(`/markets/${source.regionId}/orders/`, { params: { order_type: 'all' } });
  }

  const character = await resolveReaderCharacter(source);
  if (!character) throw new Error("No connected character found for this structure's reader.");

  let fresh;
  try {
    fresh = await ensureFreshToken(character, updateCharacterToken);
  } catch (err) {
    throw new Error(`Token refresh failed: ${err.message}`);
  }

  await resolveSourceMeta(source, fresh.accessToken);
  return esiFetchPaged(`/markets/structures/${source.structureId}/`, { token: fresh.accessToken });
}

/**
 * Runs one poll cycle for a single source. Exported so the timer and the
 * admin "Poll now" button share exactly one code path.
 */
export async function pollSource(id) {
  if (inFlight.has(id)) return { skipped: true, reason: 'already polling' };
  inFlight.add(id);

  try {
    const source = await prisma.marketSource.findUnique({ where: { id } });
    if (!source) return { skipped: true, reason: 'not found' };
    if (!source.enabled) return { skipped: true, reason: 'disabled' };

    let orders;
    try {
      orders = await fetchOrdersForSource(source);
    } catch (err) {
      // A market read failure (no docking rights, structure unanchored, token
      // missing the scope) is the expected failure mode. Recorded on the
      // source and surfaced on the Settings page rather than thrown, so one
      // bad source can't take down the tick.
      await markPollResult(source.id, 'error', err.message);
      return { error: err.message };
    }

    const now = new Date();
    const gapMs = source.lastPolledAt ? now - new Date(source.lastPolledAt) : 0;
    const missedTooManyTicks = gapMs > source.pollIntervalMinutes * 60000 * 3;

    const existing = await prisma.marketOrder.findMany({ where: { structureId: source.structureId } });
    const existingMap = new Map(existing.map((o) => [o.orderId, o]));
    const seenOrderIds = new Set();

    // Best price per (typeId, side) as of BEFORE this poll's changes — this
    // is what decides whether a vanished order is treated as a likely fill.
    const bestByTypeSide = new Map();
    for (const o of existing) {
      const key = `${o.typeId}:${o.isBuyOrder}`;
      const cur = bestByTypeSide.get(key);
      bestByTypeSide.set(
        key,
        cur === undefined ? o.price : o.isBuyOrder ? Math.max(cur, o.price) : Math.min(cur, o.price),
      );
    }

    const events = [];
    const archives = [];
    const orderUpserts = [];

    const deltas = new Map();
    function addDelta(typeId, patch) {
      const cur = deltas.get(typeId) || {
        unitsSoldConfirmed: 0,
        unitsSoldEstimated: 0,
        iskTradedConfirmed: 0,
        iskTradedEstimated: 0,
      };
      for (const k of Object.keys(patch)) cur[k] += patch[k];
      deltas.set(typeId, cur);
    }

    const aggByType = new Map();

    for (const o of orders) {
      const orderId = String(o.order_id);
      seenOrderIds.add(orderId);
      const prev = existingMap.get(orderId);

      if (!prev) {
        events.push({
          structureId: source.structureId,
          typeId: o.type_id,
          orderId,
          isBuyOrder: o.is_buy_order,
          eventType: 'new',
          price: o.price,
          occurredAt: now,
        });
      } else {
        if (prev.volumeRemain > o.volume_remain) {
          const filled = prev.volumeRemain - o.volume_remain;
          events.push({
            structureId: source.structureId,
            typeId: o.type_id,
            orderId,
            isBuyOrder: o.is_buy_order,
            eventType: 'fill',
            price: o.price,
            volume: filled,
            occurredAt: now,
          });
          addDelta(o.type_id, {
            unitsSoldConfirmed: filled,
            unitsSoldEstimated: 0,
            iskTradedConfirmed: filled * o.price,
            iskTradedEstimated: 0,
          });
        }
        if (prev.price !== o.price) {
          events.push({
            structureId: source.structureId,
            typeId: o.type_id,
            orderId,
            isBuyOrder: o.is_buy_order,
            eventType: 'price_change',
            price: o.price,
            prevPrice: prev.price,
            occurredAt: now,
          });
        }
      }

      orderUpserts.push({
        where: { structureId_orderId: { structureId: source.structureId, orderId } },
        create: {
          structureId: source.structureId,
          orderId,
          typeId: o.type_id,
          isBuyOrder: o.is_buy_order,
          price: o.price,
          volumeRemain: o.volume_remain,
          volumeTotal: o.volume_total,
          minVolume: o.min_volume || 1,
          range: o.range,
          duration: o.duration,
          issued: new Date(o.issued),
          locationId: o.location_id != null ? String(o.location_id) : null,
          firstSeenAt: now,
          lastSeenAt: now,
        },
        update: {
          price: o.price,
          volumeRemain: o.volume_remain,
          volumeTotal: o.volume_total,
          minVolume: o.min_volume || 1,
          range: o.range,
          duration: o.duration,
          lastSeenAt: now,
        },
      });

      const agg = aggByType.get(o.type_id) || {
        sellVolume: 0,
        buyVolume: 0,
        bestSell: null,
        bestBuy: null,
        sellCount: 0,
        buyCount: 0,
      };
      if (o.is_buy_order) {
        agg.buyVolume += o.volume_remain;
        agg.buyCount += 1;
        agg.bestBuy = agg.bestBuy == null ? o.price : Math.max(agg.bestBuy, o.price);
      } else {
        agg.sellVolume += o.volume_remain;
        agg.sellCount += 1;
        agg.bestSell = agg.bestSell == null ? o.price : Math.min(agg.bestSell, o.price);
      }
      aggByType.set(o.type_id, agg);
    }

    const disappearedIds = [];
    for (const prev of existing) {
      if (seenOrderIds.has(prev.orderId)) continue;
      disappearedIds.push(prev.orderId);

      const expiresAt = new Date(prev.issued.getTime() + (prev.duration || 0) * 86400000);
      let endState;

      if (expiresAt <= now) {
        endState = 'expired';
      } else if (missedTooManyTicks) {
        // Something happened to this order, but the gap is too wide to say
        // what. Archived as unknown so the row isn't lost, with no event and
        // no volume attributed.
        endState = 'unknown';
      } else if (bestByTypeSide.get(`${prev.typeId}:${prev.isBuyOrder}`) === prev.price) {
        endState = 'filled_estimated';
      } else {
        endState = 'cancelled';
      }

      archives.push({
        structureId: source.structureId,
        orderId: prev.orderId,
        typeId: prev.typeId,
        isBuyOrder: prev.isBuyOrder,
        price: prev.price,
        volumeRemain: prev.volumeRemain,
        volumeTotal: prev.volumeTotal,
        issued: prev.issued,
        duration: prev.duration,
        firstSeenAt: prev.firstSeenAt,
        lastSeenAt: prev.lastSeenAt,
        removedAt: now,
        endState,
      });

      if (endState === 'unknown') continue;

      if (endState === 'expired') {
        events.push({
          structureId: source.structureId,
          typeId: prev.typeId,
          orderId: prev.orderId,
          isBuyOrder: prev.isBuyOrder,
          eventType: 'expired',
          price: prev.price,
          occurredAt: now,
        });
        continue;
      }

      if (endState === 'filled_estimated') {
        events.push({
          structureId: source.structureId,
          typeId: prev.typeId,
          orderId: prev.orderId,
          isBuyOrder: prev.isBuyOrder,
          eventType: 'fill_estimated',
          price: prev.price,
          volume: prev.volumeRemain,
          occurredAt: now,
        });
        addDelta(prev.typeId, {
          unitsSoldConfirmed: 0,
          unitsSoldEstimated: prev.volumeRemain,
          iskTradedConfirmed: 0,
          iskTradedEstimated: prev.volumeRemain * prev.price,
        });
        continue;
      }

      events.push({
        structureId: source.structureId,
        typeId: prev.typeId,
        orderId: prev.orderId,
        isBuyOrder: prev.isBuyOrder,
        eventType: 'cancelled',
        price: prev.price,
        occurredAt: now,
      });
    }

    await prisma.$transaction([
      ...(archives.length ? [prisma.marketOrderArchive.createMany({ data: archives, skipDuplicates: true })] : []),
      ...(disappearedIds.length
        ? [prisma.marketOrder.deleteMany({ where: { structureId: source.structureId, orderId: { in: disappearedIds } } })]
        : []),
      ...orderUpserts.map((u) => prisma.marketOrder.upsert(u)),
      ...(events.length ? [prisma.marketOrderEvent.createMany({ data: events })] : []),
    ]);

    await applyDailyStats(source.structureId, now, aggByType, deltas);
    await recordWatchedSnapshots(source.structureId, aggByType, now);
    await markPollResult(source.id, 'ok', null, now, source.pollIntervalMinutes);

    return { ok: true, orderCount: orders.length, eventCount: events.length, archivedCount: archives.length };
  } finally {
    inFlight.delete(id);
  }
}

async function applyDailyStats(structureId, now, aggByType, deltas) {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const typeIds = new Set([...aggByType.keys(), ...deltas.keys()]);
  if (typeIds.size === 0) return;

  const existingToday = await prisma.marketDailyStat.findMany({
    where: { structureId, date: dayStart, typeId: { in: [...typeIds] } },
  });
  const existingMap = new Map(existingToday.map((r) => [r.typeId, r]));

  const ops = [];
  for (const typeId of typeIds) {
    const agg = aggByType.get(typeId);
    const delta = deltas.get(typeId) || {
      unitsSoldConfirmed: 0,
      unitsSoldEstimated: 0,
      iskTradedConfirmed: 0,
      iskTradedEstimated: 0,
    };
    const prevRow = existingMap.get(typeId);

    // lowSell/highBuy track the day's extremes across every poll, so they
    // survive a mid-day price spike that has reverted by the next sample.
    const lowSell =
      agg?.bestSell != null
        ? prevRow?.lowSell != null
          ? Math.min(prevRow.lowSell, agg.bestSell)
          : agg.bestSell
        : (prevRow?.lowSell ?? null);
    const highBuy =
      agg?.bestBuy != null
        ? prevRow?.highBuy != null
          ? Math.max(prevRow.highBuy, agg.bestBuy)
          : agg.bestBuy
        : (prevRow?.highBuy ?? null);

    ops.push(
      prisma.marketDailyStat.upsert({
        where: { structureId_typeId_date: { structureId, typeId, date: dayStart } },
        create: {
          structureId,
          typeId,
          date: dayStart,
          unitsSoldConfirmed: delta.unitsSoldConfirmed,
          unitsSoldEstimated: delta.unitsSoldEstimated,
          iskTradedConfirmed: delta.iskTradedConfirmed,
          iskTradedEstimated: delta.iskTradedEstimated,
          lowSell: agg?.bestSell ?? null,
          highBuy: agg?.bestBuy ?? null,
          endSellVolume: agg?.sellVolume ?? 0,
          endBuyVolume: agg?.buyVolume ?? 0,
          sellOrderCount: agg?.sellCount ?? 0,
          buyOrderCount: agg?.buyCount ?? 0,
          sampleCount: 1,
        },
        update: {
          unitsSoldConfirmed: (prevRow?.unitsSoldConfirmed ?? 0) + delta.unitsSoldConfirmed,
          unitsSoldEstimated: (prevRow?.unitsSoldEstimated ?? 0) + delta.unitsSoldEstimated,
          iskTradedConfirmed: (prevRow?.iskTradedConfirmed ?? 0) + delta.iskTradedConfirmed,
          iskTradedEstimated: (prevRow?.iskTradedEstimated ?? 0) + delta.iskTradedEstimated,
          lowSell,
          highBuy,
          endSellVolume: agg?.sellVolume ?? prevRow?.endSellVolume ?? 0,
          endBuyVolume: agg?.buyVolume ?? prevRow?.endBuyVolume ?? 0,
          sellOrderCount: agg?.sellCount ?? prevRow?.sellOrderCount ?? 0,
          buyOrderCount: agg?.buyCount ?? prevRow?.buyOrderCount ?? 0,
          sampleCount: (prevRow?.sampleCount ?? 0) + 1,
        },
      }),
    );
  }
  await prisma.$transaction(ops);
}

// Tracked items only. Snapshotting every listed item on every poll would
// dwarf every other table in the database for very little benefit.
async function recordWatchedSnapshots(structureId, aggByType, now) {
  const watched = await prisma.marketWatchItem.findMany({ where: { structureId }, select: { typeId: true } });
  if (watched.length === 0) return;

  const data = watched.map(({ typeId }) => {
    const agg = aggByType.get(typeId) || { sellVolume: 0, buyVolume: 0, bestSell: null, bestBuy: null };
    return {
      structureId,
      typeId,
      sellVolume: agg.sellVolume,
      buyVolume: agg.buyVolume,
      bestSell: agg.bestSell,
      bestBuy: agg.bestBuy,
      takenAt: now,
    };
  });
  await prisma.marketSnapshot.createMany({ data });
}

// Prunes the derived, re-derivable series. MarketOrderArchive is deliberately
// excluded: it is the permanent order history and the whole point of keeping
// it is that it outlives the retention window.
export async function cleanupExpiredHistory() {
  const sources = await prisma.marketSource.findMany();
  for (const s of sources) {
    const cutoff = new Date(Date.now() - s.retentionDays * 86400000);
    await Promise.all([
      prisma.marketOrderEvent.deleteMany({ where: { structureId: s.structureId, occurredAt: { lt: cutoff } } }),
      prisma.marketDailyStat.deleteMany({ where: { structureId: s.structureId, date: { lt: cutoff } } }),
      prisma.marketSnapshot.deleteMany({ where: { structureId: s.structureId, takenAt: { lt: cutoff } } }),
    ]);
  }
}

// Ticks every minute and polls whichever sources are due, so each source's
// own interval is honoured independently rather than every source sharing one
// global period.
async function tick() {
  try {
    const sources = await prisma.marketSource.findMany({ where: { enabled: true } });
    const now = Date.now();
    for (const s of sources) {
      const due = !s.nextPollAt || new Date(s.nextPollAt).getTime() <= now;
      if (due) {
        pollSource(s.id).catch((err) => console.error(`[market] poll failed for ${s.structureId}:`, err.message));
      }
    }
  } catch (err) {
    console.error('[market] tick failed:', err.message);
  }
}

export function startMarketPoller() {
  if (pollTimer) return;
  tick();
  pollTimer = setInterval(tick, 60 * 1000);

  cleanupExpiredHistory().catch((err) => console.error('[market] cleanup failed:', err.message));
  cleanupTimer = setInterval(
    () => cleanupExpiredHistory().catch((err) => console.error('[market] cleanup failed:', err.message)),
    24 * 60 * 60 * 1000,
  );
  console.log('[market] poller started');
}

export function stopMarketPoller() {
  if (pollTimer) clearInterval(pollTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  pollTimer = null;
  cleanupTimer = null;
}
