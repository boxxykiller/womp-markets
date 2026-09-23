import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Copy, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useDebounced } from '@/hooks/useDebounced';
import { cn } from '@/lib/utils';
import {
  VERDICT_META,
  deltaClass,
  formatDays,
  formatISK,
  formatPct,
  formatQty,
  formatRate,
} from '@/lib/format';

const GRID = '#1E2D45';
const AXIS = { fontSize: 10, fill: '#64748b' };
const TOOLTIP_STYLE = { background: '#0D1829', border: '1px solid #1E2D45', borderRadius: 8, fontSize: 12 };

export function VerdictBadge({ verdict }) {
  const meta = VERDICT_META[verdict];
  if (!meta) return null;
  return <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium', meta.badge)}>{meta.label}</span>;
}

function Stat({ label, value, sub, className }) {
  return (
    <div className="rounded-lg bg-slate-900/50 border border-slate-800 p-3">
      <div className="text-xs text-[#4A7BA7]">{label}</div>
      <div className={cn('text-lg font-bold text-white tnum', className)}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function formatDay(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const LOCAL_CSV_KEYS = [
  'date', 'units', 'unitsConfirmed', 'unitsEstimated', 'unitsMA', 'isk',
  'lowSell', 'lowSellMA', 'highBuy', 'highBuyMA', 'sellVolume', 'sellVolumeMA', 'buyVolume', 'sellOrderCount',
];
const JITA_CSV_KEYS = ['date', 'volume', 'volumeMA', 'average', 'averageMA', 'highest', 'lowest', 'orderCount'];

function toCsv(rows, keys) {
  return [keys.join(','), ...rows.map((r) => keys.map((k) => r[k] ?? '').join(','))].join('\n');
}

async function copyCsv(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error('Clipboard is unavailable in this browser context.');
  }
}

/** SDE search box. The history is keyed by type id, so the item is picked, never typed. */
function ItemPicker({ picked, onPick }) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query);

  const { data, isFetching } = useQuery({
    queryKey: ['sde-search', debounced],
    queryFn: () => api.sde.search(debounced),
    enabled: debounced.trim().length >= 2,
  });
  const results = data?.results ?? [];

  if (picked) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-[240px] h-9 px-3 rounded-md bg-slate-900 border border-slate-800">
        <img src={`https://images.evetech.net/types/${picked.typeId}/icon?size=32`} alt="" className="w-5 h-5 rounded" />
        <span className="text-sm text-slate-200 truncate flex-1">{picked.name ?? `Type ${picked.typeId}`}</span>
        <button onClick={() => onPick(null)} className="text-slate-500 hover:text-slate-300" aria-label="Pick another item">
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-w-[240px]">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find an item…"
        autoFocus
        className="bg-slate-900 border-slate-800 text-slate-200 placeholder:text-slate-600"
      />
      {isFetching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-500" />}
      {results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto scrollbar-thin rounded-lg bg-[#0D1829] border border-[#1E2D45] shadow-xl">
          {results.map((r) => (
            <button
              key={r.typeId}
              onClick={() => {
                onPick({ typeId: r.typeId, name: r.name });
                setQuery('');
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-slate-300 hover:bg-slate-800/60"
            >
              <img src={`https://images.evetech.net/types/${r.typeId}/icon?size=32`} alt="" className="w-5 h-5 rounded" loading="lazy" />
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One item's stored daily history over the chosen period, with the chosen
 * moving average drawn over volume, price and stock. `controls` is the
 * dialog's period / average selectors, rendered beside the picker.
 */
export function ItemHistoryView({ params, picked, onPick, controls }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report', 'itemHistory', picked?.typeId, params],
    queryFn: () => api.invoke('reportItemHistory', { ...params, typeId: picked.typeId }),
    enabled: !!picked,
  });

  const s = data?.summary;
  const item = data?.item;
  const rows = data?.rows ?? [];
  const jitaRows = data?.jitaRows ?? [];
  const ma = s?.maDays ?? params.maDays;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ItemPicker picked={picked} onPick={onPick} />
        {controls}
        {rows.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyCsv(toCsv(rows, LOCAL_CSV_KEYS), 'CSV')}
            className="border-slate-700 text-slate-300"
          >
            <Copy className="w-4 h-4 mr-2" />
            CSV
          </Button>
        )}
        {jitaRows.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => copyCsv(toCsv(jitaRows, JITA_CSV_KEYS), 'Jita CSV')}
            className="border-slate-700 text-slate-300"
          >
            <Copy className="w-4 h-4 mr-2" />
            Jita CSV
          </Button>
        )}
      </div>

      {!picked && (
        <div className="py-10 text-center text-sm text-slate-500">
          Pick an item to see its daily volume, price and stock over the period.
        </div>
      )}

      {picked && isLoading && (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-5 h-5 animate-spin text-[#4A9EFF]" />
        </div>
      )}

      {data && s && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <VerdictBadge verdict={s.verdict} />
            <span>
              {s.coveredDays} polled day{s.coveredDays === 1 ? '' : 's'} in the period
              {s.firstDataAt && ` · from ${formatDay(s.firstDataAt)}`} · {ma}-day moving average
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              label={`Sold/day (${ma}d avg)`}
              value={formatRate(s.maPerDay)}
              sub={
                <>
                  Period {formatRate(s.periodPerDay)} ·{' '}
                  <span className={deltaClass(s.volumeTrendPct)}>{formatPct(s.volumeTrendPct, { signed: true })}</span>
                </>
              }
            />
            <Stat
              label={`Local sell (${ma}d avg)`}
              value={formatISK(s.maPrice)}
              sub={
                <>
                  Period {formatISK(s.avgPrice)} ·{' '}
                  <span className={deltaClass(s.priceTrendPct)}>{formatPct(s.priceTrendPct, { signed: true })}</span>
                </>
              }
            />
            <Stat
              label="On market now"
              value={formatQty(item.sellVolume)}
              sub={`${formatDays(s.maPerDay > 0 ? item.sellVolume / s.maPerDay : s.periodPerDay > 0 ? item.sellVolume / s.periodPerDay : null)} days of cover`}
            />
            <Stat
              label="Last sale"
              value={s.daysSinceSale == null ? 'Never' : s.daysSinceSale === 0 ? 'Today' : `${s.daysSinceSale}d ago`}
              sub={`${s.daysOutOfStock} day${s.daysOutOfStock === 1 ? '' : 's'} sold out in period`}
            />
            <Stat label="Units sold (period)" value={formatQty(s.periodUnits)} sub={`${formatISK(s.periodIsk)} ISK traded`} />
            <Stat label="Price range (period)" value={`${formatISK(s.minPrice)} – ${formatISK(s.maxPrice)}`} className="text-base" />
            <Stat label="Local sell now" value={formatISK(item.bestSell)} sub={`Jita ${formatISK(item.jitaBestSell)}`} />
            <Stat
              label="vs Jita sell"
              value={formatPct(item.vsJitaSellPct, { signed: true })}
              className={deltaClass(item.vsJitaSellPct)}
              sub={item.tracked ? 'Tracked' : 'Not tracked'}
            />
            <Stat
              label={`Jita sold/day (${ma}d avg)`}
              value={formatRate(s.jitaMaPerDay)}
              sub={`Period ${formatRate(s.jitaPerDay)}`}
            />
            <Stat
              label={`Jita avg price (${ma}d)`}
              value={formatISK(s.jitaMaPrice)}
              sub={
                <>
                  Period {formatISK(s.jitaAvgPrice)} ·{' '}
                  <span className={deltaClass(s.jitaPriceTrendPct)}>{formatPct(s.jitaPriceTrendPct, { signed: true })}</span>
                </>
              }
            />
          </div>

          {rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">No local history recorded in this period yet.</div>
          ) : (
            <>
              <section>
                <h3 className="text-sm font-semibold text-white mb-2">Units sold per day</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={rows}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="date" tick={AXIS} minTickGap={24} />
                      <YAxis tick={AXIS} width={48} />
                      <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatRate(v)} />
                      <Bar dataKey="unitsConfirmed" stackId="u" fill="#f59e0b" name="Observed" />
                      <Bar dataKey="unitsEstimated" stackId="u" fill="#f59e0b66" name="Inferred" />
                      <Line type="monotone" dataKey="unitsMA" stroke="#38bdf8" dot={false} strokeWidth={2} name={`${ma}d avg`} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-white mb-2">Price</h3>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={rows}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="date" tick={AXIS} minTickGap={24} />
                      <YAxis tick={AXIS} width={56} tickFormatter={(v) => formatISK(v, { decimals: 1 })} domain={['auto', 'auto']} />
                      <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatISK(v)} />
                      <Line type="stepAfter" dataKey="lowSell" stroke="#10b98188" dot={false} connectNulls={false} name="Low sell" />
                      <Line type="monotone" dataKey="lowSellMA" stroke="#10b981" dot={false} strokeWidth={2} name={`Sell ${ma}d avg`} />
                      <Line type="stepAfter" dataKey="highBuy" stroke="#f43f5e88" dot={false} connectNulls={false} name="High buy" />
                      <Line type="monotone" dataKey="highBuyMA" stroke="#f43f5e" dot={false} strokeWidth={2} name={`Buy ${ma}d avg`} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-white mb-2">Stock on market (end of day)</h3>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={rows}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                      <XAxis dataKey="date" tick={AXIS} minTickGap={24} />
                      <YAxis tick={AXIS} width={48} />
                      <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => formatQty(v)} />
                      <Area type="stepAfter" dataKey="sellVolume" stroke="#10b981" fill="#10b98133" name="Sell" />
                      <Line type="monotone" dataKey="sellVolumeMA" stroke="#a166ff" dot={false} strokeWidth={2} name={`${ma}d avg`} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold text-white mb-2">Daily history</h3>
                <div className="border border-slate-800 rounded-lg overflow-x-auto max-h-80 overflow-y-auto scrollbar-thin">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-800 hover:bg-transparent">
                        <TableHead className="text-slate-400">Date</TableHead>
                        <TableHead className="text-slate-400 text-right">Sold</TableHead>
                        <TableHead className="text-slate-400 text-right">{ma}d avg</TableHead>
                        <TableHead className="text-slate-400 text-right">Low sell</TableHead>
                        <TableHead className="text-slate-400 text-right">Sell {ma}d avg</TableHead>
                        <TableHead className="text-slate-400 text-right">High buy</TableHead>
                        <TableHead className="text-slate-400 text-right">On market</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...rows].reverse().map((r) => (
                        <TableRow key={r.date} className="border-slate-800">
                          <TableCell className="text-slate-300 tnum">{r.date}</TableCell>
                          <TableCell className="text-slate-300 tnum text-right">{formatQty(r.units)}</TableCell>
                          <TableCell className="text-sky-300 tnum text-right">{formatRate(r.unitsMA)}</TableCell>
                          <TableCell className="text-slate-300 tnum text-right">{formatISK(r.lowSell)}</TableCell>
                          <TableCell className="text-emerald-300 tnum text-right">{formatISK(r.lowSellMA)}</TableCell>
                          <TableCell className="text-slate-300 tnum text-right">{formatISK(r.highBuy)}</TableCell>
                          <TableCell className="text-slate-300 tnum text-right">{formatQty(r.sellVolume)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>
            </>
          )}

          {jitaRows.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-white mb-2">Jita (The Forge) volume and average price</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={jitaRows}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
                    <XAxis dataKey="date" tick={AXIS} minTickGap={24} />
                    <YAxis yAxisId="vol" tick={AXIS} width={48} tickFormatter={(v) => formatISK(v, { decimals: 0 })} />
                    <YAxis
                      yAxisId="price"
                      orientation="right"
                      tick={AXIS}
                      width={56}
                      tickFormatter={(v) => formatISK(v, { decimals: 1 })}
                      domain={['auto', 'auto']}
                    />
                    <RechartsTooltip
                      contentStyle={TOOLTIP_STYLE}
                      formatter={(v, name) => (String(name).startsWith('Volume') ? formatRate(v) : formatISK(v))}
                    />
                    <Bar yAxisId="vol" dataKey="volume" fill="#4A9EFF55" name="Volume" />
                    <Line yAxisId="vol" type="monotone" dataKey="volumeMA" stroke="#4A9EFF" dot={false} strokeWidth={2} name={`Volume ${ma}d avg`} />
                    <Line yAxisId="price" type="monotone" dataKey="averageMA" stroke="#f59e0b" dot={false} strokeWidth={2} name={`Price ${ma}d avg`} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
