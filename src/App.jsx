import { Navigate, Route, BrowserRouter as Router, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { Toaster } from '@/components/ui/sonner';
import { queryClient } from '@/lib/query-client';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { CartProvider } from '@/hooks/useCart';
import Layout from '@/Layout';
import Dashboard from '@/pages/Dashboard';
import Tracked from '@/pages/Tracked';
import Browse from '@/pages/Browse';
import Reports from '@/pages/Reports';
import Cart from '@/pages/Cart';
import Settings from '@/pages/Settings';
import Login from '@/pages/Login';
import EveCallback from '@/pages/EveCallback';

// Gates the app pages behind a session. Renders nothing decisive while the
// session is still being resolved, so a signed-in user never gets a flash of
// the login screen on refresh.
function RequireAuth({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[#4A9EFF]" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public: the entry points that must work without a session. */}
      <Route path="/login" element={<Login />} />
      <Route path="/EveCallback" element={<EveCallback />} />

      <Route
        path="*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/tracked" element={<Tracked />} />
                <Route path="/browse" element={<Browse />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <AuthProvider>
          <CartProvider>
            <AppRoutes />
          </CartProvider>
        </AuthProvider>
      </Router>
      <Toaster position="top-right" />
    </QueryClientProvider>
  );
}
