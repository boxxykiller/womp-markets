import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, Package, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCart } from '@/hooks/useCart';
import { formatISK, formatISKFull } from '@/lib/format';
import { formatMultibuy } from '@/lib/multibuy';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 10;

// ── Margin math ──────────────────────────────────────────────────────────────

function calcItem(item, { shippingRate, brokerFee, salesTax, collateralPct, markupPct }) {
  const qty = item.quantity || 0;
  const jitaBuy = item.jitaBestBuy ?? 0;
  const jitaSell = item.jitaBestSell ?? 0;
  const m3 = item.volumePerUnit ?? 0;

  // Raw Jita prices × qty
  const grossBuyTotal = jitaBuy * qty;
  const grossSellTotal = jitaSell * qty;

  // Shipping: m³ per unit × rate × quantity
  const shippingUnit = m3 * shippingRate;
  const shippingTotal = shippingUnit * qty;

  // Net Buy = (Jita Buy + broker fee on buy + shipping per unit) × qty
  const brokerFeeUnit = jitaBuy * (brokerFee / 100);
  const netBuyUnit = jitaBuy + brokerFeeUnit + shippingUnit;
  const netBuyTotal = netBuyUnit * qty;

  // Collateral = Jita Sell total × collateral %
  const collateralTotal = jitaSell * qty * (collateralPct / 100);

  // Net Sell = Jita Sell × (1 + markup%) × (1 − sales tax%) × qty
  const netSellUnit = jitaSell * (1 + markupPct / 100) * (1 - salesTax / 100);
  const netSellTotal = netSellUnit * qty;

  return {
    grossBuyTotal,
    grossSellTotal,
    netBuyUnit,
    netBuyTotal,
    netSellUnit,
    netSellTotal,
    shippingTotal,
    collateralTotal,
  };
}

// ── Small labelled number input ───────────────────────────────────────────────

