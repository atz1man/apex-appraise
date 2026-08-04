import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { trpc } from '../lib/trpc';
import { BrandMark, Button, FirmMark, Spinner } from '../components/ui';
import { TermsDocument, TERMS_PRINT_CSS } from '../components/TermsDocument';

/**
 * PUBLIC signing page. The client reaches this by the link the valuer sends —
 * no account, no login. They read the terms as issued and sign by typing their
 * name and agreeing explicitly; the API records the evidence.
 */
export default function SignTerms() {
  const { token = '' } = useParams();
  const utils = trpc.useUtils();
  const { data: t, isLoading, error } = trpc.engagement.publicGet.useQuery({ token }, { enabled: !!token, retry: false });

  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const sign = trpc.engagement.sign.useMutation({ onSuccess: () => utils.engagement.publicGet.invalidate({ token }) });

  if (isLoading) {
    return (
      <div className="light min-h-screen bg-frame flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !t) {
    // the API distinguishes an expired link from an unknown one: only someone
    // holding a real (unguessable) token can see the expiry message, so it
    // gives the client something actionable without telling a stranger anything
    const expired = /expired/i.test(error?.message ?? '');
    return (
      <div className="light min-h-screen bg-frame flex items-center justify-center px-5">
        <div className="bg-surface border border-border-strong rounded-card shadow-rest max-w-[440px] w-full p-8 text-center">
          <BrandMark size={34} />
          <div className="mt-4 text-[17px] font-semibold tracking-[-0.3px]">
            {expired ? 'This signing link has expired' : 'This signing link is no longer valid'}
          </div>
          <p className="mt-2 text-[13px] text-ink-2 leading-relaxed">
            {expired
              ? 'Signing links stop working after a set period. Ask the sender to issue a new one — nothing you have already signed is affected.'
              : 'The terms may have been withdrawn or reissued. Please ask the sender for a current link.'}
          </p>
        </div>
      </div>
    );
  }

  const signed = t.status === 'ACCEPTED';
  const ref = `${t.orgName.slice(0, 4).toUpperCase()}-TOE`;

  return (
    <div className="light min-h-screen bg-frame">
      <style>{TERMS_PRINT_CSS}</style>

      <div className="no-print sticky top-0 z-40 bg-surface border-b border-border-strong px-5 py-3 flex items-center gap-3">
        <FirmMark logoUrl={t.orgLogoUrl} size={26} alt={`${t.orgName} logo`} />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold truncate">{t.orgName} — terms of engagement</div>
          <div className="text-[11.5px] text-ink-3 truncate">{t.dealName}</div>
        </div>
        <div className="ml-auto">
          {signed ? (
            <span className="label-mono rounded-pill bg-tint-success text-brand-ink px-3 py-1.5">SIGNED</span>
          ) : (
            <Button onClick={() => document.getElementById('sign-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>
              Go to signature
            </Button>
          )}
        </div>
      </div>

      <TermsDocument t={t} subject={t.dealName} address={t.dealAddress} postcode={t.dealPostcode} refCode={ref} />

      <div className="no-print px-5 pb-16 flex justify-center">
        <div id="sign-panel" className="bg-surface border border-border-strong rounded-card shadow-rest w-full max-w-[794px] p-7">
          {signed ? (
            <>
              <div className="text-[16px] font-semibold tracking-[-0.3px]">Thank you — these terms are signed</div>
              <p className="mt-2 text-[13px] text-ink-2 leading-relaxed">
                Signed by <b className="font-semibold">{t.signedName ?? t.acceptedBy}</b>
                {t.signedAt ? ` on ${new Date(t.signedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.
                {' '}A copy is held by {t.orgName}; print this page for your records.
              </p>
              <div className="mt-4">
                <Button variant="secondary" onClick={() => window.print()}>Print / Save PDF</Button>
              </div>
            </>
          ) : (
            <>
              <div className="text-[16px] font-semibold tracking-[-0.3px]">Sign these terms</div>
              <p className="mt-2 text-[13px] text-ink-2 leading-relaxed">
                Typing your name below and confirming has the same effect as signing by hand. {t.orgName} will record the time
                and origin of your signature.
              </p>

              <label className="block mt-4">
                <span className="label-mono text-ink-3 block mb-1">Full name</span>
                <input
                  className="w-full max-w-[380px]"
                  aria-label="Full name"
                  autoComplete="name"
                  placeholder="e.g. Jane Marchmont"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>

              <label className="mt-4 flex items-start gap-2.5 cursor-pointer max-w-[620px]">
                <input
                  type="checkbox"
                  className="mt-[3px]"
                  aria-label="I agree to these terms of engagement"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span className="text-[13px] text-ink-2 leading-relaxed">
                  I have read these terms of engagement, I am authorised to accept them on behalf of{' '}
                  <b className="font-semibold">{t.clientName || 'the client'}</b>, and I agree to them.
                </span>
              </label>

              {sign.error && <div className="mt-3 text-[12.5px] text-status-red">{sign.error.message}</div>}

              <div className="mt-5 flex items-center gap-3">
                <Button
                  loading={sign.isPending}
                  disabled={name.trim().length < 2 || !agreed}
                  onClick={() => sign.mutate({ token, name: name.trim(), agreed: true })}
                >
                  Sign and return
                </Button>
                {name.trim().length >= 2 && (
                  <span
                    className="text-[19px]"
                    style={{ fontFamily: '"Snell Roundhand", "Apple Chancery", "Segoe Script", cursive', color: 'rgb(var(--brand-800, 15 53 40))' }}
                  >
                    {name.trim()}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
