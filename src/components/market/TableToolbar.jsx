import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { STATUS_META } from '@/lib/format';

const ALL = '__all__';

/**
 * The search + filter bar shared by Browse, Tracked and the report dialogs,
 * so filtering behaves identically everywhere rather than each table growing
 * its own slightly different controls.
 *
 * Status filtering is multi-select (toggled chips) because the useful
 * question is usually "show me everything that isn't OK", which is two
 * statuses at once.
 */
export function TableToolbar({
  search,
  onSearchChange,
  statuses,
  onStatusesChange,
  categories = [],
  categoryId,
  onCategoryChange,
  sort,
  onSortChange,
  sortOptions = [],
  right,
}) {
  const showStatus = !!onStatusesChange;

  function toggleStatus(key) {
    const next = statuses.includes(key) ? statuses.filter((s) => s !== key) : [...statuses, key];
    onStatusesChange(next);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative flex-1 min-w-[220px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search items…"
          className="pl-9 pr-8 bg-slate-900/60 border-slate-800 text-slate-200 placeholder:text-slate-600"
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300"
            aria-label="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showStatus && (
        <div className="flex items-center gap-1">
          {Object.entries(STATUS_META).map(([key, meta]) => {
            const active = statuses.includes(key);
            return (
              <button
                key={key}
                onClick={() => toggleStatus(key)}
                className={cn(
                  'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                  active
                    ? meta.badge
                    : 'border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700',
                )}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      )}

      {categories.length > 0 && (
        <Select
          value={categoryId ? String(categoryId) : ALL}
          onValueChange={(v) => onCategoryChange(v === ALL ? null : Number(v))}
        >
          <SelectTrigger className="w-[200px] bg-slate-900/60 border-slate-800 text-slate-200">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent className="bg-[#0D1829] border-[#1E2D45] max-h-72">
            <SelectItem value={ALL}>All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name} ({c.itemCount})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {sortOptions.length > 0 && (
        <Select value={sort} onValueChange={onSortChange}>
          <SelectTrigger className="w-[190px] bg-slate-900/60 border-slate-800 text-slate-200">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent className="bg-[#0D1829] border-[#1E2D45]">
            {sortOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {right}
    </div>
  );
}
