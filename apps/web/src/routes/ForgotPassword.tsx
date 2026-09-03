import { useState } from 'react';
import { Link } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { BrandMark, Button } from '../components/ui';
import { heroGradient } from '@apex/ui-tokens';

/**
 * Request a reset link.
 *
 * The confirmation deliberately does NOT say whether the address is registered.
 * "No account with that email" is an enumeration oracle, and for a product whose
 * users are named surveyors at named firms, confirming who holds an account is
 * itself a disclosure. The server behaves the same way.
 */
export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const request = trpc.auth.requestPasswordReset.useMutation({ onSuccess: () => setSent(true) });

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: heroGradient }}
    >
      <div className="w-[400px] max-w-[92vw]">
        <div className="flex items-center gap-3 justify-center mb-7">
          <BrandMark size={36} />
          <span className="text-[22px] font-bold text-white tracking-[-0.5px]">
            Apex <span className="text-accent-300">Appraise</span>
          </span>
        </div>
        <div className="bg-surface rounded-panel shadow-dark-card p-5 sm:p-6">
          {sent ? (
            <>
              <div className="eyebrow mb-1">Check your email</div>
              <h1 className="text-[19px] font-bold tracking-[-0.4px] mb-3">If that address has an account, a link is on its way</h1>
              <p className="text-[12.5px] text-ink-2 leading-[1.6]">
                The link works once and expires in an hour. If nothing arrives, check the address and try again — and if your
                firm has not configured email yet, ask your administrator to reset it for you.
              </p>
              <Link to="/login" className="mt-4 inline-block text-[12px] font-semibold text-brand-ink">
                ← Back to sign in
              </Link>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                request.mutate({ email });
              }}
            >
              <div className="eyebrow mb-1">Reset your password</div>
              <h1 className="text-[19px] font-bold tracking-[-0.4px] mb-4">We’ll email you a link</h1>
              <label className="label-mono text-ink-3 block mb-1">Email</label>
              <input
                className="w-full mb-4"
                aria-label="Email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
              <Button type="submit" className="w-full" loading={request.isPending}>
                Send the link
              </Button>
              <div className="mt-3 text-center text-[12px] text-ink-2">
                Remembered it?{' '}
                <Link to="/login" className="font-semibold text-brand-ink">
                  Sign in →
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
