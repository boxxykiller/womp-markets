import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Create or edit a doctrine folder. `doctrine` null means create. */
export function DoctrineDialog({ open, onOpenChange, doctrine, onSaved }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [minQuantity, setMinQuantity] = useState('0');

  useEffect(() => {
    if (!open) return;
    setName(doctrine?.name ?? '');
    setDescription(doctrine?.description ?? '');
    setMinQuantity(String(doctrine?.minQuantity ?? 0));
  }, [open, doctrine]);

  const save = useMutation({
    mutationFn: () =>
      api.invoke('saveDoctrine', {
        id: doctrine?.id,
        name,
        description,
        minQuantity: Number(minQuantity) || 0,
      }),
    onSuccess: ({ doctrine: saved }) => {
      toast.success(doctrine ? 'Doctrine updated' : `Created ${saved.name}`);
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0D1829] border-[#1E2D45] max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-white">{doctrine ? 'Edit doctrine' : 'New doctrine'}</DialogTitle>
          <DialogDescription className="text-slate-400">
            A doctrine is a folder of fits. Its minimum is the default number of each fit to keep on market; any fit can
            override it.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-4"
        >
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">Name</span>
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ferox Fleet"
              className="bg-slate-950/60 border-slate-700 text-slate-200"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">Notes (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Comms channel, FC notes, when it's used…"
              className="w-full rounded-md bg-slate-950/60 border border-slate-700 p-2.5 text-sm text-slate-200 focus:outline-none focus:border-[#4A9EFF]"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-400 mb-1.5">Default minimum per fit</span>
            <Input
              type="number"
              min="0"
              value={minQuantity}
              onChange={(e) => setMinQuantity(e.target.value)}
              className="w-32 bg-slate-950/60 border-slate-700 text-slate-200 tnum"
            />
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-slate-400">
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || !name.trim()} className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
              {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {doctrine ? 'Save' : 'Create doctrine'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
