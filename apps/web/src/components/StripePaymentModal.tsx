import { useEffect, useRef, useState } from 'react';
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js';
import { Button, FormError, Spinner, useDialog } from './ui';
import { brand, fixed } from '@apex/ui-tokens';

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
  // this dialog is always open while it is mounted — its caller unmounts it
  const panel = useDialog(true, onClose);
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
            colorPrimary: brand[700],
            colorText: fixed.ink,
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
      {/*
        Before this it was a card form with no `role`, no Escape and a close
        button named "×": a screen reader was not told a dialog had opened, and
        a keyboard user had no way to abandon a payment.

        The trap holds the parent document's own ring. Stripe's card fields are
        in an IFRAME and keydown does not cross that boundary, so once focus is
        inside them the browser's tab order takes over — a real limit of the
        technique, and why the iframe is in the ring rather than pretended away.
      */}
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={`${kind} — ${amountLabel}`}
        tabIndex={-1}
        className="bg-surface rounded-panel shadow-float w-[440px] max-w-full p-6 outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <div className="label-mono text-ink-3">{kind}</div>
            <div className="fig text-[22px] font-semibold tracking-[-0.6px] mt-0.5">{amountLabel}</div>
          </div>
          <button className="text-ink-3 hover:text-ink text-[18px] leading-none" aria-label="Close without paying" onClick={onClose}>×</button>
        </div>
        <div className="mt-4 min-h-[220px]">
          <div ref={mountRef} />
          {!ready && (
            <div className="flex justify-center py-10"><Spinner /></div>
          )}
        </div>
        {error && <FormError className="mt-2 text-[12px]">{error}</FormError>}
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
