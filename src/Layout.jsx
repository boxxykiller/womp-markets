import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Boxes, FileBarChart, LayoutDashboard, LogOut, Menu, Settings, ShoppingCart, X } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { cn } from '@/lib/utils';
import icon from '@/assets/womp-logo.png';
import heroBg from '@/assets/womp-bg-hero.svg';

// A flat top nav rather than a sidebar: there are six destinations, and the
// tables on every page want the full window width.
const NAV = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Tracked', path: '/tracked', icon: Boxes },
  { name: 'Browse', path: '/browse', icon: BarChart3 },
  { name: 'Reports', path: '/reports', icon: FileBarChart },
  { name: 'Restock', path: '/restock', icon: ShoppingCart },
  { name: 'Settings', path: '/settings', icon: Settings },
];

function NavLink({ item, active, onClick, badge }) {
  const Icon = item.icon;
  return (
    <Link
      to={item.path}
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
        active ? 'bg-[#4A9EFF]/15 text-[#4A9EFF]' : 'text-slate-400 hover:text-white hover:bg-[#1E2D45]/60',
      )}
    >
      <Icon className="w-4 h-4" />
      {item.name}
      {badge > 0 && (
        <span className="ml-1 px-1.5 py-0.5 bg-rose-500 text-white text-[10px] font-bold rounded-full leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  );
}

export default function Layout({ children }) {
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();
  const { count: cartCount } = useCart();
  const [mobileOpen, setMobileOpen] = useState(false);

  // The count of items needing attention, shown on the Tracked tab so a
  // stockout is visible from any page without going looking for it.
  const { data: watchlist } = useQuery({
    queryKey: ['watchlist-badge'],
    queryFn: () => api.invoke('getMarketWatchlist', {}),
    enabled: isAuthenticated,
    staleTime: 2 * 60_000,
    refetchInterval: 2 * 60_000,
  });
  const attention = watchlist ? (watchlist.counts?.out ?? 0) + (watchlist.counts?.critical ?? 0) : 0;

  const badgeFor = (item) => (item.name === 'Tracked' ? attention : item.name === 'Restock' ? cartCount : 0);
  const isActive = (path) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path));

  async function handleLogout() {
    await api.invoke('logout').catch(() => {});
    window.location.href = '/';
  }

  return (
    <div
      className="flex flex-col min-h-screen bg-[#080E1A] bg-cover bg-center bg-no-repeat bg-fixed"
      style={{ backgroundImage: `url(${heroBg})` }}
    >
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-[#1E2D45]/70 bg-[#080E1A]/90 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6">
          <div className="h-14 flex items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-2.5 shrink-0">
              <img src={icon} alt="WOMP" className="w-10 h-10" />
              <div className="leading-tight">
                <div className="text-sm font-bold text-white">womp-markets</div>
                <div className="text-[11px] text-slate-400">Citadel Market Tracker</div>
              </div>
            </Link>

            <nav className="hidden lg:flex items-center gap-1">
              {NAV.map((item) => (
                <NavLink key={item.path} item={item} active={isActive(item.path)} badge={badgeFor(item)} />
              ))}
            </nav>

            <div className="flex items-center gap-3">
              {isAuthenticated ? (
                <div className="hidden sm:flex items-center gap-2.5">
                  <div className="text-right leading-tight">
                    <div className="text-xs font-medium text-white">{user.characterName}</div>
                    {user.isAdmin && <div className="text-[10px] text-[#4A7BA7]">Administrator</div>}
                  </div>
                  {user.characterId !== 'local-admin' && (
                    <img
                      src={`https://images.evetech.net/characters/${user.characterId}/portrait?size=32`}
                      alt=""
                      className="w-8 h-8 rounded-full border border-[#1E2D45]"
                    />
                  )}
                  <button
                    onClick={handleLogout}
                    title="Sign out"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1E2D45]/60 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <Link
                  to="/login"
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-[#4A9EFF] hover:bg-[#3A8EEF] text-white transition-colors"
                >
                  Sign in
                </Link>
              )}

              <button
                onClick={() => setMobileOpen((v) => !v)}
                className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1E2D45]/60"
                aria-label="Toggle navigation"
              >
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden border-t border-[#1E2D45] bg-[#0D1829] px-4 py-3 space-y-1">
            {NAV.map((item) => (
              <NavLink
                key={item.path}
                item={item}
                active={isActive(item.path)}
                badge={badgeFor(item)}
                onClick={() => setMobileOpen(false)}
              />
            ))}
          </div>
        )}
      </header>

      <main className="flex-1 pt-14 pb-10">{children}</main>

      <footer className="border-t border-[#1E2D45] bg-[#080E1A]">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#4A7BA7]">
          <span>womp-markets — EVE Online citadel market tracker</span>
          <span>
            Market data from ESI. EVE Online and all related assets are the property of CCP hf.
          </span>
        </div>
      </footer>
    </div>
  );
}
