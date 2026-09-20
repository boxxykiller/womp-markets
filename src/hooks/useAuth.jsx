// App-wide auth state. A context, not a bare hook over localStorage: the
// header, the Tracked page's admin controls and the route guards all need to
// agree on who is signed in, and per-component copies of that state drift.
import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

const AuthContext = createContext({ user: null, isLoading: true, isAdmin: false, isAuthenticated: false });

export function AuthProvider({ children }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me(),
    // The server is the only authority on role; nothing here is cached in
    // localStorage where it could be edited.
    staleTime: 60_000,
    retry: false,
  });

  const user = data?.user ?? null;
  const value = {
    user,
    isLoading,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    refetch,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
