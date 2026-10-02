import { useMutation } from '@tanstack/react-query';
import { ClipboardCopy, RefreshCw, ShoppingCart, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SortLabel } from '@/components/ui/SortLabel';
import { StatusBadge } from '@/components/market/MarketTable';
import { useCart } from '@/hooks/useCart';
import { useSortState } from '@/hooks/useSort';
import { cn } from '@/lib/utils';
import { formatISK, formatISKFull, formatQty } from '@/lib/format';
import { formatMultibuy } from '@/lib/multibuy';
import { sortRows } from '@/lib/sort';
import { KIND_LABELS, ROLES, ROLE_META, RoleBadge, toCartItems } from './shared';

function Stat({ label, value, className, title }) {
  return (
    <div title={title}>
      <div className="text-[11px] uppercase tracking-wide text-[#4A7BA7]">{label}</div>
      <div className={cn('text-sm font-medium text-slate-200 tnum', className)}>{value}</div>
    </div>
  );
}

async function copy(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Clipboard unavailable');
  }
}

/**
 * One fit, part by part: what it takes per ship and at the minimum, what's on
 * market, and which part is holding the count down.
 */
export function FitDetailSheet({ fit, doctrine, open, onOpenChange, isAdmin, onChanged, onReplace }) {
  const { addItems } = useCart();
  // One ordering shared by every slot group, so sorting one sorts them all.
  const sort = useSortState();

  const update = useMutation({
    mutationFn: (patch) => api.invoke('updateDoctrineFit', { id: fit.id, ...patch }),
    onSuccess: onChanged,
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => api.invoke('deleteDoctrineFit', { id: fit.id }),
    onSuccess: () => {
      toast.success(`Removed ${fit.name}`);
      onOpenChange(false);
      onChanged?.();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!fit) return null;

  const missing = fit.items.filter((i) => i.missing > 0);
  const groups = Object.keys(KIND_LABELS)
    .map((kind) => ({ kind, items: sortRows(fit.items.filter((i) => i.kind === kind), (i, k) => i[k], sort.key, sort.dir) }))
    .filter((g) => g.items.length > 0);
  const inherited = fit.minQuantity == null;

  function addMissingToCart() {
    addItems(toCartItems(missing));
    toast.success(`Added ${missing.length} item${missing.length === 1 ? '' : 's'} to restock list`);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl bg-[#0B1220] border-[#1E2D45] overflow-y-auto scrollbar-thin">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-3 text-white text-left">
            <img
              src={`https://images.evetech.net/types/${fit.shipTypeId}/render?size=128`}
              alt=""
              className="w-16 h-16 rounded-lg border border-slate-800"
            />
            <div className="min-w-0">
              <div className="truncate">{fit.name}</div>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <span className="text-xs font-normal text-slate-400">{fit.shipName}</span>
                <RoleBadge role={fit.role} />
                <StatusBadge status={fit.status} />
              </div>
              <div className="text-xs font-normal text-slate-500 mt-1 truncate">{doctrine?.name}</div>
            </div>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-900/50 border border-slate-800">
            <Stat
              label="Fittable now"
              value={`${formatQty(fit.fittable)} / ${formatQty(fit.min)}`}
              className={fit.status === 'ok' ? 'text-emerald-400' : fit.status === 'low' ? 'text-amber-400' : 'text-rose-400'}
            />
            <Stat label="Short by" value={fit.shortfall ? formatQty(fit.shortfall) : '—'} />
            <Stat label="Fit cost (local)" value={formatISK(fit.fitCostLocal)} title={formatISKFull(fit.fitCostLocal)} />
            <Stat label="Fit cost (Jita)" value={formatISK(fit.fitCostJita)} title={formatISKFull(fit.fitCostJita)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => copy(fit.eft, 'Fit')} className="border-slate-700 text-slate-300">
              <ClipboardCopy className="w-4 h-4 mr-1" />
              Copy fit (EFT)
            </Button>
            {missing.length > 0 && (
              <>
                <Button size="sm" onClick={addMissingToCart} className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
                  <ShoppingCart className="w-4 h-4 mr-1" />
                  Add missing to restock
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copy(formatMultibuy(toCartItems(missing)), 'Multibuy')}
                  className="border-slate-700 text-slate-300"
                >
                  <ClipboardCopy className="w-4 h-4 mr-1" />
                  Copy missing as multibuy
                </Button>
              </>
            )}
          </div>

          {fit.unmatched.length > 0 && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-300/90">
              These lines didn&apos;t match an item and aren&apos;t counted:{' '}
              <span className="font-mono">{fit.unmatched.join(', ')}</span>
            </div>
          )}

          {isAdmin && (
            <section className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-3">
              <h3 className="text-sm font-semibold text-white">Settings</h3>
              <div className="flex flex-wrap items-end gap-4">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-400 mb-1.5">Minimum on market</span>
                  <div className="flex items-center gap-2">
                    <input
                      key={`${fit.id}:${fit.minQuantity}`}
                      type="number"
                      min="0"
                      defaultValue={fit.minQuantity ?? ''}
                      placeholder={`Default (${doctrine?.minQuantity ?? 0})`}
                      onBlur={(e) => {
                        const raw = e.target.value;
                        const next = raw === '' ? null : Math.max(0, Math.floor(Number(raw)));
                        if (next !== fit.minQuantity && (next === null || Number.isFinite(next))) update.mutate({ minQuantity: next });
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                      className="h-9 w-36 rounded-md bg-slate-950/60 border border-slate-700 px-3 text-sm text-slate-200 tnum focus:outline-none focus:border-[#4A9EFF]"
                    />
                    {!inherited && (
                      <button
                        onClick={() => update.mutate({ minQuantity: null })}
                        className="text-xs text-slate-500 hover:text-[#4A9EFF]"
                      >
                        Use doctrine default
                      </button>
                    )}
                  </div>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-400 mb-1.5">Role</span>
                  <select
                    value={fit.role}
                    onChange={(e) => update.mutate({ role: e.target.value })}
                    className="h-9 rounded-md bg-slate-950/60 border border-slate-700 px-3 text-sm text-slate-200 focus:outline-none focus:border-[#4A9EFF]"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_META[r].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 h-9 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fit.includeCargo}
                    onChange={(e) => update.mutate({ includeCargo: e.target.checked })}
                    className="accent-[#4A9EFF] w-4 h-4"
                  />
                  <span className="text-sm text-slate-300">Count cargo (ammo, paste)</span>
                </label>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={onReplace} className="border-slate-700 text-slate-300">
                  <RefreshCw className="w-4 h-4 mr-1" />
                  Replace fit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (window.confirm(`Delete ${fit.name}?`)) remove.mutate();
                  }}
                  className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete fit
                </Button>
              </div>
            </section>
          )}

          {groups.map((group) => (
            <section key={group.kind}>
              <h3 className="text-sm font-semibold text-white mb-2">{KIND_LABELS[group.kind]}</h3>
              <div className="rounded-lg border border-slate-800 overflow-x-auto scrollbar-thin">
                <table className="w-full text-sm">
                  <thead className="bg-slate-900/60 text-[11px] uppercase tracking-wide text-[#4A7BA7] whitespace-nowrap">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">
                        <SortLabel sort={sort} sortKey="name">Item</SortLabel>
                      </th>
                      <th className="text-right font-medium px-3 py-2">
                        <SortLabel sort={sort} sortKey="perFit" first="desc" align="right">
                          Per fit
                        </SortLabel>
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
                      <th className="text-right font-medium px-3 py-2 hidden sm:table-cell" title="Whole fits this item's stock covers">
                        <SortLabel sort={sort} sortKey="supports" first="asc" align="right">
                          Fits
                        </SortLabel>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {group.items.map((item) => (
                      <tr key={item.typeId} className={cn(item.missing > 0 && 'bg-rose-500/5')}>
                        <td className="px-3 py-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <img
                              src={`https://images.evetech.net/types/${item.typeId}/icon?size=32`}
                              alt=""
                              loading="lazy"
                              className="w-6 h-6 rounded shrink-0"
                            />
                            <span className={cn('truncate', item.missing > 0 ? 'text-rose-300' : 'text-slate-300')}>
                              {item.name}
                            </span>
                            {item.bottleneck && fit.items.length > 1 && (
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/30 shrink-0"
                                title="This part limits how many fits can be built"
                              >
                                limiting
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right tnum text-slate-400">{formatQty(item.perFit)}</td>
                        <td className="px-3 py-1.5 text-right tnum text-slate-400">{formatQty(item.needed)}</td>
                        <td className="px-3 py-1.5 text-right tnum text-slate-300">{formatQty(item.onMarket)}</td>
                        <td className={cn('px-3 py-1.5 text-right tnum', item.missing > 0 ? 'text-rose-400 font-medium' : 'text-slate-600')}>
                          {item.missing > 0 ? formatQty(item.missing) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tnum text-slate-500 hidden sm:table-cell">{formatQty(item.supports)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
