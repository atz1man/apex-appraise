import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js';
import { Button, Spinner } from './ui';

/**
 * Card capture via Stripe's Payment Element (PCI never touches our servers).
 * On successful confirmation the caller verifies the intent server-side and
 * settles the ledger — no webhook required in dev.
 */
export function StripePaymentModal({
  publishableKey,
  clientSecret,
  amountLabel,
  kind,
  onSuccess,
  onClose,
}: {
  publishableKey: string;
  clientSecret: string;
  amountLabel: string;
  kind: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stripe = await loadStripe(publishableKey);
      if (!stripe || cancelled || !mountRef.current) return;
      stripeRef.current = stripe;
      const elements = stripe.elements({
        clientSecret,
        appearance: {
          variables: {
            colorPrimary: '#14503B',
            colorText: '#16201B',
            fontFamily: "'Schibsted Grotesk', system-ui, sans-serif",
            borderRadius: '9px',
          },
        },
      });
      elementsRef.current = elements;
      const el = elements.create('payment');
      el.mount(mountRef.current);
      el.on('ready', () => setReady(true));
    })();
    return () => {
      cancelled = true;
    };
  }, [publishableKey, clientSecret]);

  const confirm = async () => {
    if (!stripeRef.current || !elementsRef.current) return;
    setBusy(true);
    setError('');
    const result = await stripeRef.current.confirmPayment({
      elements: elementsRef.current,
      redirect: 'if_required',
    });
    if (result.error) {
      setError(result.error.message ?? 'Payment failed');
      setBusy(false);
      return;
    }
    onSuccess();
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" style={{ background: 'rgba(12,18,14,0.5)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
      <div className="bg-surface rounded-panel shadow-float w-[440px] max-w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <div className="label-mono text-ink-3">{kind}</div>
            <div className="fig text-[22px] font-semibold tracking-[-0.6px] mt-0.5">{amountLabel}</div>
          </div>
          <button className="text-ink-3 hover:text-ink text-[18px] leading-none" onClick={onClose}>×</button>
        </div>
        <div className="mt-4 min-h-[220px]">
          <div ref={mountRef} />
          {!ready && (
            <div className="flex justify-center py-10"><Spinner /></div>
          )}
        </div>
        {error && <div className="mt-2 text-[12px] text-status-red">{error}</div>}
        <Button className="w-full justify-center mt-4" disabled={!ready || busy} onClick={confirm}>
          {busy ? <Spinner /> : `Pay ${amountLabel}`}
        </Button>
        <div className="mt-2.5 text-[10.5px] text-ink-3 text-center">
          Processed securely by Stripe · test mode uses card 4242 4242 4242 4242
        </div>
      </div>
    </div>
  );
}
