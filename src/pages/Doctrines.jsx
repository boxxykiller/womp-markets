import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ChevronDown, ClipboardPaste, FolderOpen, Gauge, Loader2, Pencil, Plus, Search, ShoppingCart, Swords, Trash2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { StatusBadge } from '@/components/market/MarketTable';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EditableNumber } from '@/components/ui/EditableNumber';
import { DoctrineDialog } from '@/components/doctrines/DoctrineDialog';
import { FitImportDialog } from '@/components/doctrines/FitImportDialog';
import { FitDetailSheet } from '@/components/doctrines/FitDetailSheet';
import { MissingSheet } from '@/components/doctrines/MissingSheet';
import { ReadyBar, RoleBadge, ShipIcon, StatusDot } from '@/components/doctrines/shared';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';
import { formatISK, formatISKFull, formatQty, formatRelative } from '@/lib/format';

const COLLAPSED_KEY = 'womp.doctrines.collapsed';

// Which folders are collapsed is a per-viewer convenience, so it lives in
// browser storage; the page works the same when storage is unavailable.
function readCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function FitRow({ fit, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full grid grid-cols-[auto_1fr_auto] sm:grid-cols-[auto_1fr_auto_7rem_auto] items-center gap-x-3 px-4 py-2 text-left hover:bg-[#1E2D45]/40 transition-colors"
    >
      <ShipIcon typeId={fit.shipTypeId} size={32} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-slate-200 truncate">{fit.name}</span>
          <span className="hidden md:inline"><RoleBadge role={fit.role} /></span>
          {fit.unmatched.length > 0 && (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-label="Some lines didn't match an item" />
          )}
        </div>
        <div className="text-xs text-slate-500 truncate">
          {fit.shipName}
          {fit.missingItems > 0 && <span className="text-rose-400/80"> · {fit.missingItems} part{fit.missingItems === 1 ? '' : 's'} short</span>}
        </div>
      </div>
      <div className="text-right tnum">
        <span
          className={cn(
            'text-sm font-semibold',
            fit.status === 'ok' ? 'text-emerald-400' : fit.status === 'low' ? 'text-amber-400' : 'text-rose-400',
          )}
        >
          {formatQty(fit.fittable)}
        </span>
        <span className="text-xs text-slate-500"> / {formatQty(fit.min)}</span>
      </div>
      <ReadyBar value={fit.fittable} max={fit.min} status={fit.status} className="hidden sm:block" />
      <span className="hidden sm:inline-flex"><StatusDot status={fit.status} /></span>
    </button>
  );
}

function DoctrineCard({ doctrine, collapsed, onToggle, isAdmin, onOpenFit, onShowMissing, onAddFits, onEdit, onDelete, onSetMin }) {
  const pct = doctrine.coverage != null ? Math.floor(doctrine.coverage * 100) : null;

  return (
    <div
      className={cn(
        'rounded-2xl border bg-[#0D1829]/80 backdrop-blur overflow-hidden',
        doctrine.status === 'ok' ? 'border-emerald-500/25' : doctrine.status === 'low' ? 'border-amber-500/25' : doctrine.status ? 'border-rose-500/30' : 'border-[#1E2D45]',
      )}
    >
      <div className="flex flex-wrap items-start gap-3 px-4 pt-4 pb-3">
        <button onClick={onToggle} className="mt-0.5 p-0.5 text-slate-500 hover:text-white" aria-label={collapsed ? 'Expand' : 'Collapse'}>
          <ChevronDown className={cn('w-4 h-4 transition-transform', collapsed && '-rotate-90')} />
        </button>
        <FolderOpen className="w-5 h-5 mt-0.5 text-violet-400 shrink-0" />
        <div className="min-w-[10rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={onToggle} className="text-base font-semibold text-white truncate text-left">
              {doctrine.name}
            </button>
            {doctrine.status ? <StatusBadge status={doctrine.status} /> : <span className="text-xs text-slate-500">No fits yet</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
            <span>
              <span className="text-slate-200 font-medium tnum">{doctrine.fitsReady}</span>/{doctrine.fitsTotal} fits at minimum
            </span>
            <span>
              <span className="text-slate-200 font-medium tnum">{formatQty(doctrine.hullsFittable)}</span>/{formatQty(doctrine.hullsNeeded)} hulls
            </span>
            {pct != null && <span className="tnum">{pct}% ready</span>}
          </div>
          {pct != null && <ReadyBar value={doctrine.coverage} max={1} status={doctrine.status} className="mt-2 max-w-xs" />}
          {doctrine.description && <p className="mt-2 text-xs text-slate-500 whitespace-pre-line">{doctrine.description}</p>}
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-auto">
          {isAdmin ? (
            <div className="flex items-center gap-1 text-xs text-slate-500" title="Default minimum per fit — click to edit">
              <span>min</span>
              <div className="w-12">
                <EditableNumber value={doctrine.minQuantity} onSave={onSetMin} title="Default minimum per fit — click to edit" />
              </div>
            </div>
          ) : (
            <span className="text-xs text-slate-500">min {doctrine.minQuantity} each</span>
          )}
          {isAdmin && (
            <>
              <button onClick={onEdit} className="p-1.5 text-slate-500 hover:text-white" aria-label={`Edit ${doctrine.name}`}>
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={onDelete} className="p-1.5 text-slate-600 hover:text-rose-400" aria-label={`Delete ${doctrine.name}`}>
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {doctrine.fits.length > 0 && (
            <div className="border-t border-[#1E2D45]/70 divide-y divide-[#1E2D45]/50">
              {doctrine.fits.map((fit) => (
                <FitRow key={fit.id} fit={fit} onClick={() => onOpenFit(fit.id)} />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-t border-[#1E2D45]/70 bg-slate-950/20">
            {doctrine.missing.length > 0 ? (
              <button onClick={onShowMissing} className="text-xs text-rose-300 hover:text-rose-200">
                <ShoppingCart className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                {doctrine.missing.length} part{doctrine.missing.length === 1 ? '' : 's'} short
                <span className="text-slate-500" title={formatISKFull(doctrine.missingCostJita)}>
                  {' '}· ~{formatISK(doctrine.missingCostJita)} ISK to fill
                </span>
              </button>
            ) : doctrine.fits.length > 0 ? (
              <span className="text-xs text-emerald-400">Fully stocked</span>
            ) : (
              <span className="text-xs text-slate-500">{isAdmin ? 'Paste some fits to get started.' : 'No fits added yet.'}</span>
            )}
            <div className="flex-1" />
            {isAdmin && (
              <Button size="sm" variant="outline" onClick={onAddFits} className="h-7 border-slate-700 text-slate-300">
                <ClipboardPaste className="w-3.5 h-3.5 mr-1" />
                Add fits
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function Doctrines() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [notReadyOnly, setNotReadyOnly] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [doctrineDialog, setDoctrineDialog] = useState(null); // { doctrine } | null
  const [importFor, setImportFor] = useState(null); // { doctrineId, replaceFitId? }
  const [openFitId, setOpenFitId] = useState(null);
  const [missingFor, setMissingFor] = useState(null); // doctrine id, or 'all'

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
    } catch {
      // Storage blocked — collapsing still works for this visit.
    }
  }, [collapsed]);

  const { data, isLoading } = useQuery({
    queryKey: ['doctrines'],
    queryFn: () => api.invoke('getDoctrines', {}),
    refetchInterval: 60_000,
  });

  const doctrines = data?.doctrines ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['doctrines'] });
  }

  const saveMin = useMutation({
    mutationFn: ({ doctrine, minQuantity }) =>
      api.invoke('saveDoctrine', { id: doctrine.id, name: doctrine.name, description: doctrine.description, minQuantity }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err.message),
  });

  const removeDoctrine = useMutation({
    mutationFn: (id) => api.invoke('deleteDoctrine', { id }),
    onSuccess: () => {
      toast.success('Doctrine deleted');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const totals = useMemo(() => {
    const t = { ready: 0, withFits: 0, fitsReady: 0, fitsTotal: 0, hullsFittable: 0, hullsNeeded: 0 };
    for (const d of doctrines) {
      if (d.fitsTotal > 0) t.withFits += 1;
      if (d.status === 'ok') t.ready += 1;
      t.fitsReady += d.fitsReady;
      t.fitsTotal += d.fitsTotal;
      t.hullsFittable += d.hullsFittable;
      t.hullsNeeded += d.hullsNeeded;
    }
    return t;
  }, [doctrines]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return doctrines
      .filter((d) => !notReadyOnly || (d.status && d.status !== 'ok'))
      .map((d) => {
        if (!q || d.name.toLowerCase().includes(q)) return d;
        const fits = d.fits.filter((f) => f.name.toLowerCase().includes(q) || String(f.shipName).toLowerCase().includes(q));
        return fits.length ? { ...d, fits } : null;
      })
      .filter(Boolean);
  }, [doctrines, search, notReadyOnly]);

  // Sheets look their subject up in the latest data, so they update in place
  // after an edit or a refetch rather than showing a stale copy.
  const openFit = useMemo(() => {
    for (const d of doctrines) {
      const fit = d.fits.find((f) => f.id === openFitId);
      if (fit) return { fit, doctrine: d };
    }
    return null;
  }, [doctrines, openFitId]);

  const importDoctrine = doctrines.find((d) => d.id === importFor?.doctrineId) ?? null;
  const replaceFit = importFor?.replaceFitId ? importDoctrine?.fits.find((f) => f.id === importFor.replaceFitId) : null;
  const missingDoctrine = missingFor && missingFor !== 'all' ? doctrines.find((d) => d.id === missingFor) : null;

  const readyVariant =
    totals.withFits === 0 ? 'slate' : totals.ready === totals.withFits ? 'emerald' : totals.ready > 0 ? 'amber' : 'rose';
  const fitsPct = totals.fitsTotal ? totals.fitsReady / totals.fitsTotal : null;

  function toggleCollapsed(id) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Page>
      <PageHeader
        icon={Swords}
        accent="violet"
        title="Doctrines"
        subtitle={
          data?.source
            ? `Fleet readiness — how many of each fit ${data.source.name ?? 'the market'} can supply right now · updated ${formatRelative(data.source.lastPolledAt)}`
            : 'Fleet readiness — how many of each fit the market can supply right now'
        }
      >
        {(data?.allMissing?.length ?? 0) > 0 && (
          <Button variant="outline" onClick={() => setMissingFor('all')} className="border-slate-700 text-slate-300">
            <ShoppingCart className="w-4 h-4 mr-2" />
            Everything missing
          </Button>
        )}
        {isAdmin && (
          <Button onClick={() => setDoctrineDialog({ doctrine: null })} className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
            <Plus className="w-4 h-4 mr-2" />
            New doctrine
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          title="Doctrines ready"
          value={totals.withFits ? `${totals.ready}/${totals.withFits}` : '—'}
          subtitle="every fit stocked to minimum"
          icon={Swords}
          variant={readyVariant}
          onClick={() => setNotReadyOnly(false)}
        />
        <StatCard
          title="Fits at minimum"
          value={fitsPct != null ? `${Math.floor(fitsPct * 100)}%` : '—'}
          subtitle={`${totals.fitsReady} of ${totals.fitsTotal} fits`}
          icon={Gauge}
          variant={fitsPct == null ? 'slate' : fitsPct >= 0.9 ? 'emerald' : fitsPct >= 0.6 ? 'amber' : 'rose'}
          onClick={() => setNotReadyOnly(true)}
        />
        <StatCard
          title="Hulls fittable"
          value={formatQty(totals.hullsFittable)}
          subtitle={`${formatQty(totals.hullsNeeded)} wanted across all fits`}
          variant="blue"
        />
        <StatCard
          title="Cost to fill"
          value={data ? formatISK(data.allMissingCostJita) : '—'}
          subtitle={data ? `${data.allMissing.length} items short · Jita sell` : ''}
          icon={ShoppingCart}
          variant={data?.allMissing?.length ? 'rose' : 'emerald'}
          onClick={() => setMissingFor('all')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search doctrines, fits or ships…"
            className="pl-9 pr-8 bg-slate-900/60 border-slate-800 text-slate-200 placeholder:text-slate-600"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-500 hover:text-slate-300"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => setNotReadyOnly((v) => !v)}
          className={cn(
            'px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors',
            notReadyOnly
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
              : 'border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700',
          )}
        >
          Not ready only
        </button>
        {doctrines.length > 1 && (
          <button
            onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(doctrines.map((d) => d.id)))}
            className="px-2.5 py-1.5 rounded-lg text-xs font-medium border border-slate-800 text-slate-500 hover:text-slate-300 hover:border-slate-700"
          >
            {collapsed.size ? 'Expand all' : 'Collapse all'}
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-40">
          <Loader2 className="w-5 h-5 animate-spin text-[#4A9EFF]" />
        </div>
      )}

      {!isLoading && doctrines.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[#1E2D45] p-10 text-center">
          <FolderOpen className="w-8 h-8 mx-auto text-violet-400/70 mb-3" />
          <div className="text-slate-300 font-medium">No doctrines yet</div>
          <p className="text-sm text-slate-500 mt-1">
            {isAdmin
              ? 'Create a doctrine, then paste its fits from the game or pyfa.'
              : 'An administrator can add doctrines and their fits.'}
          </p>
          {isAdmin && (
            <Button onClick={() => setDoctrineDialog({ doctrine: null })} className="mt-4 bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white">
              <Plus className="w-4 h-4 mr-2" />
              New doctrine
            </Button>
          )}
        </div>
      )}

      {!isLoading && doctrines.length > 0 && visible.length === 0 && (
        <div className="text-sm text-slate-500 py-10 text-center">Nothing matches.</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        {visible.map((doctrine) => (
          <DoctrineCard
            key={doctrine.id}
            doctrine={doctrine}
            collapsed={collapsed.has(doctrine.id) && !search}
            onToggle={() => toggleCollapsed(doctrine.id)}
            isAdmin={isAdmin}
            onOpenFit={setOpenFitId}
            onShowMissing={() => setMissingFor(doctrine.id)}
            onAddFits={() => setImportFor({ doctrineId: doctrine.id })}
            onEdit={() => setDoctrineDialog({ doctrine })}
            onDelete={() => {
              if (window.confirm(`Delete ${doctrine.name} and its ${doctrine.fitsTotal} fit${doctrine.fitsTotal === 1 ? '' : 's'}?`)) {
                removeDoctrine.mutate(doctrine.id);
              }
            }}
            onSetMin={(minQuantity) => saveMin.mutate({ doctrine, minQuantity })}
          />
        ))}
      </div>

      <DoctrineDialog
        open={!!doctrineDialog}
        onOpenChange={(v) => !v && setDoctrineDialog(null)}
        doctrine={doctrineDialog?.doctrine ?? null}
        onSaved={(saved) => {
          invalidate();
          // A brand-new doctrine is empty; go straight to pasting its fits.
          if (!doctrineDialog?.doctrine) setImportFor({ doctrineId: saved.id });
        }}
      />

      <FitImportDialog
        open={!!importFor && !!importDoctrine}
        onOpenChange={(v) => !v && setImportFor(null)}
        doctrine={importDoctrine}
        replaceFit={replaceFit}
        onDone={invalidate}
      />

      <FitDetailSheet
        open={!!openFit}
        onOpenChange={(v) => !v && setOpenFitId(null)}
        fit={openFit?.fit}
        doctrine={openFit?.doctrine}
        isAdmin={isAdmin}
        onChanged={invalidate}
        onReplace={() => {
          // One modal at a time: the paste dialog replaces the sheet.
          setImportFor({ doctrineId: openFit.doctrine.id, replaceFitId: openFit.fit.id });
          setOpenFitId(null);
        }}
      />

      <MissingSheet
        open={!!missingFor}
        onOpenChange={(v) => !v && setMissingFor(null)}
        title={missingFor === 'all' ? 'Everything missing' : `${missingDoctrine?.name ?? ''} — missing`}
        subtitle={
          missingFor === 'all'
            ? 'Combined across every doctrine, since they all draw on the same stock'
            : 'Combined across this doctrine’s fits at their minimums'
        }
        missing={missingFor === 'all' ? data?.allMissing : missingDoctrine?.missing}
        totalCost={missingFor === 'all' ? data?.allMissingCostJita : missingDoctrine?.missingCostJita}
      />
    </Page>
  );
}
