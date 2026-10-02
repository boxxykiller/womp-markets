import { ClipboardCopy, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SortLabel } from '@/components/ui/SortLabel';
import { useCart } from '@/hooks/useCart';
import { useSort } from '@/hooks/useSort';
import { formatISK, formatISKFull, formatQty } from '@/lib/format';
import { formatMultibuy } from '@/lib/multibuy';
import { toCartItems } from './shared';

const missingValue = (m, key) => (key === 'cost' ? (m.jitaPrice != null ? m.jitaPrice * m.missing : null) : m[key]);

/**
 * The shopping list for a doctrine (or every doctrine at once): each part
 * short of the combined demand of its fits, with what it costs in Jita.
 */
export function MissingSheet({ open, onOpenChange, title, subtitle, missing = [], totalCost }) {
  const { addItems } = useCart();
  const sort = useSort(missing, missingValue);

  function addToCart() {
    addItems(toCartItems(missing));
    toast.success(`Added ${missing.length} item${missing.length === 1 ? '' : 's'} to restock list`);
  }

  async function copyMultibuy() {
    try {
      await navigator.clipboard.writeText(formatMultibuy(toCartItems(missing)));
      toast.success('Multibuy copied');
    } catch {
      toast.error('Clipboard unavailable');
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl bg-[#0B1220] border-[#1E2D45] overflow-y-auto scrollbar-thin">
        <SheetHeader>
          <SheetTitle className="text-white text-left">
            {title}
            {subtitle && <div className="text-xs font-normal text-slate-500 mt-1">{subtitle}</div>}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-4">
          {missing.length === 0 ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
              Nothing missing — the market covers every minimum.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm text-slate-300 mr-auto">
                  <span className="text-rose-400 font-medium">{missing.length}</span> item{missing.length === 1 ? '' : 's'} short
                  {' · '}
                  <span title={formatISKFull(totalCost)}>~{formatISK(totalCost)} ISK</span> in Jita
                </div>
                <Button size="sm" onClick={addToCart} className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
                  <ShoppingCart className="w-4 h-4 mr-1" />
                  Add all to restock
                </Button>
                <Button size="sm" variant="outline" onClick={copyMultibuy} className="border-slate-700 text-slate-300">
                  <ClipboardCopy className="w-4 h-4 mr-1" />
                  Copy multibuy
                </Button>
              </div>

              <div className="rounded-lg border border-slate-800 overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/60 text-[11px] uppercase tracking-wide text-[#4A7BA7] whitespace-nowrap">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">
                        <SortLabel sort={sort} sortKey="name">Item</SortLabel>
                      </th>
                      <th className="text-right font-medium px-3 py-2">
                        <SortLabel sort={sort} sortKey="needed" first="desc" align="right">
                          Needed
                        </SortLabel>
                      </th>
                      <th className="text-right font-medium px-3 py-2">
                        <SortLabel sort={sort} sortKey="onMarket" first="desc" align="right">
                          On market
                        </SortLabel>
                      </th>
                      <th className="text-right font-medium px-3 py-2">
                        <SortLabel sort={sort} sortKey="missing" first="desc" align="right">
                          Missing
                        </SortLabel>
                      </th>
                      <th className="text-right font-medium px-3 py-2 hidden sm:table-cell">
                        <SortLabel sort={sort} sortKey="cost" first="desc" align="right">
                          Jita cost
                        </SortLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {sort.rows.map((m) => (
                      <tr key={m.typeId}>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <img
                              src={`https://images.evetech.net/types/${m.typeId}/icon?size=32`}
                              alt=""
                              loading="lazy"
                              className="w-6 h-6 rounded shrink-0"
                            />
                            <span className="truncate text-slate-300">{m.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right tnum text-slate-400">{formatQty(m.needed)}</td>
                        <td className="px-3 py-1.5 text-right tnum text-slate-300">{formatQty(m.onMarket)}</td>
                        <td className="px-3 py-1.5 text-right tnum text-rose-400 font-medium">{formatQty(m.missing)}</td>
                        <td
                          className="px-3 py-1.5 text-right tnum text-slate-400 hidden sm:table-cell"
                          title={m.jitaPrice != null ? formatISKFull(m.jitaPrice * m.missing) : 'No Jita price'}
                        >
                          {m.jitaPrice != null ? formatISK(m.jitaPrice * m.missing) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
