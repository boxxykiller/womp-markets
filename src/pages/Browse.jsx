import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronLeft, ChevronRight, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { MarketTable } from '@/components/market/MarketTable';
import { TableToolbar } from '@/components/market/TableToolbar';
import { CategoryTree } from '@/components/market/CategoryTree';
import { ItemDetailSheet } from '@/components/market/ItemDetailSheet';
import { Button } from '@/components/ui/button';
import { useCart } from '@/hooks/useCart';
import { useDebounced } from '@/hooks/useDebounced';
import { useSortState } from '@/hooks/useSort';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 100;

// Cart line for a browsed item: what it takes to reach target when it's
// tracked, otherwise a single unit to edit on the restock page.
const toCartItem = (r) => ({
  typeId: r.typeId,
  itemName: r.itemName,
  quantity: r.restockQuantity > 0 ? r.restockQuantity : 1,
  jitaBestSell: r.jitaBestSell,
  jitaBestBuy: r.jitaBestBuy,
  volumePerUnit: r.volumePerUnit,
  bestSell: r.bestSell,
});

export default function Browse() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  const [page, setPage] = useState(0);
  // Sorted server-side: the list is paginated, so sorting in the browser
  // would only reorder the page on screen.
  const sort = useSortState({ key: 'name', dir: 'asc' }, () => setPage(0));
  const [detailTypeId, setDetailTypeId] = useState(null);
  // Selected rows are kept whole, keyed by type, so a selection survives
  // paging and group changes.
  const [selected, setSelected] = useState({});
  const { addItems, has } = useCart();

  const debouncedSearch = useDebounced(search);

  const { data, isLoading } = useQuery({
    queryKey: ['browse', debouncedSearch, categoryId, sort.key, sort.dir, page],
    queryFn: () =>
      api.invoke('getMarketBrowse', {
        search: debouncedSearch || undefined,
        marketGroupId: categoryId ?? undefined,
        sort: sort.key,
        sortDir: sort.dir,
        limit: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      }),
    refetchInterval: 60_000,
  });

  const { data: categoryData } = useQuery({
    queryKey: ['market-categories'],
    queryFn: () => api.invoke('getMarketCategories', {}),
    staleTime: 10 * 60_000,
  });

  const { data: overview } = useQuery({
    queryKey: ['market-overview'],
    queryFn: () => api.invoke('getMarketOverview', {}),
    staleTime: 60_000,
  });

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const selectedIds = Object.keys(selected).map(Number);

  function toggleSelect(typeId) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[typeId]) delete next[typeId];
      else {
        const row = rows.find((r) => r.typeId === typeId);
        if (row) next[typeId] = row;
      }
      return next;
    });
  }

  // Select-all applies to the page on screen.
  function toggleAll() {
    setSelected((prev) => {
      const next = { ...prev };
      const all = rows.every((r) => next[r.typeId]);
      for (const r of rows) {
        if (all) delete next[r.typeId];
        else next[r.typeId] = r;
      }
      return next;
    });
  }

  function addSelected() {
    const items = Object.values(selected);
    addItems(items.map(toCartItem));
    toast.success(`Added ${items.length} item${items.length === 1 ? '' : 's'} to restock list`);
    setSelected({});
  }

  // Any filter change invalidates the current offset, so reset to page one.
  function changeFilter(setter) {
    return (value) => {
      setter(value);
      setPage(0);
    };
  }

  return (
    <Page>
      <PageHeader
        icon={BarChart3}
        accent="blue"
        title="Market browser"
        subtitle={
          overview?.source
            ? `${overview.source.name ?? overview.source.structureId} — ${overview.distinctItems ?? 0} items listed, updated ${formatRelative(overview.source.lastPolledAt)}`
            : 'Every item currently listed in the citadel'
        }
      />

      <TableToolbar search={search} onSearchChange={changeFilter(setSearch)} />

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-lg bg-[#4A9EFF]/10 border border-[#4A9EFF]/30">
          <span className="text-sm text-slate-200">{selectedIds.length} selected</span>
          <div className="flex-1" />
          <Button size="sm" onClick={addSelected} className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
            <ShoppingCart className="w-4 h-4 mr-2" />
            Add to restock
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected({})} className="text-slate-400">
            Clear
          </Button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="min-w-0 flex-1 w-full">
          <MarketTable
            rows={rows}
            isLoading={isLoading}
            selectable
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            onRowClick={(row) => setDetailTypeId(row.typeId)}
            sort={sort}
            columns={['local', 'jita', 'spread', 'volume', 'cover']}
            rowActions={(row) => (
              <button
                onClick={() => {
                  addItems([toCartItem(row)]);
                  toast.success(`Added ${row.itemName ?? 'item'} to restock list`);
                }}
                className={cn('p-1 transition-colors', has(row.typeId) ? 'text-[#4A9EFF]' : 'text-slate-500 hover:text-[#4A9EFF]')}
                aria-label={`Add ${row.itemName} to restock list`}
                title="Add to restock list"
              >
                <ShoppingCart className="w-4 h-4" />
              </button>
            )}
            emptyMessage={
              overview?.source
                ? 'No items match these filters.'
                : 'No market source configured yet — set one up in Settings.'
            }
          />

          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-3 text-sm text-slate-400">
              <span>
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="border-slate-700 text-slate-300"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= lastPage}
                  onClick={() => setPage((p) => p + 1)}
                  className="border-slate-700 text-slate-300"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Market groups sit beside the table, as in the in-game browser. */}
        <aside className="w-full lg:w-72 shrink-0 lg:sticky lg:top-4 order-first">
          <div className="text-[11px] uppercase tracking-wide text-[#4A7BA7] mb-1.5">Market groups</div>
          <CategoryTree
            groups={categoryData?.groups ?? []}
            selectedId={categoryId}
            onSelect={changeFilter(setCategoryId)}
            className="max-h-[50vh] lg:max-h-[calc(100vh-8rem)]"
          />
        </aside>
      </div>

      <ItemDetailSheet typeId={detailTypeId} open={!!detailTypeId} onOpenChange={(v) => !v && setDetailTypeId(null)} />
    </Page>
  );
}
