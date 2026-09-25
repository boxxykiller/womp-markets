// Keeps Jita 4-4 reference prices current, so every local price can be shown
// next to what the same item costs at the main trade hub. Refreshed after each
// successful market source poll (see marketPoller.js), and on demand from
// Settings.
//
// Two providers, because neither alone is good enough:
//
//   Fuzzwork  market.fuzzwork.co.uk/aggregates/ takes hundreds of type ids in
//             one request and answers for station 60003760 specifically.
//             A watchlist of 500 items costs ~3 requests.
//   ESI       /markets/10000002/orders/?type_id=N is authoritative and has no
//             third-party dependency, but it is one request per item and
//             returns the whole region, which then has to be filtered down to
//             the 4-4 station.
//
// Fuzzwork is the default primary for the request count alone; whichever is
// primary, the other covers its failures, and the row records which one
// actually answered so the Settings page can show when the fallback is
// carrying the app.
import { prisma } from '../db/prisma.js';
import { esiFetch, mapWithConcurrency } from './esiClient.js';

// Jita IV - Moon 4 - Caldari Navy Assembly Plant, in The Forge.
export const JITA_STATION_ID = 60003760;
export const THE_FORGE_REGION_ID = 10000002;
// Amarr VIII (Oris) - Emperor Family Academy, in Domain.
export const AMARR_STATION_ID = 60008494;
export const DOMAIN_REGION_ID = 10000043;

const FUZZWORK_URL = 'https://market.fuzzwork.co.uk/aggregates/';

// Fuzzwork accepts a long comma-separated list; 200 keeps the URL well under
// any sane length limit while still making the request count negligible.
const FUZZWORK_CHUNK_SIZE = 200;
const FUZZWORK_TIMEOUT_MS = 20_000;

let refreshInProgress = false;

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * Normalizes one Fuzzwork aggregate entry into our row shape.
 *
 * Fuzzwork always returns both sides with zeros rather than omitting them, so
 * "no orders" arrives as max/min of 0 — which must become null, not a real
 * price of zero ISK.
 */
export function parseFuzzworkEntry(typeId, entry) {
  if (!entry) return null;
  const buy = entry.buy || {};
  const sell = entry.sell || {};

  const bestBuy = toNumberOrNull(buy.max);
  const bestSell = toNumberOrNull(sell.min);
  if (bestBuy == null && bestSell == null) return null;

  return {
    typeId: Number(typeId),
    bestBuy,
    bestSell,
    buyVolume: Number(buy.volume) || 0,
    sellVolume: Number(sell.volume) || 0,
    medianBuy: toNumberOrNull(buy.median),
    medianSell: toNumberOrNull(sell.median),
    source: 'fuzzwork',
  };
}

