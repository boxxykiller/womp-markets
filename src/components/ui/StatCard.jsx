import { cn } from '@/lib/utils';

// Static per-variant class strings. See PageHeader for why these can't be
// interpolated.
const VARIANTS = {
  blue: { card: 'from-blue-500/20 to-blue-600/5 border-blue-500/20', icon: 'bg-blue-500/10 text-blue-400' },
  amber: { card: 'from-amber-500/20 to-amber-600/5 border-amber-500/20', icon: 'bg-amber-500/10 text-amber-400' },
  emerald: { card: 'from-emerald-500/20 to-emerald-600/5 border-emerald-500/20', icon: 'bg-emerald-500/10 text-emerald-400' },
  rose: { card: 'from-rose-500/20 to-rose-600/5 border-rose-500/20', icon: 'bg-rose-500/10 text-rose-400' },
  violet: { card: 'from-violet-500/20 to-violet-600/5 border-violet-500/20', icon: 'bg-violet-500/10 text-violet-400' },
  slate: { card: 'from-slate-800/60 to-slate-900/40 border-slate-700/40', icon: 'bg-slate-700/40 text-slate-300' },
};

export function StatCard({ title, value, subtitle, icon: Icon, variant = 'slate', onClick }) {
  const v = VARIANTS[variant] ?? VARIANTS.slate;
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      onClick={onClick}
      className={cn(
        'rounded-2xl border bg-gradient-to-br p-5 text-left w-full',
        v.card,
        onClick && 'transition-colors hover:border-white/20 cursor-pointer',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-400">{title}</div>
          <div className="text-3xl font-bold text-white mt-1 tnum truncate">{value}</div>
          {subtitle && <div className="text-xs text-slate-500 mt-1">{subtitle}</div>}
        </div>
        {Icon && (
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shrink-0', v.icon)}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </Tag>
  );
}
