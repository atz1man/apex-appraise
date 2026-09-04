import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { AutoAppraisalResult } from '@apex/appraisal-engine';
import type { Extraction } from '@apex/types';
import { trpc } from '../lib/trpc';
import { fM, n0, formatDelta, formatPct, formatSigned } from '../lib/format';
import { useUnits } from '../lib/region';
import { Button, Dot, EmptyState, FormError, Panel, ProgressBar, SegmentedToggle, Spinner, Td, Th, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';
import { accent, brand, brandInk, neutral, onFill } from '@apex/ui-tokens';
import { manualDefaultsFor, manualIsRunnable, type ManualState, type ManualUnit } from '../lib/auto-defaults';

// ---------- types ----------

type Verdict = 'Proceed' | 'Caution' | 'Decline';
/** `roc` is null when no asking price was given — there is no cost to return on. */
type Indicative = AutoAppraisalResult & { roc: number | null; verdict: Verdict };

interface RunState {
  extraction: Extraction;
  buildPerSqft: number;
  indicative: Indicative;
  /** display label for the headline (manual mode keeps the free-text asset type) */
  assetLabel: string;
  sourceNote: string;
}


// ---------- the worked example the AI panel discloses ----------

const SAMPLE_NOTES =
  'Planning ref 7/2025/0412 — GRANTED. Demolition of existing warehouse and erection of 6no. B2/B8 trade counter units with ancillary mezzanine offices, Holdenhurst Road, Bournemouth BH8 8EW. Total consented floorspace 36,200 sq ft GIA. Conditions: standard pre-commencement; S106 contribution £150,000 (highways). CIL charging rate £40 per sqm.\n\nCost plan summary: shell, core & fit-out £105/ft². Programme 18 months + 3 month sales.\n\nComparables: trade counter capital values £230–£250/ft²; B8 warehouse £160–£170/ft²; mezzanine offices £200–£215/ft². Asking land price £400,000. Target profit 20% of GDV. Senior debt 60% LTC at 7.5% pa.';


const LOADING_STAGES = [
  'Reading planning & documents',
  'Extracting areas & unit mix',
  'Pricing build & finance',
  'Running residual appraisal & risk',
];

const VERDICT_STYLE: Record<Verdict, { dot: string; bg: string }> = {
  Proceed: { dot: accent[300], bg: 'rgba(127,227,180,0.2)' },
  Caution: { dot: 'rgb(var(--dot-warn, 245 196 81))', bg: 'rgba(245,196,81,0.22)' },
  Decline: { dot: 'rgb(var(--dot-crit, 240 138 124))', bg: 'rgba(240,138,124,0.22)' },
};

const CONF_DOT: Record<'high' | 'med' | 'low', string> = {
  high: 'rgb(var(--status-green, 30 122 85))',
  med: 'rgb(var(--status-amber, 154 98 18))',
  low: 'rgb(var(--status-red, 178 58 46))',
};

// ---------- small local pieces ----------

function Sparkle({ size = 16, color = onFill }: { size?: number; color?: string }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2Z" />
      <path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z" />
    </svg>
  );
}

const DOC_TILES: Array<{ label: string; sub: string; icon: JSX.Element }> = [
  {
    label: 'Architectural drawings',
    sub: 'GIA / unit mix',
    icon: (
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={brandInk} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H3z" />
      </svg>
    ),
  },
  {
    label: 'Cost plan',
    sub: 'Build cost rate',
    icon: (
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={brandInk} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3v18M3 9h18" />
        <rect x="3" y="3" width="18" height="18" rx="2" />
      </svg>
    ),
  },
  {
    label: 'Planning decision',
    sub: 'Use / levies / obligations',
    icon: (
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={brandInk} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 3h7l4 4v14H7z" />
        <path d="M14 3v4h4" />
      </svg>
    ),
  },
  {
    label: 'Comparables',
    sub: 'Capital value rate',
    icon: (
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={brandInk} strokeWidth="2.1" strokeLinecap="round">
        <path d="M5 20v-7M12 20V5M19 20v-9" />
      </svg>
    ),
  },
];

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <div className="label-mono text-ink-3">{children}</div>;
}

function NumBox({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="block text-[10px] text-ink-3">{label}</span>
      <input
        type="number"
        step="any"
        className="mt-1 w-full h-8 px-2 text-right fig text-[12px] font-medium"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </label>
  );
}

