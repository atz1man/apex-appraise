import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSession, trpc, type StoredPrincipal } from '../lib/trpc';
import { BrandMark, Button, Spinner } from '../components/ui';

const DEMOS: Array<[string, string, string]> = [
  ['Internal team', 'arthur@apexappraise.co.uk', 'Pipeline, appraisals, construction, sales'],
  ['Investor portal', 'investor@demo.co.uk', 'LP position, cashflows, capital calls'],
  ['Buyer portal', 'buyer@demo.co.uk', 'Reservation, conveyancing, payments'],
];

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('arthur@apexappraise.co.uk');
  const [password, setPassword] = useState('demo');
  const [error, setError] = useState('');
  const login = trpc.auth.login.useMutation({
    onSuccess: (res) => {
      setSession(res.token, res.principal as StoredPrincipal);
      const t = res.principal.principalType;
      navigate(t === 'buyer' ? '/portal/buyer' : t === 'investor' ? '/portal/investor' : '/', { replace: true });
    },
    onError: (e) => setError(e.message),
  });

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(160deg,#13402F 0%,#0F3528 55%,#0C2A20 100%)' }}>
      <div className="w-[400px] max-w-[92vw]">
        <div className="flex items-center gap-3 justify-center mb-7">
          <BrandMark size={36} />
          <span className="text-[22px] font-bold text-white tracking-[-0.5px]">
            Apex <span className="text-accent-300">Appraise</span>
          </span>
        </div>
        <form
          className="bg-surface rounded-panel shadow-dark-card p-6"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            login.mutate({ email, password });
          }}
        >
          <div className="eyebrow mb-1">Sign in</div>
          <h1 className="text-[19px] font-bold tracking-[-0.4px] mb-4">One connected workfile</h1>
          <label className="label-mono text-ink-3 block mb-1">Email</label>
          <input className="w-full mb-3" aria-label="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <label className="label-mono text-ink-3 block mb-1">Password</label>
          <input className="w-full mb-4" type="password" aria-label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <div className="text-[12px] text-status-red mb-3">{error}</div>}
          <Button type="submit" className="w-full justify-center" disabled={login.isPending}>
            {login.isPending ? <Spinner /> : 'Sign in'}
          </Button>
          <div className="mt-3 text-center text-[12px] text-ink-2">
            New here?{' '}
            <a href="/register" className="font-semibold text-brand-500 hover:text-brand-700">
              Create your organisation →
            </a>
          </div>
          <div className="mt-5 border-t border-border-faint pt-4">
            <div className="label-mono text-ink-3 mb-2">Demo accounts · password “demo”</div>
            <div className="flex flex-col gap-1.5">
              {DEMOS.map(([label, mail, desc]) => (
                <button
                  key={mail}
                  type="button"
                  onClick={() => {
                    setEmail(mail);
                    setPassword('demo');
                  }}
                  className="text-left rounded-[9px] border border-border-faint px-3 py-2 hover:bg-sunken transition-colors"
                >
                  <div className="text-[12.5px] font-semibold">{label}</div>
                  <div className="text-[11px] text-ink-3">{desc}</div>
                </button>
              ))}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
