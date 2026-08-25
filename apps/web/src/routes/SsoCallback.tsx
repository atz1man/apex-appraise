import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { setSession, trpc, type StoredPrincipal } from '../lib/trpc';
import { BrandMark, Spinner } from '../components/ui';

/**
 * Where the identity provider sends the person back.
 *
 * This is `${APP_URL}/sso/callback`, the redirect URI auth.ssoStart registers
 * with the provider — and until now nothing served it. The three procedures
 * behind single sign-on were complete and tested; there was no screen that
 * called any of them, and no route at the address the provider was told to
 * return to.
 *
 * That was not a missing feature so much as a trap. Settings offers an admin a
 * switch marked "require single sign-on", and auth.login refuses an enforced
 * workspace with "Use the SSO button instead" — a button that did not exist, on
 * a page that had never heard of SSO. Turning the switch on locked the whole
 * firm out with no way back that did not involve the database. The reset email
 * pointed at the same missing button.
 */
export default function SsoCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const code = params.get('code');
  const state = params.get('state');
  /** The provider may hand back its own refusal instead of a code. */
  const providerError = params.get('error_description') ?? params.get('error');

  const complete = trpc.auth.ssoComplete.useMutation({
    onSuccess: (res) => {
      setSession(res.token, res.principal as StoredPrincipal);
      const t = res.principal.principalType;
      navigate(t === 'buyer' ? '/portal/buyer' : t === 'investor' ? '/portal/investor' : '/', { replace: true });
    },
  });

  /**
   * Once. The state is single-use on the server — it is deleted the moment it is
   * looked up — so a second attempt with the same code fails with "that sign-in
   * has expired", which is exactly what React's development double-render would
   * produce on a perfectly good login.
   */
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current || !code || !state) return;
    fired.current = true;
    complete.mutate({ code, state });
  }, [code, state, complete]);

  const message = providerError ?? (!code || !state ? 'That sign-in link is incomplete.' : complete.error?.message);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: 'linear-gradient(160deg,#13402F 0%,#0F3528 55%,#0C2A20 100%)' }}
    >
      <div className="w-[400px] max-w-[92vw]">
        <div className="flex items-center gap-3 justify-center mb-7">
          <BrandMark size={36} />
          <span className="text-[22px] font-bold text-white tracking-[-0.5px]">
            Apex <span className="text-accent-300">Appraise</span>
          </span>
        </div>
        <div className="bg-surface rounded-panel shadow-dark-card p-6 text-center">
          {message ? (
            <>
              <div className="text-[15px] font-semibold">Single sign-on did not complete</div>
              <div className="mt-2 text-[12.5px] text-ink-2">{message}</div>
              <a href="/login" className="mt-4 inline-block text-[12.5px] font-semibold text-brand-ink">
                Back to sign in →
              </a>
            </>
          ) : (
            <>
              <div className="flex justify-center mb-3">
                <Spinner />
              </div>
              <div className="text-[13px] text-ink-2">Signing you in…</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
