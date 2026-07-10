import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { status as statusTokens, brand, neutral, type StatusKey } from '@apex/ui-tokens';
import { clearSession, getPrincipal, trpc } from '../lib/trpc';
import { formatMoneyFull } from '@apex/appraisal-engine';
import { Avatar, BrandMark, Button, Icon, Skeleton, SkeletonRows, Spinner, StatusChip } from '../components/ui';
import { StripePaymentModal } from '../components/StripePaymentModal';

const fdate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

const UNIT_STATUS: Record<string, { key: StatusKey; label: string }> = {
  AVAILABLE: { key: 'neutral', label: 'AVAILABLE' },
  RESERVED: { key: 'amber', label: 'RESERVED' },
  EXCHANGED: { key: 'blue', label: 'EXCHANGED' },
  COMPLETED: { key: 'green', label: 'COMPLETED' },
  HANDOVER: { key: 'green', label: 'HANDOVER' },
};

/** Plain-English explainer for each conveyancing milestone (the "what happens next" card). */
const MILESTONE_EXPLAINERS: Record<string, string> = {
  Reserved: 'Your reservation is confirmed and your plot is off the market while the legal work gets underway.',
  'Memorandum of sale': 'We circulate the memorandum of sale to both solicitors so the legal work can begin.',
  'Searches ordered': 'Your solicitor orders the local authority, water and environmental searches on the property.',
  'Enquiries raised': 'Your solicitor reviews the contract pack and raises enquiries with ours — routine, and we answer quickly.',
  'Mortgage offer': 'Your lender completes its valuation and issues your formal mortgage offer.',
  Exchanged: 'Contracts are exchanged, your deposit is paid over and the purchase becomes legally binding.',
  Completed: 'Funds are transferred on completion day and the home becomes legally yours.',
  'Handover & snagging': 'We hand over your keys, walk you through your new home and log any snags for our team to fix.',
};

