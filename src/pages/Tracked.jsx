import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, ClipboardPaste, Gauge, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { MarketTable } from '@/components/market/MarketTable';
import { TableToolbar } from '@/components/market/TableToolbar';
import { ItemDetailSheet } from '@/components/market/ItemDetailSheet';
import { AddItemRow } from '@/components/market/AddItemRow';
import { BulkPasteDialog } from '@/components/market/BulkPasteDialog';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { useDebounced } from '@/hooks/useDebounced';
import { stockedSummary } from '@/lib/format';

const SORT_OPTIONS = [
  { value: 'status', label: 'Status' },
  { value: 'daysOfCover', label: 'Days left' },
  { value: 'name', label: 'Name' },
  { value: 'volume', label: 'Sold per day' },
  { value: 'sellVolume', label: 'On market' },
];

/**
 * Inline-editable numeric cell. Saves on blur rather than on every keystroke
 * so a half-typed "10" never briefly becomes a minimum of 1.
 */
function EditableNumber({ value, onSave, title }) {
  const [draft, setDraft] = useState(String(value ?? 0));
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setDraft(String(value ?? 0));
          setEditing(true);
        }}
        title={title}
        className="w-full text-right tnum text-slate-300 hover:text-[#4A9EFF] transition-colors"
      >
        {Math.round(value ?? 0).toLocaleString()}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      type="number"
      min="0"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => {
        setEditing(false);
        const next = Number(draft);
        if (Number.isFinite(next) && next !== value) onSave(next);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setEditing(false);
      }}
      className="h-7 w-24 text-right bg-slate-900 border-slate-700 tnum"
    />
  );
}

