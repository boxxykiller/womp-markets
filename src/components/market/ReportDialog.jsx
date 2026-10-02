import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { Copy, Loader2, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SortLabel } from '@/components/ui/SortLabel';
import { StatusBadge } from './MarketTable';
import { ItemHistoryView, VerdictBadge } from './ItemHistoryView';
import { useCart } from '@/hooks/useCart';
import { useDebounced } from '@/hooks/useDebounced';
import { useSort } from '@/hooks/useSort';
import { cn } from '@/lib/utils';
import {
  deltaClass,
  formatDateTime,
  formatDays,
  formatISK,
  formatPct,
  formatQty,
  formatRate,
  formatRelative,
} from '@/lib/format';
import { formatMultibuy } from '@/lib/multibuy';

const GRID = '#1E2D45';
const AXIS = { fontSize: 10, fill: '#64748b' };
const TOOLTIP_STYLE = { background: '#0D1829', border: '1px solid #1E2D45', borderRadius: 8, fontSize: 12 };

const STATUS_ORDER = ['out', 'critical', 'low', 'ok'];
const lineCost = (r) => (r.restockQuantity ?? 0) * (r.jitaBestSell ?? r.bestSell ?? 0);

// Every column a report can ask for, defined once. A report names the subset
// it wants rather than each one hand-rolling a table. `value` is the raw
// number behind the cell — what CSV exports and what the column sorts on
// (unless `sortValue` says otherwise) — and `first` is the direction a click
// sorts it in first: biggest first for amounts, soonest first for time left.
const COLUMNS = {
  status: {
    label: 'Status',
    value: (r) => r.status,
    sortValue: (r) => (r.status == null ? null : STATUS_ORDER.indexOf(r.status)),
    render: (r) => <StatusBadge status={r.status} />,
  },
  min: { label: 'Min', align: 'right', value: (r) => r.effectiveMin, render: (r) => formatQty(r.effectiveMin) },
  volume: { label: 'On market', align: 'right', value: (r) => r.sellVolume, render: (r) => formatQty(r.sellVolume) },
  buyVolume: { label: 'Buy depth', align: 'right', value: (r) => r.buyVolume, render: (r) => formatQty(r.buyVolume) },
  restock: {
    label: 'Restock',
    align: 'right',
    value: (r) => r.restockQuantity,
    render: (r) => <span className="text-amber-400 font-medium">{formatQty(r.restockQuantity)}</span>,
  },
  rate: { label: 'Sold/day', align: 'right', value: (r) => r.avgDaily30, render: (r) => formatRate(r.avgDaily30) },
  cover: {
    label: 'Days left',
    align: 'right',
    first: 'asc',
    value: (r) => r.daysOfCover30,
    render: (r) => formatDays(r.daysOfCover30),
  },
  stockoutAt: {
    label: 'Runs out',
    align: 'right',
    first: 'asc',
    value: (r) => r.stockoutAt,
    sortValue: (r) => (r.stockoutAt ? new Date(r.stockoutAt).getTime() : null),
    render: (r) => formatRelative(r.stockoutAt),
  },
  localBuy: { label: 'Local buy', align: 'right', value: (r) => r.bestBuy, render: (r) => formatISK(r.bestBuy) },
  localSell: { label: 'Local sell', align: 'right', value: (r) => r.bestSell, render: (r) => formatISK(r.bestSell) },
  jitaSell: { label: 'Jita sell', align: 'right', value: (r) => r.jitaBestSell, render: (r) => formatISK(r.jitaBestSell) },
  spread: {
    label: 'vs Jita',
    align: 'right',
    value: (r) => r.vsJitaSellPct,
    render: (r) => <span className={deltaClass(r.vsJitaSellPct)}>{formatPct(r.vsJitaSellPct, { signed: true })}</span>,
  },
  split: { label: 'Buy share', align: 'right', value: (r) => r.buySellSplit, render: (r) => formatPct(r.buySellSplit) },
  lineCost: { label: 'Est. cost', align: 'right', value: lineCost, render: (r) => formatISK(lineCost(r)) },
  iskTiedUp: { label: 'ISK tied up', align: 'right', value: (r) => r.iskTiedUp, render: (r) => formatISK(r.iskTiedUp) },
  unitsConfirmed: { label: 'Observed', align: 'right', value: (r) => r.unitsConfirmed, render: (r) => formatQty(r.unitsConfirmed) },
  unitsEstimated: { label: 'Inferred', align: 'right', value: (r) => r.unitsEstimated, render: (r) => formatQty(r.unitsEstimated) },
  units: { label: 'Units', align: 'right', value: (r) => r.units, render: (r) => formatQty(r.units) },
  sold: {
    label: 'Sold',
    align: 'right',
    value: (r) => r.units,
    render: (r) => <span className="text-amber-400 font-medium">{formatQty(r.units)}</span>,
  },
  isk: { label: 'ISK', align: 'right', value: (r) => r.isk, render: (r) => formatISK(r.isk) },
  perDay: { label: 'Per day', align: 'right', value: (r) => r.unitsPerDay, render: (r) => formatRate(r.unitsPerDay) },
  iskPerDay: { label: 'Est. ISK/day', align: 'right', value: (r) => r.iskPerDay, render: (r) => formatISK(r.iskPerDay) },
  // History columns — the moving-average window is whatever the report asked for.
  verdict: { label: 'Verdict', value: (r) => r.verdict, render: (r) => <VerdictBadge verdict={r.verdict} /> },
  maRate: { label: 'Sold/day (MA)', align: 'right', value: (r) => r.maPerDay, render: (r) => formatRate(r.maPerDay) },
  periodRate: { label: 'Sold/day (period)', align: 'right', value: (r) => r.periodPerDay, render: (r) => formatRate(r.periodPerDay) },
  volumeTrend: {
    label: 'Vol trend',
    align: 'right',
    value: (r) => r.volumeTrendPct,
    render: (r) => <span className={deltaClass(r.volumeTrendPct)}>{formatPct(r.volumeTrendPct, { signed: true })}</span>,
  },
  maPrice: { label: 'Sell (MA)', align: 'right', value: (r) => r.maPrice, render: (r) => formatISK(r.maPrice) },
  priceTrend: {
    label: 'Price trend',
    align: 'right',
    value: (r) => r.priceTrendPct,
    render: (r) => <span className={deltaClass(r.priceTrendPct)}>{formatPct(r.priceTrendPct, { signed: true })}</span>,
  },
  lastSale: {
    label: 'Last sale',
    align: 'right',
    first: 'asc',
    value: (r) => r.daysSinceSale,
    render: (r) => (r.daysSinceSale == null ? 'Never' : r.daysSinceSale === 0 ? 'Today' : `${r.daysSinceSale}d ago`),
  },
  historyCover: {
    label: 'Days left',
    align: 'right',
    first: 'asc',
    value: (r) => r.historyCover,
    render: (r) => formatDays(r.historyCover),
  },
  outOfStock: { label: 'Days sold out', align: 'right', value: (r) => r.daysOutOfStock, render: (r) => formatQty(r.daysOutOfStock) },
  jitaRate: { label: 'Jita sold/day (MA)', align: 'right', value: (r) => r.jitaMaPerDay, render: (r) => formatRate(r.jitaMaPerDay) },
};

