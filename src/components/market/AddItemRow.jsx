import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Loader2, Plus } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/hooks/useDebounced';
import { cn } from '@/lib/utils';

/**
 * Admin-only "add a tracked item" row, rendered inline at the top of the
 * Tracked table.
 *
 * The item has to be picked from the SDE rather than typed free-form: the
 * watchlist is keyed by type id, and a typo'd name would otherwise create an
 * item that can never match anything on the market.
 */
export function AddItemRow({ onAdd, isSaving }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [minQuantity, setMinQuantity] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [minDaysCover, setMinDaysCover] = useState('');
  const [targetQuantity, setTargetQuantity] = useState('');

  const debounced = useDebounced(query);

  const { data, isFetching } = useQuery({
    queryKey: ['sde-search', debounced],
    queryFn: () => api.sde.search(debounced),
    enabled: !picked && debounced.trim().length >= 2,
  });

  const results = data?.results ?? [];
  const canSubmit = picked && Number(minQuantity) >= 0 && minQuantity !== '';

  function reset() {
    setQuery('');
    setPicked(null);
    setMinQuantity('');
    setMinDaysCover('');
    setTargetQuantity('');
    setShowAdvanced(false);
  }

  function submit() {
    if (!canSubmit) return;
    onAdd({
      typeId: picked.typeId,
      itemName: picked.name,
      minQuantity: Number(minQuantity),
      minDaysCover: Number(minDaysCover) || 0,
      targetQuantity: targetQuantity === '' ? null : Number(targetQuantity),
    });
    reset();
  }

  return (
    <div className="mb-4 p-3 rounded-lg bg-slate-900/50 border border-slate-800">
      <div className="flex flex-wrap items-start gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Input
            value={picked ? picked.name : query}
            onChange={(e) => {
              setPicked(null);
              setQuery(e.target.value);
            }}
            placeholder="Find an item to track…"
            className="bg-slate-900 border-slate-700 text-slate-200 placeholder:text-slate-600"
          />
          {isFetching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-slate-500" />}

          {!picked && results.length > 0 && (
            <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto scrollbar-thin rounded-lg bg-[#0D1829] border border-[#1E2D45] shadow-xl">
              {results.map((r) => (
                <button
                  key={r.typeId}
                  onClick={() => {
                    setPicked(r);
                    setQuery('');
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm text-slate-300 hover:bg-[#1E2D45]/60"
                >
                  <img src={`https://images.evetech.net/types/${r.typeId}/icon?size=32`} alt="" className="w-5 h-5 rounded" />
                  <span className="truncate">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <Input
          type="number"
          min="0"
          value={minQuantity}
          onChange={(e) => setMinQuantity(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Min qty"
          className="w-32 bg-slate-900 border-slate-700 text-slate-200 tnum"
        />

        <Button
          onClick={submit}
          disabled={!canSubmit || isSaving}
          className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white disabled:opacity-40"
        >
          {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
          Track
        </Button>

        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 px-2 py-2 text-xs text-slate-500 hover:text-slate-300"
        >
          {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          More
        </button>
      </div>

      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-slate-800">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Min days of cover
            <Input
              type="number"
              min="0"
              value={minDaysCover}
              onChange={(e) => setMinDaysCover(e.target.value)}
              className="w-24 h-8 bg-slate-900 border-slate-700 tnum"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-400">
            Restock to
            <Input
              type="number"
              min="0"
              value={targetQuantity}
              onChange={(e) => setTargetQuantity(e.target.value)}
              placeholder="min"
              className="w-24 h-8 bg-slate-900 border-slate-700 tnum"
            />
          </label>
          <span className={cn('text-xs text-slate-600')}>
            Days of cover scales the minimum with actual demand; whichever floor is higher applies.
          </span>
        </div>
      )}
    </div>
  );
}
