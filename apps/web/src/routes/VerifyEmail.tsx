import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { BrandMark, Button, FormError } from '../components/ui';
import { heroGradient } from '@apex/ui-tokens';

export default function VerifyEmail() {
  const location = useLocation();
  const initial = location.state as { email?: string; emailSent?: boolean } | null;
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  const [email, setEmail] = useState(initial?.email ?? '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState(initial?.emailSent === false
    ? 'Your workspace is waiting for verification, but we could not send the email. You can retry below; if delivery remains unavailable, contact the service operator.'
    : token ? 'Confirm your email address below to activate your workspace.' : 'Open the verification link in your email to activate your workspace. Links expire after one hour.');
  const verify = trpc.auth.verifyEmail.useMutation({
    meta: { inlineError: true },
    onError: e => setError(e.message),
  });
  const resend = trpc.auth.resendVerification.useMutation({
    meta: { inlineError: true },
    onSuccess: () => setMessage('If this address has a pending account and delivery is available, a new link will arrive. Use the most recent link. Requests are limited to three per 15 minutes; check spam before retrying.'),
    onError: e => setError(e.message),
  });
  return <div className="min-h-screen flex items-center justify-center" style={{ background: heroGradient }}>
    <div className="w-[420px] max-w-[92vw] bg-surface rounded-panel shadow-dark-card p-5 sm:p-6">
      <BrandMark size={36} />
      <h1 className="text-[22px] font-bold mt-3 mb-3">Verify your email</h1>
      {verify.isSuccess ? <p role="status" className="text-ink-2 mb-4">Your email is verified. You can now sign in to your workspace.</p> : <>
        <p role="status" className="text-ink-2 mb-4">{message}</p>
        <p className="text-ink-2 mb-4">For a new trial workspace, your 14 days begin when you verify your email.</p>
        {token && <Button className="w-full mb-4" loading={verify.isPending} disabled={resend.isPending} onClick={() => {
          if (verify.isPending) return;
          setError('');
          verify.mutate({ token });
        }}>Verify email address</Button>}
        <form onSubmit={e => {
          e.preventDefault();
          if (resend.isPending) return;
          setError('');
          resend.mutate({ email: email.trim() });
        }}>
          <label htmlFor="verification-email" className="label-mono block mb-1">Email address</label>
          <input id="verification-email" type="email" autoComplete="email" required maxLength={254}
            className="w-full mb-3" value={email} onChange={e => setEmail(e.target.value)} readOnly={resend.isPending} />
          <Button type="submit" className="w-full" loading={resend.isPending} disabled={verify.isPending}>Request a new verification link</Button>
        </form>
      </>}
      {error && <FormError className="mt-3">{error}</FormError>}
      <Link to="/login" className="inline-block mt-4 text-brand-ink font-semibold">Back to sign in</Link>
    </div>
  </div>;
}
