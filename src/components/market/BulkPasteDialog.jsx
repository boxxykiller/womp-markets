import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseMultibuy } from '@/lib/multibuy';

/**
 * Admin-only bulk add, in the same format EVE's multibuy uses, so an existing
 * shopping list can be pasted straight in.
 *
 * Two steps on purpose: names are resolved and shown for confirmation before
 * anything is written, because a silent partial import leaves you believing
 * you're tracking items you aren't.
 */
export function BulkPasteDialog({ open, onOpenChange, onDone }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);

  const resolve = useMutation({
    mutationFn: async () => {
      const parsed = parseMultibuy(text);
      if (parsed.length === 0) throw new Error('Nothing to import — paste some lines first.');

      const { matched, unmatched } = await api.sde.resolveNames(parsed.map((p) => p.name));
      const qtyByName = new Map(parsed.map((p) => [p.name.trim().toLowerCase(), p.quantity]));

      return {
        items: matched.map((m) => ({
          typeId: m.typeId,
          itemName: m.name,
          minQuantity: qtyByName.get(m.name.toLowerCase()) ?? 0,
        })),
        unmatched,
      };
    },
    onSuccess: setPreview,
    onError: (err) => toast.error(err.message),
  });

  const save = useMutation({
    mutationFn: () => api.invoke('bulkAddMarketWatchItems', { items: preview.items }),
    onSuccess: (result) => {
      toast.success(`Added ${result.added}, updated ${result.updated}`);
      setText('');
      setPreview(null);
      onOpenChange(false);
      onDone?.();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0D1829] border-[#1E2D45] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white">Bulk add tracked items</DialogTitle>
          <DialogDescription className="text-slate-400">
            One item per line, name then quantity — the same format EVE&apos;s multibuy accepts. The quantity becomes the
            item&apos;s minimum stock level.
          </DialogDescription>
        </DialogHeader>

        {!preview && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              spellCheck={false}
              placeholder={'Tritanium\t1000000\nPyerite\t500000\nMedium Shield Extender II\t20'}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-sm text-slate-200 font-mono scrollbar-thin focus:outline-none focus:border-[#4A9EFF]"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-400">
                Cancel
              </Button>
              <Button
                onClick={() => resolve.mutate()}
                disabled={resolve.isPending}
                className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white"
              >
                {resolve.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Check items
              </Button>
            </div>
          </>
        )}

        {preview && (
          <>
            <div className="text-sm text-slate-300">
              <span className="text-emerald-400 font-medium">{preview.items.length}</span> item
              {preview.items.length === 1 ? '' : 's'} matched.
            </div>

            {preview.unmatched.length > 0 && (
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
                <div className="flex items-center gap-2 text-amber-400 text-sm font-medium mb-1">
                  <AlertTriangle className="w-4 h-4" />
                  {preview.unmatched.length} line{preview.unmatched.length === 1 ? '' : 's'} didn&apos;t match an item
                </div>
                {/* Reported rather than silently dropped — a name that
                    doesn't resolve is usually a typo worth fixing. */}
                <div className="text-xs text-amber-300/80 font-mono max-h-24 overflow-y-auto scrollbar-thin">
                  {preview.unmatched.map((n, i) => (
                    <div key={i}>{n}</div>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-56 overflow-y-auto scrollbar-thin rounded-lg border border-slate-800 divide-y divide-slate-800/70">
              {preview.items.map((item) => (
                <div key={item.typeId} className="flex items-center justify-between px-3 py-1.5 text-sm">
                  <span className="text-slate-300 truncate">{item.itemName}</span>
                  <span className="text-slate-500 tnum">min {item.minQuantity.toLocaleString()}</span>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)} className="text-slate-400">
                Back
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={save.isPending || preview.items.length === 0}
                className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white"
              >
                {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Add {preview.items.length} item{preview.items.length === 1 ? '' : 's'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
