import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { status as statusTokens, brand, neutral } from '@apex/ui-tokens';
import { clearSession, getPrincipal, trpc } from '../lib/trpc';
import { fM } from '../lib/format';
import { formatPct } from '@apex/appraisal-engine';
import { Avatar, Button, Icon, Spinner, Td, Th, TopBar } from '../components/ui';

const fdate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** Deal stage → LP-facing chip, per the prototype's status map. */
const STAGE_CHIP: Record<string, { label: string; text: string; bg: string }> = {
  CONSTRUCTION: { label: 'CONSTRUCTION', text: brand[700], bg: neutral.tintSuccess },
  SALES_LETTING: { label: 'IN SALES', text: statusTokens.blue.text, bg: statusTokens.blue.bg },
  COMPLETED: { label: 'REALISED', text: statusTokens.green.text, bg: statusTokens.green.bg },
};

/** The API's investorPosition helper is loosely typed (`any` internals), so re-assert row shapes locally. */
type HoldingRow = {
  dealName: string;
  dealAddress: string;
  stage: string;
  assetType: string;
  committed: number;
  called: number;
  distributed: number;
  irr: number;
};
type CashflowRow = { kind: string; label: string; amount: number; date: Date };

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export default function InvestorPortal() {
  const navigate = useNavigate();
  const principal = getPrincipal();
  const isInternal = principal?.principalType === 'internal';

  // internal users preview any investor; investor principals see only their own
  const listQ = trpc.investors.list.useQuery(undefined, { enabled: isInternal });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const effectiveId = selectedId ?? listQ.data?.[0]?.id ?? null;
  const getQ = trpc.investors.get.useQuery(effectiveId ?? '', { enabled: isInternal && !!effectiveId });
  const myQ = trpc.investors.myPosition.useQuery(undefined, { enabled: !isInternal });

  const inv = isInternal ? getQ.data : myQ.data;
  const isLoading = isInternal ? listQ.isLoading || getQ.isLoading : myQ.isLoading;
  const error = isInternal ? getQ.error : myQ.error;

  const signOut = () => {
    clearSession();
    navigate('/login');
  };

  const pos = inv?.position;
  const calledPct = pos && pos.committed > 0 ? pos.called / pos.committed : null;

  return (
    <div className="min-h-screen">
      <TopBar
        crumb="Investor portal"
        right={
          <>
            {isInternal && listQ.data && (
              <>
                <span className="text-[12px] text-ink-3">Viewing as</span>
                <select
                  className="h-[34px] font-semibold text-[12.5px]"
                  value={effectiveId ?? ''}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  {listQ.data.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            {inv && <Avatar initials={inv.initials} size={34} />}
            <button className="text-[12px] text-ink-3 hover:text-ink" onClick={signOut}>
              Sign out
            </button>
          </>
        }
      />
      <main className="max-w-[1320px] mx-auto px-6 pb-14">
        {isLoading ? (
          <div className="mt-14 flex justify-center">
            <Spinner />
          </div>
        ) : error || !inv ? (
          <div className="mt-14 max-w-md mx-auto bg-surface border border-border-strong rounded-panel shadow-rest p-6 text-center">
            <div className="text-[15px] font-semibold">We couldn't load your statement</div>
            <p className="mt-2 text-[12.5px] text-ink-2b leading-relaxed">
              Your investor account isn't linked to a position yet. Please contact your manager and we'll put it right.
            </p>
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={signOut}>
                Sign out
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* greeting */}
            <div className="mt-6 flex items-end justify-between gap-4 flex-wrap">
              <div>
                <div className="label-mono text-ink-3 tracking-[1px] text-[11px]">
                  Investor statement · {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
                <h1 className="mt-1.5 text-[24px] font-bold tracking-[-0.6px]">
                  {greeting()}, {inv.contactFirst || inv.name}
                </h1>
              </div>
              <div className="text-[12px] text-ink-3">
                {inv.name} · {formatPct(inv.sharePct / 100, 0)} share of the LP base
              </div>
            </div>

            {/* position cards */}
            {pos && (
              <div className="mt-[18px] grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
                <div
                  className="rounded-card px-[18px] py-4 text-white shadow-dark-card"
                  style={{ background: `linear-gradient(155deg,${brand[600]},${brand[700]})` }}
                >
                  <div className="label-mono" style={{ color: 'rgba(255,255,255,0.6)' }}>
                    Committed
                  </div>
                  <div className="fig mt-1.5 text-[22px] font-semibold tracking-[-1px]">{fM(pos.committed)}</div>
                </div>
                <div className="bg-surface border border-border-strong rounded-card shadow-rest px-[18px] py-4">
                  <div className="label-mono text-ink-3">Called / drawn</div>
                  <div className="fig mt-1.5 text-[22px] font-semibold tracking-[-1px]">{fM(pos.called)}</div>
                  {calledPct != null && <div className="mt-0.5 text-[11px] text-ink-3">{formatPct(calledPct, 0)} of committed</div>}
                </div>
                <div className="bg-surface border border-border-strong rounded-card shadow-rest px-[18px] py-4">
                  <div className="label-mono text-ink-3">Distributed</div>
                  <div className="fig mt-1.5 text-[22px] font-semibold tracking-[-1px] text-brand-500">{fM(pos.distributed)}</div>
                </div>
                <div className="bg-surface border border-border-strong rounded-card shadow-rest px-[18px] py-4">
                  <div className="label-mono text-ink-3">Net IRR</div>
                  <div className="fig mt-1.5 text-[22px] font-semibold tracking-[-1px]">{formatPct(pos.netIrr, 1)}</div>
                </div>
                <div className="bg-surface border border-border-strong rounded-card shadow-rest px-[18px] py-4">
                  <div className="label-mono text-ink-3">Net MOIC</div>
                  <div className="fig mt-1.5 text-[22px] font-semibold tracking-[-1px]">{pos.netMoic.toFixed(2)}×</div>
                </div>
              </div>
            )}

            <div className="mt-5 grid gap-5 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
              <div className="flex flex-col gap-4">
                {/* holdings */}
                <section className="bg-surface border border-border-strong rounded-panel shadow-rest p-5">
                  <h3 className="text-[16px] font-semibold tracking-[-0.3px] mb-3.5">Your holdings</h3>
                  <table className="w-full border-collapse">
                    <thead>
                      <tr>
                        <Th>Deal</Th>
                        <Th right>Committed</Th>
                        <Th right>Distributed</Th>
                        <Th right>Net IRR</Th>
                        <Th className="pl-4">Stage</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {inv.holdings.map((h: HoldingRow) => {
                        const chip = STAGE_CHIP[h.stage] ?? { label: h.stage, text: statusTokens.neutral.text, bg: statusTokens.neutral.bg };
                        return (
                          <tr key={h.dealName}>
                            <Td>
                              <div className="text-[13px] font-semibold">{h.dealName}</div>
                              <div className="text-[10.5px] text-ink-3">{h.dealAddress}</div>
                            </Td>
                            <Td right fig>
                              {fM(h.committed)}
                            </Td>
                            <Td right fig style={{ color: h.distributed > 0 ? statusTokens.green.text : undefined }}>
                              {h.distributed > 0 ? fM(h.distributed) : '—'}
                            </Td>
                            <Td right fig className="font-semibold">
                              {h.irr > 0 ? formatPct(h.irr, 1) : '—'}
                            </Td>
                            <Td className="pl-4">
                              <span className="label-mono inline-flex rounded-[7px] px-2 py-1" style={{ color: chip.text, background: chip.bg }}>
                                {chip.label}
                              </span>
                            </Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>

                {/* cashflow history */}
                <section className="bg-surface border border-border-strong rounded-panel shadow-rest p-5">
                  <h3 className="text-[16px] font-semibold tracking-[-0.3px] mb-1.5">Cashflow history</h3>
                  {inv.cashflows.length === 0 ? (
                    <div className="mt-3">
                      <div className="text-[12.5px] text-ink-3b">No distributions or capital calls yet.</div>
                    </div>
                  ) : (
                    <div className="flex flex-col">
                      {inv.cashflows.map((c: CashflowRow, i: number) => {
                        const isDist = c.kind === 'dist';
                        const tone = isDist ? statusTokens.green : statusTokens.red;
                        return (
                          <div key={`${c.label}-${i}`} className="flex items-center gap-3.5 py-[11px] border-b border-border-faint last:border-b-0">
                            <span className="shrink-0 w-[34px] h-[34px] rounded-[9px] flex items-center justify-center" style={{ background: tone.bg }}>
                              <Icon d={isDist ? 'M12 19V5|M5 12l7-7 7 7' : 'M12 5v14|M5 12l7 7 7-7'} size={16} color={tone.text} />
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] font-semibold">{c.label}</div>
                              <div className="text-[10.5px] text-ink-3">{fdate(c.date)}</div>
                            </div>
                            <span className="fig text-[14px] font-semibold" style={{ color: tone.text }}>
                              {isDist ? `+${fM(c.amount)}` : fM(c.amount)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>

              {/* side rail */}
              <div className="flex flex-col gap-4 sticky top-[78px]">
                {/* open capital call */}
                {inv.openCapitalCall && (
                  <section className="rounded-card px-[18px] py-4" style={{ background: '#FBF3E6', border: '1px solid #EBDCBC' }}>
                    <div className="flex items-center gap-[9px]">
                      <span
                        className="w-[26px] h-[26px] rounded-[8px] flex items-center justify-center"
                        style={{ background: statusTokens.amber.text }}
                      >
                        <Icon d="M12 8v5|M12 16h.01|M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" size={15} color="#fff" />
                      </span>
                      <span className="text-[13px] font-semibold" style={{ color: '#7A4E0E' }}>
                        Capital call open
                      </span>
                    </div>
                    <p className="mt-2.5 text-[12.5px] leading-[1.5] m-0" style={{ color: '#7A4E0E' }}>
                      {inv.openCapitalCall.label} — {inv.openCapitalCall.deal}.
                    </p>
                    <div className="mt-3 flex items-baseline justify-between">
                      <span className="text-[11px]" style={{ color: statusTokens.amber.text }}>
                        Your share
                      </span>
                      <span className="fig text-[18px] font-semibold" style={{ color: '#7A4E0E' }}>
                        {fM(inv.openCapitalCall.amount)}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-right" style={{ color: statusTokens.amber.text }}>
                      due {fdate(inv.openCapitalCall.due)}
                    </div>
                    <Button variant="secondary" className="mt-3 w-full justify-center">
                      <Icon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z|M14 2v6h6" size={14} />
                      View drawdown notice
                    </Button>
                  </section>
                )}

                {/* documents */}
                <section className="bg-surface border border-border-strong rounded-card shadow-rest px-[18px] py-4">
                  <h3 className="text-[13px] font-semibold">Documents</h3>
                  <div className="mt-2 flex flex-col">
                    {inv.documents.length === 0 ? (
                      <div className="text-[12px] text-ink-3b py-2">No documents shared yet.</div>
                    ) : (
                      inv.documents.map((d) => (
                        <button
                          key={d.name}
                          className="flex items-center gap-2.5 py-2 border-b border-border-faint last:border-b-0 text-left group"
                          title={`Download ${d.name}`}
                        >
                          <span
                            className="shrink-0 w-[26px] h-8 rounded-[5px] flex items-center justify-center fig text-[7px] font-semibold"
                            style={{ background: statusTokens.red.bg, color: statusTokens.red.text }}
                          >
                            {(d.name.split('.').pop() ?? 'PDF').toUpperCase()}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[12px] font-medium truncate">{d.name}</span>
                            <span className="block text-[10px] text-ink-3">
                              {fdate(d.date)} · {d.size}
                            </span>
                          </span>
                          <Icon d="M12 3v13|M8 12l4 4 4-4|M5 21h14" size={15} color={neutral.ink3} />
                        </button>
                      ))
                    )}
                  </div>
                </section>

                {/* manager contact */}
                <section className="bg-surface border border-border-strong rounded-card shadow-rest px-[18px] py-4">
                  <h3 className="text-[13px] font-semibold">Your manager</h3>
                  <div className="mt-3 flex items-center gap-[11px]">
                    <Avatar initials="AO" size={40} />
                    <div className="flex-1">
                      <div className="text-[13px] font-semibold">Arthur O.</div>
                      <div className="text-[11px] text-ink-3">Brookfield Developments</div>
                    </div>
                    <a
                      href="mailto:arthur@apexappraise.co.uk"
                      className="w-[34px] h-[34px] rounded-[9px] border border-border-strong flex items-center justify-center hover:bg-sunken"
                      title="Email Arthur"
                    >
                      <Icon d="M4 4h16v12H5.2L4 17.2z" size={16} color={brand[700]} strokeWidth={1.9} />
                    </a>
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
