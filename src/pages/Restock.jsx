import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Check, ChevronDown, ClipboardPaste, Copy, Loader2, Package, RotateCcw, Search, Tags, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCart } from '@/hooks/useCart';
import { formatISK, formatISKFull, formatQty } from '@/lib/format';
import { formatMultibuy, parseMultibuy } from '@/lib/multibuy';
import { cn } from '@/lib/utils';

// ── Calculator settings ──────────────────────────────────────────────────────
// Remembered per browser: they describe how this person hauls and trades, and
// re-typing a freight rate on every visit is exactly the friction to avoid.

const SETTINGS_KEY = 'womp.restock.calc.v1';
const DEFAULTS = {
  shippingRate: 650,
  collateralPct: 1,
  buyBrokerFee: 3,
  sellBrokerFee: 3,
  sccSurcharge: 0.5,
  salesTax: 3.6,
  markupPct: 10,
  // Buy side priced off Jita sell orders (buy now) instead of Jita buy
  // orders (place an order and wait).
  buyAtJitaSell: false,
};

function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    const saved = JSON.parse(raw);
    // Earlier versions had one broker fee for both sides; carry it over to
    // each rather than silently resetting someone's number.
    if (saved.brokerFee != null) {
      saved.buyBrokerFee ??= saved.brokerFee;
      saved.sellBrokerFee ??= saved.brokerFee;
      delete saved.brokerFee;
    }
    return { ...DEFAULTS, ...saved };
  } catch {
    return DEFAULTS;
  }
}

// ── Margin math ──────────────────────────────────────────────────────────────
//
// Buy side:  Net Buy  = Jita Buy + buy broker fee + shipping
//            shipping = m³ × rate  +  collateral fee (a % of the Jita Sell
//            value, which is what a courier contract is collateralised at)
// Sell side: list price = Jita Sell + markup (a % of Jita Sell)
//            Net Sell   = list price − sell broker fee − SCC surcharge
//                         − sales tax, each charged on the list price
// Profit:    Net Sell − Net Buy

function calcItem(item, s) {
  const qty = item.quantity || 0;
  const sell = item.jitaBestSell ?? 0;
  const buy = s.buyAtJitaSell ? sell : (item.jitaBestBuy ?? 0);
  const m3 = item.volumePerUnit ?? 0;

  // Buying straight off sell orders is an instant purchase: no order is
  // placed, so there's no broker fee.
  const brokerBuy = s.buyAtJitaSell ? 0 : buy * (s.buyBrokerFee / 100);
  const freight = m3 * s.shippingRate;
  const collateralFee = sell * (s.collateralPct / 100);
  const netBuy = buy + brokerBuy + freight + collateralFee;

  const markup = sell * (s.markupPct / 100);
  const listPrice = sell + markup;
  const brokerSell = listPrice * (s.sellBrokerFee / 100);
  const scc = listPrice * (s.sccSurcharge / 100);
  const tax = listPrice * (s.salesTax / 100);
  const sellFees = brokerSell + scc + tax;
  const netSell = listPrice - sellFees;

  const profit = netSell - netBuy;

  const unit = {
    grossBuy: buy, grossSell: sell, brokerBuy, freight, collateralFee, netBuy,
    markup, listPrice, brokerSell, scc, tax, sellFees, netSell, profit,
  };
  const line = Object.fromEntries(Object.entries(unit).map(([k, v]) => [k, v * qty]));
  return { qty, m3: m3 * qty, collateral: sell * qty, unit, line, missing: item.jitaBestBuy == null && item.jitaBestSell == null };
}

/**
 * Fills an item's Jita prices from the live quote, falling back per side.
 *
 * Roughly one item in seven has orders on only one side at Jita 4-4, and
 * pricing the empty side at zero wrecks the margin. With no buy orders, the
 * realistic restock cost is the Jita sell price (you'd buy off the sell
 * orders); with no sell orders, CCP's universe-wide average stands in. Each
 * fallback is flagged so the table can mark it as an estimate.
 */