export default function BuyerPortal() {
  const navigate = useNavigate();
  const principal = getPrincipal();
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.buyer.myUnit.useQuery(undefined, { retry: false });

  // persisted e-sign — the server stamps signedAt (DocuSign in prod)
  const sign = trpc.buyer.sign.useMutation({ onSuccess: () => utils.buyer.myUnit.invalidate() });
  const [cardModal, setCardModal] = useState<{ clientSecret: string; paymentId: string; amountLabel: string; kind: string } | null>(null);
  const { data: billing } = trpc.billing.config.useQuery();
  const pay = trpc.buyer.pay.useMutation({
    onSuccess: (res, paymentId) => {
      if (res.mode === 'live' && 'clientSecret' in res && res.clientSecret) {
        const p = data?.payments.find((x) => x.id === paymentId);
        setCardModal({
          clientSecret: res.clientSecret,
          paymentId,
          amountLabel: p ? formatMoneyFull(p.amount) : '',
          kind: p?.kind ?? 'Payment',
        });
      } else {
        utils.buyer.myUnit.invalidate();
      }
    },
  });
  const confirmPayment = trpc.buyer.confirmPayment.useMutation({
    onSuccess: () => {
      setCardModal(null);
      utils.buyer.myUnit.invalidate();
    },
  });

  const signOut = () => {
    clearSession();
    navigate('/login');
  };

  const milestones = data ? [...data.milestones].sort((a, b) => a.index - b.index) : [];
  const doneCount = milestones.filter((m) => m.done).length;
  const currentIdx = milestones.findIndex((m) => !m.done);
  const currentMilestone = currentIdx >= 0 ? milestones[currentIdx] : null;

  return (
    <div className="min-h-screen">
      {/* buyer-facing top bar: development branding, no internal navigation */}
      <header className="sticky top-0 z-40 h-14 bg-surface border-b border-border-strong flex items-center gap-3 px-5">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <span className="text-[15.5px] font-bold tracking-[-0.3px]">{data?.development.name ?? 'Apex Appraise'}</span>
        </div>
        <span className="label-mono rounded-[7px] px-2.5 py-1 bg-tint-success text-brand-700 tracking-[0.4px]">Buyer portal</span>
        <div className="ml-auto flex items-center gap-2.5">
          {principal && (
            <>
              <div className="text-right">
                <div className="text-[13px] font-semibold leading-tight">{principal.name}</div>
                {data && <div className="text-[11px] text-ink-3 leading-tight">{data.unit.name}</div>}
              </div>
              <Avatar initials={principal.initials} size={34} />
            </>
          )}
          <button className="text-[12px] text-ink-3 hover:text-ink" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-[960px] mx-auto px-6 pb-16">
        {isLoading ? (
          <div aria-busy="true">
            {/* hero placeholder */}
            <Skeleton height={196} className="mt-7 rounded-[20px]" />
            <div className="mt-[18px] grid gap-[18px] items-start" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {/* timeline panel placeholder */}
              <section className="bg-surface border border-border-strong rounded-panel shadow-rest p-[22px]">
                <Skeleton width={120} height={15} className="mb-4" />
                <SkeletonRows rows={6} height={26} />
              </section>
              {/* right-hand panel placeholders */}
              <div className="flex flex-col gap-[18px]">
                <Skeleton height={190} className="rounded-panel" />
                <Skeleton height={130} className="rounded-panel" />
                <Skeleton height={130} className="rounded-panel" />
              </div>
            </div>
          </div>
        ) : error ? (
          <div className="mt-14 max-w-md mx-auto bg-surface border border-border-strong rounded-panel shadow-rest p-6 text-center">
            <div className="text-[15px] font-semibold">
              {error.data?.code === 'FORBIDDEN' ? 'This portal is for buyers' : "We couldn't load your purchase"}
            </div>
            <p className="mt-2 text-[12.5px] text-ink-2b leading-relaxed">
              {error.data?.code === 'FORBIDDEN'
                ? "Your account isn't linked to a reserved plot. If you've recently reserved, contact your sales progressor and we'll connect it."
                : 'Something went wrong on our side. Please try again shortly, or contact your sales progressor.'}
            </p>
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={signOut}>
                Sign out
              </Button>
            </div>
          </div>
        ) : data ? (
          <>
            {/* welcoming hero */}
            <section
              className="mt-7 rounded-[20px] p-8 text-white shadow-dark-card relative overflow-hidden"
              style={{ background: `linear-gradient(155deg,${brand[600]},${brand[700]})` }}
            >
              <div
                className="absolute rounded-full"
                style={{ top: -40, right: -30, width: 180, height: 180, background: 'rgba(255,255,255,0.06)' }}
              />
              <div className="label-mono tracking-[0.8px]" style={{ color: 'rgba(255,255,255,0.6)' }}>
                Your purchase
              </div>
              <h1 className="mt-2 text-[30px] font-bold tracking-[-1px] leading-tight">Your new home at {data.development.name}</h1>
              <div className="mt-1.5 text-[15px] text-accent-muted-4">
                {data.unit.name} · {data.unit.spec} · {data.development.address}
              </div>
              <div className="mt-5 flex items-center gap-3.5">
                <div className="flex-1 h-2 rounded-[5px] overflow-hidden" style={{ background: 'rgba(255,255,255,0.18)' }}>
                  <div
                    className="h-full transition-all"
                    style={{ width: `${milestones.length ? (doneCount / milestones.length) * 100 : 0}%`, background: '#7FE3B4' }}
                  />
                </div>
                <span className="fig text-[13px] font-semibold">
                  {doneCount} of {milestones.length} steps
                </span>
              </div>
            </section>

            <div className="mt-[18px] grid gap-[18px] items-start" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {/* left: conveyancing timeline */}
              <section className="bg-surface border border-border-strong rounded-panel shadow-rest p-[22px]">
                <h3 className="text-[15px] font-semibold mb-4">Your progress</h3>
                <div className="flex flex-col">
                  {milestones.map((m, i) => {
                    const isCurrent = i === currentIdx;
                    const isLast = i === milestones.length - 1;
                    const date = fdate(m.date);
                    return (
                      <div key={m.index} className="flex gap-3.5">
                        <div className="shrink-0 flex flex-col items-center">
                          <span
                            className="w-6 h-6 rounded-full flex items-center justify-center"
                            style={{
                              background: m.done ? brand[700] : neutral.surface,
                              border: `2px solid ${m.done ? brand[700] : isCurrent ? statusTokens.amber.dot : neutral.dashed}`,
                            }}
                          >
                            {m.done ? (
                              <Icon d="m5 12 5 5 9-10" size={12} color="#fff" strokeWidth={3.2} />
                            ) : isCurrent ? (
                              <span className="w-2 h-2 rounded-full animate-pulseDot" style={{ background: statusTokens.amber.dot }} />
                            ) : null}
                          </span>
                          {!isLast && <span className="w-[2px] flex-1 min-h-4" style={{ background: m.done ? brand[700] : neutral.border }} />}
                        </div>
                        <div className="flex-1 pb-4">
                          <div
                            className="text-[13.5px] font-semibold"
                            style={{ color: m.done ? neutral.ink : isCurrent ? statusTokens.amber.text : neutral.ink3b }}
                          >
                            {m.name}
                          </div>
                          <div
                            className="fig mt-[1px] text-[11px]"
                            style={{ color: m.done ? statusTokens.green.text : isCurrent ? statusTokens.amber.text : neutral.ink3b }}
                          >
                            {m.done ? (date ?? 'Done') : isCurrent ? 'In progress' : 'Upcoming'}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* right: plot, documents, payments, what's next */}
              <div className="flex flex-col gap-[18px]">
                {/* plot card */}
                <section className="bg-surface border border-border-strong rounded-panel shadow-rest p-[22px]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[15px] font-semibold">{data.unit.name}</div>
                      <div className="text-[11.5px] text-ink-3">{data.unit.spec}</div>
                    </div>
                    {(() => {
                      const s = UNIT_STATUS[data.unit.status] ?? UNIT_STATUS.AVAILABLE;
                      return <StatusChip status={s.key} label={s.label} />;
                    })()}
                  </div>
                  <div className="mt-3.5">
                    <div className="label-mono text-ink-3">Agreed purchase price</div>
                    <div className="fig mt-1 text-[28px] font-semibold tracking-[-1.5px]">
                      {data.unit.agreedValue != null ? formatMoneyFull(data.unit.agreedValue) : '—'}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-col gap-1.5 text-[12px]">
                    <div className="flex justify-between gap-3">
                      <span className="text-ink-3">Reserved</span>
                      <span className="fig">{fdate(data.unit.reservedAt) ?? '—'}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-ink-3">Deposit held</span>
                      <span className="fig">{data.unit.depositHeld != null ? formatMoneyFull(data.unit.depositHeld) : '—'}</span>
                    </div>
                    {data.unit.incentive && data.unit.incentive !== 'None' && (
                      <div className="flex justify-between gap-3">
                        <span className="text-ink-3">Incentive</span>
                        <span className="font-medium text-brand-500">{data.unit.incentive}</span>
                      </div>
                    )}
                  </div>
                </section>

                {/* documents to e-sign */}
                <section className="bg-surface border border-border-strong rounded-panel shadow-rest p-[22px]">
                  <h3 className="text-[15px] font-semibold">Documents to sign</h3>
                  {data.documentsToSign.length === 0 ? (
                    <div className="mt-2 text-[12px] text-ink-3b">Nothing waiting for your signature.</div>
                  ) : (
                    <div className="mt-2.5 flex flex-col">
                      {data.documentsToSign.map((d) => {
                        const isSigned = d.signed;
                        return (
                          <div key={d.id} className="flex items-center gap-2.5 py-2.5 border-b border-border-faint last:border-b-0">
                            <span
                              className="shrink-0 w-[26px] h-8 rounded-[5px] flex items-center justify-center fig text-[7px] font-semibold"
                              style={{ background: statusTokens.red.bg, color: statusTokens.red.text }}
                            >
                              PDF
                            </span>
                            <span className="flex-1 min-w-0 text-[12.5px] font-medium truncate">{d.name}</span>
                            {isSigned ? (
                              <StatusChip status="green" label="SIGNED" />
                            ) : (
                              <Button variant="secondary" className="h-[32px] px-3 text-[12px]" disabled={sign.isPending} onClick={() => sign.mutate(d.id)}>
                                {sign.isPending && sign.variables === d.id ? (
                                  <Spinner />
                                ) : (
                                  <>
                                    <Icon d="M12 20h9|M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" size={13} />
                                    Review &amp; sign
                                  </>
                                )}
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-2.5 text-[10.5px] text-ink-3 leading-snug">
                    E-signatures are executed through our DocuSign integration — signed copies land in your email and this portal.
                  </div>
                </section>

                {/* payments */}
                <section className="bg-surface border border-border-strong rounded-panel shadow-rest p-[22px]">
                  <h3 className="text-[15px] font-semibold">Payments</h3>
                  <div className="mt-2 flex flex-col">
                    {data.payments.map((p) => (
                      <div key={p.id} className="flex items-center gap-3 py-2.5 border-b border-border-faint last:border-b-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-medium">{p.kind}</div>
                          <div className="text-[10.5px] text-ink-3">{p.paid ? (fdate(p.date) ?? 'Received') : 'Due at exchange'}</div>
                        </div>
                        <span className="fig text-[13px] font-semibold">{formatMoneyFull(p.amount)}</span>
                        {p.paid ? (
                          <StatusChip status="green" label="PAID" />
                        ) : (
                          <button
                            className="rounded-[9px] bg-brand-700 hover:bg-brand-600 text-white text-[11.5px] font-semibold px-3 py-1.5 disabled:opacity-50 transition-colors"
                            disabled={pay.isPending}
                            onClick={() => pay.mutate(p.id)}
                          >
                            {pay.isPending && pay.variables === p.id ? 'Processing…' : 'Pay now'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-2.5 text-[10.5px] text-ink-3 leading-snug">
                    {data.stripeMode === 'live'
                      ? 'Card payments are processed securely by Stripe.'
                      : 'Demo mode — payments settle instantly. Live card processing activates when Stripe keys are configured.'}
                  </div>
                </section>

                {/* what happens next */}
                <section className="rounded-panel p-[22px] bg-tint-success border border-border-strong">
                  <div className="flex items-center gap-[9px]">
                    <span className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center" style={{ background: brand[700] }}>
                      <Icon d="M12 16v-4|M12 8h.01" size={15} color="#fff" strokeWidth={2.2} />
                    </span>
                    <span className="text-[13.5px] font-semibold text-brand-700">What happens next</span>
                  </div>
                  {currentMilestone ? (
                    <>
                      <div className="mt-2.5 text-[13px] font-semibold">{currentMilestone.name}</div>
                      <p className="mt-1 text-[12.5px] leading-[1.55] text-ink-2b m-0">
                        {MILESTONE_EXPLAINERS[currentMilestone.name] ?? 'Your sales progressor will be in touch with the details of this step.'}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2.5 text-[12.5px] leading-[1.55] text-ink-2b m-0">
                      Every step is complete — welcome home. Any snags? Your sales team is one message away.
                    </p>
                  )}
                </section>
              </div>
            </div>

            {/* contact the sales team */}
            <section className="mt-[18px] bg-surface border border-border-strong rounded-card shadow-rest px-5 py-4 flex items-center gap-[13px]">
              <Avatar initials="SR" size={40} />
              <div className="flex-1">
                <div className="text-[13px] font-semibold">Sarah Reeve · Sales progressor</div>
                <div className="text-[11.5px] text-ink-3">Your point of contact through to completion</div>
              </div>
              <div className="flex gap-2">
                <a
                  href="mailto:sales@apexappraise.co.uk"
                  className="w-[38px] h-[38px] rounded-[10px] border border-border-strong flex items-center justify-center hover:bg-sunken transition-colors"
                  title="Email your sales team"
                  aria-label="Email your sales team"
                >
                  <Icon d="M4 4h16v12H5.2L4 17.2z" size={17} color={brand[700]} strokeWidth={1.9} />
                </a>
                <a
                  href="tel:+441202555555"
                  className="w-[38px] h-[38px] rounded-[10px] border border-border-strong flex items-center justify-center hover:bg-sunken transition-colors"
                  title="Call your sales team"
                  aria-label="Call your sales team"
                >
                  <Icon
                    d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8.1 9.5a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2Z"
                    size={17}
                    color={brand[700]}
                    strokeWidth={1.9}
                  />
                </a>
              </div>
            </section>
          </>
        ) : null}
      </main>

      {cardModal && billing?.publishableKey && (
        <StripePaymentModal
          publishableKey={billing.publishableKey}
          clientSecret={cardModal.clientSecret}
          amountLabel={cardModal.amountLabel}
          kind={cardModal.kind}
          onClose={() => setCardModal(null)}
          onSuccess={() => confirmPayment.mutate(cardModal.paymentId)}
        />
      )}
    </div>
  );
}
