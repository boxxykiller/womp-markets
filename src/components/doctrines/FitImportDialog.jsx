import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ROLES, ROLE_META, ShipIcon } from './shared';

const PLACEHOLDER = `[Ferox, WOMP Ferox]
Damage Control II
Magnetic Field Stabilizer II

Large Shield Extender II

250mm Railgun II, Spike M

Medium Core Defense Field Extender I

Hornet EC-300 x5

Spike M x2000`;

/**
 * Paste EFT fits into a doctrine, or replace one fit's contents.
 *
 * Two steps, like the Tracked bulk paste: every line is resolved and shown
 * before anything is saved, because a module that silently failed to match
 * would make the fit read as fully stocked when it isn't.
 */
export function FitImportDialog({ open, onOpenChange, doctrine, replaceFit, onDone }) {
  const [text, setText] = useState('');
  const [role, setRole] = useState('main');
  const [minQuantity, setMinQuantity] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setPreview(null);
    setRole('main');
    setMinQuantity('');
  }, [open]);

  const check = useMutation({
    mutationFn: () => api.invoke('previewDoctrineFits', { eft: text }),
    onSuccess: ({ fits }) => setPreview(fits),
    onError: (err) => toast.error(err.message),
  });

  const save = useMutation({
    mutationFn: () =>
      replaceFit
        ? api.invoke('updateDoctrineFit', { id: replaceFit.id, eft: text })
        : api.invoke('importDoctrineFits', {
            doctrineId: doctrine.id,
            eft: text,
            role,
            minQuantity: minQuantity === '' ? null : Number(minQuantity),
          }),
    onSuccess: (result) => {
      if (replaceFit) toast.success('Fit replaced');
      else {
        toast.success(`Imported ${result.created} fit${result.created === 1 ? '' : 's'}`);
        for (const f of result.failed ?? []) toast.error(`${f.name}: ${f.error}`);
      }
      onOpenChange(false);
      onDone?.();
    },
    onError: (err) => toast.error(err.message),
  });

  const usable = preview?.filter((f) => !f.error) ?? [];
  const tooMany = replaceFit && preview && preview.length !== 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0D1829] border-[#1E2D45] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-white">
            {replaceFit ? `Replace ${replaceFit.name}` : `Add fits to ${doctrine?.name ?? 'doctrine'}`}
          </DialogTitle>
          <DialogDescription className="text-slate-400">
            Paste a fit in EFT format — in game, open the fitting window and use <em>Copy to clipboard</em>; in pyfa,
            <em> Export → EFT</em>.{' '}
            {replaceFit ? 'The fit keeps its role and minimum.' : 'Several fits can be pasted at once.'}
          </DialogDescription>
        </DialogHeader>

        {!preview && (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={14}
              spellCheck={false}
              placeholder={PLACEHOLDER}
              className="w-full rounded-lg bg-slate-950 border border-slate-800 p-3 text-sm text-slate-200 font-mono scrollbar-thin focus:outline-none focus:border-[#4A9EFF]"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-400">
                Cancel
              </Button>
              <Button
                onClick={() => check.mutate()}
                disabled={check.isPending || !text.trim()}
                className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white"
              >
                {check.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Check fit{replaceFit ? '' : 's'}
              </Button>
            </div>
          </>
        )}

        {preview && (
          <>
            <div className="max-h-[45vh] overflow-y-auto scrollbar-thin space-y-2">
              {preview.map((fit, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-3 ${fit.error ? 'border-rose-500/40 bg-rose-500/5' : 'border-slate-800 bg-slate-900/40'}`}
                >
                  <div className="flex items-center gap-3">
                    <ShipIcon typeId={fit.shipTypeId} size={32} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white truncate">{fit.name}</div>
                      <div className="text-xs text-slate-500">
                        {fit.shipName} · {fit.items.length} item types ·{' '}
                        {fit.items.reduce((sum, it) => sum + (it.kind === 'module' ? it.quantity : 0), 0)} modules
                      </div>
                    </div>
                  </div>
                  {fit.error && <div className="mt-2 text-xs text-rose-400">{fit.error} — this fit will be skipped.</div>}
                  {fit.unmatched.length > 0 && (
                    <div className="mt-2 flex gap-2 text-xs text-amber-300/90">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                      <span>
                        Not recognised (won&apos;t be counted): <span className="font-mono">{fit.unmatched.join(', ')}</span>
                      </span>
                    </div>
                  )}
                  {fit.skipped.length > 0 && (
                    <div className="mt-1 text-xs text-slate-500">
                      Not sold on the market, ignored: {fit.skipped.join(', ')}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {tooMany && (
              <div className="text-sm text-rose-400">Paste exactly one fit to replace this one.</div>
            )}

            {!replaceFit && usable.length > 0 && (
              <div className="flex flex-wrap items-end gap-4">
                <label className="block">
                  <span className="block text-xs font-medium text-slate-400 mb-1.5">Role</span>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="h-9 rounded-md bg-slate-950/60 border border-slate-700 px-3 text-sm text-slate-200 focus:outline-none focus:border-[#4A9EFF]"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_META[r].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-medium text-slate-400 mb-1.5">Minimum on market</span>
                  <Input
                    type="number"
                    min="0"
                    value={minQuantity}
                    onChange={(e) => setMinQuantity(e.target.value)}
                    placeholder={`Default (${doctrine?.minQuantity ?? 0})`}
                    className="w-40 h-9 bg-slate-950/60 border-slate-700 text-slate-200 tnum"
                  />
                </label>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)} className="text-slate-400">
                Back
              </Button>
              <Button
                onClick={() => save.mutate()}
                disabled={save.isPending || usable.length === 0 || tooMany}
                className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white"
              >
                {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {replaceFit ? 'Replace fit' : `Add ${usable.length} fit${usable.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
