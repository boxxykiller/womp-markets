import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, Package, RotateCcw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCart } from '@/hooks/useCart';
import { formatISK, formatISKFull, formatQty } from '@/lib/format';
import { formatMultibuy } from '@/lib/multibuy';
import { cn } from '@/lib/utils';

// ── Calculator settings ──────────────────────────────────────────────────────
// Remembered per browser: they describe how this person hauls and trades, and
// re-typing a freight rate on every visit is exactly the friction to avoid.

const SETTINGS_KEY = 'womp.restock.calc.v1';
const DEFAULTS = { shippingRate: 650, collateralPct: 1, brokerFee: 3, salesTax: 3.6, markupPct: 10 };

function readSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

// ── Margin math ──────────────────────────────────────────────────────────────
//
// Buy side:  Net Buy  = Jita Buy + broker fee + shipping
//            shipping = m³ × rate  +  collateral fee (a % of the Jita Sell
//            value, which is what a courier contract is collateralised at)
// Sell side: Net Sell = Jita Sell + sell fees (tax + broker) + markup
//            — the price to list at so fees are passed on and markup is kept
// Profit:    what the listing actually returns after sell fees, less Net Buy

function calcItem(item, s) {
  const qty = item.quantity || 0;
  const buy = item.jitaBestBuy ?? 0;
  const sell = item.jitaBestSell ?? 0;
  const m3 = item.volumePerUnit ?? 0;
  const sellFeeRate = (s.salesTax + s.brokerFee) / 100;

  const brokerBuy = buy * (s.brokerFee / 100);
  const freight = m3 * s.shippingRate;
  const collateralFee = sell * (s.collateralPct / 100);
  const netBuy = buy + brokerBuy + freight + collateralFee;

  const sellFees = sell * sellFeeRate;
  const markup = sell * (s.markupPct / 100);
  const netSell = sell + sellFees + markup;

  const profit = netSell * (1 - sellFeeRate) - netBuy;

  const unit = { grossBuy: buy, grossSell: sell, brokerBuy, freight, collateralFee, netBuy, sellFees, markup, netSell, profit };
  const line = Object.fromEntries(Object.entries(unit).map(([k, v]) => [k, v * qty]));
  return { qty, m3: m3 * qty, collateral: sell * qty, unit, line, missing: item.jitaBestBuy == null || item.jitaBestSell == null };
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Restock() {
  const { items, setQuantity, removeItem, clear } = useCart();
  const [settings, setSettings] = useState(readSettings);
  const [perUnit, setPerUnit] = useState(false);
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Blocked storage just means the defaults come back next visit.
    }
  }, [settings]);

  const set = (key) => (value) => setSettings((s) => ({ ...s, [key]: value }));

  const rows = useMemo(() => items.map((item) => ({ item, c: calcItem(item, settings) })), [items, settings]);

  const totals = useMemo(() => {
    const t = { units: 0, m3: 0, collateral: 0, missing: 0 };
    for (const { c } of rows) {
      t.units += c.qty;
      t.m3 += c.m3;
      t.collateral += c.collateral;
      if (c.missing) t.missing += 1;
      for (const [k, v] of Object.entries(c.line)) t[k] = (t[k] ?? 0) + v;
    }
    t.marginPct = t.netBuy > 0 ? t.profit / t.netBuy : null;
    return t;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? rows.filter(({ item }) => String(item.itemName ?? '').toLowerCase().includes(q)) : rows;
  }, [rows, filter]);

  const multibuyText = useMemo(() => formatMultibuy(items), [items]);

  async function copyMultibuy() {
    try {
      await navigator.clipboard.writeText(multibuyText);
      setCopied(true);
      toast.success('Multibuy copied — paste it into EVE');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be blocked outright; the text is in the
      // "Multibuy text" panel below to copy by hand.
      toast.error('Could not copy automatically — open "Multibuy text" below and copy it manually.');
    }
  }

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
          <Button onClick={copyMultibuy} className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
            {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
            {copied ? 'Copied' : 'Copy multibuy'}
          </Button>
        </>
      )}
    </PageHeader>
  );

  if (items.length === 0) {
    return (
      <Page>
        {header}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center">
          <Package className="w-8 h-8 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400">Your restock list is empty.</p>
          <p className="text-sm text-slate-600 mt-1">
            Select items on the Tracked page and add them here to build a restock list.
          </p>
        </div>
      </Page>
    );
  }

  const v = (c) => (perUnit ? c.unit : c.line);
  const sellFeePct = settings.salesTax + settings.brokerFee;

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
          subtitle="Landed cost: Jita buy + fees + shipping"
          variant="amber"
        />
        <StatCard
          title="Net Sell"
          value={formatISK(totals.netSell)}
          subtitle={`List value at Jita sell + fees + ${settings.markupPct}%`}
          variant="blue"
        />
        <StatCard
          title="Profit"
          value={formatISK(totals.profit)}
          subtitle={
            totals.marginPct != null
              ? `${totals.marginPct >= 0 ? '+' : ''}${(totals.marginPct * 100).toFixed(1)}% on cost, after sell fees`
              : 'After sell fees'
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
              Shipping
            </div>
            <CalcField label="Rate per m³" value={settings.shippingRate} onChange={set('shippingRate')} unit="ISK" step={50} />
            <CalcField label="Collateral fee" value={settings.collateralPct} onChange={set('collateralPct')} unit="%" step={0.1} />

            <div className="col-span-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 -mb-2 mt-1">
              Fees &amp; pricing
            </div>
            <CalcField label="Broker fee" value={settings.brokerFee} onChange={set('brokerFee')} unit="%" step={0.1} />
            <CalcField label="Sales tax" value={settings.salesTax} onChange={set('salesTax')} unit="%" step={0.1} />
            <CalcField label="Markup" value={settings.markupPct} onChange={set('markupPct')} unit="%" step={0.5} />
          </div>

          {/* Breakdown */}
          <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-3 content-start">
            <Receipt title="Buy side">
              <Line label="Gross Buy" hint="Jita buy" value={totals.grossBuy} />
              <Line label="Broker fee" hint={`${settings.brokerFee}%`} value={totals.brokerBuy} sign="+" />
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
              <Line label="Sell fees" hint={`${sellFeePct.toFixed(1)}% tax + broker`} value={totals.sellFees} sign="+" />
              <Line label="Markup" hint={`${settings.markupPct}%`} value={totals.markup} sign="+" />
              <Line label="Net Sell" value={totals.netSell} total tone="text-sky-400" />
              <Line
                label="Profit"
                hint="after sell fees"
                value={totals.profit}
                tone={totals.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}
              />
            </Receipt>

            {totals.missing > 0 && (
              <p className="md:col-span-2 text-xs text-amber-400/80">
                {totals.missing} item{totals.missing === 1 ? ' has' : 's have'} no Jita price yet and count as zero.
                Re-add from Tracked once prices refresh.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Items ────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">
            Items <span className="text-slate-500 font-normal">({items.length})</span>
          </h2>
          <div className="flex items-center gap-2">
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
              {visibleRows.map(({ item, c }) => {
                const x = v(c);
                return (
                  <tr key={item.typeId} className="border-b border-slate-800/70 hover:bg-slate-800/30">
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
                    <td className="px-2 text-right tnum text-slate-300" title={formatISKFull(x.grossBuy)}>
                      {formatISK(x.grossBuy)}
                    </td>
                    <td className="px-2 text-right tnum text-slate-300" title={formatISKFull(x.grossSell)}>
                      {formatISK(x.grossSell)}
                    </td>
                    <td
                      className="px-2 text-right tnum text-amber-400"
                      title={`${formatISKFull(x.netBuy)} — broker ${formatISK(x.brokerBuy)}, freight ${formatISK(x.freight)}, collateral ${formatISK(x.collateralFee)}`}
                    >
                      {formatISK(x.netBuy)}
                    </td>
                    <td
                      className="px-2 text-right tnum text-sky-400"
                      title={`${formatISKFull(x.netSell)} — fees ${formatISK(x.sellFees)}, markup ${formatISK(x.markup)}`}
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
                    No items match &ldquo;{filter}&rdquo;.
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