function TextBox({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <MicroLabel>{label}</MicroLabel>
      <input className="mt-1.5 w-full h-[34px] text-[12.5px] font-medium" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function RateBox({ prefix, value, onChange }: { prefix: string; value: number; onChange: (v: number) => void }) {
  // the rate is held per square foot, as the engine wants it, and typed in the
  // firm's own unit — see lib/region.ts on why the round trip is the hard part
  const U = useUnits();
  return (
    <div className="flex-none flex items-center gap-1.5 px-3 h-[42px] border border-border-strong rounded-[11px]">
      <span className="text-[12px] text-ink-2b whitespace-nowrap">{prefix}</span>
      <input
        type="number"
        aria-label={`${prefix} per ${U.unitSpoken}`}
        className="w-[54px] text-right fig text-[13px] font-semibold text-brand-ink"
        style={{ border: 'none', boxShadow: 'none', padding: 0, background: 'transparent' }}
        value={Number.isFinite(value) ? U.rateField(value) : 0}
        onChange={(e) => onChange(U.rateFromField(parseFloat(e.target.value) || 0))}
      />
      <span className="text-[12px] text-ink-3">/{U.unit}</span>
    </div>
  );
}

function HeadlineStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex-1 rounded-[11px] px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.1)' }}>
      <div className="fig text-[9px] uppercase" style={{ color: 'rgba(255,255,255,0.6)', letterSpacing: '0.4px' }}>{label}</div>
      <div className="fig mt-1 text-[18px] font-semibold tracking-[-0.6px]">{value}</div>
    </div>
  );
}

function Well({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex-1 bg-sunken border border-border-std rounded-[11px] p-3">
      <div className="fig text-[9.5px] uppercase text-ink-3" style={{ letterSpacing: '0.4px' }}>{label}</div>
      <div className="fig mt-1 text-[15px] font-semibold" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  );
}

/** manual free-text asset type → extraction enum */
function assetEnum(text: string): Extraction['assetType'] {
  const t = text.toLowerCase();
  if (t.includes('resi')) return 'residential';
  if (t.includes('mixed')) return 'mixed';
  if (t.includes('office') || t.includes('retail') || t.includes('commercial')) return 'commercial';
  return 'industrial';
}

// ---------- screen ----------