export default function Tracked() {
  const { isAdmin } = useAuth();
  const { addItems } = useCart();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statuses, setStatuses] = useState([]);
  const [categoryId, setCategoryId] = useState(null);
  const [sort, setSort] = useState('status');
  const [selected, setSelected] = useState([]);
  const [detailTypeId, setDetailTypeId] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  const debouncedSearch = useDebounced(search);

  const { data, isLoading } = useQuery({
    queryKey: ['watchlist', debouncedSearch, statuses, categoryId, sort],
    queryFn: () =>
      api.invoke('getMarketWatchlist', {
        search: debouncedSearch || undefined,
        status: statuses.length ? statuses : undefined,
        marketGroupId: categoryId ?? undefined,
        sort,
      }),
    refetchInterval: 60_000,
  });

  const { data: categoryData } = useQuery({
    queryKey: ['market-categories'],
    queryFn: () => api.invoke('getMarketCategories', {}),
    staleTime: 10 * 60_000,
  });

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? { out: 0, critical: 0, low: 0, ok: 0 };

  const stocked = stockedSummary(counts);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['watchlist'] });
    queryClient.invalidateQueries({ queryKey: ['watchlist-badge'] });
  }

  const saveItem = useMutation({
    mutationFn: (payload) => api.invoke('upsertMarketWatchItem', payload),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const removeItems = useMutation({
    mutationFn: (ids) => api.invoke('deleteMarketWatchItem', { ids }),
    onSuccess: (result) => {
      invalidate();
      setSelected([]);
      toast.success(`Removed ${result.deleted} item${result.deleted === 1 ? '' : 's'}`);
    },
    onError: (err) => toast.error(err.message),
  });

  const selectedRows = useMemo(() => rows.filter((r) => selected.includes(r.typeId)), [rows, selected]);

  function toggleSelect(typeId) {
    setSelected((prev) => (prev.includes(typeId) ? prev.filter((t) => t !== typeId) : [...prev, typeId]));
  }

  function toggleAll() {
    setSelected((prev) => (prev.length === rows.length ? [] : rows.map((r) => r.typeId)));
  }

  function addSelectedToCart() {
    addItems(
      selectedRows.map((r) => ({
        typeId: r.typeId,
        itemName: r.itemName,
        // Default to what it takes to get back to target — the number
        // someone opening the restock list actually wants.
        quantity: r.restockQuantity ?? 0,
        jitaBestSell: r.jitaBestSell,
        jitaBestBuy: r.jitaBestBuy,
        volumePerUnit: r.volumePerUnit,
        bestSell: r.bestSell,
      })),
    );
    toast.success(`Added ${selectedRows.length} item${selectedRows.length === 1 ? '' : 's'} to restock list`);
    setSelected([]);
  }

  return (
    <Page>
      <PageHeader
        icon={Boxes}
        accent="amber"
        title="Tracked items"
        subtitle="Shared watchlist — minimum stock levels, local and Jita prices, and how long stock will last"
      >
        {isAdmin && (
          <Button variant="outline" onClick={() => setPasteOpen(true)} className="border-slate-700 text-slate-300">
            <ClipboardPaste className="w-4 h-4 mr-2" />
            Bulk paste
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <StatCard
          title="Stocked"
          value={stocked.value}
          subtitle={stocked.subtitle}
          icon={Gauge}
          variant={stocked.variant}
          onClick={() => setStatuses([])}
        />
        <StatCard
          title="Out of stock"
          value={counts.out}
          icon={Boxes}
          variant="rose"
          onClick={() => setStatuses(['out'])}
        />
        <StatCard title="Critical" value={counts.critical} variant="rose" onClick={() => setStatuses(['critical'])} />
        <StatCard title="Low" value={counts.low} variant="amber" onClick={() => setStatuses(['low'])} />
        <StatCard title="Healthy" value={counts.ok} variant="emerald" onClick={() => setStatuses(['ok'])} />
      </div>

      {/* Adding and editing lives on this page rather than behind a separate
          editor, so the list can be corrected while you're looking at it. */}
      {isAdmin && <AddItemRow onAdd={(payload) => saveItem.mutate(payload)} isSaving={saveItem.isPending} />}

      <TableToolbar
        search={search}
        onSearchChange={setSearch}
        statuses={statuses}
        onStatusesChange={setStatuses}
        categories={categoryData?.categories ?? []}
        categoryId={categoryId}
        onCategoryChange={setCategoryId}
        sort={sort}
        onSortChange={setSort}
        sortOptions={SORT_OPTIONS}
      />

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 p-3 rounded-lg bg-[#4A9EFF]/10 border border-[#4A9EFF]/30">
          <span className="text-sm text-slate-200">{selected.length} selected</span>
          <div className="flex-1" />
          <Button size="sm" onClick={addSelectedToCart} className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
            <ShoppingCart className="w-4 h-4 mr-2" />
            Add to restock
          </Button>
          {isAdmin && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => removeItems.mutate(selectedRows.map((r) => r.watchId).filter(Boolean))}
              className="border-rose-500/40 text-rose-400 hover:bg-rose-500/10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Remove selected
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelected([])} className="text-slate-400">
            Clear
          </Button>
        </div>
      )}

      <MarketTable
        rows={rows}
        isLoading={isLoading}
        selectable
        selectedIds={selected}
        onToggleSelect={toggleSelect}
        onToggleAll={toggleAll}
        onRowClick={(row) => setDetailTypeId(row.typeId)}
        columns={['status', ...(isAdmin ? [] : ['min']), 'local', 'jita', 'spread', 'volume', 'cover']}
        emptyMessage={
          isAdmin
            ? 'Nothing tracked yet — add an item above, or paste a list in bulk.'
            : 'Nothing tracked yet. An administrator can add items to this list.'
        }
        rowActions={
          isAdmin
            ? (row) => (
                <div className="flex items-center gap-2">
                  <EditableNumber
                    value={row.minQuantity}
                    title="Minimum quantity — click to edit"
                    onSave={(minQuantity) =>
                      saveItem.mutate({
                        id: row.watchId,
                        typeId: row.typeId,
                        itemName: row.itemName,
                        minQuantity,
                        minDaysCover: row.minDaysCover,
                        targetQuantity: row.targetQuantity,
                      })
                    }
                  />
                  <button
                    onClick={() => removeItems.mutate([row.watchId])}
                    className="p-1 text-slate-600 hover:text-rose-400 transition-colors"
                    aria-label={`Remove ${row.itemName}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )
            : undefined
        }
      />

      {isAdmin && rows.length > 0 && (
        <p className="mt-2 text-xs text-slate-600">
          <Plus className="w-3 h-3 inline mr-1" />
          Click a minimum to edit it in place.
        </p>
      )}

      <ItemDetailSheet typeId={detailTypeId} open={!!detailTypeId} onOpenChange={(v) => !v && setDetailTypeId(null)} />
      <BulkPasteDialog open={pasteOpen} onOpenChange={setPasteOpen} onDone={invalidate} />
    </Page>
  );
}
