// Pure market maths, shared by the read API and the report handlers.
// No database or network access in here — everything takes plain data, which
// is what makes it directly testable.

/**
 * Indexes daily-stat rows as typeId -> (yyyy-mm-dd -> units sold).
 *
 * Confirmed and estimated units are summed here deliberately: for a *rate*
 * ("how fast does this move"), excluding inferred fills would badly
 * understate any item whose orders tend to vanish whole rather than be
 * whittled down. The two stay separate everywhere they're reported as
 * quantities.
 */
export function buildDailyLookup(rows) {
  const byType = new Map();
  for (const row of rows) {
    let perDay = byType.get(row.typeId);
    if (!perDay) {
      perDay = new Map();
      byType.set(row.typeId, perDay);
    }
    const key = new Date(row.date).toISOString().slice(0, 10);
    const units = (row.unitsSoldConfirmed || 0) + (row.unitsSoldEstimated || 0);
    perDay.set(key, (perDay.get(key) || 0) + units);
  }
  return byType;
}

/**
 * Average units sold per day over the last `windowDays`.
 *
 * Divides by the number of days that actually have data, not by the window
 * length. An item first seen three days ago has no sales on the other 27 days
 * of a 30-day window — counting those as zeroes would report it as moving ten
 * times slower than it is, and days-of-cover would then claim there's far
 * more stock than there really is. Returns null when there is no data at all,
 * so callers can show "—" rather than a confident zero.
 */
export function avgDailyVolume(dailyByType, typeId, windowDays, now = new Date()) {
  const perDay = dailyByType.get(typeId);
  if (!perDay || perDay.size === 0) return null;

  const cutoff = new Date(now.getTime() - windowDays * 86400000);
  let total = 0;
  let days = 0;

  for (const [key, units] of perDay) {
    if (new Date(`${key}T00:00:00.000Z`) < cutoff) continue;
    total += units;
    days += 1;
  }

  if (days === 0) return null;
  return total / days;
}

/**
 * How many days the current sell-side stock will last at the given rate.
 *
 * null when the rate is unknown (no data yet) and Infinity when the item
 * sells nothing — two genuinely different situations that both need to be
 * distinguishable from "0 days left".
 */
export function daysOfCover(sellVolume, ratePerDay) {
  if (ratePerDay == null) return null;
  if (ratePerDay <= 0) return sellVolume > 0 ? Infinity : 0;
  return sellVolume / ratePerDay;
}

/**
 * The minimum this item should be kept at, right now.
 *
 * Two policies, whichever currently binds harder: a flat floor, and a
 * dynamic one expressed in days of sales cover. The dynamic one keeps fast
 * movers stocked without having to revise every flat minimum by hand as
 * demand changes.
 */
export function effectiveMinimum({ minQuantity = 0, minDaysCover = 0 }, ratePerDay) {
  const dynamic = ratePerDay != null && minDaysCover > 0 ? minDaysCover * ratePerDay : 0;
  return Math.max(minQuantity || 0, dynamic);
}

export const WATCH_STATUSES = ['out', 'critical', 'low', 'ok'];

/**
 * Stock status for one tracked item.
 *
 * "out" is checked before anything else so an item with nothing on the market
 * always reads as out, even when no minimum has been set for it. With no
 * effective minimum there is nothing to be below, so anything in stock is ok.
 */
export function watchStatus(sellVolume, effectiveMin) {
  if (!(sellVolume > 0)) return 'out';
  if (!(effectiveMin > 0)) return 'ok';
  if (sellVolume < effectiveMin * 0.5) return 'critical';
  if (sellVolume < effectiveMin) return 'low';
  return 'ok';
}

/** How much to buy to bring an item back to its target. */
export function restockQuantity(sellVolume, targetQuantity) {
  return Math.max(0, Math.ceil((targetQuantity || 0) - (sellVolume || 0)));
}

/**
 * Share of total depth sitting on the buy side, 0..1.
 *
 * null rather than 0 when there is no depth at all — "no orders" and "all
 * sell orders" are different facts.
 */
export function buySellSplit(buyVolume, sellVolume) {
  const total = (buyVolume || 0) + (sellVolume || 0);
  if (total <= 0) return null;
  return (buyVolume || 0) / total;
}

/** Spread between best buy and best sell, as a fraction of best sell. */
export function spreadPct(bestBuy, bestSell) {
  if (bestBuy == null || bestSell == null || bestSell <= 0) return null;
  return (bestSell - bestBuy) / bestSell;
}

/**
 * Local price relative to a reference price, as a signed fraction.
 * +0.2 means the local price is 20% above Jita.
 */
