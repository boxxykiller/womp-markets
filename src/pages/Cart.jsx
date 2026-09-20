import { useMemo, useState } from 'react';
import { Check, Copy, ShoppingCart, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCart } from '@/hooks/useCart';
import { formatISK, formatISKFull } from '@/lib/format';
import { formatMultibuy } from '@/lib/multibuy';

export default function Cart() {
  const { items, setQuantity, removeItem, clear } = useCart();
  const [copied, setCopied] = useState(false);

  const totals = useMemo(() => {
    let jita = 0;
    let local = 0;
    for (const item of items) {
      jita += (item.jitaBestSell ?? 0) * item.quantity;
      local += (item.bestSell ?? 0) * item.quantity;
    }
    return { jita, local };
  }, [items]);

  const multibuyText = useMemo(() => formatMultibuy(items), [items]);

  async function copyMultibuy() {
    try {
      await navigator.clipboard.writeText(multibuyText);
      setCopied(true);
      toast.success('Multibuy copied — paste it into EVE');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access needs a secure context and can be blocked outright,
      // so the textarea below is always present as the fallback.
      toast.error('Could not copy automatically — select the text below and copy it manually.');
    }
  }

  return (
    <Page>
      <PageHeader
        icon={ShoppingCart}
        accent="violet"
        title="Restock cart"
        subtitle="Adjust quantities, then copy a multibuy list straight into EVE"
      >
        {items.length > 0 && (
          <Button variant="outline" onClick={clear} className="border-slate-700 text-slate-300">
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
        )}
      </PageHeader>

      {items.length === 0 ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-10 text-center">
          <ShoppingCart className="w-8 h-8 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-400">Your cart is empty.</p>
          <p className="text-sm text-slate-600 mt-1">
            Select low-stock items on the Tracked page and add them here to build a restock list.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
            <StatCard title="Items" value={items.length} variant="violet" />
            <StatCard
              title="Cost at Jita"
              value={formatISK(totals.jita)}
              subtitle="Buying at the hub's ask price"
              variant="blue"
            />
            <StatCard
              title="Cost locally"
              value={formatISK(totals.local)}
              subtitle="Buying from this citadel"
              variant="slate"
            />
          </div>

          <div className="border border-slate-800 rounded-lg overflow-x-auto mb-6">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-transparent">
                  <TableHead className="text-slate-400">Item</TableHead>
                  <TableHead className="text-slate-400 text-right w-40">Quantity</TableHead>
                  <TableHead className="text-slate-400 text-right">Jita unit</TableHead>
                  <TableHead className="text-slate-400 text-right">Line total</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.typeId} className="border-slate-800">
                    <TableCell className="text-slate-200 font-medium">
                      <div className="flex items-center gap-2">
                        <img
                          src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`}
                          alt=""
                          className="w-6 h-6 rounded"
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
                        className="h-8 w-32 ml-auto text-right bg-slate-900 border-slate-700 tnum"
                      />
                    </TableCell>
                    <TableCell className="text-right text-slate-400 tnum" title={formatISKFull(item.jitaBestSell)}>
                      {formatISK(item.jitaBestSell)}
                    </TableCell>
                    <TableCell className="text-right text-slate-200 tnum">
                      {formatISK((item.jitaBestSell ?? 0) * item.quantity)}
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
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
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
        </>
      )}
    </Page>
  );
}