function resolvePrices(raw, q) {
  const buy = q?.jitaBestBuy ?? raw.jitaBestBuy ?? null;
  const sell = q?.jitaBestSell ?? raw.jitaBestSell ?? null;
  const avg = q?.averagePrice ?? null;

  const item = {
    ...raw,
    jitaBestBuy: buy ?? sell ?? avg,
    jitaBestSell: sell ?? avg ?? buy,
    volumePerUnit: q?.volumePerUnit ?? raw.volumePerUnit,
  };
  const est = {
    buy: buy == null && item.jitaBestBuy != null ? (sell != null ? 'No Jita buy orders — using Jita sell' : 'No Jita orders — using CCP average price') : null,
    sell: sell == null && item.jitaBestSell != null ? (avg != null ? 'No Jita sell orders — using CCP average price' : 'No Jita sell orders — using Jita buy') : null,
  };
  return { item, est };
}

function Estimated({ note, children }) {
  if (!note) return children;
  return (
    <span title={note} className="cursor-help">
      <span className="text-amber-400/80 mr-0.5">≈</span>
      {children}
    </span>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

function CalcField({ label, value, onChange, unit, step }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-400 mb-1.5">{label}</span>
      <div className="relative">
        <Input
          type="number"
          min="0"
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="h-9 bg-slate-950/60 border-slate-700 tnum text-right pr-14"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500 pointer-events-none">
          {unit}
        </span>
      </div>
    </label>
  );
}

function Line({ label, hint, value, sign, total, tone }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 py-1.5',
        total && 'mt-1 pt-2.5 border-t border-slate-700/70',
      )}
    >
      <div className="min-w-0">
        <span className={cn('text-sm', total ? 'font-semibold text-white' : 'text-slate-300')}>{label}</span>
        {hint && <span className="ml-2 text-xs text-slate-500">{hint}</span>}
      </div>
      <span
        className={cn('tnum text-sm whitespace-nowrap', total ? 'font-semibold' : '', tone ?? 'text-slate-200')}
        title={formatISKFull(value)}
      >
        {sign && <span className="text-slate-500 mr-1">{sign}</span>}
        {formatISK(value)}
      </span>
    </div>
  );
}

function Receipt({ title, children }) {
  return (
    <div className="rounded-lg bg-slate-950/40 border border-slate-800 px-4 py-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1">{title}</div>
      {children}
    </div>
  );
}

/**
 * The empty state doubles as an import: paste a multibuy (or a stock export)
 * and it's priced like any list built from the Tracked page. Names that don't
 * resolve are listed rather than dropped, so a typo doesn't quietly shrink
 * the haul.
 */