function sortValue(row, key) {
  if (key === 'name') return row.itemName;
  const col = COLUMNS[key];
  if (!col) return null;
  return (col.sortValue ?? col.value)(row);
}

function toCsv(rows, columnKeys) {
  const header = ['Item', ...columnKeys.map((k) => COLUMNS[k].label)];
  const escape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

  // Raw values, not the display strings: a spreadsheet wants 1234567, not
  // "1.23M".
  const lines = rows.map((r) =>
    [r.itemName ?? `Type ${r.typeId}`, ...columnKeys.map((k) => COLUMNS[k].value(r) ?? '')].map(escape).join(','),
  );

  return [header.join(','), ...lines].join('\n');
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Clipboard is unavailable in this browser context.');
  }
}

/** The report's own filters: number boxes, dates and fixed-choice selectors. */
function FilterControls({ filters, params, setParams }) {
  // A filter can depend on another, e.g. dates that only apply to a custom period.
  const visible = (filters ?? []).filter((f) => !f.showWhen || f.showWhen(params));
  return visible.map((f) => (
    <label key={f.key} className="flex items-center gap-2 text-xs text-slate-400">
      {f.label}
      {f.type === 'date' ? (
        <Input
          type="date"
          value={params[f.key] ?? ''}
          onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
          className="w-36 h-8 bg-slate-900 border-slate-800 text-slate-200 tnum"
        />
      ) : f.type === 'select' ? (
        <Select value={String(params[f.key] ?? f.default)} onValueChange={(v) => setParams((p) => ({ ...p, [f.key]: v }))}>
          <SelectTrigger className="w-28 h-8 bg-slate-900 border-slate-800 text-slate-200">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[#0D1829] border-[#1E2D45]">
            {f.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          type="number"
          min="0"
          value={params[f.key] ?? ''}
          onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
          className="w-24 h-8 bg-slate-900 border-slate-800 tnum"
        />
      )}
    </label>
  ));
}

const sourceValue = (s, key) => (key === 'name' ? s.name ?? s.structureId : key === 'lastPolledAt' ? Date.parse(s.lastPolledAt) : s[key]);

/** Poll status and SDE builds — a different shape from the item reports. */
function HealthView({ data }) {
  const sourceSort = useSort(data.rows, sourceValue);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-3">
          <div className="text-xs text-[#4A7BA7]">Days with data</div>
          <div className="text-xl font-bold text-white tnum">{data.summary.daysWithData}</div>
        </div>
        <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-3">
          <div className="text-xs text-[#4A7BA7]">Events recorded</div>
          <div className="text-xl font-bold text-white tnum">{formatQty(data.summary.eventCount)}</div>
        </div>
        <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-3">
          <div className="text-xs text-[#4A7BA7]">Orders archived</div>
          <div className="text-xl font-bold text-white tnum">{formatQty(data.summary.archivedOrders)}</div>
        </div>
        <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-3">
          <div className="text-xs text-[#4A7BA7]">First data</div>
          <div className="text-sm font-medium text-white">{formatDateTime(data.summary.firstDataAt)}</div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Market sources</h3>
        <div className="border border-slate-800 rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-slate-800 hover:bg-transparent">
                <TableHead className="text-slate-400">
                  <SortLabel sort={sourceSort} sortKey="name">Source</SortLabel>
                </TableHead>
                <TableHead className="text-slate-400">
                  <SortLabel sort={sourceSort} sortKey="lastPollStatus">Status</SortLabel>
                </TableHead>
                <TableHead className="text-slate-400">
                  <SortLabel sort={sourceSort} sortKey="lastPolledAt" first="desc">Last poll</SortLabel>
                </TableHead>
                <TableHead className="text-slate-400">
                  <SortLabel sort={sourceSort} sortKey="pollIntervalMinutes">Interval</SortLabel>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sourceSort.rows.map((s) => (
                <TableRow key={s.id} className="border-slate-800">
                  <TableCell className="text-slate-200">{s.name ?? s.structureId}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'px-2 py-0.5 rounded-md text-xs font-medium',
                        s.lastPollStatus === 'ok'
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : s.lastPollStatus === 'error'
                            ? 'bg-rose-500/20 text-rose-400'
                            : 'bg-slate-700/40 text-slate-400',
                      )}
                      title={s.lastPollError ?? undefined}
                    >
                      {s.lastPollStatus}
                    </span>
                  </TableCell>
                  <TableCell className="text-slate-400">{formatRelative(s.lastPolledAt)}</TableCell>
                  <TableCell className="text-slate-400">{s.pollIntervalMinutes}m</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-white mb-2">Recent SDE builds</h3>
        <div className="space-y-1">
          {data.sdeBuilds.length === 0 && <div className="text-xs text-slate-600">No SDE build ingested yet.</div>}
          {data.sdeBuilds.map((b) => (
            <div key={b.buildNumber} className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60">
              <span className="text-slate-300 tnum">Build {b.buildNumber}</span>
              <span className="text-slate-500">{b.datasetCount} datasets</span>
              <span className="text-slate-600">{formatDateTime(b.ingestedAt)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReportDialog({ report, open, onOpenChange, onOpenItem }) {
  const { addItems } = useCart();
  const [search, setSearch] = useState('');
  const [params, setParams] = useState({});
  const [pickedItem, setPickedItem] = useState(null);
  const debouncedSearch = useDebounced(search);
  const isHistory = report?.kind === 'history';

  // Reset filters when a different report opens, so the previous report's
  // window doesn't silently carry over. A drill-down passes initialParams to
  // keep its period and average on purpose.
  useEffect(() => {
    if (!report) return;
    const defaults = {};
    for (const f of report.filters ?? []) defaults[f.key] = report.initialParams?.[f.key] ?? f.default;
    setParams(defaults);
    setSearch('');
    setPickedItem(report.initialItem ?? null);
    sort.reset();
  }, [report]);

  const { data, isLoading } = useQuery({
    queryKey: ['report', report?.key, params],
    queryFn: () => {
      const payload = { ...params };
      // The UI takes a readable percentage; the API works in fractions.
      if (payload.minAbsPct != null) payload.minAbsPct = Number(payload.minAbsPct) / 100;
      return api.invoke(report.handler, payload);
    },
    // The item history runs its own query once an item is picked.
    enabled: open && !!report && !isHistory,
  });

  const columnKeys = report?.columns ?? [];

  const filteredRows = useMemo(() => {
    const all = data?.rows ?? [];
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return all;
    return all.filter((r) => String(r.itemName ?? '').toLowerCase().includes(term));
  }, [data, debouncedSearch]);

  // Column sorting is local: every report returns its full result set. With
  // no column picked, rows keep the server's ranking.
  const sort = useSort(filteredRows, sortValue);
  const rows = sort.rows;

  const chartData = useMemo(
    () =>
      // The report's own top rows, whatever column the table is sorted by.
      filteredRows.slice(0, 12).map((r) => ({
        name: (r.itemName ?? `#${r.typeId}`).slice(0, 18),
        // The report's headline number, charted for the top rows — named by
        // the report where it has one, otherwise the first field present.
        value:
          (report?.chart ? r[report.chart] : null) ??
          r.restockQuantity ??
          r.iskTiedUp ??
          r.isk ??
          (r.daysOfCover30 != null && Number.isFinite(r.daysOfCover30) ? r.daysOfCover30 : null) ??
          r.sellVolume ??
          0,
      })),
    [filteredRows, report],
  );

  if (!report) return null;
  const isHealth = report.kind === 'health';
  const filterControls = <FilterControls filters={report.filters} params={params} setParams={setParams} />;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Sized to the browser window rather than a fixed width, so wide reports
          use the screen they have. The table takes whatever height is left and
          scrolls on its own, keeping its header and horizontal scrollbar in
          view instead of at the bottom of a long dialog. */}
      <DialogContent className="flex flex-col w-[calc(100vw-1rem)] sm:w-[calc(100vw-3rem)] max-w-[1800px] max-h-[94vh] p-4 sm:p-6 bg-[#0D1829] border-[#1E2D45] overflow-y-auto scrollbar-thin">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="text-white">{report.title}</DialogTitle>
          <DialogDescription className="text-slate-400">{report.description}</DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-[#4A9EFF]" />
          </div>
        )}

        {isHistory && (
          <ItemHistoryView params={params} picked={pickedItem} onPick={setPickedItem} controls={filterControls} />
        )}

        {!isLoading && data && isHealth && <HealthView data={data} />}

        {!isLoading && data && !isHealth && !isHistory && (
          <>
            <div className="shrink-0 flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter these results…"
                className="flex-1 min-w-[180px] bg-slate-900 border-slate-800 text-slate-200"
              />

              {filterControls}

              <Button
                size="sm"
                variant="outline"
                onClick={() => copyText(toCsv(rows, columnKeys), 'CSV')}
                className="border-slate-700 text-slate-300"
              >
                <Copy className="w-4 h-4 mr-2" />
                CSV
              </Button>

              {report.multibuy && (
                <Button
                  size="sm"
                  onClick={() => {
                    const items = rows
                      .filter((r) => (r.restockQuantity ?? 0) > 0)
                      .map((r) => ({
                        typeId: r.typeId,
                        itemName: r.itemName,
                        quantity: r.restockQuantity,
                        jitaBestSell: r.jitaBestSell,
                        jitaBestBuy: r.jitaBestBuy,
                        volumePerUnit: r.volumePerUnit,
                        bestSell: r.bestSell,
                      }));
                    if (items.length === 0) return toast.error('Nothing here needs restocking.');
                    addItems(items);
                    copyText(formatMultibuy(items), 'Multibuy');
                  }}
                  className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  To restock
                </Button>
              )}
            </div>

            <div className="shrink-0 text-xs text-slate-500">
              {rows.length} row{rows.length === 1 ? '' : 's'}
              {data.summary?.estimatedCost != null && ` · est. ${formatISK(data.summary.estimatedCost)} to restock`}
              {data.summary?.iskTiedUp != null && ` · ${formatISK(data.summary.iskTiedUp)} tied up`}
              {data.summary?.totalUnits != null && ` · ${formatQty(data.summary.totalUnits)} units`}
              {data.summary?.totalIsk != null && ` · ${formatISK(data.summary.totalIsk)} traded`}
              {data.summary?.to != null && ` · ${data.summary.from ?? 'first poll'} → ${data.summary.to} (UTC)`}
              {data.summary?.iskPerDay != null && ` · ${formatISK(data.summary.iskPerDay)}/day moved`}
              {!!data.summary?.soldOut && ` · ${data.summary.soldOut} sold out`}
              {data.summary?.counts &&
                ` · ${data.summary.counts.seed} to seed · ${data.summary.counts.stale} stale · ${data.summary.counts.ok} moving`}
              {data.summary?.coveredDays != null && ` · ${data.summary.coveredDays} polled days`}
              {data.summary?.maDays != null && ` · ${data.summary.maDays}-day MA`}
            </div>

            {chartData.length > 0 && (
              <div className="shrink-0 h-36 lg:h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                    <XAxis dataKey="name" tick={AXIS} angle={-35} textAnchor="end" interval={0} height={60} />
                    <YAxis tick={AXIS} width={52} />
                    <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="value" fill="#4A9EFF" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            <div className="min-h-[14rem] border border-slate-800 rounded-lg overflow-auto scrollbar-thin">
              <Table className="whitespace-nowrap">
                <TableHeader className="sticky top-0 z-20 bg-[#0D1829] shadow-[0_1px_0_#1E293B]">
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    {/* The item column stays pinned while the numbers scroll
                        sideways, so a row never loses its name. */}
                    <TableHead className="sticky left-0 z-10 bg-[#0D1829] text-slate-400 min-w-[160px]">
                      <SortLabel sort={sort} sortKey="name">Item</SortLabel>
                    </TableHead>
                    {columnKeys.map((k) => (
                      <TableHead
                        key={k}
                        className={cn('text-slate-400 px-3', COLUMNS[k].align === 'right' && 'text-right')}
                      >
                        <SortLabel
                          sort={sort}
                          sortKey={k}
                          first={COLUMNS[k].first ?? (COLUMNS[k].align === 'right' ? 'desc' : 'asc')}
                          align={COLUMNS[k].align}
                        >
                          {COLUMNS[k].label}
                        </SortLabel>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow className="border-slate-800">
                      <TableCell colSpan={columnKeys.length + 1} className="py-8 text-center text-slate-500 text-sm">
                        Nothing to report — that&apos;s usually good news.
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((r) => (
                    <TableRow
                      key={r.typeId}
                      className={cn('group border-slate-800', report.opensHistory && 'cursor-pointer hover:bg-slate-800/40')}
                      onClick={report.opensHistory ? () => onOpenItem?.({ typeId: r.typeId, name: r.itemName }, params) : undefined}
                      title={report.opensHistory ? 'Open item history' : undefined}
                    >
                      <TableCell className="sticky left-0 z-10 bg-[#0D1829] text-slate-200 py-1.5">
                        <div className="flex items-center gap-2 max-w-[240px] sm:max-w-[320px]">
                          <img
                            src={`https://images.evetech.net/types/${r.typeId}/icon?size=32`}
                            alt=""
                            className="w-5 h-5 rounded shrink-0"
                            loading="lazy"
                          />
                          <span className="truncate" title={r.itemName ?? undefined}>
                            {r.itemName ?? `Type ${r.typeId}`}
                          </span>
                        </div>
                      </TableCell>
                      {columnKeys.map((k) => (
                        <TableCell
                          key={k}
                          className={cn('text-slate-300 tnum px-3 py-1.5', COLUMNS[k].align === 'right' && 'text-right')}
                        >
                          {COLUMNS[k].render(r)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
