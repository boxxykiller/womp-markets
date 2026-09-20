import { cn } from '@/lib/utils';

// Tailwind cannot see a class built by interpolation, so the per-page accent
// is a static lookup rather than `from-${color}-500/20`. The sister project
// builds these dynamically and the icon tint silently does nothing there.
const ACCENTS = {
  blue: 'from-blue-500/20 to-cyan-500/10 text-blue-400',
  amber: 'from-amber-500/20 to-orange-500/10 text-amber-400',
  emerald: 'from-emerald-500/20 to-teal-500/10 text-emerald-400',
  violet: 'from-violet-500/20 to-purple-500/10 text-violet-400',
  rose: 'from-rose-500/20 to-pink-500/10 text-rose-400',
  slate: 'from-slate-500/20 to-slate-600/10 text-slate-300',
};

export function PageHeader({ icon: Icon, title, subtitle, accent = 'blue', children }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div className="flex items-center gap-3">
        <div className={cn('w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center', ACCENTS[accent])}>
          <Icon className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">{title}</h1>
          {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

export function Page({ children }) {
  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</div>
  );
}