export async function fetchFuzzworkChunk(typeIds, { fetchImpl = fetch, stationId = JITA_STATION_ID } = {}) {
  const url = `${FUZZWORK_URL}?station=${stationId}&types=${typeIds.join(',')}`;
  // A deadline so a stalled Fuzzwork falls through to ESI instead of hanging
  // the whole refresh.
  const res = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FUZZWORK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Fuzzwork ${res.status}`);

  const body = await res.json();
  const rows = [];
  for (const typeId of typeIds) {
    const parsed = parseFuzzworkEntry(typeId, body?.[String(typeId)]);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

/**
 * ESI fallback for a single type. Region orders cover all of The Forge, so
 * they are filtered down to the 4-4 station — comparing against "somewhere in
 * the region" would quietly include a much worse price from a backwater
 * station and make the local market look better than it is.
 */
export async function fetchEsiPrice(typeId, { regionId = THE_FORGE_REGION_ID, stationId = JITA_STATION_ID } = {}) {
  const orders = await esiFetch(`/markets/${regionId}/orders/`, {
    params: { order_type: 'all', type_id: typeId },
  });
  const atJita = (orders || []).filter((o) => String(o.location_id) === String(stationId));
  if (atJita.length === 0) return null;

  let bestBuy = null;
  let bestSell = null;
  let buyVolume = 0;
  let sellVolume = 0;

  for (const o of atJita) {
    if (o.is_buy_order) {
      buyVolume += o.volume_remain;
      bestBuy = bestBuy == null ? o.price : Math.max(bestBuy, o.price);
    } else {
      sellVolume += o.volume_remain;
      bestSell = bestSell == null ? o.price : Math.min(bestSell, o.price);
    }
  }

  return {
    typeId: Number(typeId),
    bestBuy,
    bestSell,
    buyVolume,
    sellVolume,
    medianBuy: null,
    medianSell: null,
    source: 'esi',
  };
}

// The types worth pricing: everything tracked, plus everything currently
// listed in the citadel (so Browse has a Jita column too).
export async function collectTypeIds() {
  const [watched, listed] = await Promise.all([
    prisma.marketWatchItem.findMany({ select: { typeId: true } }),
    prisma.marketOrder.findMany({ select: { typeId: true }, distinct: ['typeId'] }),
  ]);
  return [...new Set([...watched.map((w) => w.typeId), ...listed.map((l) => l.typeId)])];
}

async function persist(rows) {
  if (rows.length === 0) return 0;
  const fetchedAt = new Date();
  await prisma.$transaction(
    rows.map((row) =>
      prisma.referencePrice.upsert({
        where: { typeId: row.typeId },
        create: { ...row, fetchedAt },
        update: { ...row, fetchedAt },
      }),
    ),
  );
  return rows.length;
}

/**
 * Refreshes Jita prices for the given types (defaults to everything relevant).
 *
 * Returns a summary rather than throwing on partial failure — a provider
 * being down should degrade the Jita column, not break the refresh.
 */
export async function refreshReferencePrices({ typeIds, fetchImpl = fetch } = {}) {
  const ids = typeIds ?? (await collectTypeIds());
  if (ids.length === 0) return { updated: 0, fuzzwork: 0, esi: 0, failed: 0 };

  const preferEsi = process.env.JITA_PRICE_SOURCE === 'esi';
  const rows = [];
  let fuzzworkCount = 0;
  let esiCount = 0;
  let failed = 0;

  // Types still needing a price after the primary provider has had its turn.
  let outstanding = ids;

  if (!preferEsi) {
    const remaining = [];
    for (const group of chunk(ids, FUZZWORK_CHUNK_SIZE)) {
      try {
        const got = await fetchFuzzworkChunk(group, { fetchImpl });
        rows.push(...got);
        fuzzworkCount += got.length;
        // A chunk can succeed overall while an individual type comes back
        // with no orders on either side; those fall through to ESI rather
        // than being left stale.
        const answered = new Set(got.map((r) => r.typeId));
        remaining.push(...group.filter((id) => !answered.has(Number(id))));
      } catch (err) {
        console.error(`[jita] Fuzzwork chunk failed (${group.length} types): ${err.message}`);
        remaining.push(...group);
      }
    }
    outstanding = remaining;
  }

  if (outstanding.length > 0) {
    const results = await mapWithConcurrency(outstanding, 5, async (typeId) => {
      try {
        return await fetchEsiPrice(typeId);
      } catch (err) {
        console.error(`[jita] ESI lookup failed for type ${typeId}: ${err.message}`);
        return undefined;
      }
    });
    for (const r of results) {
      if (r === undefined) failed += 1;
      else if (r !== null) {
        rows.push(r);
        esiCount += 1;
      }
      // r === null means "genuinely no orders at Jita for this item", which
      // is an answer, not a failure.
    }
  }

  const updated = await persist(rows);
  return { updated, fuzzwork: fuzzworkCount, esi: esiCount, failed };
}

export async function runReferenceRefresh() {
  if (refreshInProgress) return { skipped: true, reason: 'already running' };
  refreshInProgress = true;
  try {
    const result = await refreshReferencePrices();
    console.log(`[jita] refreshed ${result.updated} prices (fuzzwork ${result.fuzzwork}, esi ${result.esi})`);
    return result;
  } catch (err) {
    console.error('[jita] refresh failed:', err.message);
    return { error: err.message };
  } finally {
    refreshInProgress = false;
  }
}

