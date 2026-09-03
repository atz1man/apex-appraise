import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { BrandMark, Button } from '../components/ui';
import { heroGradient } from '@apex/ui-tokens';

/** Set a new password from an emailed link. The token is single-use and expires in an hour. */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const reset = trpc.auth.resetPassword.useMutation({
    // this screen shows the error where it happened; see App.tsx
    meta: { inlineError: true },
    onSuccess: () => navigate('/login?reset=1', { replace: true }),
    onError: (e) => setError(e.message),
  });

  // the two ways this can be wrong are worth separating for the person holding a
  // dead link: a missing token is a broken URL, a rejected one is an expired link
  const mismatch = confirm.length > 0 && password !== confirm;

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
          {!token ? (
            <>
              <div className="eyebrow mb-1">Reset your password</div>
              <h1 className="text-[19px] font-bold tracking-[-0.4px] mb-3">This link is missing its token</h1>
              <p className="text-[12.5px] text-ink-2 leading-[1.6]">
                Open the link straight from the email rather than retyping it — some mail clients cut long URLs in half.
              </p>
              <Link to="/forgot" className="mt-4 inline-block text-[12px] font-semibold text-brand-ink">
                Request a new link →
              </Link>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setError('');
                if (password !== confirm) return;
                reset.mutate({ token, password });
              }}
            >
              <div className="eyebrow mb-1">Reset your password</div>
              <h1 className="text-[19px] font-bold tracking-[-0.4px] mb-4">Choose a new password</h1>
              <label className="label-mono text-ink-3 block mb-1">New password</label>
              <input
                className="w-full mb-3"
                type="password"
                aria-label="New password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <label className="label-mono text-ink-3 block mb-1">Confirm</label>
              <input
                className="w-full mb-1"
                type="password"
                aria-label="Confirm password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <div className="text-[11px] text-ink-3 mb-3">At least 8 characters.</div>
              {mismatch && <div className="text-[12px] text-status-red mb-3">Those two do not match.</div>}
              {error && <div className="text-[12px] text-status-red mb-3">{error}</div>}
              <Button type="submit" className="w-full" loading={reset.isPending} disabled={mismatch}>
                Set the password
              </Button>
              <div className="mt-3 text-center text-[12px] text-ink-2">
                <Link to="/forgot" className="font-semibold text-brand-ink">
                  Request a new link →
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
