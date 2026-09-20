import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { Copy, Loader2, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusBadge } from './MarketTable';
import { useCart } from '@/hooks/useCart';
import { useDebounced } from '@/hooks/useDebounced';
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

// Every column a report can ask for, defined once. A report names the subset
// it wants rather than each one hand-rolling a table.
const COLUMNS = {
  status: { label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
  min: { label: 'Min', align: 'right', render: (r) => formatQty(r.effectiveMin) },
  volume: { label: 'On market', align: 'right', render: (r) => formatQty(r.sellVolume) },
  buyVolume: { label: 'Buy depth', align: 'right', render: (r) => formatQty(r.buyVolume) },
  restock: {
    label: 'Restock',
    align: 'right',
    render: (r) => <span className="text-amber-400 font-medium">{formatQty(r.restockQuantity)}</span>,
  },
  rate: { label: 'Sold/day', align: 'right', render: (r) => formatRate(r.avgDaily30) },
  cover: { label: 'Days left', align: 'right', render: (r) => formatDays(r.daysOfCover30) },
  stockoutAt: { label: 'Runs out', align: 'right', render: (r) => formatRelative(r.stockoutAt) },
  localBuy: { label: 'Local buy', align: 'right', render: (r) => formatISK(r.bestBuy) },
  localSell: { label: 'Local sell', align: 'right', render: (r) => formatISK(r.bestSell) },
  jitaSell: { label: 'Jita sell', align: 'right', render: (r) => formatISK(r.jitaBestSell) },
  spread: {
    label: 'vs Jita',
    align: 'right',
    render: (r) => <span className={deltaClass(r.vsJitaSellPct)}>{formatPct(r.vsJitaSellPct, { signed: true })}</span>,
  },
  split: { label: 'Buy share', align: 'right', render: (r) => formatPct(r.buySellSplit) },
  lineCost: {
    label: 'Est. cost',
    align: 'right',
    render: (r) => formatISK((r.restockQuantity ?? 0) * (r.jitaBestSell ?? r.bestSell ?? 0)),
  },
  iskTiedUp: { label: 'ISK tied up', align: 'right', render: (r) => formatISK(r.iskTiedUp) },
  unitsConfirmed: { label: 'Observed', align: 'right', render: (r) => formatQty(r.unitsConfirmed) },
  unitsEstimated: { label: 'Inferred', align: 'right', render: (r) => formatQty(r.unitsEstimated) },
  units: { label: 'Units', align: 'right', render: (r) => formatQty(r.units) },
  isk: { label: 'ISK', align: 'right', render: (r) => formatISK(r.isk) },
  perDay: { label: 'Per day', align: 'right', render: (r) => formatRate(r.unitsPerDay) },
};

function toCsv(rows, columnKeys) {
  const header = ['Item', ...columnKeys.map((k) => COLUMNS[k].label)];
  const escape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

  const lines = rows.map((r) => {
    // Raw values, not the display strings: a spreadsheet wants 1234567, not
    // "1.23M".
    const cells = columnKeys.map((k) => {
      switch (k) {
        case 'status': return r.status ?? '';
        case 'min': return r.effectiveMin ?? '';
        case 'volume': return r.sellVolume ?? '';
        case 'buyVolume': return r.buyVolume ?? '';
        case 'restock': return r.restockQuantity ?? '';
        case 'rate': return r.avgDaily30 ?? '';
        case 'cover': return r.daysOfCover30 ?? '';
        case 'stockoutAt': return r.stockoutAt ?? '';
        case 'localBuy': return r.bestBuy ?? '';
        case 'localSell': return r.bestSell ?? '';
        case 'jitaSell': return r.jitaBestSell ?? '';
        case 'spread': return r.vsJitaSellPct ?? '';
        case 'split': return r.buySellSplit ?? '';
        case 'lineCost': return (r.restockQuantity ?? 0) * (r.jitaBestSell ?? r.bestSell ?? 0);
        case 'iskTiedUp': return r.iskTiedUp ?? '';
        default: return r[k] ?? '';
      }
    });
    return [r.itemName ?? `Type ${r.typeId}`, ...cells].map(escape).join(',');
  });

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

/** Poll status and SDE builds — a different shape from the item reports. */
function HealthView({ data }) {
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
                <TableHead className="text-slate-400">Source</TableHead>
                <TableHead className="text-slate-400">Status</TableHead>
                <TableHead className="text-slate-400">Last poll</TableHead>
                <TableHead className="text-slate-400">Interval</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((s) => (
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

export function ReportDialog({ report, open, onOpenChange }) {
  const { addItems } = useCart();
  const [search, setSearch] = useState('');
  const [params, setParams] = useState({});
  const debouncedSearch = useDebounced(search);

  // Reset filters when a different report opens, so the previous report's
  // window doesn't silently carry over.
  useEffect(() => {
    if (!report) return;
    const defaults = {};
    for (const f of report.filters ?? []) defaults[f.key] = f.default;
    setParams(defaults);
    setSearch('');
  }, [report]);

  const { data, isLoading } = useQuery({
    queryKey: ['report', report?.key, params],
    queryFn: () => {
      const payload = { ...params };
      // The UI takes a readable percentage; the API works in fractions.
      if (payload.minAbsPct != null) payload.minAbsPct = Number(payload.minAbsPct) / 100;
      return api.invoke(report.handler, payload);
    },
    enabled: open && !!report,
  });

  const columnKeys = report?.columns ?? [];

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return all;
    return all.filter((r) => String(r.itemName ?? '').toLowerCase().includes(term));
  }, [data, debouncedSearch]);

  const chartData = useMemo(
    () =>
      rows.slice(0, 12).map((r) => ({
        name: (r.itemName ?? `#${r.typeId}`).slice(0, 18),
        // Whatever the report's headline number is, charted for the top rows.
        value:
          r.restockQuantity ??
          r.iskTiedUp ??
          r.isk ??
          (r.daysOfCover30 != null && Number.isFinite(r.daysOfCover30) ? r.daysOfCover30 : null) ??
          r.sellVolume ??
          0,
      })),
    [rows],
  );

  if (!report) return null;
  const isHealth = report.kind === 'health';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0D1829] border-[#1E2D45] max-w-5xl max-h-[88vh] overflow-y-auto scrollbar-thin">
        <DialogHeader>
          <DialogTitle className="text-white">{report.title}</DialogTitle>
          <DialogDescription className="text-slate-400">{report.description}</DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-[#4A9EFF]" />
          </div>
        )}

        {!isLoading && data && isHealth && <HealthView data={data} />}

        {!isLoading && data && !isHealth && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter these results…"
                className="flex-1 min-w-[200px] bg-slate-900 border-slate-800 text-slate-200"
              />

              {(report.filters ?? []).map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-xs text-slate-400">
                  {f.label}
                  <Input
                    type="number"
                    min="0"
                    value={params[f.key] ?? ''}
                    onChange={(e) => setParams((p) => ({ ...p, [f.key]: e.target.value }))}
                    className="w-24 h-8 bg-slate-900 border-slate-800 tnum"
                  />
                </label>
              ))}

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
                        bestSell: r.bestSell,
                      }));
                    if (items.length === 0) return toast.error('Nothing here needs restocking.');
                    addItems(items);
                    copyText(formatMultibuy(items), 'Multibuy');
                  }}
                  className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white"
                >
                  <ShoppingCart className="w-4 h-4 mr-2" />
                  To cart
                </Button>
              )}
            </div>

            <div className="text-xs text-slate-500">
              {rows.length} row{rows.length === 1 ? '' : 's'}
              {data.summary?.estimatedCost != null && ` · est. ${formatISK(data.summary.estimatedCost)} to restock`}
              {data.summary?.iskTiedUp != null && ` · ${formatISK(data.summary.iskTiedUp)} tied up`}
              {data.summary?.totalIsk != null && ` · ${formatISK(data.summary.totalIsk)} traded`}
            </div>

            {chartData.length > 0 && (
              <div className="h-44">
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

            <div className="border border-slate-800 rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-slate-800 hover:bg-transparent">
                    <TableHead className="text-slate-400 min-w-[180px]">Item</TableHead>
                    {columnKeys.map((k) => (
                      <TableHead
                        key={k}
                        className={cn('text-slate-400', COLUMNS[k].align === 'right' && 'text-right')}
                      >
                        {COLUMNS[k].label}
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
                    <TableRow key={r.typeId} className="border-slate-800">
                      <TableCell className="text-slate-200">
                        <div className="flex items-center gap-2">
                          <img
                            src={`https://images.evetech.net/types/${r.typeId}/icon?size=32`}
                            alt=""
                            className="w-5 h-5 rounded"
                            loading="lazy"
                          />
                          <span className="truncate">{r.itemName ?? `Type ${r.typeId}`}</span>
                        </div>
                      </TableCell>
                      {columnKeys.map((k) => (
                        <TableCell
                          key={k}
                          className={cn('text-slate-300 tnum', COLUMNS[k].align === 'right' && 'text-right')}
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
