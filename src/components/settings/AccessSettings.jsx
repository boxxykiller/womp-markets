// Admin-only Settings sections: who may sign in (the corp/alliance allowlist)
// and everyone who has signed in, or tried to.
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Search, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

function usePolicy() {
  return useQuery({ queryKey: ['access-policy'], queryFn: () => api.invoke('getAccessPolicy', {}) });
}

function useSavePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (next) => api.invoke('saveAccessPolicy', next),
    onSuccess: (policy) => {
      queryClient.setQueryData(['access-policy'], policy);
      // Each user's "allowed" flag depends on the policy.
      queryClient.invalidateQueries({ queryKey: ['characters'] });
      toast.success('Login filter saved');
    },
    onError: (err) => toast.error(err.message),
  });
}

/** Adds an entry to the stored policy, leaving the other list untouched. */
function withEntry(policy, kind, entry) {
  const key = kind === 'corporation' ? 'corporations' : 'alliances';
  const list = policy[key] ?? [];
  if (list.some((e) => e.id === String(entry.id))) return null;
  return {
    corporations: policy.corporations,
    alliances: policy.alliances,
    [key]: [...list, { id: String(entry.id), name: entry.name ?? null }],
  };
}

function Chip({ label, sub, onRemove, locked }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950/60 pl-2.5 pr-1.5 py-1 text-sm">
      <span className="text-slate-200">{label}</span>
      <span className="text-xs text-slate-500 tnum">{sub}</span>
      {locked ? (
        <span className="text-[10px] uppercase tracking-wide text-slate-500 px-1">env</span>
      ) : (
        <button onClick={onRemove} className="p-0.5 text-slate-500 hover:text-rose-400" aria-label={`Remove ${label}`}>
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </span>
  );
}

function AllowList({ kind, title, stored, envIds, policy, save }) {
  const [draftId, setDraftId] = useState('');
  const key = kind === 'corporation' ? 'corporations' : 'alliances';
  const storedIds = new Set(stored.map((e) => e.id));
  // Environment entries are shown for completeness but can't be removed here.
  const envOnly = envIds.filter((id) => !storedIds.has(id));

  function add() {
    const id = draftId.trim();
    if (!/^\d+$/.test(id)) return toast.error(`Enter a numeric ${kind} id.`);
    const next = withEntry(policy, kind, { id });
    if (!next) return toast.info('Already on the list.');
    save.mutate(next, { onSuccess: () => setDraftId('') });
  }

  function remove(id) {
    save.mutate({ corporations: policy.corporations, alliances: policy.alliances, [key]: stored.filter((e) => e.id !== id) });
  }

  return (
    <div>
      <div className="text-xs font-medium text-[#4A7BA7] mb-2">{title}</div>
      <div className="flex flex-wrap gap-2 mb-2 min-h-[2rem]">
        {stored.length === 0 && envOnly.length === 0 && <span className="text-sm text-slate-600 py-1">None</span>}
        {envOnly.map((id) => (
          <Chip key={`env-${id}`} label={id} sub="" locked />
        ))}
        {stored.map((e) => (
          <Chip key={e.id} label={e.name ?? e.id} sub={e.name ? e.id : ''} onRemove={() => remove(e.id)} />
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draftId}
          onChange={(e) => setDraftId(e.target.value.trim())}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder={`Add ${kind} id`}
          className="bg-slate-900 border-slate-700 text-slate-200 tnum h-9 max-w-[14rem]"
        />
        <Button size="sm" variant="outline" onClick={add} disabled={!draftId || save.isPending} className="border-slate-700 text-slate-300 h-9">
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

export function AccessPolicySection({ Section }) {
  const { data: policy, isLoading } = usePolicy();
  const save = useSavePolicy();

  if (isLoading || !policy) {
    return (
      <Section title="Login filter" description="Which corporations and alliances may sign in.">
        <Loader2 className="w-5 h-5 animate-spin text-[#4A9EFF]" />
      </Section>
    );
  }

  const me = policy.me;
  const corpAllowed = me?.corporationId && policy.allowedCorporationIds.includes(me.corporationId);
  const allianceAllowed = me?.allianceId && policy.allowedAllianceIds.includes(me.allianceId);

  function allowMine(kind) {
    const entry =
      kind === 'corporation'
        ? { id: me.corporationId, name: me.corporationName }
        : { id: me.allianceId, name: me.allianceName };
    const next = withEntry(policy, kind, entry);
    if (next) save.mutate(next);
  }

  return (
    <Section
      title="Login filter"
      description="Characters in any listed corporation or alliance may sign in. Entries from the server environment always apply."
    >
      <div
        className={cn(
          'flex items-start gap-2 rounded-lg border p-3 mb-4 text-sm',
          policy.open ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300',
        )}
      >
        {policy.open ? <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" /> : <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />}
        {policy.open
          ? 'No filter set — any EVE character can sign in. Add your corporation or alliance to restrict access.'
          : `Restricted to ${policy.allowedCorporationIds.length} corporation(s) and ${policy.allowedAllianceIds.length} alliance(s).`}
      </div>

      {me ? (
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 mb-5">
          <div className="text-xs text-slate-500 mb-2">Based on your character</div>
          <div className="flex flex-wrap items-center gap-2">
            {me.corporationId && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => allowMine('corporation')}
                disabled={corpAllowed || save.isPending}
                className="border-slate-700 text-slate-300"
              >
                {corpAllowed ? <ShieldCheck className="w-4 h-4 mr-2 text-emerald-400" /> : <Plus className="w-4 h-4 mr-2" />}
                {corpAllowed ? 'Corporation allowed' : 'Allow my corporation'}: {me.corporationName ?? me.corporationId}
              </Button>
            )}
            {me.allianceId ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => allowMine('alliance')}
                disabled={allianceAllowed || save.isPending}
                className="border-slate-700 text-slate-300"
              >
                {allianceAllowed ? <ShieldCheck className="w-4 h-4 mr-2 text-emerald-400" /> : <Plus className="w-4 h-4 mr-2" />}
                {allianceAllowed ? 'Alliance allowed' : 'Allow my alliance'}: {me.allianceName ?? me.allianceId}
              </Button>
            ) : (
              <span className="text-xs text-slate-500">Your corporation is not in an alliance.</span>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500 mb-5">Sign in with an EVE character to fill this from your own corporation and alliance.</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <AllowList
          kind="corporation"
          title="Allowed corporations"
          stored={policy.corporations}
          envIds={policy.envCorporationIds}
          policy={policy}
          save={save}
        />
        <AllowList
          kind="alliance"
          title="Allowed alliances"
          stored={policy.alliances}
          envIds={policy.envAllianceIds}
          policy={policy}
          save={save}
        />
      </div>
    </Section>
  );
}

function statusOf(c) {
  if (c.banned) return { label: 'Blocked', cls: 'bg-rose-500/20 text-rose-400' };
  if (!c.active) {
    // Inactive rows are characters the filter turned away at login.
    return c.allowed
      ? { label: 'Allowed now', cls: 'bg-sky-500/20 text-sky-400' }
      : { label: 'Denied', cls: 'bg-amber-500/20 text-amber-400' };
  }
  if (!c.allowed) return { label: 'Outside filter', cls: 'bg-amber-500/20 text-amber-400' };
  return { label: 'Active', cls: 'bg-emerald-500/20 text-emerald-400' };
}

export function UsersSection({ Section }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['characters'],
    queryFn: () => api.invoke('listCharacters', {}),
  });
  const { data: policy } = usePolicy();
  const savePolicy = useSavePolicy();

  const onDone = {
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['characters'] }),
    onError: (err) => toast.error(err.message),
  };
  const setRole = useMutation({ mutationFn: (v) => api.invoke('setCharacterRole', v), ...onDone });
  const setBanned = useMutation({ mutationFn: (v) => api.invoke('setCharacterBanned', v), ...onDone });

  const characters = useMemo(() => {
    const all = data?.characters ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((c) =>
      [c.characterName, c.corporationName, c.allianceName].some((v) => v?.toLowerCase().includes(q)),
    );
  }, [data, search]);

  const total = data?.characters?.length ?? 0;
  const busy = setRole.isPending || setBanned.isPending;

  return (
    <Section title="Users" description="Every character that has signed in, or tried to, with their corporation and alliance.">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, corp, alliance"
            className="bg-slate-900 border-slate-700 text-slate-200 h-9 pl-8 w-64"
          />
        </div>
        <span className="text-xs text-slate-500 tnum">
          {characters.length === total ? `${total} characters` : `${characters.length} of ${total} characters`}
        </span>
      </div>

      {isLoading ? (
        <Loader2 className="w-5 h-5 animate-spin text-[#4A9EFF]" />
      ) : characters.length === 0 ? (
        <p className="text-sm text-slate-500">{total === 0 ? 'Nobody has signed in yet.' : 'No matches.'}</p>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-3 font-medium">Character</th>
                <th className="py-2 pr-3 font-medium">Corporation</th>
                <th className="py-2 pr-3 font-medium">Alliance</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 font-medium">Last login</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {characters.map((c) => {
                const status = statusOf(c);
                const isSelf = c.characterId === user?.characterId;
                const corpListed = policy?.allowedCorporationIds?.includes(c.corporationId);
                return (
                  <tr key={c.id} className="border-b border-slate-800/60 last:border-0 align-middle">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <img
                          src={`https://images.evetech.net/characters/${c.characterId}/portrait?size=32`}
                          alt=""
                          className="w-6 h-6 rounded"
                          loading="lazy"
                        />
                        <span className="text-slate-200">{c.characterName}</span>
                        {c.role === 'admin' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#4A9EFF]/20 text-[#4A9EFF]">Admin</span>
                        )}
                        {!c.isMain && c.ownerKey !== c.characterId && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-700/40 text-slate-400">Alt</span>
                        )}
                        {isSelf && <span className="text-[10px] text-slate-500">(you)</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-300">
                      {c.corporationName ?? <span className="text-slate-600">{c.corporationId ?? '—'}</span>}
                    </td>
                    <td className="py-2 pr-3 text-slate-300">
                      {c.allianceName ?? <span className="text-slate-600">{c.allianceId ?? '—'}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap', status.cls)}>
                        {status.label}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">{formatRelative(c.lastLoginAt)}</td>
                    <td className="py-2 text-right whitespace-nowrap">
                      {!c.allowed && c.corporationId && !corpListed && policy && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={savePolicy.isPending}
                          onClick={() => {
                            const next = withEntry(policy, 'corporation', { id: c.corporationId, name: c.corporationName });
                            if (next) savePolicy.mutate(next);
                          }}
                          className="text-sky-400 h-7"
                        >
                          Allow corp
                        </Button>
                      )}
                      {!isSelf && !c.banned && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || (c.role === 'admin' && c.envAdmin)}
                          title={c.envAdmin ? 'Admin via ADMIN_CHARACTER_NAMES' : undefined}
                          onClick={() =>
                            setRole.mutate({ characterId: c.characterId, role: c.role === 'admin' ? 'user' : 'admin' })
                          }
                          className="text-slate-400 h-7"
                        >
                          {c.role === 'admin' ? 'Remove admin' : 'Make admin'}
                        </Button>
                      )}
                      {!isSelf && !c.envAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            if (c.banned || confirm(`Block ${c.characterName} from signing in?`)) {
                              setBanned.mutate({ characterId: c.characterId, banned: !c.banned });
                            }
                          }}
                          className={cn('h-7', c.banned ? 'text-emerald-400' : 'text-rose-400')}
                        >
                          {c.banned ? 'Unblock' : 'Block'}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
