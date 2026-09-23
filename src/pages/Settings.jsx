import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Loader2, RefreshCw, Save, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Page, PageHeader } from '@/components/layout/PageHeader';
import { AccessPolicySection, UsersSection } from '@/components/settings/AccessSettings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

function Section({ title, description, children }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 mb-5">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {description && <p className="text-sm text-slate-400 mt-0.5 mb-4">{description}</p>}
      {children}
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <div className="text-xs font-medium text-[#4A7BA7] mb-1">{label}</div>
      {children}
      {hint && <div className="text-xs text-slate-600 mt-1">{hint}</div>}
    </label>
  );
}

/** Add or edit one market source. Doubles as the first-run wizard. */
function SourceForm({ source, onDone, isFirstRun }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    structureId: source?.structureId ?? '',
    readerCharacterName: source?.readerCharacterName ?? '',
    pollIntervalMinutes: source?.pollIntervalMinutes ?? 15,
    retentionDays: source?.retentionDays ?? 180,
  });

  const save = useMutation({
    mutationFn: () =>
      api.invoke('saveMarketSource', {
        id: source?.id,
        ...form,
        // A first source has to become the default, or every page keeps
        // reporting that nothing is configured.
        isPrimary: isFirstRun || source?.isPrimary,
      }),
    onSuccess: () => {
      toast.success('Market source saved');
      queryClient.invalidateQueries({ queryKey: ['system-status'] });
      queryClient.invalidateQueries({ queryKey: ['market-overview'] });
      onDone?.();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Structure ID" hint="The citadel's 13-digit Upwell structure id.">
        <Input
          value={form.structureId}
          onChange={(e) => setForm((f) => ({ ...f, structureId: e.target.value.trim() }))}
          placeholder="1000000000000"
          disabled={!!source}
          className="bg-slate-900 border-slate-700 text-slate-200 tnum disabled:opacity-60"
        />
      </Field>

      <Field label="Reader character" hint="A signed-in character with docking access to that structure.">
        <Input
          value={form.readerCharacterName}
          onChange={(e) => setForm((f) => ({ ...f, readerCharacterName: e.target.value }))}
          placeholder="Character name"
          className="bg-slate-900 border-slate-700 text-slate-200"
        />
      </Field>

      <Field label="Poll interval (minutes)" hint="How often the order book is re-read. 15 is a good default.">
        <Input
          type="number"
          min="1"
          value={form.pollIntervalMinutes}
          onChange={(e) => setForm((f) => ({ ...f, pollIntervalMinutes: Number(e.target.value) }))}
          className="bg-slate-900 border-slate-700 text-slate-200 tnum"
        />
      </Field>

      <Field label="Retention (days)" hint="How long daily stats and the event feed are kept. Order history is kept forever.">
        <Input
          type="number"
          min="1"
          value={form.retentionDays}
          onChange={(e) => setForm((f) => ({ ...f, retentionDays: Number(e.target.value) }))}
          className="bg-slate-900 border-slate-700 text-slate-200 tnum"
        />
      </Field>

      <div className="sm:col-span-2 flex gap-2">
        <Button
          onClick={() => save.mutate()}
          disabled={!form.structureId || save.isPending}
          className="bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white"
        >
          {save.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          {source ? 'Save changes' : 'Add market source'}
        </Button>
        {onDone && source && (
          <Button variant="ghost" onClick={onDone} className="text-slate-400">
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['system-status'],
    queryFn: () => api.invoke('getSystemStatus', {}),
    refetchInterval: 30_000,
  });

  function refetchAll() {
    queryClient.invalidateQueries({ queryKey: ['system-status'] });
  }

  const pollNow = useMutation({
    mutationFn: (id) => api.invoke('pollMarketNow', { id }),
    onSuccess: (r) => {
      toast[r?.error ? 'error' : 'success'](r?.error ?? `Polled ${r.orderCount ?? 0} orders`);
      refetchAll();
    },
    onError: (err) => toast.error(err.message),
  });

  const refreshSde = useMutation({
    mutationFn: () => api.invoke('refreshSde', {}),
    onSuccess: () => {
      toast.success('SDE check started — this can take several minutes.');
      refetchAll();
    },
    onError: (err) => toast.error(err.message),
  });

  const refreshJita = useMutation({
    mutationFn: () => api.invoke('refreshJitaPrices', {}),
    onSuccess: (r) => {
      toast.success(`Refreshed ${r.updated ?? 0} Jita prices`);
      refetchAll();
    },
    onError: (err) => toast.error(err.message),
  });

  const removeSource = useMutation({
    mutationFn: (id) => api.invoke('deleteMarketSource', { id }),
    onSuccess: () => {
      toast.success('Market source removed');
      refetchAll();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <Page>
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-[#4A9EFF]" />
        </div>
      </Page>
    );
  }

  const sources = status?.sources ?? [];
  const isFirstRun = sources.length === 0;

  return (
    <Page>
      <PageHeader
        icon={SettingsIcon}
        accent="slate"
        title="Settings"
        subtitle="Market sources, access, users, static data, and reference pricing"
      />

      {isFirstRun && (
        <div className="rounded-xl border border-[#4A9EFF]/30 bg-[#4A9EFF]/10 p-5 mb-5">
          <h2 className="text-base font-semibold text-white mb-1">Set up your citadel</h2>
          <p className="text-sm text-slate-400 mb-4">
            Enter the structure id of the citadel you want to track and the character whose token should read its market.
            Nothing is polled until this is configured.
          </p>
          {isAdmin ? (
            <SourceForm isFirstRun onDone={refetchAll} />
          ) : (
            <p className="text-sm text-amber-400">An administrator needs to complete this setup.</p>
          )}
        </div>
      )}

      {sources.length > 0 && (
        <Section title="Market sources" description="The citadels being polled for order book data.">
          <div className="space-y-3">
            {sources.map((s) => (
              <div key={s.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-white truncate">{s.name ?? s.structureId}</span>
                      {s.isPrimary && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#4A9EFF]/20 text-[#4A9EFF]">
                          Primary
                        </span>
                      )}
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded text-[10px] font-medium',
                          s.lastPollStatus === 'ok'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : s.lastPollStatus === 'error'
                              ? 'bg-rose-500/20 text-rose-400'
                              : 'bg-slate-700/40 text-slate-400',
                        )}
                      >
                        {s.lastPollStatus}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 tnum">
                      {s.structureId}
                      {s.systemName && ` · ${s.systemName}`}
                      {s.regionName && ` · ${s.regionName}`}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      Reader: {s.readerCharacterName ?? '—'} · every {s.pollIntervalMinutes}m · last polled{' '}
                      {formatRelative(s.lastPolledAt)}
                    </div>
                    {s.lastPollError && <div className="text-xs text-rose-400 mt-1">{s.lastPollError}</div>}
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => pollNow.mutate(s.id)}
                        disabled={pollNow.isPending}
                        className="border-slate-700 text-slate-300"
                      >
                        <RefreshCw className={cn('w-4 h-4 mr-2', pollNow.isPending && 'animate-spin')} />
                        Poll now
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setEditing(editing === s.id ? null : s.id)}
                        className="text-slate-400"
                      >
                        Edit
                      </Button>
                      <button
                        onClick={() => {
                          // Removing a source deletes all of its collected
                          // market data, including the permanent order
                          // archive, so it is confirmed explicitly.
                          if (confirm(`Remove ${s.name ?? s.structureId} and delete all of its collected market data?`)) {
                            removeSource.mutate(s.id);
                          }
                        }}
                        className="p-1.5 text-slate-600 hover:text-rose-400"
                        aria-label="Remove source"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {editing === s.id && (
                  <div className="mt-4 pt-4 border-t border-slate-800">
                    <SourceForm source={s} onDone={() => setEditing(null)} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {isAdmin && !isFirstRun && editing !== 'new' && (
            <Button variant="ghost" onClick={() => setEditing('new')} className="mt-3 text-[#4A9EFF]">
              Add another source
            </Button>
          )}
          {editing === 'new' && (
            <div className="mt-4 pt-4 border-t border-slate-800">
              <SourceForm onDone={() => setEditing(null)} />
            </div>
          )}
        </Section>
      )}

      {isAdmin && (
        <>
          <AccessPolicySection Section={Section} />
          <UsersSection Section={Section} />
        </>
      )}

      <Section
        title="Static Data Export"
        description="Item names and market groups come from CCP's SDE, checked automatically for new builds."
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {status.sde.meta ? (
              <>
                <div className="text-slate-200 tnum">
                  Build {status.sde.meta.buildNumber}
                  <span className="text-slate-500"> · released {formatDateTime(status.sde.meta.releaseDate)}</span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Ingested {formatRelative(status.sde.meta.ingestedAt)} ·{' '}
                  {Object.keys(status.sde.meta.datasetCounts ?? {}).length} datasets
                </div>
              </>
            ) : (
              <div className="text-amber-400">
                No SDE ingested yet — item names will be missing until the first import completes.
              </div>
            )}
            <div className="text-xs text-slate-600 mt-1">
              {status.env.sdeIntervalHours > 0
                ? `Checking for new builds every ${status.env.sdeIntervalHours}h.`
                : 'Automatic checks are disabled.'}
              {status.sde.lastCheck?.finishedAt && ` Last checked ${formatRelative(status.sde.lastCheck.finishedAt)}.`}
              {status.sde.lastCheck?.ok === false && (
                <span className="text-rose-400"> Last check failed: {status.sde.lastCheck.error}</span>
              )}
            </div>
          </div>

          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => refreshSde.mutate()}
              disabled={refreshSde.isPending || status.sde.ingestInProgress}
              className="border-slate-700 text-slate-300"
            >
              {status.sde.ingestInProgress ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing…
                </>
              ) : (
                <>
                  <Database className="w-4 h-4 mr-2" />
                  Check for update
                </>
              )}
            </Button>
          )}
        </div>
      </Section>

      <Section title="Jita 4-4 reference prices" description="Used for the comparison columns throughout the app.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <div className="text-slate-200 tnum">{status.jita.priceCount.toLocaleString()} items priced</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Last updated {formatRelative(status.jita.lastFetchedAt)} · configured source {status.jita.configuredSource}
            </div>
            <div className="text-xs text-slate-600 mt-0.5">
              {status.jita.bySource.fuzzwork.toLocaleString()} from Fuzzwork,{' '}
              {status.jita.bySource.esi.toLocaleString()} from ESI
              {/* Makes it obvious when the primary provider is down and the
                  fallback is quietly carrying the whole app. */}
              {status.jita.configuredSource === 'fuzzwork' && status.jita.bySource.esi > status.jita.bySource.fuzzwork && (
                <span className="text-amber-400"> — the ESI fallback is doing most of the work.</span>
              )}
            </div>
          </div>

          {isAdmin && (
            <Button
              variant="outline"
              onClick={() => refreshJita.mutate()}
              disabled={refreshJita.isPending}
              className="border-slate-700 text-slate-300"
            >
              <RefreshCw className={cn('w-4 h-4 mr-2', refreshJita.isPending && 'animate-spin')} />
              Refresh prices
            </Button>
          )}
        </div>
      </Section>
    </Page>
  );
}