export default function AutoAppraisal() {
  /** floor areas and rates in the firm's own unit, and the words for them */
  const U = useUnits();
  const { dealId = '' } = useParams();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });

  const extract = trpc.autoAppraisal.extract.useMutation();
  const whatIf = trpc.autoAppraisal.whatIf.useMutation();
  const save = trpc.appraisal.save.useMutation();
  /**
   * Does this deal already have an appraisal?
   *
   * If it does, accepting an extraction BRANCHES rather than overwrites. An AI
   * reading of some drawings replacing a valuer's own figures in place, with no
   * version and nothing in the history to say it happened, is the same silent
   * loss the save lock exists to stop — and here the thing being lost is human
   * work replaced by a machine's.
   */
  const { data: existingAppraisal } = trpc.appraisal.getCurrent.useQuery(dealId, { enabled: !!dealId });

  const [engine, setEngine] = useState<'ai' | 'manual'>('ai');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'result'>('idle');
  const [notes, setNotes] = useState(SAMPLE_NOTES);
  const [buildRate, setBuildRate] = useState(105);
  const [docsOn, setDocsOn] = useState<number[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  // real data-room documents the AI can read (PDFs/images with a stored file)
  const { data: roomDocs } = trpc.documents.list.useQuery({ dealId }, { enabled: !!dealId });
  const readableDocs = (roomDocs?.documents ?? []).filter(
    (d) => d.url?.startsWith('/uploads/files/') && ['pdf', 'png', 'jpg', 'jpeg'].includes(d.ext.toLowerCase()),
  );
  const toggleDoc = (id: string) =>
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id);
      return next;
    });
  /**
   * The manual form starts from THIS deal — name, address, asset type — and
   * from nothing that is a fact about a scheme. It started from the demo
   * scheme, on every deal; see lib/auto-defaults.ts. Seeded once the deal
   * record arrives, and never over something the person has typed.
   */
  const [manual, setManual] = useState<ManualState>(() => manualDefaultsFor(null));
  const touched = useRef(false);
  useEffect(() => {
    if (deal && !touched.current) setManual(manualDefaultsFor(deal));
  }, [deal]);
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [stage, setStage] = useState(0);

  // cycle the loading stage highlight while pending
  useEffect(() => {
    if (phase !== 'loading') {
      setStage(0);
      return;
    }
    const t = setInterval(() => setStage((s) => (s + 1) % LOADING_STAGES.length), 900);
    return () => clearInterval(t);
  }, [phase]);

  const setMan = (patch: Partial<ManualState>) => {
    touched.current = true;
    setManual((s) => ({ ...s, ...patch }));
  };
  const setFin = (patch: Partial<ManualState['finance']>) => {
    touched.current = true;
    setManual((s) => ({ ...s, finance: { ...s.finance, ...patch } }));
  };
  const setUnit = (i: number, patch: Partial<ManualUnit>) => {
    touched.current = true;
    setManual((s) => ({ ...s, units: s.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) }));
  };

  // ---- AI extraction run: real documents + notes ----
  const onGenerate = async () => {
    const docIds = [...selectedDocs];
    if (phase === 'loading' || (notes.trim().length < 10 && docIds.length === 0)) return;
    setError(null);
    setPhase('loading');
    try {
      const res = await extract.mutateAsync({ notes, documentIds: docIds, buildPerSqft: buildRate });
      if (docIds.length) utils.documents.list.invalidate();
      setRun({
        extraction: res.extraction,
        buildPerSqft: buildRate,
        indicative: res.indicative,
        assetLabel: res.extraction.assetType,
        sourceNote: res.documentsRead?.length
          ? `Generated by AI from ${res.documentsRead.length} document${res.documentsRead.length === 1 ? '' : 's'}: ${res.documentsRead.join('; ')}${notes.trim() ? ' + your notes' : ''}.`
          : 'Generated by AI from your document text.',
      });
      setChat([]);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed — try manual entry.');
      setPhase(run ? 'result' : 'idle');
    }
  };

  // ---- manual run: build an Extraction from the form, compute server-side ----
  const onRunManual = async () => {
    if (phase === 'loading' || !manualIsRunnable(manual)) return;
    const m = manual;
    const extraction: Extraction = {
      // manual entry is the user's own scheme, never the worked example
      sample: false,
      scheme: m.scheme,
      address: m.address,
      assetType: assetEnum(m.assetType),
      units: m.units.map((u) => ({ label: u.label, count: u.count, area: u.area, value: u.value, conf: 'high' as const, source: 'Manual entry' })),
      efficiency: m.efficiency,
      profFee: m.profFee,
      contingency: m.contingency,
      finance: { ...m.finance },
      targetProfit: m.targetProfit,
      asking: m.asking,
      cilPerSqm: m.cilPerSqm,
      s106: m.s106,
      agent: m.agent,
      legal: m.legal,
      acq: m.acq,
      planningStatus: m.planningStatus,
      planningRisk: 30,
      planningRiskLabel: 'Manual',
      planningNotes: `${m.planningStatus || 'Planning not assessed'} — risk not scored in manual mode.`,
      recommendation:
        'Manual appraisal complete. The verdict reflects profit on cost from your inputs; confirm comparable evidence and planning before committing.',
      confidence: 'Manual entry',
    };
    setError(null);
    setPhase('loading');
    try {
      const indicative = await utils.client.autoAppraisal.compute.query({ extraction, buildPerSqft: buildRate });
      setRun({ extraction, buildPerSqft: buildRate, indicative, assetLabel: m.assetType, sourceNote: 'Calculated from your manual inputs.' });
      setChat([]);
      setPhase('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Appraisal failed — check your inputs.');
      setPhase(run ? 'result' : 'idle');
    }
  };

  // ---- what-if chat ----
  const onAsk = async () => {
    const q = chatInput.trim();
    if (!q || !run || whatIf.isPending) return;
    setChat((c) => [...c, { role: 'user', text: q }]);
    setChatInput('');
    try {
      const res = await whatIf.mutateAsync({ extraction: run.extraction, buildPerSqft: run.buildPerSqft, prompt: q });
      setRun((r) => (r ? { ...r, extraction: res.extraction, buildPerSqft: res.buildPerSqft, indicative: res.indicative } : r));
      setChat((c) => [...c, { role: 'ai', text: res.reply }]);
    } catch {
      setChat((c) => [...c, { role: 'ai', text: 'Something went wrong — try again.' }]);
    }
  };

  // ---- open full appraisal: map extraction → AppraisalInput, save, navigate ----
  const onOpenFull = async () => {
    if (!run || save.isPending) return;
    const x = run.extraction;
    const ind = run.indicative;
    try {
      await save.mutateAsync({
        dealId,
        source: 'ai',
        asNewVersion: !!existingAppraisal,
        label: existingAppraisal ? 'Auto-Appraisal' : undefined,
        input: {
          units: x.units.map((u) => ({ label: u.label, count: u.count, area: u.area, cap: u.value, conf: u.conf, source: u.source })),
          efficiency: x.efficiency,
          trades: [{ label: 'Build', rate: run.buildPerSqft }],
          profFeePct: x.profFee,
          contingencyPct: x.contingency,
          otherCosts: [
            { label: 'CIL', amount: ind.cil },
            { label: 'S106', amount: x.s106 },
          ],
          finance: {
            ltcPct: x.finance.ltc,
            ratePct: x.finance.rate,
            periodMonths: x.finance.period,
            salesMonths: x.finance.sales,
            arrangementFeePct: x.finance.arrFee,
            spendProfile: 'scurve',
          },
          site: { mode: 'residual', landFixed: x.asking, acqPct: x.acq },
          disposal: { agentPct: x.agent, legalPct: x.legal },
          targetProfitOnGdvPct: x.targetProfit,
        },
      });
      utils.appraisal.getCurrent.invalidate(dealId);
      utils.deals.list.invalidate();
      navigate(`/deal/${dealId}/appraisal`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the appraisal.');
    }
  };

  const onReset = () => {
    setPhase('idle');
    setRun(null);
    setChat([]);
    setError(null);
  };

  // ---- result derivations (display only — all money from the server indicative) ----
  const ind = run?.indicative;
  const x = run?.extraction;
  const risk = x ? Math.max(0, Math.min(100, x.planningRisk)) : 0;
  const riskColor = risk <= 33 ? 'rgb(var(--status-green, 30 122 85))' : risk <= 66 ? 'rgb(var(--status-amber, 154 98 18))' : 'rgb(var(--status-red, 178 58 46))';
  const riskLabel = x?.planningRiskLabel || (risk <= 33 ? 'Low' : risk <= 66 ? 'Medium' : 'High');
  const verdictStyle = ind ? VERDICT_STYLE[ind.verdict] : VERDICT_STYLE.Caution;

  const appraisalRows: Array<[string, string, boolean?]> =
    run && ind && x
      ? [
          [`Build · ${U.rate(run.buildPerSqft)}`, fM(ind.build)],
          ['Professional fees', fM(ind.fees)],
          ['Contingency', fM(ind.cont)],
          ['Finance', fM(ind.finance)],
          [U.terms.infraLevy, ind.cil > 0 ? fM(ind.cil) : '—'],
          [U.terms.planningObligation, x.s106 > 0 ? fM(x.s106) : '—'],
          /*
           * The bands are England & Northern Ireland statute. Outside the UK the
           * duty is real and this product does not model it, so the row names the
           * local one and says where the figure came from rather than presenting a
           * UK number under a local name.
           */
          [
            U.profile.landTaxModelled ? `${U.terms.landTax} (on land)` : `${U.terms.landTax} (on land, at UK SDLT bands)`,
            fM(ind.sdlt),
          ],
          ['VAT', 'Opted — neutral', true],
        ]
      : [];

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to="/board" className="hover:text-brand-ink">Pipeline</Link> / New deal from documents
            {deal ? ` · ${deal.name}` : ''}
          </span>
        }
        right={
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-[9px] bg-tint-success px-2.5 py-1.5 text-[11.5px] font-semibold text-brand-ink">
            <Sparkle size={14} color={brandInk} /> AI Development Director
          </span>
        }
      />

      <DealNav dealId={dealId} active="auto" />
      <main className="max-w-[1500px] mx-auto p-4 sm:p-6 grid grid-cols-1 gap-5 items-start lg:[grid-template-columns:minmax(0,1fr)_minmax(0,1.25fr)]">
        {/* ===== LEFT: INTAKE ===== */}
        <Panel className="lg:sticky lg:top-20">
          <div className="text-[19px] font-bold tracking-[-0.4px]">Drop the deal in. Get an appraisal out.</div>
          <div className="mt-1.5 text-[13.5px] text-ink-2 leading-relaxed">
            Add drawings, cost plans and planning documents — the AI extracts areas and assumptions and runs a full development appraisal. Or enter the
            scheme manually.
          </div>

          <div className="mt-4">
            <SegmentedToggle
              options={[
                ['ai', 'AI extraction'],
                ['manual', 'Manual entry'],
              ]}
              value={engine}
              onChange={setEngine}
            />
          </div>

          {engine === 'ai' ? (
            <>
              {/* doc-type tiles (decorative selected states) */}
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                {DOC_TILES.map((t, i) => {
                  const on = docsOn.includes(i);
                  return (
                    <button
                      key={t.label}
                      aria-pressed={on}
                      onClick={() => setDocsOn((d) => (on ? d.filter((k) => k !== i) : [...d, i]))}
                      className="rounded-[12px] p-3.5 flex items-center gap-2.5 text-left transition-colors"
                      style={{ border: on ? '1.5px solid rgb(var(--brand-ink, 20 80 59))' : '1.5px dashed rgb(var(--checkbox-border, 210 209 202))', background: on ? 'rgb(var(--tint-success, 236 243 239))' : 'transparent' }}
                    >
                      <span className="w-[30px] h-[30px] rounded-chip bg-tint-success inline-flex items-center justify-center shrink-0">{t.icon}</span>
                      <span>
                        <span className="block text-[12px] font-semibold">{t.label}</span>
                        <span className="block text-[10px] text-ink-3">{t.sub}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* real documents from the data room — the AI reads the actual PDFs */}
              {readableDocs.length > 0 && (
                <div className="mt-4">
                  <MicroLabel>Read documents from the data room · {selectedDocs.size}/4 selected</MicroLabel>
                  <div className="mt-2 flex flex-col gap-1.5 max-h-[168px] overflow-y-auto rounded-[12px] border border-border-std p-2">
                    {readableDocs.map((d) => {
                      const on = selectedDocs.has(d.id);
                      return (
                        <button
                          key={d.id}
                          aria-pressed={on}
                          onClick={() => toggleDoc(d.id)}
                          className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors"
                          style={{ background: on ? 'rgb(var(--tint-success, 236 243 239))' : 'transparent' }}
                        >
                          <span
                            className="inline-flex w-[15px] h-[15px] rounded-[4px] border items-center justify-center shrink-0"
                            style={{ background: on ? brand[700] : neutral.surface, borderColor: on ? brand[700] : 'rgb(var(--checkbox-border, 210 209 202))' }}
                          >
                            {on && (
                              <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={onFill} strokeWidth="3.2"><path d="M4 12l5 5L20 7" /></svg>
                            )}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[12px] font-medium truncate">{d.name}</span>
                            <span className="block text-[10px] text-ink-3">{d.category} · {d.ext.toUpperCase()}</span>
                          </span>
                          {d.extraction === 'EXTRACTED' && <span className="label-mono text-brand-ink shrink-0">READ</span>}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-1.5 text-[10.5px] text-ink-3">
                    The AI reads the selected PDFs/images directly — every extracted figure cites its source document.
                  </div>
                </div>
              )}

              <div className="mt-4">
                <MicroLabel>Scheme notes &amp; document text</MicroLabel>
              </div>
              <textarea
                aria-label="Scheme notes and document text"
                className="mt-2 w-full h-[208px] text-[12.5px] leading-relaxed resize-y p-3 rounded-[12px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />

              <div className="mt-3.5 flex items-center gap-3 flex-wrap">
                <RateBox prefix="Run build at £" value={buildRate} onChange={setBuildRate} />
                <Button writes
                  onClick={onGenerate}
                  size="lg"
                  className="flex-1"
                  loading={phase === 'loading'}
                  disabled={notes.trim().length < 10 && selectedDocs.size === 0}
                >
                  <Sparkle /> Generate appraisal
                </Button>
              </div>
              <div className="mt-2.5 text-[11px] text-ink-3b">
                Tip: the sample text describes a Bournemouth trade-counter scheme — edit it or paste your own.
              </div>
            </>
          ) : (
            <div className="mt-4 flex flex-col gap-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextBox label="Scheme" value={manual.scheme} onChange={(v) => setMan({ scheme: v })} />
                <TextBox label="Asset type" value={manual.assetType} onChange={(v) => setMan({ assetType: v })} />
              </div>
              <TextBox label="Site address" value={manual.address} onChange={(v) => setMan({ address: v })} />
              <TextBox label="Planning status" value={manual.planningStatus} onChange={(v) => setMan({ planningStatus: v })} />

              {/* unit schedule */}
              <div>
                <div className="flex label-mono text-ink-3 px-0.5 pb-1.5">
                  <div style={{ flex: 2.2 }}>Use / unit</div>
                  <div className="text-right" style={{ flex: 0.8 }}>No.</div>
                  <div className="text-right" style={{ flex: 1.1 }}>Area {U.unit}</div>
                  <div className="text-right" style={{ flex: 1 }}>£/{U.unit}</div>
                  <div className="w-[22px] shrink-0" />
                </div>
                {manual.units.map((u, i) => (
                  <div key={i} className="flex items-center gap-1.5 mb-1.5">
                    <input
                      aria-label={`Unit ${i + 1} label`}
                      className="min-w-0 h-8 px-2 text-[12px] font-medium rounded-[7px]"
                      style={{ flex: 2.2 }}
                      value={u.label}
                      onChange={(e) => setUnit(i, { label: e.target.value })}
                    />
                    <input
                      type="number"
                      aria-label={`${u.label || `Unit ${i + 1}`} number of units`}
                      className="min-w-0 h-8 px-1.5 text-right fig text-[12px] rounded-[7px]"
                      style={{ flex: 0.8 }}
                      value={u.count}
                      onChange={(e) => setUnit(i, { count: parseFloat(e.target.value) || 0 })}
                    />
                    <input
                      type="number"
                      aria-label={`${u.label || `Unit ${i + 1}`} area ${U.unitSpoken}`}
                      className="min-w-0 h-8 px-1.5 text-right fig text-[12px] rounded-[7px]"
                      style={{ flex: 1.1 }}
                      value={U.areaField(u.area)}
                      onChange={(e) => setUnit(i, { area: U.areaFromField(parseFloat(e.target.value) || 0) })}
                    />
                    <input
                      type="number"
                      aria-label={`${u.label || `Unit ${i + 1}`} price per ${U.unitSpoken}`}
                      className="min-w-0 h-8 px-1.5 text-right fig text-[12px] rounded-[7px]"
                      style={{ flex: 1 }}
                      value={U.rateField(u.value)}
                      onChange={(e) => setUnit(i, { value: U.rateFromField(parseFloat(e.target.value) || 0) })}
                    />
                    <button
                      aria-label={`Remove ${u.label}`}
                      className="w-[22px] h-[22px] shrink-0 rounded-[6px] inline-flex items-center justify-center text-[rgb(var(--ink-faint,_192_191_184))] hover:text-status-red hover:bg-status-red-bg"
                      onClick={() => setMan({ units: manual.units.filter((_, j) => j !== i) })}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setMan({ units: [...manual.units, { label: '', count: 1, area: 0, value: 0 }] })}
                >
                  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={brandInk} strokeWidth="2.4" strokeLinecap="round">
                    <path d="M12 6v12M6 12h12" />
                  </svg>
                  Add unit
                </Button>
              </div>

              <MicroLabel>Costs</MicroLabel>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <NumBox label="Prof fees %" value={manual.profFee} onChange={(v) => setMan({ profFee: v })} />
                <NumBox label="Contingency %" value={manual.contingency} onChange={(v) => setMan({ contingency: v })} />
                <NumBox label="Efficiency %" value={manual.efficiency} onChange={(v) => setMan({ efficiency: v })} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <NumBox label={`${U.terms.infraLevy} £/sqm`} value={manual.cilPerSqm} onChange={(v) => setMan({ cilPerSqm: v })} />
                <NumBox label={`${U.terms.planningObligation} £`} value={manual.s106} onChange={(v) => setMan({ s106: v })} />
              </div>

              <MicroLabel>Revenue &amp; land</MicroLabel>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <NumBox label="Target profit %" value={manual.targetProfit} onChange={(v) => setMan({ targetProfit: v })} />
                <NumBox label="Asking land £" value={manual.asking} onChange={(v) => setMan({ asking: v })} />
                <NumBox label="Acquisition %" value={manual.acq} onChange={(v) => setMan({ acq: v })} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <NumBox label="Agent fee %" value={manual.agent} onChange={(v) => setMan({ agent: v })} />
                <NumBox label="Legal fee %" value={manual.legal} onChange={(v) => setMan({ legal: v })} />
              </div>

              <MicroLabel>Finance</MicroLabel>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <NumBox label="LTC %" value={manual.finance.ltc} onChange={(v) => setFin({ ltc: v })} />
                <NumBox label="Rate % pa" value={manual.finance.rate} onChange={(v) => setFin({ rate: v })} />
                <NumBox label="Period mo" value={manual.finance.period} onChange={(v) => setFin({ period: v })} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <NumBox label="Sales / void mo" value={manual.finance.sales} onChange={(v) => setFin({ sales: v })} />
                <NumBox label="Arrangement %" value={manual.finance.arrFee} onChange={(v) => setFin({ arrFee: v })} />
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <RateBox prefix="Build £" value={buildRate} onChange={setBuildRate} />
                <Button
                  onClick={onRunManual}
                  size="lg"
                  className="flex-1"
                  loading={phase === 'loading'}
                  disabled={!manualIsRunnable(manual)}
                  title={manualIsRunnable(manual) ? undefined : `Add a unit with a count, an area and a £/${U.unit} first`}
                >
                  Run appraisal
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={onFill} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </Button>
              </div>
            </div>
          )}
          {error && <FormError className="mt-2.5 text-[12px]">{error}</FormError>}
        </Panel>

        {/* ===== RIGHT: OUTPUT ===== */}
        <div className="min-w-0">
          {phase === 'idle' && (
            <Panel>
              <EmptyState icon={<Sparkle size={30} color="rgb(var(--crumb, 201 205 200))" />}>
                <div className="text-[16px] font-bold text-ink">Your appraisal will appear here</div>
                <div className="mt-1 max-w-[380px] text-[13px] text-ink-3 leading-relaxed">
                  GIA, {U.terms.gdv}, build, finance, VAT, {U.terms.landTax}, {U.terms.infraLevy}, profit, planning risk and an
                  investment recommendation — generated from your documents.
                </div>
              </EmptyState>
            </Panel>
          )}

          {phase === 'loading' && (
            <Panel>
              <div className="flex items-center gap-3.5 py-2">
                <div aria-hidden="true" className="w-8 h-8 rounded-full animate-spin shrink-0" style={{ border: '3px solid rgb(var(--border-std, 236 235 229))', borderTopColor: 'rgb(var(--brand-ink, 20 80 59))' }} />
                <div className="text-[16px] font-semibold">AI Development Director analysing…</div>
              </div>
              <div className="mt-4 mb-2 flex flex-col gap-3">
                {LOADING_STAGES.map((s, i) => (
                  <div
                    key={s}
                    className="flex items-center gap-2.5 text-[13px] font-medium"
                    style={{ color: i === stage ? 'rgb(var(--ink, 22 32 27))' : 'rgb(var(--ink-2, 95 102 95))' }}
                  >
                    <span className="w-2 h-2 rounded-full bg-brand-700 animate-pulseDot shrink-0" style={{ animationDelay: `${i * 0.2}s` }} />
                    {s}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {phase === 'result' && run && ind && x && (
            <div className="flex flex-col gap-4">
              {/* A server with no AI key returns the built-in worked example, not a
                  reading of what was pasted — so it says so, above the figures and
                  before anyone acts on them. Handing someone a confident appraisal
                  of a scheme they did not paste is how a trial ends. */}
              {run.extraction.sample && (
                <section
                  className="rounded-panel p-3.5 border"
                  style={{ borderColor: 'rgb(var(--status-amber, 133 82 14))', background: 'rgb(var(--status-amber-bg, 250 243 226))' }}
                  data-sample-notice
                >
                  <div className="text-[12.5px] font-semibold" style={{ color: 'rgb(var(--status-amber, 133 82 14))' }}>
                    This is the worked example, not your text
                  </div>
                  <div className="mt-1 text-[12px] text-ink-2">
                    AI extraction isn't configured on this server, so the scheme, areas and values below come from the built-in
                    sample — only the {U.terms.planningObligation}, {U.terms.infraLevy} and asking figures were read from what
                    you pasted. Use <b>Manual entry</b> to
                    appraise your own scheme.
                  </div>
                </section>
              )}

              {/* headline */}
              <section className="relative overflow-hidden rounded-panel p-[22px] text-white" style={{ background: `linear-gradient(155deg,${brand[600]},${brand[700]})` }}>
                <div className="absolute -top-[26px] -right-[26px] w-[120px] h-[120px] rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }} />
                <div className="relative flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="label-mono truncate" style={{ color: 'rgba(255,255,255,0.6)', letterSpacing: '0.7px' }}>
                      {run.assetLabel} · {x.confidence}
                    </div>
                    <div className="mt-1 text-[21px] font-bold tracking-[-0.4px] truncate">{x.scheme}</div>
                    <div className="text-[12px] truncate" style={{ color: 'rgba(255,255,255,0.75)' }}>{x.address}</div>
                  </div>
                  <span
                    className="flex-none inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[9px] text-[11px] font-semibold"
                    style={{ background: verdictStyle.bg }}
                  >
                    <Dot color={verdictStyle.dot} /> {ind.verdict}
                  </span>
                </div>
                <div className="relative mt-4 flex gap-2.5">
                  <HeadlineStat label="Residual land value" value={formatSigned(ind.residualNet)} />
                  <HeadlineStat label="Profit on cost" value={ind.roc != null ? formatPct(ind.roc, 0) : '—'} />
                  <HeadlineStat label={U.terms.gdv} value={fM(ind.gdv)} />
                </div>
              </section>

              {/* extracted accommodation */}
              <Panel
                title="Extracted accommodation"
                right={<span className="fig text-[11px] text-ink-3">{U.area(ind.gia)} GIA · {U.area(ind.nia)} NIA</span>}
              >
                <div className="overflow-x-auto">
                <table className="w-full min-w-[520px]">
                  <thead>
                    <tr>
                      <Th>Use / unit</Th>
                      <Th right>No.</Th>
                      <Th right>Area {U.unit}</Th>
                      <Th right>£/{U.unit}</Th>
                      <Th right>Value</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {x.units.map((u, i) => (
                      <tr key={i} className="hover:bg-sunken transition-colors">
                        <Td>
                          <span className="inline-flex items-center gap-2">
                            <span title={u.source}>
                              <Dot color={CONF_DOT[u.conf]} size={8} />
                            </span>
                            {u.label}
                          </span>
                        </Td>
                        <Td right fig>{u.count}</Td>
                        <Td right fig>{U.areaNum(u.area)}</Td>
                        <Td right fig>£{U.rateNum(u.value)}</Td>
                        <Td right fig className="font-semibold" style={{ color: 'rgb(var(--brand-ink, 20 80 59))' }}>{fM(u.count * u.area * u.value)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </Panel>

              {/* auto-generated appraisal */}
              <Panel title="Auto-generated appraisal">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
                  {appraisalRows.map(([label, value, muted]) => (
                    <div key={label} className="flex justify-between gap-3">
                      <span className="text-[12.5px] text-ink-2">{label}</span>
                      <span className="fig text-[12.5px] font-medium" style={muted ? { color: 'rgb(var(--ink-2b, 110 114 105))' } : undefined}>{value}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3.5 pt-3 border-t border-border-std flex gap-3">
                  <Well label="Asking land" value={x.asking > 0 ? fM(x.asking) : '—'} />
                  <Well
                    label="Land headroom"
                    value={ind.headroom != null ? formatDelta(ind.headroom) : '—'}
                    tone={ind.headroom != null && ind.headroom < 0 ? 'rgb(var(--status-red, 178 58 46))' : 'rgb(var(--status-green, 30 122 85))'}
                  />
                  {/*
                    Three figures in this row are only knowable once someone has
                    named a price. Asking land and Land headroom already said so
                    with an em dash; this one did not — it fell back to the
                    TARGET profit, the figure the appraisal was solved to hit,
                    and printed it as though it were the profit you would make at
                    a price nobody had quoted. Its tone was also a green literal
                    rather than a test, so a genuinely priced site whose asking
                    was far over the residual showed its LOSS in green, with the
                    headroom immediately to its left correctly in red.
                  */}
                  <Well
                    label="Profit at asking"
                    value={ind.profitAtAsking != null ? formatSigned(ind.profitAtAsking) : '—'}
                    tone={
                      ind.profitAtAsking != null && ind.profitAtAsking < 0
                        ? 'rgb(var(--status-red, 178 58 46))'
                        : 'rgb(var(--status-green, 30 122 85))'
                    }
                  />
                </div>
              </Panel>

              {/* planning risk */}
              <Panel
                title="Planning risk"
                right={
                  <span className="fig text-[12px] font-semibold" style={{ color: riskColor }}>
                    {riskLabel} · {risk}/100
                  </span>
                }
              >
                <ProgressBar pct={risk} color={riskColor} height={8} />
                <p className="mt-2.5 text-[12px] text-ink-2 leading-relaxed">{x.planningNotes || x.planningStatus}</p>
              </Panel>

              {/* recommendation */}
              <section className="rounded-card p-4 bg-tint-success" style={{ border: '1px solid rgb(var(--border-green-soft, 214 230 221))' }}>
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-[7px] bg-brand-700 inline-flex items-center justify-center shrink-0">
                    <Sparkle size={14} />
                  </span>
                  <span className="text-[14px] font-semibold text-brand-ink">Investment recommendation</span>
                </div>
                <p className="mt-2.5 text-[13px] leading-relaxed" style={{ color: 'rgb(var(--ink-green-deep, 30 92 69))' }}>{x.recommendation}</p>
              </section>

              {/* ask the deal · what-if */}
              <Panel
                title={
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-[7px] bg-brand-700 inline-flex items-center justify-center shrink-0">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={onFill} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 12h.01M12 12h.01M16 12h.01M21 12a8 8 0 0 1-11.3 7.3L3 21l1.7-6.7A8 8 0 1 1 21 12Z" />
                      </svg>
                    </span>
                    <h3 className="text-[14px] font-semibold">Ask the deal · what-if</h3>
                  </div>
                }
              >
                {chat.length > 0 && (
                  <div className="flex flex-col gap-2 mb-3">
                    {chat.map((m, i) => (
                      <div key={i} className="flex" style={{ justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div
                          className="max-w-[82%] px-3 py-2 rounded-[12px] text-[12.5px] leading-snug"
                          style={m.role === 'user' ? { background: brand[700], color: onFill } : { background: 'rgb(var(--canvas, 243 244 241))', color: 'rgb(var(--ink, 22 32 27))' }}
                        >
                          {m.text}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    className="flex-1 h-10 rounded-[10px] text-[13px]"
                    placeholder="e.g. what if the interest rate rises to 9%?"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onAsk();
                    }}
                  />
                  <button
                    onClick={onAsk}
                    aria-label="Send question"
                    disabled={whatIf.isPending || !chatInput.trim()}
                    className="flex-none w-[46px] h-10 rounded-[10px] bg-brand-700 hover:bg-brand-600 inline-flex items-center justify-center transition-colors disabled:opacity-50"
                  >
                    {whatIf.isPending ? <Spinner /> : (
                      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={onFill} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 2 11 13M22 2l-7 20-4-9-9-4Z" />
                      </svg>
                    )}
                  </button>
                </div>
                {whatIf.isPending && <div className="mt-2 text-[11.5px] text-ink-3">Thinking…</div>}
              </Panel>

              {/* actions */}
              <div className="flex gap-3">
                <Button writes onClick={onOpenFull} size="lg" className="flex-1" loading={save.isPending}>
                  {!save.isPending && (
                    <>
                      Open full appraisal
                      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={onFill} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </>
                  )}
                </Button>
                <Button variant="secondary" size="lg" className="flex-none" onClick={onReset}>
                  New deal
                </Button>
              </div>
              <div className="text-[11px] text-ink-3b text-center">{run.sourceNote}</div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
