import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import { api } from '@/api/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  EVENT_META,
  deltaClass,
  formatDateTime,
  formatDays,
  formatISK,
  formatISKFull,
  formatPct,
  formatQty,
  formatRate,
  formatRelative,
} from '@/lib/format';
import { StatusBadge } from './MarketTable';

// Chart chrome, matched to the app's surfaces rather than Recharts' defaults.
const GRID = '#1E2D45';
const AXIS = { fontSize: 10, fill: '#64748b' };
const TOOLTIP_STYLE = { background: '#0D1829', border: '1px solid #1E2D45', borderRadius: 8, fontSize: 12 };

function Stat({ label, value, className }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-[#4A7BA7]">{label}</div>
      <div className={cn('text-sm font-medium text-slate-200 tnum', className)}>{value}</div>
    </div>
  );
}

/** One side of the depth ladder, with the volume drawn as a bar behind the text. */
function Ladder({ levels, isBuy }) {
  const max = Math.max(...levels.map((l) => l.cumulative), 1);

  return (
    <div className="space-y-0.5 max-h-56 overflow-y-auto scrollbar-thin">
      {levels.length === 0 && <div className="text-xs text-slate-600 py-2">No {isBuy ? 'buy' : 'sell'} orders</div>}
      {levels.map((level, i) => (
        <div key={i} className="relative flex items-center justify-between px-2 py-1 text-xs">
          <div
            className={cn('absolute inset-y-0 left-0 rounded', isBuy ? 'bg-rose-500/20' : 'bg-emerald-500/20')}
            style={{ width: `${(level.cumulative / max) * 100}%` }}
          />
          <span className={cn('relative tnum', isBuy ? 'text-rose-300' : 'text-emerald-300')}>
            {formatISK(level.price)}
          </span>
          <span className="relative tnum text-slate-400">{formatQty(level.volume)}</span>
        </div>
      ))}
    </div>
  );
}

export function ItemDetailSheet({ typeId, open, onOpenChange }) {
  const { data, isLoading } = useQuery({
    queryKey: ['market-item', typeId],
    queryFn: () => api.invoke('getMarketItem', { typeId, days: 90 }),
    enabled: open && !!typeId,
    refetchInterval: 60_000,
  });

  const item = data?.item;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl bg-[#0B1220] border-[#1E2D45] overflow-y-auto scrollbar-thin">
        {isLoading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-[#4A9EFF]" />
          </div>
        )}

        {!isLoading && item && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3 text-white">
                <img src={`https://images.evetech.net/types/${typeId}/icon?size=64`} alt="" className="w-10 h-10 rounded" />
                <div className="min-w-0">
                  <div className="truncate">{item.itemName ?? `Type ${typeId}`}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {item.tracked && <StatusBadge status={item.status} />}
                    <span className="text-xs font-normal text-slate-500">
                      {/* Says plainly how much history the numbers rest on, so
                          a three-day average isn't read as a monthly one. */}
                      {data.dataCoverageDays} days of data
                    </span>
                  </div>
                </div>
              </SheetTitle>
            </SheetHeader>

            <div className="mt-5 space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                <Stat label="Local sell" value={formatISK(item.bestSell)} className="text-emerald-400" />
                <Stat label="Local buy" value={formatISK(item.bestBuy)} className="text-rose-400" />
                <Stat label="Jita sell" value={formatISK(item.jitaBestSell)} />
                <Stat label="Jita buy" value={formatISK(item.jitaBestBuy)} />
                <Stat label="On market" value={formatQty(item.sellVolume)} />
                <Stat label="Buy depth" value={formatQty(item.buyVolume)} />
                <Stat
                  label="vs Jita sell"
                  value={formatPct(item.vsJitaSellPct, { signed: true })}
                  className={deltaClass(item.vsJitaSellPct)}
                />
                <Stat label="Days left" value={formatDays(item.daysOfCover30)} />
              </div>

              <div className="grid grid-cols-3 gap-4 p-4 rounded-xl bg-slate-900/50 border border-slate-800">
                <Stat label="Daily avg" value={formatRate(item.avgDaily1)} />
                <Stat label="Weekly avg" value={formatRate(item.avgDaily7)} />
                <Stat label="Monthly avg" value={formatRate(item.avgDaily30)} />
              </div>

              <section>
                <h3 className="text-sm font-semibold text-white mb-2">Units sold per day</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data.series}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="date" tick={AXIS} />
                      <YAxis tick={AXIS} width={44} />
                      <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
                      <Line type="monotone" dataKey="units" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="Units" />
                      {/* Moving averages dashed over the solid raw series, so
                          the trend reads without hiding the daily noise. */}
                      <Line type="monotone" dataKey="unitsMA7" stroke="#38bdf8" dot={false} strokeDasharray="4 2" name="7d avg" />
                      <Line type="monotone" dataKey="unitsMA30" stroke="#a166ff" dot={false} strokeDasharray="6 3" name="30d avg" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-white mb-2">Stock on market</h3>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.series}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="date" tick={AXIS} />
                      <YAxis tick={AXIS} width={44} />
                      <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
                      <Area type="stepAfter" dataKey="sellVolume" stroke="#10b981" fill="#10b98133" name="Sell" />
                      <Area type="stepAfter" dataKey="buyVolume" stroke="#f43f5e" fill="#f43f5e33" name="Buy" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-white mb-2">Order book</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-emerald-400 mb-1">Sell orders</div>
                    <Ladder levels={data.sellLadder} isBuy={false} />
                  </div>
                  <div>
                    <div className="text-xs text-rose-400 mb-1">Buy orders</div>
                    <Ladder levels={data.buyLadder} isBuy />
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-white mb-2">Recent activity</h3>
                <div className="max-h-64 overflow-y-auto scrollbar-thin divide-y divide-slate-800/70">
                  {data.events.length === 0 && <div className="text-xs text-slate-600 py-2">Nothing recorded yet.</div>}
                  {data.events.slice(0, 60).map((e) => {
                    const meta = EVENT_META[e.eventType] ?? { label: e.eventType, className: 'text-slate-400' };
                    return (
                      <div key={e.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                        <span className={meta.className}>{meta.label}</span>
                        <span className="text-slate-500 tnum">
                          {e.volume ? `${formatQty(e.volume)} @ ` : ''}
                          <span title={formatISKFull(e.price)}>{formatISK(e.price)}</span>
                        </span>
                        <span className="text-slate-600 shrink-0" title={formatDateTime(e.occurredAt)}>
                          {formatRelative(e.occurredAt)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
