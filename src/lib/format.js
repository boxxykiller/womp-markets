// Display formatting. Market tables are dense and read at a glance, so the
// bias throughout is toward short, scannable values with the full precision
// available in a tooltip where it matters.

const EM_DASH = '—';

/** ISK with a B/M/K suffix. Full precision belongs in a tooltip, not a cell. */
export function formatISK(value, { decimals = 2 } = {}) {
  if (value == null || !Number.isFinite(value)) return EM_DASH;
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(decimals)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(decimals)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(decimals)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(decimals)}K`;
  return value.toFixed(decimals);
}

/** Exact ISK, for tooltips and detail panels. */
export function formatISKFull(value) {
  if (value == null || !Number.isFinite(value)) return EM_DASH;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ISK`;
}

/** Whole-unit quantities. Fractional volumes are a rounding artefact, not data. */
export function formatQty(value) {
  if (value == null || !Number.isFinite(value)) return EM_DASH;
  return Math.round(value).toLocaleString();
}

/** Compact quantity (144.4M, 2.1K) for stat cards where the full number won't fit. */
export function formatQtyCompact(value) {
  if (value == null || !Number.isFinite(value)) return EM_DASH;
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return Math.round(value).toLocaleString();
}

/** A rate like 1.2k/day, kept to one decimal below a thousand. */
export function formatRate(value) {
  if (value == null || !Number.isFinite(value)) return EM_DASH;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 10) return value.toFixed(0);
  return value.toFixed(1);
}

/** Signed percentage from a fraction. +12.3% reads as "12.3% above". */
export function formatPct(fraction, { decimals = 1, signed = false } = {}) {
  if (fraction == null || !Number.isFinite(fraction)) return EM_DASH;
  const pct = fraction * 100;
  const sign = signed && pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(decimals)}%`;
}

/**
 * Days of stock left.
 *
 * "∞" for something that never sells and "—" for something with no data are
 * deliberately different: one is a fact about the item, the other is a fact
 * about the dataset, and conflating them hides how young the history is.
 */
export function formatDays(days) {
  if (days == null) return EM_DASH;
  if (!Number.isFinite(days)) return '∞';
  if (days >= 999) return '999+';
  if (days < 10) return days.toFixed(1);
  return Math.round(days).toString();
}

export function formatDateTime(value) {
  if (!value) return EM_DASH;
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatRelative(value) {
  if (!value) return EM_DASH;
  const diffMs = Date.now() - new Date(value).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Counts down to the next poll; "due now" once it has elapsed. */
export function formatCountdown(ms) {
  if (ms == null || ms <= 0) return 'due now';
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Status metadata, shared by every table, badge and tile so a colour always
// means the same thing.
export const STATUS_META = {
  out: { label: 'Out of stock', badge: 'bg-rose-500/20 text-rose-400 border border-rose-500/30', dot: 'bg-rose-500' },
  critical: { label: 'Critical', badge: 'bg-rose-500/20 text-rose-400 border border-rose-500/30', dot: 'bg-rose-500' },
  low: { label: 'Low', badge: 'bg-amber-500/20 text-amber-400 border border-amber-500/30', dot: 'bg-amber-500' },
  ok: { label: 'OK', badge: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30', dot: 'bg-emerald-500' },
};

// History-report verdicts: what the stored history says to do about an item.
export const VERDICT_META = {
  seed: { label: 'Seed', badge: 'bg-amber-500/20 text-amber-400 border border-amber-500/30' },
  stale: { label: 'Stale', badge: 'bg-slate-700/40 text-slate-300 border border-slate-600/40' },
  ok: { label: 'Moving', badge: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' },
  idle: { label: 'Idle', badge: 'bg-slate-800/60 text-slate-500 border border-slate-700/40' },
};

export const EVENT_META = {
  new: { label: 'New order', className: 'text-sky-400' },
  fill: { label: 'Filled', className: 'text-emerald-400' },
  fill_estimated: { label: 'Filled (est.)', className: 'text-emerald-300/80' },
  price_change: { label: 'Price change', className: 'text-amber-400' },
  cancelled: { label: 'Cancelled', className: 'text-slate-500' },
  expired: { label: 'Expired', className: 'text-slate-500' },
};

/**
 * Colour for a local-vs-Jita delta.
 *
 * Intentionally not red/green: whether being above Jita is good depends
 * entirely on which side of the trade you're on, so this only signals
 * direction and magnitude, and leaves the judgement to the reader.
 */
export function deltaClass(fraction) {
  if (fraction == null || !Number.isFinite(fraction)) return 'text-slate-500';
  if (Math.abs(fraction) < 0.02) return 'text-slate-400';
  return fraction > 0 ? 'text-amber-400' : 'text-sky-400';
}

/**
 * Share of tracked items at or above their minimum, from the watchlist status
 * counts. Returns null variant/percent-free values when nothing is tracked.
 */
export function stockedSummary(counts) {
  const total = (counts?.out ?? 0) + (counts?.critical ?? 0) + (counts?.low ?? 0) + (counts?.ok ?? 0);
  if (total === 0) return { value: EM_DASH, subtitle: 'nothing tracked', variant: 'slate' };
  const pct = (counts.ok / total) * 100;
  // Floor so 99.6% never reads as a fully stocked 100%.
  const shown = Math.floor(pct);
  return {
    value: `${shown}%`,
    subtitle: `${counts.ok} of ${total} at or above minimum`,
    variant: pct >= 90 ? 'emerald' : pct >= 70 ? 'amber' : 'rose',
  };
}