export function vsReferencePct(localPrice, referencePrice) {
  if (localPrice == null || referencePrice == null || referencePrice <= 0) return null;
  return (localPrice - referencePrice) / referencePrice;
}

/**
 * Adds a trailing simple moving average to a daily series.
 *
 * Trailing and not centred: a centred average would need future data, which
 * doesn't exist for the most recent point — the one anyone is actually
 * looking at. Short windows at the start of the series average over however
 * many points exist rather than being dropped, so a young item still charts.
 */
export function withMovingAverage(series, windowDays, valueKey) {
  return series.map((point, i) => {
    const start = Math.max(0, i - windowDays + 1);
    const window = series.slice(start, i + 1);
    const sum = window.reduce((acc, p) => acc + (p[valueKey] || 0), 0);
    return { ...point, [`${valueKey}MA${windowDays}`]: sum / window.length };
  });
}

/**
 * Trailing mean over the last `windowDays` points that ignores gaps.
 *
 * Unlike withMovingAverage, a null value is skipped rather than counted as
 * zero — a day with no ask on the market has no price, and averaging it in as
 * 0 ISK would drag the line to the floor. The result is null until a window
 * holds at least one real value. Written to `outKey`, so a chart can plot the
 * average under a fixed name whatever window was picked.
 */
export function withTrailingMean(series, windowDays, valueKey, outKey = `${valueKey}MA`) {
  const size = Math.max(1, Math.floor(windowDays) || 1);
  return series.map((point, i) => {
    let sum = 0;
    let n = 0;
    for (let j = Math.max(0, i - size + 1); j <= i; j += 1) {
      const v = series[j][valueKey];
      if (v == null || !Number.isFinite(v)) continue;
      sum += v;
      n += 1;
    }
    return { ...point, [outKey]: n > 0 ? sum / n : null };
  });
}

/**
 * Sorts one item's history into what to do about it:
 *   seed  - it sells, and stock is gone or won't last `targetDays`
 *   stale - stock is sitting there and nothing has sold for `staleDays`
 *   ok    - stocked and moving
 *   idle  - nothing listed and nothing sold; no evidence either way
 *
 * "seed" is checked first: an item that sells but is sold out is the most
 * useful thing this can point at.
 */
export function classifyHistory({ ratePerDay, sellVolume, daysSinceSale, targetDays, staleDays }) {
  const stock = sellVolume || 0;
  if (ratePerDay > 0 && (stock <= 0 || stock / ratePerDay < targetDays)) return 'seed';
  if (stock > 0 && (daysSinceSale == null || daysSinceSale >= staleDays)) return 'stale';
  if (stock > 0) return 'ok';
  return 'idle';
}

/**
 * Groups one side of an order book into price levels for a depth ladder.
 *
 * groupPct === 0 keeps every distinct price; otherwise prices are bucketed
 * into bands that wide relative to the best price, which collapses the long
 * tail of 0.01-ISK undercuts into something readable. Levels come back sorted
 * best-first with a running cumulative volume.
 */
export function groupOrdersIntoLadder(orders, { isBuy, groupPct = 0 } = {}) {
  const side = orders.filter((o) => o.isBuyOrder === isBuy);
  if (side.length === 0) return [];

  const sorted = [...side].sort((a, b) => (isBuy ? b.price - a.price : a.price - b.price));
  const bestPrice = sorted[0].price;
  const bucketSize = groupPct > 0 ? bestPrice * (groupPct / 100) : 0;

  const byKey = new Map();
  const levels = [];

  for (const o of sorted) {
    // Buckets are measured outward from the best price rather than off a
    // grid anchored at zero. With a zero-anchored grid the best price
    // frequently lands exactly on a boundary and sits alone in its own
    // level — 100 and 101 stay apart even with a 2 ISK bucket — which
    // defeats the point of grouping.
    const key = bucketSize > 0 ? Math.floor(Math.abs(o.price - bestPrice) / bucketSize) : o.price;
    let level = byKey.get(key);
    if (!level) {
      level = { price: o.price, volume: 0, orderCount: 0 };
      byKey.set(key, level);
      levels.push(level);
    } else if (isBuy ? o.price > level.price : o.price < level.price) {
      // A bucket is labelled with its best price, not the first one seen.
      level.price = o.price;
    }
    level.volume += o.volumeRemain;
    level.orderCount += 1;
  }

  levels.sort((a, b) => (isBuy ? b.price - a.price : a.price - b.price));
  let running = 0;
  for (const level of levels) {
    running += level.volume;
    level.cumulative = running;
  }
  return levels;
}
