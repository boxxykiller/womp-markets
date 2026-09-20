import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { MarketTable } from '@/components/market/MarketTable';
import { TableToolbar } from '@/components/market/TableToolbar';
import { ItemDetailSheet } from '@/components/market/ItemDetailSheet';
import { Button } from '@/components/ui/button';
import { useDebounced } from '@/hooks/useDebounced';
import { formatRelative } from '@/lib/format';

const PAGE_SIZE = 100;

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'volume', label: 'Sold per day' },
  { value: 'sellVolume', label: 'On market' },
  { value: 'spread', label: 'vs Jita' },
  { value: 'daysOfCover', label: 'Days left' },
];

export default function Browse() {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState(null);
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(0);
  const [detailTypeId, setDetailTypeId] = useState(null);

  const debouncedSearch = useDebounced(search);

  const { data, isLoading } = useQuery({
    queryKey: ['browse', debouncedSearch, categoryId, sort, page],
    queryFn: () =>
      api.invoke('getMarketBrowse', {
        search: debouncedSearch || undefined,
        marketGroupId: categoryId ?? undefined,
        sort,
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

      <TableToolbar
        search={search}
        onSearchChange={changeFilter(setSearch)}
        categories={categoryData?.categories ?? []}
        categoryId={categoryId}
        onCategoryChange={changeFilter(setCategoryId)}
        sort={sort}
        onSortChange={changeFilter(setSort)}
        sortOptions={SORT_OPTIONS}
      />

      <MarketTable
        rows={rows}
        isLoading={isLoading}
        onRowClick={(row) => setDetailTypeId(row.typeId)}
        columns={['local', 'jita', 'spread', 'volume', 'cover']}
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

      <ItemDetailSheet typeId={detailTypeId} open={!!detailTypeId} onOpenChange={(v) => !v && setDetailTypeId(null)} />
    </Page>
  );
}
