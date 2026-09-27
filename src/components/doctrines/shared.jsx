// Small pieces shared by the Doctrines page and its sheets and dialogs.
import { cn } from '@/lib/utils';
import { STATUS_META } from '@/lib/format';

export const ROLE_META = {
  main: { label: 'Mainline', badge: 'bg-sky-500/15 text-sky-300 border border-sky-500/30' },
  logi: { label: 'Logistics', badge: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' },
  support: { label: 'Support', badge: 'bg-violet-500/15 text-violet-300 border border-violet-500/30' },
};

export const ROLES = Object.keys(ROLE_META);

export const KIND_LABELS = { hull: 'Hull', module: 'Fitted modules', drone: 'Drones', cargo: 'Cargo' };

// Bar fill per status, matching the status badge colours.
const BAR = { out: 'bg-rose-500', critical: 'bg-rose-500', low: 'bg-amber-500', ok: 'bg-emerald-500' };

export function RoleBadge({ role }) {
  const meta = ROLE_META[role] ?? ROLE_META.main;
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide', meta.badge)}>
      {meta.label}
    </span>
  );
}

export function ShipIcon({ typeId, size = 32, className }) {
  if (!typeId) return <div className={cn('rounded bg-slate-800', className)} style={{ width: size, height: size }} />;
  return (
    <img
      src={`https://images.evetech.net/types/${typeId}/icon?size=${size > 32 ? 64 : 32}`}
      alt=""
      loading="lazy"
      className={cn('rounded shrink-0', className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Progress toward a minimum, capped at full. */
export function ReadyBar({ value, max, status, className }) {
  const pct = max > 0 ? Math.min(1, value / max) : value > 0 ? 1 : 0;
  return (
    <div className={cn('h-1.5 rounded-full bg-slate-800 overflow-hidden', className)}>
      <div className={cn('h-full rounded-full transition-all', BAR[status] ?? 'bg-slate-600')} style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

export function StatusDot({ status }) {
  const meta = STATUS_META[status];
  return <span className={cn('inline-block w-2 h-2 rounded-full shrink-0', meta?.dot ?? 'bg-slate-600')} title={meta?.label} />;
}

/** Shopping-list lines in the restock cart's item shape. */
export function toCartItems(missing) {
  return missing
    .filter((m) => m.missing > 0)
    .map((m) => ({
      typeId: m.typeId,
      itemName: m.name,
      quantity: m.missing,
      jitaBestSell: m.jitaPrice,
      bestSell: m.localPrice,
    }));
}
