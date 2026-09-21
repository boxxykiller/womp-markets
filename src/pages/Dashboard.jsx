import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Boxes,
  Database,
  Layers,
  LayoutDashboard,
  PackageX,
  ShoppingCart,
  Tag,
  TrendingUp,
} from 'lucide-react';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { MarketTable } from '@/components/market/MarketTable';
import { ItemDetailSheet } from '@/components/market/ItemDetailSheet';
import { formatISK, formatQty, formatQtyCompact, formatRelative } from '@/lib/format';

export default function Dashboard() {
  const [detailTypeId, setDetailTypeId] = useState(null);

  const { data: overview } = useQuery({
    queryKey: ['market-overview'],
    queryFn: () => api.invoke('getMarketOverview', {}),
    refetchInterval: 60_000,
  });

  const { data: watchlist, isLoading } = useQuery({
    queryKey: ['dashboard-watchlist'],
    queryFn: () => api.invoke('getMarketWatchlist', { sort: 'daysOfCover' }),
    refetchInterval: 60_000,
  });

  const { data: velocity } = useQuery({
    queryKey: ['dashboard-velocity'],
    queryFn: () => api.invoke('reportVelocity', { days: 7 }),
    staleTime: 5 * 60_000,
  });

  const counts = watchlist?.counts ?? { out: 0, critical: 0, low: 0, ok: 0 };
  const needsAttention = (watchlist?.rows ?? []).filter((r) => r.status !== 'ok').slice(0, 10);
  const movers = (velocity?.rows ?? []).slice(0, 8);

  const book = overview?.book ?? { sell: { orders: 0, units: 0, isk: 0 }, buy: { orders: 0, units: 0, isk: 0 } };
  // Divide by the history that actually exists (capped at the 7-day window)
  // so a young install isn't understated by dividing a day of sales by seven.
  const velocityDays = Math.max(1, Math.min(7, overview?.dataCoverageDays ?? 1));
  const iskPerDay = (velocity?.summary?.totalIsk ?? 0) / velocityDays;
  const unitsPerDay = (velocity?.summary?.totalUnits ?? 0) / velocityDays;

  if (!overview?.source) {
    return (
      <Page>
        <PageHeader icon={LayoutDashboard} title="Dashboard" subtitle="Citadel market overview" />
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-8 text-center">
          <Database className="w-8 h-8 text-amber-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-white">No market source configured</h2>
          <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
            Add the citadel you want to track and pick a character with docking access to read its market.
          </p>
          <Link
            to="/settings"
            className="inline-block mt-4 px-4 py-2 rounded-lg bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white text-sm font-medium"
          >
            Open Settings
          </Link>
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        subtitle={`${overview.source.name ?? overview.source.structureId} — polled ${formatRelative(overview.source.lastPolledAt)}`}
      />

      {overview.source.lastPollStatus === 'error' && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm">
          <span className="text-rose-400 font-medium">Last poll failed: </span>
          <span className="text-slate-300">{overview.source.lastPollError}</span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          title="Needs attention"
          value={counts.out + counts.critical}
          subtitle={`${counts.out} out, ${counts.critical} critical`}
          icon={AlertTriangle}
          variant={counts.out + counts.critical > 0 ? 'rose' : 'emerald'}
        />
        <StatCard title="Low stock" value={counts.low} icon={PackageX} variant="amber" />
        <StatCard
          title="Tracked items"
          value={overview.trackedCount}
          subtitle={`of ${overview.distinctItems} listed`}
          icon={Boxes}
          variant="blue"
        />
        <StatCard
          title="Traded (7d)"
          value={formatISK(velocity?.summary?.totalIsk ?? 0)}
          subtitle={`${overview.dataCoverageDays} days of history`}
          icon={TrendingUp}
          variant="violet"
        />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          title="Sell orders value"
          value={formatISK(book.sell.isk)}
          subtitle={`${book.sell.orders.toLocaleString()} orders`}
          icon={Tag}
          variant="emerald"
        />
        <StatCard
          title="Buy orders value"
          value={formatISK(book.buy.isk)}
          subtitle={`${book.buy.orders.toLocaleString()} orders`}
          icon={ShoppingCart}
          variant="blue"
        />
        <StatCard
          title="Units on sale / wanted"
          value={`${formatQtyCompact(book.sell.units)} / ${formatQtyCompact(book.buy.units)}`}
          subtitle={`${formatQty(book.sell.units)} sell / ${formatQty(book.buy.units)} buy`}
          icon={Layers}
          variant="slate"
        />
        <StatCard
          title="ISK moving per day"
          value={formatISK(iskPerDay)}
          subtitle={`${formatQty(Math.round(unitsPerDay))} units/day, ${velocityDays}-day avg`}
          icon={Activity}
          variant="violet"
        />
      </div>

      <section className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-white">Running low</h2>
          <Link to="/tracked" className="text-sm text-[#4A9EFF] hover:underline">
            View all tracked
          </Link>
        </div>
        <MarketTable
          rows={needsAttention}
          isLoading={isLoading}
          columns={['status', 'min', 'volume', 'cover']}
          onRowClick={(row) => setDetailTypeId(row.typeId)}
          emptyMessage="Everything tracked is above its minimum."
        />
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-white">Fastest movers (7 days)</h2>
          <Link to="/reports" className="text-sm text-[#4A9EFF] hover:underline">
            All reports
          </Link>
        </div>
        <div className="border border-slate-800 rounded-lg divide-y divide-slate-800/70">
          {movers.length === 0 && (
            <div className="py-8 text-center text-slate-500 text-sm">
              No sales recorded yet — the poller needs a little history first.
            </div>
          )}
          {movers.map((m) => (
            <button
              key={m.typeId}
              onClick={() => setDetailTypeId(m.typeId)}
              className="flex items-center justify-between gap-3 w-full px-3 py-2 text-sm hover:bg-slate-900/50 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src={`https://images.evetech.net/types/${m.typeId}/icon?size=32`}
                  alt=""
                  className="w-6 h-6 rounded"
                  loading="lazy"
                />
                <span className="text-slate-200 truncate">{m.itemName ?? `Type ${m.typeId}`}</span>
              </div>
              <div className="flex items-center gap-6 shrink-0 tnum">
                <span className="text-slate-400">{Math.round(m.unitsPerDay).toLocaleString()}/day</span>
                <span className="text-emerald-400">{formatISK(m.isk)}</span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <ItemDetailSheet typeId={detailTypeId} open={!!detailTypeId} onOpenChange={(v) => !v && setDetailTypeId(null)} />
    </Page>
  );
}
