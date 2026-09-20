import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, ShieldX } from 'lucide-react';
import { api } from '@/api/client';

export default function EveCallback() {
  const [params] = useSearchParams();
  const [error, setError] = useState(null);
  const [notAllowed, setNotAllowed] = useState(false);
  // The OAuth state is single-use and consumed server-side, so a second call
  // (React 18 StrictMode double-invokes effects in development) would always
  // fail with "already used".
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state) {
      setError('This sign-in link is incomplete. Please start again.');
      return;
    }

    api
      .invoke('eveCallback', { code, state })
      .then(() => {
        // Full reload rather than a client navigation, so every query
        // re-runs against the new session cookie.
        window.location.href = '/';
      })
      .catch((err) => {
        if (err.code === 'NOT_ALLOWED') setNotAllowed(true);
        else setError(err.message);
      });
  }, [params]);

  if (notAllowed) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <ShieldX className="w-12 h-12 text-rose-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white">Not authorised</h1>
          <p className="text-sm text-slate-400 mt-2">
            That character isn&apos;t in a corporation or alliance allowed to use this instance. If you think this is a
            mistake, ask an administrator to check the access list — your character has been recorded, so they can find it.
          </p>
          <Link to="/login" className="inline-block mt-6 text-sm text-[#4A9EFF] hover:underline">
            Try a different character
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-bold text-white">Sign-in failed</h1>
          <p className="text-sm text-slate-400 mt-2">{error}</p>
          <Link to="/login" className="inline-block mt-6 text-sm text-[#4A9EFF] hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-6 h-6 animate-spin text-[#4A9EFF]" />
      <p className="text-sm text-slate-400">Completing sign-in…</p>
    </div>
  );
}
