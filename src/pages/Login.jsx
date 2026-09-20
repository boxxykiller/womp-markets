import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import icon from '@/assets/womp-icon.svg';

// CCP's official "Log in with EVE Online" button asset.
const EVE_SSO_IMAGE = 'https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-black-large.png';

export default function Login() {
  const [showLocal, setShowLocal] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const startSso = useMutation({
    mutationFn: () => api.invoke('eveLogin', {}),
    onSuccess: (data) => {
      window.location.href = data.authUrl;
    },
    onError: (err) => toast.error(err.message),
  });

  const localLogin = useMutation({
    mutationFn: () => api.localLogin(username, password),
    onSuccess: () => {
      window.location.href = '/';
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <img src={icon} alt="" className="w-16 h-16 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-white">womp-markets</h1>
        <p className="text-sm text-slate-400 mt-1 mb-8">
          Sign in with your EVE character to view the citadel market.
        </p>

        <button onClick={() => startSso.mutate()} disabled={startSso.isPending} className="inline-block">
          {startSso.isPending ? (
            <Loader2 className="w-6 h-6 animate-spin text-[#4A9EFF] mx-auto" />
          ) : (
            <img src={EVE_SSO_IMAGE} alt="Log in with EVE Online" className="h-10" />
          )}
        </button>

        {/* Only useful when the server has the dev bypass enabled; the
            endpoint 404s otherwise, so this stays harmless in production. */}
        <div className="mt-10 pt-6 border-t border-slate-800">
          {!showLocal ? (
            <button onClick={() => setShowLocal(true)} className="text-xs text-slate-600 hover:text-slate-400">
              Developer sign-in
            </button>
          ) : (
            <div className="space-y-2 text-left">
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="bg-slate-900 border-slate-800"
              />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && localLogin.mutate()}
                placeholder="Password"
                className="bg-slate-900 border-slate-800"
              />
              <Button
                onClick={() => localLogin.mutate()}
                disabled={localLogin.isPending}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                {localLogin.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Sign in locally
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
