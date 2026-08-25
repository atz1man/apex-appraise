import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSession, trpc, type StoredPrincipal } from '../lib/trpc';
import { BrandMark, Button } from '../components/ui';

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
  // arriving from a completed reset — say so, or the redirect looks like a failure
  const justReset = new URLSearchParams(window.location.search).get('reset') === '1';
  /**
   * Whether this address's workspace federates.
   *
   * Debounced, and only asked once the address is plausibly complete: the
   * question is keyed on the email, so querying per keystroke would send every
   * half-typed address a valuer types to the server and back.
   */
  const [settledEmail, setSettledEmail] = useState(email);
  useEffect(() => {
    const t = setTimeout(() => setSettledEmail(email), 400);
    return () => clearTimeout(t);
  }, [email]);
  const looksLikeAddress = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(settledEmail);
  const { data: sso } = trpc.auth.ssoAvailable.useQuery(
    { email: settledEmail },
    { enabled: looksLikeAddress, staleTime: 60_000, retry: 0 },
  );

  const ssoStart = trpc.auth.ssoStart.useMutation({
    // straight out to the provider; we come back at /sso/callback
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e) => setError(e.message),
  });

  /**
   * An enforced workspace CANNOT sign in with a password — auth.login refuses it
   * outright. Showing the field anyway is how somebody ends up typing their
   * password into a form that was always going to reject it, reading "use the
   * SSO button instead", and looking for a button.
   */
  const passwordAllowed = !sso?.enforced;

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
          className="bg-surface rounded-panel shadow-dark-card p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            // enter, on an enforced workspace, goes where the only button goes
            if (!passwordAllowed) ssoStart.mutate({ email });
            else login.mutate({ email, password });
          }}
        >
          <div className="eyebrow mb-1">Sign in</div>
          <h1 className="text-[19px] font-bold tracking-[-0.4px] mb-4">One connected workfile</h1>
          <label className="label-mono text-ink-3 block mb-1">Email</label>
          <input className="w-full mb-3" aria-label="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          {passwordAllowed && (
            <>
              <div className="flex items-baseline justify-between mb-1">
                <label className="label-mono text-ink-3">Password</label>
                <a href="/forgot" className="text-[11.5px] font-semibold text-brand-ink">
                  Forgot?
                </a>
              </div>
              <input className="w-full mb-4" type="password" aria-label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </>
          )}
          {sso?.enforced && (
            <div className="mb-4 text-[12px] text-ink-2 leading-relaxed">
              Your organisation signs in with single sign-on. There is no password to enter.
            </div>
          )}
          {justReset && !error && (
            <div className="text-[12px] text-status-green mb-3">Password updated — sign in with it below.</div>
          )}
          {error && <div className="text-[12px] text-status-red mb-3">{error}</div>}
          {passwordAllowed && (
            <Button type="submit" className="w-full" loading={login.isPending}>
              Sign in
            </Button>
          )}
          {sso?.sso && (
            <Button
              type="button"
              variant={sso.enforced ? 'primary' : 'secondary'}
              className={passwordAllowed ? 'w-full mt-2' : 'w-full'}
              loading={ssoStart.isPending}
              onClick={() => {
                setError('');
                ssoStart.mutate({ email });
              }}
            >
              Continue with single sign-on
            </Button>
          )}
          <div className="mt-3 text-center text-[12px] text-ink-2">
            New here?{' '}
            <a href="/register" className="font-semibold text-brand-ink hover:text-brand-ink">
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
                  className="text-left rounded-[9px] border border-[rgb(var(--control-border))] px-3 py-2 hover:bg-sunken transition-colors"
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
