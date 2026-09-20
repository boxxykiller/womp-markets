import { Loader2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { STATUS_META, deltaClass, formatDays, formatISK, formatPct, formatQty, formatRate } from '@/lib/format';

export function StatusBadge({ status }) {
  const meta = STATUS_META[status];
  if (!meta) return <span className="text-slate-600">—</span>;
  return <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium', meta.badge)}>{meta.label}</span>;
}

/**
 * The item table used by Browse and Tracked.
 *
 * One component for both so a column means the same thing on either page.
 * `columns` selects which of the shared set to show, and `selectable` turns
 * on the checkbox column that feeds the cart.
 */
export function MarketTable({
  rows,
  isLoading,
  columns = ['status', 'min', 'local', 'jita', 'spread', 'volume', 'cover'],
  selectable = false,
  selectedIds = [],
  onToggleSelect,
  onToggleAll,
  onRowClick,
  rowActions,
  emptyMessage = 'No items match these filters.',
}) {
  const show = (c) => columns.includes(c);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  // Header cell count, so loading and empty states span the full width.
  const colSpan =
    1 +
    (selectable ? 1 : 0) +
    (show('status') ? 1 : 0) +
    (show('min') ? 1 : 0) +
    (show('local') ? 2 : 0) +
    (show('jita') ? 2 : 0) +
    (show('spread') ? 1 : 0) +
    (show('volume') ? 2 : 0) +
    (show('cover') ? 1 : 0) +
    (rowActions ? 1 : 0);

  return (
    <div className="border border-slate-800 rounded-lg overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-slate-800 hover:bg-transparent">
            {selectable && (
              <TableHead className="w-10">
                <Checkbox checked={allSelected} onCheckedChange={onToggleAll} aria-label="Select all" />
              </TableHead>
            )}
            <TableHead className="text-slate-400 min-w-[200px]">Item</TableHead>
            {show('status') && <TableHead className="text-slate-400">Status</TableHead>}
            {show('min') && <TableHead className="text-slate-400 text-right">Min</TableHead>}
            {show('local') && (
              <>
                <TableHead className="text-slate-400 text-right">Local buy</TableHead>
                <TableHead className="text-slate-400 text-right">Local sell</TableHead>
              </>
            )}
            {show('jita') && (
              <>
                <TableHead className="text-slate-400 text-right">Jita buy</TableHead>
                <TableHead className="text-slate-400 text-right">Jita sell</TableHead>
              </>
            )}
            {show('spread') && <TableHead className="text-slate-400 text-right">vs Jita</TableHead>}
            {show('volume') && (
              <>
                <TableHead className="text-slate-400 text-right">On market</TableHead>
                <TableHead className="text-slate-400 text-right">Sold/day</TableHead>
              </>
            )}
            {show('cover') && <TableHead className="text-slate-400 text-right">Days left</TableHead>}
            {rowActions && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>

        <TableBody>
          {isLoading && (
            <TableRow className="border-slate-800">
              <TableCell colSpan={colSpan} className="py-10 text-center">
                <Loader2 className="w-5 h-5 animate-spin text-[#4A9EFF] mx-auto" />
              </TableCell>
            </TableRow>
          )}

          {!isLoading && rows.length === 0 && (
            <TableRow className="border-slate-800">
              <TableCell colSpan={colSpan} className="py-10 text-center text-slate-500 text-sm">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}

          {!isLoading &&
            rows.map((row) => (
              <TableRow
                key={row.typeId}
                className={cn('border-slate-800', onRowClick && 'cursor-pointer hover:bg-slate-900/50')}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {selectable && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.includes(row.typeId)}
                      onCheckedChange={() => onToggleSelect(row.typeId)}
                      aria-label={`Select ${row.itemName}`}
                    />
                  </TableCell>
                )}

                <TableCell className="text-slate-200 font-medium">
                  <div className="flex items-center gap-2">
                    <img
                      src={`https://images.evetech.net/types/${row.typeId}/icon?size=32`}
                      alt=""
                      className="w-6 h-6 rounded shrink-0"
                      loading="lazy"
                    />
                    <span className="truncate">{row.itemName ?? `Type ${row.typeId}`}</span>
                  </div>
                </TableCell>

                {show('status') && (
                  <TableCell>
                    <StatusBadge status={row.status} />
                  </TableCell>
                )}

                {show('min') && <TableCell className="text-right text-slate-400 tnum">{formatQty(row.effectiveMin)}</TableCell>}

                {show('local') && (
                  <>
                    <TableCell className="text-right text-rose-400/90 tnum">{formatISK(row.bestBuy)}</TableCell>
                    <TableCell className="text-right text-emerald-400/90 tnum">{formatISK(row.bestSell)}</TableCell>
                  </>
                )}

                {show('jita') && (
                  <>
                    <TableCell className="text-right text-slate-400 tnum">{formatISK(row.jitaBestBuy)}</TableCell>
                    <TableCell className="text-right text-slate-400 tnum">{formatISK(row.jitaBestSell)}</TableCell>
                  </>
                )}

                {show('spread') && (
                  <TableCell className={cn('text-right tnum', deltaClass(row.vsJitaSellPct))}>
                    {formatPct(row.vsJitaSellPct, { signed: true })}
                  </TableCell>
                )}

                {show('volume') && (
                  <>
                    <TableCell className="text-right text-slate-200 tnum">{formatQty(row.sellVolume)}</TableCell>
                    <TableCell className="text-right text-slate-400 tnum">{formatRate(row.avgDaily30)}</TableCell>
                  </>
                )}

                {show('cover') && (
                  <TableCell
                    className={cn(
                      'text-right tnum font-medium',
                      // Colour the runway, not the raw number: under a week
                      // is the point at which restocking has to start.
                      row.daysOfCover30 == null
                        ? 'text-slate-600'
                        : row.daysOfCover30 < 3
                          ? 'text-rose-400'
                          : row.daysOfCover30 < 7
                            ? 'text-amber-400'
                            : 'text-slate-300',
                    )}
                  >
                    {formatDays(row.daysOfCover30)}
                  </TableCell>
                )}

                {rowActions && <TableCell onClick={(e) => e.stopPropagation()}>{rowActions(row)}</TableCell>}
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </div>
  );
}
