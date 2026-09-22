import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio } from 'lucide-react';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import { EVENT_META, formatDateTime, formatISK, formatISKFull, formatQty, formatRelative } from '@/lib/format';

const TRADE_TYPES = ['fill', 'fill_estimated'];

const MODES = [
  { key: 'trades', label: 'Trades' },
  { key: 'all', label: 'All activity' },
];

/**
 * Live feed of market events, newest first.
 *
 * Refetches every minute. New rows only appear when the poller has taken a
 * fresh snapshot of the book (every MARKET_POLL_INTERVAL_MINUTES), so most
 * refetches return the same list — rows that weren't in the previous result
 * get a brief highlight so an actual change is easy to spot.
 */
export function LiveMarketFeed({ onItemClick, className }) {
  const [mode, setMode] = useState('trades');
  const [, setTick] = useState(0);
  const seenIds = useRef(null);
  const [freshIds, setFreshIds] = useState(() => new Set());

  const { data, dataUpdatedAt, isLoading, isError } = useQuery({
    queryKey: ['dashboard-feed', mode],
    queryFn: () =>
      api.invoke('getMarketFeed', { limit: 100, ...(mode === 'trades' ? { eventTypes: TRADE_TYPES } : {}) }),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  const events = data?.events ?? [];

  // Relative timestamps ("3m ago") drift between refetches; re-render on a
  // light timer so they stay honest.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  // Reset the seen set when switching modes so the whole list doesn't flash.
  useEffect(() => {
    seenIds.current = null;
  }, [mode]);

  useEffect(() => {
    if (!data) return;
    const ids = data.events.map((e) => e.id);
    if (seenIds.current) {
      const fresh = ids.filter((id) => !seenIds.current.has(id));
      if (fresh.length) setFreshIds(new Set(fresh));
    }
    seenIds.current = new Set(ids);
  }, [data]);

  useEffect(() => {
    if (freshIds.size === 0) return;
    const t = setTimeout(() => setFreshIds(new Set()), 8_000);
    return () => clearTimeout(t);
  }, [freshIds]);

  return (
    <section className={cn('flex flex-col border border-slate-800 rounded-lg bg-slate-950/40 min-h-0', className)}>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-emerald-500" />
          </span>
          <h2 className="text-base font-semibold text-white">Live feed</h2>
        </div>
        <div className="flex rounded-md border border-slate-800 p-0.5 text-xs">
          {MODES.map((m) => (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={cn(
                'px-2 py-0.5 rounded transition-colors',
                mode === m.key ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin divide-y divide-slate-800/70">
        {isLoading && <div className="py-8 text-center text-slate-500 text-sm">Loading…</div>}
        {isError && <div className="py-8 text-center text-rose-400 text-sm">Couldn&apos;t load the feed.</div>}
        {!isLoading && !isError && events.length === 0 && (
          <div className="py-8 px-4 text-center text-slate-500 text-sm">
            <Radio className="w-5 h-5 mx-auto mb-2 text-slate-600" />
            {mode === 'trades' ? 'No trades observed yet.' : 'No market activity recorded yet.'}
          </div>
        )}
        {events.map((e) => {
          const meta = EVENT_META[e.eventType] ?? { label: e.eventType, className: 'text-slate-400' };
          const total = e.volume && e.price ? e.volume * e.price : null;
          const side = e.isBuyOrder == null ? null : e.isBuyOrder ? 'Buy' : 'Sell';
          return (
            <button
              key={e.id}
              onClick={() => onItemClick?.(e.typeId)}
              className={cn(
                'flex items-start gap-2.5 w-full px-3 py-2 text-left text-sm hover:bg-slate-900/50 transition-colors duration-700',
                freshIds.has(e.id) && 'bg-emerald-500/10',
              )}
            >
              <img
                src={`https://images.evetech.net/types/${e.typeId}/icon?size=32`}
                alt=""
                className="w-7 h-7 rounded mt-0.5 shrink-0"
                loading="lazy"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-slate-200 truncate">{e.itemName ?? `Type ${e.typeId}`}</span>
                  <span className="text-emerald-400 tnum shrink-0" title={total ? formatISKFull(total) : undefined}>
                    {total ? formatISK(total) : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate">
                    <span className={meta.className}>{meta.label}</span>
                    {side && (
                      <span className={e.isBuyOrder ? 'text-rose-400/80' : 'text-emerald-400/80'}> · {side}</span>
                    )}
                    <span className="text-slate-500 tnum">
                      {' · '}
                      {e.volume ? `${formatQty(e.volume)} @ ` : ''}
                      <span title={formatISKFull(e.price)}>{formatISK(e.price)}</span>
                    </span>
                  </span>
                  <span className="text-slate-600 shrink-0" title={formatDateTime(e.occurredAt)}>
                    {formatRelative(e.occurredAt)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="px-3 py-1.5 border-t border-slate-800 text-[11px] text-slate-600">
        Refreshes every minute{dataUpdatedAt ? ` · checked ${formatRelative(dataUpdatedAt)}` : ''}
      </div>
    </section>
  );
}
