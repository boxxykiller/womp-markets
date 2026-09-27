// Doctrine readiness: how many of each fit the market can supply right now,
// and what's missing to reach the minimums. Pure functions over a fit's
// resolved items and a per-type market lookup, so the numbers are testable
// without a database.
import { watchStatus } from './marketMath.js';

export const FIT_ROLES = ['main', 'logi', 'support'];

const STATUS_RANK = { out: 0, critical: 1, low: 2, ok: 3 };

/** The minimum that applies to a fit: its own, else the doctrine's. */
export function fitMinimum(fit, doctrine) {
  return Math.max(0, Math.floor(fit.minQuantity ?? doctrine?.minQuantity ?? 0));
}

/**
 * One fit's items as required per ship, merged by type. Cargo is left out
 * when the fit is set not to count it, so a hull short only on spare paste
 * can still read as fittable.
 */
export function fitRequirements(fit) {
  const byType = new Map();
  for (const item of Array.isArray(fit.items) ? fit.items : []) {
    if (item.kind === 'cargo' && fit.includeCargo === false) continue;
    const typeId = Number(item.typeId);
    const quantity = Number(item.quantity) || 0;
    if (!typeId || quantity <= 0) continue;
    const existing = byType.get(typeId);
    if (existing) existing.perFit += quantity;
    else byType.set(typeId, { typeId, name: item.name ?? null, kind: item.kind ?? 'module', perFit: quantity });
  }
  return [...byType.values()];
}

/**
 * Readiness of a single fit against the market, treating its stock as if no
 * other fit competed for it. `market(typeId)` returns
 * { onMarket, localPrice, jitaPrice, name } for a type.
 */
export function evaluateFit(fit, doctrine, market) {
  const min = fitMinimum(fit, doctrine);
  const reqs = fitRequirements(fit);

  const items = reqs.map((r) => {
    const m = market(r.typeId) || {};
    const onMarket = Math.max(0, Number(m.onMarket) || 0);
    const needed = r.perFit * min;
    return {
      typeId: r.typeId,
      name: m.name ?? r.name,
      kind: r.kind,
      perFit: r.perFit,
      needed,
      onMarket,
      missing: Math.max(0, needed - onMarket),
      // How many whole fits this one item's stock covers.
      supports: Math.floor(onMarket / r.perFit),
      localPrice: m.localPrice ?? null,
      jitaPrice: m.jitaPrice ?? null,
    };
  });

  const fittable = items.length ? Math.min(...items.map((i) => i.supports)) : 0;
  for (const item of items) item.bottleneck = item.supports === fittable;

  // A fit's price is only reported when every part has one — a partial sum
  // reads as a cheap fit rather than as missing data.
  const cost = (key) => (items.length && items.every((i) => i[key] != null)
    ? items.reduce((sum, i) => sum + i[key] * i.perFit, 0)
    : null);

  return {
    min,
    fittable,
    shortfall: Math.max(0, min - fittable),
    status: watchStatus(fittable, min),
    missingItems: items.filter((i) => i.missing > 0).length,
    fitCostLocal: cost('localPrice'),
    fitCostJita: cost('jitaPrice'),
    items,
  };
}

/**
 * The shopping list for a set of evaluated fits: every part whose combined
 * demand (per-fit quantity x minimum, summed across the fits) exceeds what's
 * on market.
 */
export function combinedMissing(readinessList) {
  const demand = new Map();
  for (const readiness of readinessList) {
    for (const item of readiness.items) {
      if (item.needed <= 0) continue;
      const existing = demand.get(item.typeId);
      if (existing) existing.needed += item.needed;
      else demand.set(item.typeId, { ...item });
    }
  }

  return [...demand.values()]
    .map((d) => ({
      typeId: d.typeId,
      name: d.name,
      kind: d.kind,
      needed: d.needed,
      onMarket: d.onMarket,
      missing: Math.max(0, d.needed - d.onMarket),
      localPrice: d.localPrice,
      jitaPrice: d.jitaPrice,
    }))
    .filter((d) => d.missing > 0)
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

/**
 * Readiness of a whole doctrine. Fits are evaluated one by one for the
 * per-ship numbers, but the shopping list is built from the combined demand:
 * five fits sharing one module all draw on the same stock, so each fit being
 * individually fittable doesn't mean the doctrine is.
 */
export function evaluateDoctrine(doctrine, fits, market) {
  const evaluated = fits.map((fit) => ({ fit, readiness: evaluateFit(fit, doctrine, market) }));

  const missing = combinedMissing(evaluated.map(({ readiness }) => readiness));

  const targeted = evaluated.filter(({ readiness }) => readiness.min > 0);
  const coverage = targeted.length
    ? targeted.reduce((sum, { readiness }) => sum + Math.min(1, readiness.fittable / readiness.min), 0) / targeted.length
    : null;

  // Fits with no minimum are along for reference; they only decide the
  // doctrine's status when nothing in it has a minimum at all.
  const judged = targeted.length ? targeted : evaluated;
  let status = null;
  if (judged.length > 0) {
    const worst = Math.min(...judged.map(({ readiness }) => STATUS_RANK[readiness.status]));
    status = worst === STATUS_RANK.ok
      // Every fit is fine alone; the doctrine is only ready if the stock
      // also covers all of them at once.
      ? (missing.length ? 'low' : 'ok')
      : Object.keys(STATUS_RANK).find((k) => STATUS_RANK[k] === worst);
  }

  return {
    status,
    coverage,
    fitsTotal: evaluated.length,
    fitsReady: evaluated.filter(({ readiness }) => readiness.status === 'ok').length,
    hullsFittable: evaluated.reduce((sum, { readiness }) => sum + readiness.fittable, 0),
    hullsNeeded: evaluated.reduce((sum, { readiness }) => sum + readiness.min, 0),
    missing,
    // Unpriced parts are left out of the total rather than making it null:
    // this is a shopping estimate, and the list shows which lines lack a price.
    missingCostJita: missingCost(missing),
    unpricedMissing: missing.filter((m) => m.jitaPrice == null).length,
    fits: evaluated,
  };
}

/** Jita cost of a shopping list, skipping lines with no price. */
export function missingCost(missing) {
  return missing.reduce((sum, m) => sum + (m.jitaPrice ?? 0) * m.missing, 0);
}