function CalcField({ label, value, onChange, suffix, min = 0, step = 0.1 }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label className="text-xs font-medium text-slate-400 whitespace-nowrap">{label}</label>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="h-8 w-full bg-slate-900 border-slate-700 tnum text-sm text-right pr-2"
        />
        {suffix && <span className="text-xs text-slate-500 whitespace-nowrap shrink-0">{suffix}</span>}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Restock() {
  const { items, setQuantity, removeItem, clear } = useCart();
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(0);

  // Margin calculator inputs
  const [shippingRate, setShippingRate] = useState(650);   // ISK/m³
  const [brokerFee, setBrokerFee] = useState(3.6);          // % on Jita Buy
  const [salesTax, setSalesTax] = useState(1.5);            // % on your sell orders
  const [collateralPct, setCollateralPct] = useState(1.5);  // % of Jita Sell total
  const [markupPct, setMarkupPct] = useState(10);           // % above Jita Sell

  const calcParams = { shippingRate, brokerFee, salesTax, collateralPct, markupPct };

  // Pagination
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = items.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Global totals across all items
  const totals = useMemo(() => {
    let grossBuy = 0, grossSell = 0, netBuy = 0, netSell = 0, shipping = 0, collateral = 0;
    for (const item of items) {
      const c = calcItem(item, calcParams);
      grossBuy += c.grossBuyTotal;
      grossSell += c.grossSellTotal;
      netBuy += c.netBuyTotal;
      netSell += c.netSellTotal;
      shipping += c.shippingTotal;
      collateral += c.collateralTotal;
    }
    const netMargin = netSell - netBuy - collateral;
    const netMarginPct = netBuy > 0 ? netMargin / netBuy : null;
    return { grossBuy, grossSell, netBuy, netSell, shipping, collateral, netMargin, netMarginPct };
  }, [items, shippingRate, brokerFee, salesTax, collateralPct, markupPct]);

  // Multibuy copy
  const multibuyText = useMemo(() => formatMultibuy(items), [items]);

  async function copyMultibuy() {
    try {
      await navigator.clipboard.writeText(multibuyText);
      setCopied(true);
      toast.success('Multibuy copied — paste it into EVE');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy automatically — select the text below and copy it manually.');
    }
  }

  // Navigate to the page that contains the given item index
  function jumpToItem(index) {
    setPage(Math.floor(index / PAGE_SIZE));
  }

  if (items.length === 0) {
    return (
      <Page>
        <PageHeader
          icon={Package}
          accent="violet"
          title="Restock"
          subtitle="Adjust quantities, review margin, then copy a multibuy list straight into EVE"
        />
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

  return (
    <Page>
      <PageHeader
        icon={Package}
        accent="violet"
        title="Restock"
        subtitle="Adjust quantities, review margin, then copy a multibuy list straight into EVE"
      >
        <Button onClick={copyMultibuy} className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
          {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
          {copied ? 'Copied' : 'Copy multibuy'}
        </Button>
        <Button variant="outline" onClick={clear} className="border-slate-700 text-slate-300">
          <Trash2 className="w-4 h-4 mr-2" />
          Clear
        </Button>
      </PageHeader>

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard title="Items" value={items.length} variant="violet" />
        <StatCard
          title="Gross Buy (Jita)"
          value={formatISK(totals.grossBuy)}
          subtitle="Jita buy orders × qty"
          variant="blue"
        />
        <StatCard
          title="Net Cost"
          value={formatISK(totals.netBuy + totals.collateral)}
          subtitle="Buy + fees + shipping + collateral"
          variant="amber"
        />
        <StatCard
          title="Net Margin"
          value={formatISK(totals.netMargin)}
          subtitle={
            totals.netMarginPct != null
              ? `${totals.netMarginPct >= 0 ? '+' : ''}${(totals.netMarginPct * 100).toFixed(1)}% on cost`
              : 'After fees, shipping & collateral'
          }
          variant={totals.netMargin >= 0 ? 'emerald' : 'rose'}
        />
      </div>

      {/* ── Margin calculator ──────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 mb-6">
        <h2 className="text-sm font-semibold text-white mb-4">Margin calculator</h2>

        {/* Inputs row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
          <CalcField
            label="Shipping rate"
            value={shippingRate}
            onChange={setShippingRate}
            suffix="ISK/m³"
            step={50}
          />
          <CalcField
            label="Broker fee (buy)"
            value={brokerFee}
            onChange={setBrokerFee}
            suffix="%"
            step={0.1}
          />
          <CalcField
            label="Sales tax (sell)"
            value={salesTax}
            onChange={setSalesTax}
            suffix="%"
            step={0.1}
          />
          <CalcField
            label="Collateral %"
            value={collateralPct}
            onChange={setCollateralPct}
            suffix="% of Jita Sell"
            step={0.1}
          />
          <CalcField
            label="Markup %"
            value={markupPct}
            onChange={setMarkupPct}
            suffix="% above Jita Sell"
            step={0.5}
          />
        </div>

        {/* Summary row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-4 border-t border-slate-800 text-center">
          {[
            { label: 'Gross Buy', value: totals.grossBuy, hint: 'Jita Buy × qty' },
            { label: 'Gross Sell', value: totals.grossSell, hint: 'Jita Sell × qty' },
            { label: 'Shipping', value: totals.shipping, hint: 'Vol × rate × qty' },
            { label: 'Collateral', value: totals.collateral, hint: `${collateralPct}% of Jita Sell` },
            { label: 'Net Buy', value: totals.netBuy, hint: 'Buy + fees + shipping' },
            {
              label: 'Net Sell',
              value: totals.netSell,
              hint: `Jita Sell +${markupPct}% − tax`,
              highlight: true,
            },
          ].map(({ label, value, hint, highlight }) => (
            <div key={label} className="rounded-lg bg-slate-800/40 p-3">
              <div className="text-xs text-slate-500 mb-1">{label}</div>
              <div className={cn('text-sm font-semibold tnum', highlight ? 'text-emerald-400' : 'text-white')}>
                {formatISK(value)}
              </div>
              <div className="text-[10px] text-slate-600 mt-0.5">{hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Table + right nav ──────────────────────────────────────────────── */}
      <div className="flex gap-4 items-start">

        {/* Main table */}
        <div className="flex-1 min-w-0">
          <div className="border border-slate-800 rounded-lg overflow-x-auto mb-3">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400 min-w-[180px]">Item</TableHead>
                  <TableHead className="text-slate-400 text-right w-32">Qty</TableHead>
                  <TableHead className="text-slate-400 text-right">Gross Buy</TableHead>
                  <TableHead className="text-slate-400 text-right">Gross Sell</TableHead>
                  <TableHead className="text-slate-400 text-right">Net Buy</TableHead>
                  <TableHead className="text-slate-400 text-right">Net Sell</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((item) => {
                  const c = calcItem(item, calcParams);
                  return (
                    <TableRow key={item.typeId} className="border-slate-800">
                      <TableCell className="text-slate-200 font-medium">
                        <div className="flex items-center gap-2">
                          <img
                            src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`}
                            alt=""
                            className="w-6 h-6 rounded shrink-0"
                            loading="lazy"
                          />
                          <span className="truncate">{item.itemName ?? `Type ${item.typeId}`}</span>
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          value={item.quantity}
                          onChange={(e) => setQuantity(item.typeId, e.target.value)}
                          className="h-8 w-28 ml-auto text-right bg-slate-900 border-slate-700 tnum"
                        />
                      </TableCell>

                      {/* Gross Buy — Jita Buy × qty */}
                      <TableCell
                        className="text-right text-slate-400 tnum text-sm"
                        title={`Jita Buy: ${formatISKFull(item.jitaBestBuy)} × ${item.quantity}`}
                      >
                        <div className="text-slate-200">{formatISK(c.grossBuyTotal)}</div>
                        <div className="text-xs text-slate-600">{formatISK(item.jitaBestBuy)}/u</div>
                      </TableCell>

                      {/* Gross Sell — Jita Sell × qty */}
                      <TableCell
                        className="text-right tnum text-sm"
                        title={`Jita Sell: ${formatISKFull(item.jitaBestSell)} × ${item.quantity}`}
                      >
                        <div className="text-slate-200">{formatISK(c.grossSellTotal)}</div>
                        <div className="text-xs text-slate-600">{formatISK(item.jitaBestSell)}/u</div>
                      </TableCell>

                      {/* Net Buy — Jita Buy + fees + shipping */}
                      <TableCell
                        className="text-right tnum text-sm"
                        title={`Net Buy/u: ${formatISKFull(c.netBuyUnit)} (includes ${brokerFee}% broker + ${formatISK(item.volumePerUnit ?? 0)} m³ × ${formatISK(shippingRate)}/m³ shipping)`}
                      >
                        <div className="text-amber-400">{formatISK(c.netBuyTotal)}</div>
                        <div className="text-xs text-slate-600">{formatISK(c.netBuyUnit)}/u</div>
                      </TableCell>

                      {/* Net Sell — Jita Sell × (1 + markup%) × (1 - tax%) */}
                      <TableCell
                        className="text-right tnum text-sm"
                        title={`Net Sell/u: ${formatISKFull(c.netSellUnit)} (Jita Sell +${markupPct}% markup − ${salesTax}% sales tax)`}
                      >
                        <div className="text-emerald-400">{formatISK(c.netSellTotal)}</div>
                        <div className="text-xs text-slate-600">{formatISK(c.netSellUnit)}/u</div>
                      </TableCell>

                      <TableCell>
                        <button
                          onClick={() => removeItem(item.typeId)}
                          className="p-1 text-slate-600 hover:text-rose-400 transition-colors"
                          aria-label={`Remove ${item.itemName}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-slate-400 px-1">
              <span>
                {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, items.length)} of {items.length} items
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="p-1.5 rounded hover:bg-slate-800 disabled:opacity-30 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={cn(
                      'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                      i === safePage
                        ? 'bg-[#4A9EFF]/20 text-[#4A9EFF]'
                        : 'hover:bg-slate-800 text-slate-500',
                    )}
                  >
                    {i + 1}
                  </button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage === totalPages - 1}
                  className="p-1.5 rounded hover:bg-slate-800 disabled:opacity-30 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right navigation sidebar — all items as jump targets */}
        <div className="w-52 shrink-0 hidden lg:block">
          <div className="sticky top-20 rounded-xl border border-slate-800 bg-slate-900/40 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-800">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                All items ({items.length})
              </span>
            </div>
            <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
              {items.map((item, idx) => {
                const isOnPage = Math.floor(idx / PAGE_SIZE) === safePage;
                return (
                  <button
                    key={item.typeId}
                    onClick={() => jumpToItem(idx)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
                      isOnPage
                        ? 'bg-[#4A9EFF]/10 text-[#4A9EFF]'
                        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200',
                    )}
                  >
                    <img
                      src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`}
                      alt=""
                      className="w-5 h-5 rounded shrink-0"
                      loading="lazy"
                    />
                    <span className="truncate flex-1">{item.itemName ?? `Type ${item.typeId}`}</span>
                    {isOnPage && <span className="w-1.5 h-1.5 rounded-full bg-[#4A9EFF] shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Multibuy textarea fallback ─────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Multibuy list</h2>
            <p className="text-xs text-slate-500">
              Copy this, then paste it into EVE&apos;s multibuy window.
            </p>
          </div>
          <Button onClick={copyMultibuy} className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
            {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
            {copied ? 'Copied' : 'Copy multibuy'}
          </Button>
        </div>
        {/* Readonly rather than hidden: if the clipboard API is blocked,
            this is the fallback people select and copy by hand. */}
        <textarea
          readOnly
          value={multibuyText}
          rows={Math.min(items.length + 1, 12)}
          onFocus={(e) => e.target.select()}
          className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-sm text-slate-300 font-mono scrollbar-thin focus:outline-none focus:border-[#4A9EFF]"
        />
      </div>
    </Page>
  );
}