function PasteList({ onAdd }) {
  const [text, setText] = useState('');
  const [unmatched, setUnmatched] = useState([]);

  const resolve = useMutation({
    mutationFn: async () => {
      const parsed = parseMultibuy(text);
      if (parsed.length === 0) throw new Error('Nothing to price — paste some lines first.');

      // A bare name is one unit, as in EVE's own multibuy; repeated lines add up.
      const qtyByName = new Map();
      for (const p of parsed) {
        const key = p.name.trim().toLowerCase();
        qtyByName.set(key, (qtyByName.get(key) ?? 0) + (p.quantity > 0 ? p.quantity : 1));
      }

      const { matched, unmatched } = await api.sde.resolveNames([...new Set(parsed.map((p) => p.name.trim()))]);
      return {
        items: matched.map((m) => ({
          typeId: m.typeId,
          itemName: m.name,
          quantity: qtyByName.get(m.name.toLowerCase()) ?? 1,
        })),
        unmatched,
      };
    },
    onSuccess: ({ items, unmatched }) => {
      setUnmatched(unmatched);
      if (items.length === 0) return toast.error('None of those lines matched an item.');
      onAdd(items);
      toast.success(`Added ${items.length} item${items.length === 1 ? '' : 's'} to price`);
      if (unmatched.length > 0) {
        toast.warning(`${unmatched.length} line${unmatched.length === 1 ? '' : 's'} didn't match: ${unmatched.slice(0, 3).join(', ')}${unmatched.length > 3 ? '…' : ''}`);
      }
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="text-center mb-5">
        <Package className="w-8 h-8 text-slate-700 mx-auto mb-3" />
        <p className="text-slate-400">Your restock list is empty.</p>
        <p className="text-sm text-slate-600 mt-1">
          Select items on the Tracked page and add them here — or paste a multibuy list below to price it.
        </p>
      </div>

      <div className="max-w-2xl mx-auto">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={'Tritanium\t1000000\nPyerite\t500000\nMedium Shield Extender II\t20'}
          className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-sm text-slate-200 font-mono scrollbar-thin focus:outline-none focus:border-[#4A9EFF]"
        />
        {unmatched.length > 0 && (
          <div className="mt-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
            <div className="flex items-center gap-2 text-amber-400 text-sm font-medium mb-1">
              <AlertTriangle className="w-4 h-4" />
              {unmatched.length} line{unmatched.length === 1 ? '' : 's'} didn&apos;t match an item
            </div>
            <div className="text-xs text-amber-300/80 font-mono max-h-24 overflow-y-auto scrollbar-thin">
              {unmatched.map((n, i) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 mt-3">
          <span className="text-xs text-slate-500">
            One item per line, name then quantity. Stock-export lines use the target as the quantity.
          </span>
          <Button
            onClick={() => resolve.mutate()}
            disabled={resolve.isPending || !text.trim()}
            className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white shrink-0"
          >
            {resolve.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardPaste className="w-4 h-4 mr-2" />}
            Price this list
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Restock() {
  const { items, addItems, setQuantity, removeItem, clear, remapTypes } = useCart();
  const [settings, setSettings] = useState(readSettings);
  const [perUnit, setPerUnit] = useState(false);
  const [filter, setFilter] = useState('');
  // Adding a whole tracked list brings in every healthy item at quantity 0.
  // Those rows are all 0.00 in line-total view, which reads as "no price",
  // so they're hidden by default.
  const [hideZero, setHideZero] = useState(true);
  const [copied, setCopied] = useState(null); // 'multibuy' | 'prices' | null

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Blocked storage just means the defaults come back next visit.
    }
  }, [settings]);

  const set = (key) => (value) => setSettings((s) => ({ ...s, [key]: value }));

  // Live Jita prices and packaged volume, rather than the snapshot stored when
  // each item was added — that snapshot is often empty and always ages. The
  // server fetches anything missing or stale from Jita on the spot. (Packaged
  // volume matters because the SDE volume is the assembled size, which
  // overstates ships roughly tenfold.)
  const typeIds = useMemo(() => items.map((i) => i.typeId).sort((a, b) => a - b), [items]);
  const { data: quoteData, isFetching: quotesLoading, isError: quotesFailed } = useQuery({
    queryKey: ['restock-quotes', typeIds],
    queryFn: () => api.invoke('getRestockQuotes', { typeIds }),
    enabled: typeIds.length > 0,
    staleTime: 5 * 60_000,
    // The server answers within ~15s with whatever it has and keeps
    // refreshing behind that, so re-ask soon while anything is still bare.
    refetchInterval: (query) => {
      const quotes = Object.values(query.state.data?.quotes ?? {});
      return quotes.some((q) => q.jitaBestBuy == null && q.jitaBestSell == null) ? 30_000 : 5 * 60_000;
    },
    placeholderData: (prev) => prev,
  });

  // The server prices a non-market duplicate as the real item and says so;
  // fix the stored type id too, so the icon, links and re-adds line up.
  useEffect(() => {
    const remap = {};
    for (const [from, q] of Object.entries(quoteData?.quotes ?? {})) {
      if (q.resolvedTypeId) remap[from] = q.resolvedTypeId;
    }
    if (Object.keys(remap).length > 0) remapTypes(remap);
  }, [quoteData, remapTypes]);

  const rows = useMemo(
    () =>
      items.map((raw) => {
        const { item, est } = resolvePrices(raw, quoteData?.quotes?.[raw.typeId]);
        return { item, est, c: calcItem(item, settings) };
      }),
    [items, settings, quoteData],
  );

  const totals = useMemo(() => {
    const t = { units: 0, m3: 0, collateral: 0, missing: [], estimated: 0 };
    for (const { item, est, c } of rows) {
      if (est.buy || est.sell) t.estimated += 1;
      t.units += c.qty;
      t.m3 += c.m3;
      t.collateral += c.collateral;
      if (c.missing) t.missing.push(`${item.itemName ?? 'Type'} (#${item.typeId})`);
      for (const [k, v] of Object.entries(c.line)) t[k] = (t[k] ?? 0) + v;
    }
    t.marginPct = t.netBuy > 0 ? t.profit / t.netBuy : null;
    return t;
  }, [rows]);

  const zeroCount = useMemo(() => rows.filter(({ c }) => c.qty === 0).length, [rows]);

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return rows.filter(
      ({ item, c }) =>
        (!hideZero || c.qty > 0) && (!q || String(item.itemName ?? '').toLowerCase().includes(q)),
    );
  }, [rows, filter, hideZero]);

  function removeZeroQty() {
    for (const { item, c } of rows) if (c.qty === 0) removeItem(item.typeId);
    toast.success(`Removed ${zeroCount} item${zeroCount === 1 ? '' : 's'} with quantity 0`);
  }

  const multibuyText = useMemo(() => formatMultibuy(items), [items]);

  // "Item Name<TAB>price" per line: Net Sell per unit (Jita sell plus
  // markup, less sell fees).
  // Same items as the multibuy (quantity above 0), and plain numbers with no
  // separators so it pastes cleanly into a spreadsheet.
  const priceSheetText = useMemo(
    () =>
      rows
        .filter(({ c }) => c.qty > 0 && c.unit.netSell > 0)
        .map(({ item, c }) => `${String(item.itemName ?? `Type ${item.typeId}`).trim()}\t${c.unit.netSell.toFixed(2)}`)
        .join('\n'),
    [rows],
  );

  async function copyText(key, text, success) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast.success(success);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be blocked outright; the multibuy is in the
      // "Multibuy text" panel below to copy by hand.
      toast.error('Could not copy automatically — clipboard access is blocked in this browser.');
    }
  }

  const copyMultibuy = () => copyText('multibuy', multibuyText, 'Multibuy copied — paste it into EVE');
  const copyPriceSheet = () => {
    if (!priceSheetText) return toast.error('No priced items with a quantity to copy.');
    copyText('prices', priceSheetText, 'Price sheet copied — item name and Net Sell per unit');
  };

  const header = (
    <PageHeader
      icon={Package}
      accent="violet"
      title="Restock"
      subtitle="Price a haul from Jita, check the margin, then paste the multibuy into EVE"
    >
      {items.length > 0 && (
        <>
          <Button variant="outline" onClick={clear} className="border-slate-700 text-slate-300">
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
          <Button variant="outline" onClick={copyPriceSheet} className="border-slate-700 text-slate-300">
            {copied === 'prices' ? <Check className="w-4 h-4 mr-2" /> : <Tags className="w-4 h-4 mr-2" />}
            {copied === 'prices' ? 'Copied' : 'Copy price sheet'}
          </Button>
          <Button onClick={copyMultibuy} className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
            {copied === 'multibuy' ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
            {copied === 'multibuy' ? 'Copied' : 'Copy multibuy'}
          </Button>
        </>
      )}
    </PageHeader>
  );

  if (items.length === 0) {
    return (
      <Page>
        {header}
        <PasteList onAdd={addItems} />
      </Page>
    );
  }

  const v = (c) => (perUnit ? c.unit : c.line);

  return (
    <Page>
      {header}

      {/* ── Headline numbers ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          title="Items"
          value={items.length}
          subtitle={`${formatQty(totals.units)} units · ${formatQty(totals.m3)} m³`}
          variant="violet"
        />
        <StatCard
          title="Net Buy"
          value={formatISK(totals.netBuy)}
          subtitle={`Landed cost: Jita ${settings.buyAtJitaSell ? 'sell' : 'buy'} + fees + shipping`}
          variant="amber"
        />
        <StatCard
          title="Net Sell"
          value={formatISK(totals.netSell)}
          subtitle={`Jita sell + ${settings.markupPct}% markup, less sell fees`}
          variant="blue"
        />
        <StatCard
          title="Profit"
          value={formatISK(totals.profit)}
          subtitle={
            totals.marginPct != null
              ? `${totals.marginPct >= 0 ? '+' : ''}${(totals.marginPct * 100).toFixed(1)}% on Net Buy`
              : 'Net Sell − Net Buy'
          }
          variant={totals.profit >= 0 ? 'emerald' : 'rose'}
        />
      </div>

      {/* ── Margin calculator ────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Margin calculator</h2>
          <button
            onClick={() => setSettings(DEFAULTS)}
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Inputs */}
          <div className="lg:col-span-4 grid grid-cols-2 gap-x-3 gap-y-4 content-start">
            <div className="col-span-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 -mb-2">
              Buying
            </div>
            <label className="col-span-2 flex items-center justify-between gap-3 cursor-pointer">
              <span>
                <span className="block text-sm text-slate-200">Buy at Jita sell</span>
                <span className="block text-xs text-slate-500">
                  {settings.buyAtJitaSell
                    ? 'Buying off sell orders now — no buy broker fee'
                    : 'Placing buy orders at the Jita buy price'}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.buyAtJitaSell}
                onClick={() => set('buyAtJitaSell')(!settings.buyAtJitaSell)}
                className={cn(
                  'relative w-10 h-6 rounded-full shrink-0 transition-colors',
                  settings.buyAtJitaSell ? 'bg-[#4A9EFF]' : 'bg-slate-700',
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform',
                    settings.buyAtJitaSell && 'translate-x-4',
                  )}
                />
              </button>
            </label>

            <div className="col-span-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 -mb-2 mt-1">
              Shipping
            </div>
            <CalcField label="Rate per m³" value={settings.shippingRate} onChange={set('shippingRate')} unit="ISK" step={50} />
            <CalcField label="Collateral fee" value={settings.collateralPct} onChange={set('collateralPct')} unit="%" step={0.1} />

            <div className="col-span-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 -mb-2 mt-1">
              Market fees
            </div>
            <CalcField label="Buy broker fee" value={settings.buyBrokerFee} onChange={set('buyBrokerFee')} unit="%" step={0.1} />
            <CalcField label="Sell broker fee" value={settings.sellBrokerFee} onChange={set('sellBrokerFee')} unit="%" step={0.1} />
            <CalcField label="SCC surcharge" value={settings.sccSurcharge} onChange={set('sccSurcharge')} unit="%" step={0.1} />
            <CalcField label="Tax rate" value={settings.salesTax} onChange={set('salesTax')} unit="%" step={0.1} />

            <div className="col-span-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 -mb-2 mt-1">
              Pricing
            </div>
            <CalcField label="Markup" value={settings.markupPct} onChange={set('markupPct')} unit="%" step={0.5} />
          </div>

          {/* Breakdown */}
          <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-3 content-start">
            <Receipt title="Buy side">
              <Line label="Gross Buy" hint={settings.buyAtJitaSell ? 'Jita sell' : 'Jita buy'} value={totals.grossBuy} />
              <Line
                label="Buy broker fee"
                hint={settings.buyAtJitaSell ? 'none on instant buys' : `${settings.buyBrokerFee}%`}
                value={totals.brokerBuy}
                sign="+"
              />
              <Line
                label="Freight"
                hint={`${formatQty(totals.m3)} m³ × ${formatISK(settings.shippingRate, { decimals: 0 })}`}
                value={totals.freight}
                sign="+"
              />
              <Line
                label="Collateral fee"
                hint={`${settings.collateralPct}% of ${formatISK(totals.collateral)}`}
                value={totals.collateralFee}
                sign="+"
              />
              <Line label="Net Buy" value={totals.netBuy} total tone="text-amber-400" />
            </Receipt>

            <Receipt title="Sell side">
              <Line label="Gross Sell" hint="Jita sell" value={totals.grossSell} />
              <Line label="Markup" hint={`${settings.markupPct}%`} value={totals.markup} sign="+" />
              <Line label="List price" value={totals.listPrice} total />
              <Line label="Sell broker fee" hint={`${settings.sellBrokerFee}%`} value={totals.brokerSell} sign="−" />
              <Line label="SCC surcharge" hint={`${settings.sccSurcharge}%`} value={totals.scc} sign="−" />
              <Line label="Sales tax" hint={`${settings.salesTax}%`} value={totals.tax} sign="−" />
              <Line label="Net Sell" value={totals.netSell} total tone="text-sky-400" />
              <Line
                label="Profit"
                hint="Net Sell − Net Buy"
                value={totals.profit}
                tone={totals.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}
              />
            </Receipt>

            <div className="md:col-span-2 space-y-1 text-xs">
              {quotesFailed && (
                <p className="text-rose-400">
                  Couldn&apos;t load live Jita prices — showing the prices saved when items were added.
                </p>
              )}
              {quotesLoading && !quoteData && <p className="text-slate-500">Fetching live Jita prices…</p>}
              {quoteData && totals.estimated > 0 && (
                <p className="text-slate-500">
                  <span className="text-amber-400/80">≈</span> {totals.estimated} item
                  {totals.estimated === 1 ? ' has' : 's have'} orders on only one side at Jita 4-4; the other side is
                  estimated (hover a ≈ price for its source).
                </p>
              )}
              {quoteData && totals.missing.length > 0 && (
                <p className="text-amber-400/80">
                  No price anywhere for {totals.missing.slice(0, 5).join(', ')}
                  {totals.missing.length > 5 ? ` and ${totals.missing.length - 5} more` : ''} — counted as zero.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── Items ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">
            Items{' '}
            <span className="text-slate-500 font-normal">
              ({items.length - zeroCount} to buy{zeroCount > 0 && ` · ${zeroCount} at quantity 0`})
            </span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {zeroCount > 0 && (
              <>
                <button
                  onClick={() => setHideZero((h) => !h)}
                  className="h-8 px-2.5 rounded-lg border border-slate-700 text-xs text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {hideZero ? `Show ${zeroCount} at 0` : 'Hide quantity 0'}
                </button>
                <button
                  onClick={removeZeroQty}
                  className="h-8 px-2.5 rounded-lg border border-rose-500/30 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors"
                >
                  Remove quantity 0
                </button>
              </>
            )}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter items"
                className="h-8 w-44 pl-8 bg-slate-950/60 border-slate-700 text-sm"
              />
            </div>
            <div className="flex rounded-lg border border-slate-700 p-0.5 text-xs">
              {[
                [false, 'Line total'],
                [true, 'Per unit'],
              ].map(([val, label]) => (
                <button
                  key={label}
                  onClick={() => setPerUnit(val)}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-colors',
                    perUnit === val ? 'bg-[#4A9EFF]/20 text-[#4A9EFF]' : 'text-slate-400 hover:text-slate-200',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Around ten rows tall; the rest scroll under a pinned header and
            totals row, with the scrollbar on the right. */}
        <div className="max-h-[520px] overflow-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-[#0D1829]">
              <tr className="text-xs text-slate-400 border-b border-slate-800">
                <th className="text-left font-medium px-4 h-10 min-w-[220px]">Item</th>
                <th className="text-right font-medium px-2 w-28">Qty</th>
                <th className="text-right font-medium px-2">m³</th>
                <th className="text-right font-medium px-2">Gross Buy</th>
                <th className="text-right font-medium px-2">Gross Sell</th>
                <th className="text-right font-medium px-2">Net Buy</th>
                <th className="text-right font-medium px-2">Net Sell</th>
                <th className="text-right font-medium px-2">Profit</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(({ item, est, c }) => {
                // A zero line total says nothing; show what one unit costs
                // instead, dimmed, so a quantity can be chosen from it.
                const zero = c.qty === 0;
                const x = zero ? c.unit : v(c);
                return (
                  <tr
                    key={item.typeId}
                    className={cn(
                      'border-b border-slate-800/70 hover:bg-slate-800/30',
                      zero && '[&>td:nth-child(n+3)]:opacity-50',
                    )}
                    title={zero ? 'Quantity 0 — prices shown per unit' : undefined}
                  >
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`}
                          alt=""
                          className="w-6 h-6 rounded shrink-0"
                          loading="lazy"
                        />
                        <span className="truncate text-slate-200 font-medium">{item.itemName ?? `Type ${item.typeId}`}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Input
                        type="number"
                        min="0"
                        value={item.quantity}
                        onChange={(e) => setQuantity(item.typeId, e.target.value)}
                        className="h-7 w-24 ml-auto text-right bg-slate-950/60 border-slate-700 tnum"
                      />
                    </td>
                    <td className="px-2 text-right tnum text-slate-500">
                      {item.volumePerUnit == null ? '—' : formatQty(perUnit ? item.volumePerUnit : c.m3)}
                    </td>
                    <td
                      className="px-2 text-right tnum text-slate-300"
                      title={(settings.buyAtJitaSell ? est.sell : est.buy) ?? formatISKFull(x.grossBuy)}
                    >
                      <Estimated note={settings.buyAtJitaSell ? est.sell : est.buy}>{formatISK(x.grossBuy)}</Estimated>
                    </td>
                    <td className="px-2 text-right tnum text-slate-300" title={est.sell ?? formatISKFull(x.grossSell)}>
                      <Estimated note={est.sell}>{formatISK(x.grossSell)}</Estimated>
                    </td>
                    <td
                      className="px-2 text-right tnum text-amber-400"
                      title={`${formatISKFull(x.netBuy)} — broker ${formatISK(x.brokerBuy)}, freight ${formatISK(x.freight)}, collateral ${formatISK(x.collateralFee)}`}
                    >
                      {formatISK(x.netBuy)}
                    </td>
                    <td
                      className="px-2 text-right tnum text-sky-400"
                      title={`${formatISKFull(x.netSell)} — list ${formatISK(x.listPrice)} (Jita sell + ${formatISK(x.markup)} markup), less broker ${formatISK(x.brokerSell)}, SCC ${formatISK(x.scc)}, tax ${formatISK(x.tax)}`}
                    >
                      {formatISK(x.netSell)}
                    </td>
                    <td
                      className={cn('px-2 text-right tnum font-medium', x.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}
                      title={formatISKFull(x.profit)}
                    >
                      {formatISK(x.profit)}
                    </td>
                    <td className="pr-3 text-right">
                      <button
                        onClick={() => removeItem(item.typeId)}
                        className="p-1 text-slate-600 hover:text-rose-400 transition-colors"
                        aria-label={`Remove ${item.itemName}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-sm text-slate-500">
                    {filter.trim()
                      ? <>No items match &ldquo;{filter}&rdquo;.</>
                      : `Every item is at quantity 0 — set a quantity, or show the ${zeroCount} hidden items.`}
                  </td>
                </tr>
              )}
            </tbody>
            {!perUnit && (
              <tfoot className="sticky bottom-0 bg-[#0D1829]">
                <tr className="border-t border-slate-700 text-sm font-semibold">
                  <td className="px-4 h-10 text-slate-300">Total</td>
                  <td className="px-2 text-right tnum text-slate-300">{formatQty(totals.units)}</td>
                  <td className="px-2 text-right tnum text-slate-500">{formatQty(totals.m3)}</td>
                  <td className="px-2 text-right tnum text-slate-200">{formatISK(totals.grossBuy)}</td>
                  <td className="px-2 text-right tnum text-slate-200">{formatISK(totals.grossSell)}</td>
                  <td className="px-2 text-right tnum text-amber-400">{formatISK(totals.netBuy)}</td>
                  <td className="px-2 text-right tnum text-sky-400">{formatISK(totals.netSell)}</td>
                  <td className={cn('px-2 text-right tnum', totals.profit >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                    {formatISK(totals.profit)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* ── Multibuy text: the clipboard fallback, out of the way ────────── */}
      <details className="group mt-4 rounded-xl border border-slate-800 bg-slate-900/40">
        <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer text-sm text-slate-400 hover:text-slate-200 list-none">
          <ChevronDown className="w-4 h-4 transition-transform group-open:rotate-180" />
          Multibuy text
          <span className="text-xs text-slate-600">— select and copy by hand if the button is blocked</span>
        </summary>
        <div className="px-4 pb-4">
          <textarea
            readOnly
            value={multibuyText}
            rows={Math.min(items.length + 1, 12)}
            onFocus={(e) => e.target.select()}
            className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-sm text-slate-300 font-mono scrollbar-thin focus:outline-none focus:border-[#4A9EFF]"
          />
        </div>
      </details>
    </Page>
  );
}
