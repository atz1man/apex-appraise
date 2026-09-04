import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setSession, trpc, type StoredPrincipal } from '../lib/trpc';
import { BrandMark, Button, FormError } from '../components/ui';
import { heroGradient } from '@apex/ui-tokens';

/**
 * The demo password is public by design, but only where the demo accounts
 * exist. This page used to list three demo logins and arrive with the demo
 * founder's email and "demo" already typed on EVERY deployment — a firm's
 * production sign-in advertising credentials for accounts the seed had refused
 * to create (prisma/seed.ts says why), and prefilling a password that was not
 * theirs. The server now says which demo logins exist, and the page offers and
 * prefills only those.
 */
const DEMO_PASSWORD = 'demo';

/** an input error arrives as zod's JSON array; a person gets its first sentence, not the array */
function plainMessage(message: string): string {
  if (!message.startsWith('[')) return message;
  try {
    const issues = JSON.parse(message) as Array<{ message?: string }>;
    return issues[0]?.message || 'Check the details you entered.';
  } catch {
    return 'Check the details you entered.';
  }
}

export default function Login() {
  const navigate = useNavigate();
  const demoQ = trpc.auth.demoAccounts.useQuery(undefined, { staleTime: 300_000, retry: 0 });
  const demos = demoQ.data;
  /**
   * Never prefilled asynchronously. A first version wrote the demo login into
   * the fields when the answer arrived, and the answer arrived while a person
   * — or a test — was typing: the field read the address twice, because the
   * write landed between a select-all and the insert. A field somebody has
   * focused is theirs. Pressing Sign in with nothing typed resolves the demo
   * login below; the panel's buttons fill the fields on a click.
   */
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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
    // this screen shows the error where it happened; see App.tsx
    meta: { inlineError: true },
    // straight out to the provider; we come back at /sso/callback
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e) => setError(plainMessage(e.message)),
  });

  /**
   * An enforced workspace CANNOT sign in with a password — auth.login refuses it
   * outright. Showing the field anyway is how somebody ends up typing their
   * password into a form that was always going to reject it, reading "use the
   * SSO button instead", and looking for a button.
   */
  const passwordAllowed = !sso?.enforced;

  const login = trpc.auth.login.useMutation({
    // this screen shows the error where it happened; see App.tsx
    meta: { inlineError: true },
    onSuccess: (res) => {
      setSession(res.token, res.principal as StoredPrincipal);
      const t = res.principal.principalType;
      navigate(t === 'buyer' ? '/portal/buyer' : t === 'investor' ? '/portal/investor' : '/', { replace: true });
    },
    onError: (e) => setError(plainMessage(e.message)),
  });

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: heroGradient }}>
      <div className="w-[400px] max-w-[92vw]">
        <div className="flex items-center gap-3 justify-center mb-7">
          <BrandMark size={36} />
          <span className="text-[22px] font-bold text-white tracking-[-0.5px]">
            Apex <span className="text-accent-300">Appraise</span>
          </span>
        </div>
        <form
          className="bg-surface rounded-panel shadow-dark-card p-5 sm:p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            let creds = { email, password };
            // nothing typed: sign in as the demo login, if this deployment has one
            if (!creds.email) {
              const offered = demos ?? (await demoQ.refetch()).data;
              if (offered?.[0]) creds = { email: offered[0].email, password: DEMO_PASSWORD };
            }
            // enter, on an enforced workspace, goes where the only button goes
            if (!passwordAllowed) ssoStart.mutate({ email: creds.email });
            else login.mutate(creds);
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
          {error && <FormError className="text-[12px] mb-3">{error}</FormError>}
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
          {/* only where those logins exist — a production sign-in advertises nobody's password */}
          {!!demos?.length && (
            <div className="mt-5 border-t border-border-faint pt-4">
              <div className="label-mono text-ink-3 mb-2">Demo accounts · password “{DEMO_PASSWORD}”</div>
              <div className="flex flex-col gap-1.5">
                {demos.map((d) => (
                  <button
                    key={d.email}
                    type="button"
                    onClick={() => {
                      setEmail(d.email);
                      setPassword(DEMO_PASSWORD);
                    }}
                    className="text-left rounded-[9px] border border-[rgb(var(--control-border))] px-3 py-2 hover:bg-sunken transition-colors"
                  >
                    <div className="text-[12.5px] font-semibold">{d.label}</div>
                    <div className="text-[11px] text-ink-3">{d.blurb}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
