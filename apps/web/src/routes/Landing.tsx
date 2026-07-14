import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { computeAppraisal } from '@apex/appraisal-engine';
import { brandMarkGradient } from '@apex/ui-tokens';
import { fM } from '../lib/format';
import { BrandMark, Icon } from '../components/ui';

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fade-and-rise on first scroll into view (no-op with reduced motion). */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(() => reducedMotion());
  useEffect(() => {
    if (shown || !ref.current) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [shown]);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(22px)',
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/** Counts up once scrolled into view; parses and reuses any prefix/suffix (£, %, +, bn…). */
function CountUp({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(() => (reducedMotion() ? text : text.replace(/[\d.]+/, '0')));
  useEffect(() => {
    if (reducedMotion() || !ref.current) return;
    const m = /([\d.]+)/.exec(text);
    if (!m) {
      setDisplay(text);
      return;
    }
    const target = parseFloat(m[1]!);
    const decimals = m[1]!.includes('.') ? m[1]!.split('.')[1]!.length : 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - start) / 1100, 1);
          const eased = 1 - Math.pow(1 - p, 3);
          setDisplay(text.replace(/[\d.]+/, (target * eased).toFixed(decimals)));
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [text]);
  return <span ref={ref}>{display}</span>;
}

const DEMO_MAILTO = 'mailto:hello@apexappraise.co.uk?subject=Apex%20Appraise%20%E2%80%94%20book%20a%20demo';
const ARROW = 'M5 12h14|M13 6l6 6-6 6';
const CHECK = 'm5 12 5 5 9-10';

/** Marketing CTA — white-on-dark or brand-gradient pill with a sliding arrow. */
function Cta({
  to,
  href,
  onClick,
  kind = 'light',
  children,
  arrow = true,
  className = '',
}: {
  to?: string;
  href?: string;
  onClick?: () => void;
  kind?: 'light' | 'brand' | 'outline-dark' | 'outline-light';
  children: ReactNode;
  arrow?: boolean;
  className?: string;
}) {
  const chrome: Record<string, [string, React.CSSProperties]> = {
    light: [
      'bg-surface text-brand-800 hover:-translate-y-0.5 hover:shadow-[0_14px_34px_-12px_rgba(0,0,0,0.45)]',
      { boxShadow: '0 8px 24px -10px rgba(0,0,0,0.35)' },
    ],
    brand: [
      'text-white hover:[filter:brightness(1.08)] hover:-translate-y-0.5',
      {
        background: 'linear-gradient(180deg,#1B6048 0%,#14503B 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 26px -10px rgba(20,80,59,0.55)',
      },
    ],
    'outline-dark': ['text-white hover:bg-white/10', { border: '1px solid rgba(255,255,255,0.25)' }],
    'outline-light': ['bg-surface text-ink hover:bg-sunken', { border: '1px solid rgba(20,30,25,0.14)' }],
  };
  const [cls, style] = chrome[kind];
  const inner = (
    <>
      {children}
      {arrow && (
        <span className="transition-transform duration-200 group-hover:translate-x-[3px] motion-reduce:transition-none" aria-hidden="true">
          <Icon d={ARROW} size={17} strokeWidth={2.2} />
        </span>
      )}
    </>
  );
  const shared = `group inline-flex items-center justify-center gap-[9px] h-[50px] px-6 rounded-[13px] text-[15px] font-semibold transition-all duration-200 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 ${cls} ${className}`;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={shared} style={style}>
        {inner}
      </button>
    );
  }
  return href ? (
    <a href={href} className={shared} style={style}>
      {inner}
    </a>
  ) : (
    <Link to={to ?? '/register'} className={shared} style={style}>
      {inner}
    </Link>
  );
}

const WRAP = 'max-w-[1100px] mx-auto px-5 sm:px-7';

// ---------- data ----------

const NAV_LINKS: Array<[string, string]> = [
  ['Platform', '#platform'],
  ['Pricing', '#pricing'],
  ['Resources', '#features'],
  ['Company', '#footer'],
];

const TRUST_ROW = ['RICS Red Book native', 'Land Registry · EPC · planning data', 'Full audit trail'];

const LOGOS = ['Brookfield', 'Meridian Capital', 'Harbour Group', 'Stour Estates', 'Glenfield'];

const STATS: Array<[string, string]> = [
  ['58%', 'less time per instruction'],
  ['2,400+', 'appraisals run on the platform'],
  ['£1.2bn', 'of GDV modelled to date'],
  ['100%', 'figures traceable to evidence'],
];

const STAGES: Array<[string, string, string]> = [
  ['01', 'Source', 'Pipeline & AI appraisal'],
  ['02', 'Inspect', 'Mobile capture, offline'],
  ['03', 'Model', 'Cashflow, JV & debt stack'],
  ['04', 'Build', 'Contractors & cost monitoring'],
  ['05', 'Sell & report', 'Sales CRM & investor portal'],
];

const FEATURES: Array<{ icon: string; title: string; desc: string }> = [
  {
    icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    title: 'Pipeline board',
    desc: 'Every deal across the lifecycle, with probability-weighted GDV and a live portfolio roll-up.',
  },
  {
    icon: 'M5 20v-7|M12 20V5|M19 20v-9',
    title: 'Development appraisal',
    desc: 'Residual land value, trade-level build, monthly cashflow, JV waterfall and a senior + mezz debt stack.',
  },
  {
    icon: 'M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1-1.6A1 1 0 0 1 9.6 4h4.8a1 1 0 0 1 .8.4l1 1.6h1.3A2.5 2.5 0 0 1 20 8.5V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z|M12 15.4a3.1 3.1 0 1 0 0-6.2 3.1 3.1 0 0 0 0 6.2Z',
    title: 'Field inspection',
    desc: 'Offline capture on mobile — checklist, photos and condition that sync straight into the desk workfile.',
  },
  {
    icon: 'M3 3v18h18|M7 14l3-3 3 3 5-6',
    title: 'Cost monitoring',
    desc: 'Budget vs actual variance, contractor assignment, timesheets, retention and a dated site photo log.',
  },
  {
    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z|M22 21v-2a4 4 0 0 0-3-3.87',
    title: 'Investor portal',
    desc: 'LP statements, distributions, capital calls and net IRR / MOIC per investor — leveraging the JV waterfall.',
  },
  {
    icon: 'M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2Z',
    title: 'Benchmarking',
    desc: 'Your build costs, values and margins against an anonymised market median — the data moat that compounds.',
  },
];

// ---------- live engine hero widget ----------

const HERO_AREA_FT2 = 850; // typical 2-bed new-build

function heroCompute(homes: number, capPsf: number, buildPsf: number) {
  return computeAppraisal({
    units: [{ label: 'New homes', count: homes, area: HERO_AREA_FT2, cap: capPsf }],
    efficiency: 90,
    trades: [{ label: 'Build', rate: buildPsf }],
    profFeePct: 10,
    contingencyPct: 5,
    otherCosts: [],
    finance: { ltcPct: 65, ratePct: 9, periodMonths: 18, salesMonths: 6, arrangementFeePct: 1 },
    site: { mode: 'residual', landFixed: 0, acqPct: 5.8 },
    disposal: { agentPct: 1.5, legalPct: 0.5 },
    targetProfitOnGdvPct: 17.5,
  });
}

function EngineSlider({
  label, value, min, max, step, unit, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[1.2px] text-white/55">{label}</span>
        <span className="fig text-[13px] font-semibold text-accent-300">{unit === '£/ft²' ? `£${value}/ft²` : `${value} ${unit}`}</span>
      </div>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[#3FD894] cursor-pointer"
      />
    </div>
  );
}

/** The actual product engine, live on the marketing page. No mock numbers. */
function LiveEngineCard() {
  const [homes, setHomes] = useState(12);
  const [cap, setCap] = useState(450);
  const [build, setBuild] = useState(210);
  const r = heroCompute(homes, cap, build);
  const viable = r.residualNet > 0;
  return (
    <div
      className="rounded-[18px] p-5 text-white w-full lg:w-[340px]"
      style={{
        background: 'rgba(12,42,32,0.72)',
        backdropFilter: 'blur(18px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(18px) saturate(1.4)',
        border: '1px solid rgba(63,216,148,0.28)',
        boxShadow: '0 30px 80px -20px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.08)',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="w-[7px] h-[7px] rounded-full bg-accent-300 animate-pulse" />
        <span className="font-mono text-[10.5px] font-semibold tracking-[1.5px] uppercase text-accent-300">Try the engine — live</span>
      </div>
      <div className="mt-4 flex flex-col gap-3.5">
        <EngineSlider label="Homes" value={homes} min={2} max={40} step={1} unit="units" onChange={setHomes} />
        <EngineSlider label="Sale value" value={cap} min={250} max={800} step={10} unit="£/ft²" onChange={setCap} />
        <EngineSlider label="Build cost" value={build} min={120} max={350} step={5} unit="£/ft²" onChange={setBuild} />
      </div>
      <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-3 gap-2">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[1px] text-white/50">GDV</div>
          <div className="fig mt-0.5 text-[16px] font-semibold tracking-[-0.5px]" data-testid="live-gdv">{fM(r.gdv)}</div>
        </div>
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[1px] text-white/50">Residual land</div>
          <div className="fig mt-0.5 text-[16px] font-semibold tracking-[-0.5px]" style={{ color: viable ? '#3FD894' : '#FF8A7A' }}>
            {fM(Math.max(r.residualNet, 0))}
          </div>
        </div>
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[1px] text-white/50">Profit on cost</div>
          <div className="fig mt-0.5 text-[16px] font-semibold tracking-[-0.5px]">{(r.poc * 100).toFixed(1)}%</div>
        </div>
      </div>
      <div className="mt-3 text-[11px] leading-snug text-white/55">
        {viable
          ? 'Computed by the same deterministic engine that runs the product — not a mock.'
          : 'The engine says this scheme can’t pay for its land — change the mix.'}
      </div>
      <Link
        to="/register"
        className="group mt-4 inline-flex w-full items-center justify-center gap-2 h-[42px] rounded-[12px] bg-surface text-brand-800 text-[13.5px] font-semibold transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] motion-reduce:transition-none"
      >
        Run a full appraisal
        <span className="transition-transform duration-200 group-hover:translate-x-[3px]" aria-hidden="true">
          <Icon d={ARROW} size={15} strokeWidth={2.2} />
        </span>
      </Link>
    </div>
  );
}

// ---------- product tour ----------

const TOUR: Array<{ img: string; title: string; caption: string }> = [
  { img: '/tour/hub.png', title: 'One home for the whole workfile', caption: 'Live portfolio roll-up and every deal tool one click away — nothing re-keyed between them.' },
  { img: '/tour/board.png', title: 'Pipeline board', caption: 'Every deal across the lifecycle with probability-weighted GDV and forecast profit.' },
  { img: '/tour/appraisal.png', title: 'Development appraisal', caption: 'Residual land value, trade-level build costs, finance stack and live sensitivity — recomputed as you type.' },
  { img: '/tour/sitepack.png', title: 'Live UK site pack', caption: 'Real sold prices, planning constraints, flood risk and walkable amenities from official data sources.' },
  { img: '/tour/costs.png', title: 'Cost monitoring', caption: 'Budget vs actual by trade, contractor valuations and a dated site photo log behind every claim.' },
  { img: '/tour/report.png', title: 'Print-ready reports', caption: 'Investment pack and RICS Red Book report assembled from the same engine that runs the appraisal.' },
];

function TourModal({ onClose, initial = 0 }: { onClose: () => void; initial?: number }) {
  const [step, setStep] = useState(initial);
  const s = TOUR[step]!;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setStep((v) => Math.min(v + 1, TOUR.length - 1));
      if (e.key === 'ArrowLeft') setStep((v) => Math.max(v - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Product tour">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-[1080px]">
        <div className="rounded-[18px] overflow-hidden border border-white/10 bg-brand-950" style={{ boxShadow: '0 40px 120px -30px rgba(0,0,0,0.7)' }}>
          {/* mini browser chrome */}
          <div className="flex items-center gap-[7px] px-4 py-2.5">
            <span className="w-[10px] h-[10px] rounded-full bg-status-red" />
            <span className="w-[10px] h-[10px] rounded-full bg-status-amber" />
            <span className="w-[10px] h-[10px] rounded-full bg-status-green" />
            <span className="ml-2 font-mono text-[11px] text-accent-muted-1">app.apexappraise.co.uk</span>
            <button className="ml-auto text-white/60 hover:text-white text-[13px] font-semibold px-2" onClick={onClose} aria-label="Close tour">
              ✕
            </button>
          </div>
          <img src={s.img} alt={s.title} className="block w-full" />
          {/* preload the next slide */}
          {step < TOUR.length - 1 && <img src={TOUR[step + 1]!.img} alt="" aria-hidden="true" className="hidden" />}
        </div>
        <div className="mt-4 flex items-center gap-4 text-white flex-wrap">
          <button
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30 grid place-items-center transition-colors"
            onClick={() => setStep((v) => Math.max(v - 1, 0))}
            disabled={step === 0}
            aria-label="Previous"
          >
            ←
          </button>
          <div className="flex-1 min-w-[200px]">
            <div className="text-[16px] font-bold tracking-[-0.3px]">{s.title}</div>
            <div className="mt-0.5 text-[13px] text-white/70 leading-snug">{s.caption}</div>
          </div>
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {TOUR.map((_, i) => (
              <button key={i} className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-accent-300' : 'bg-white/25 hover:bg-white/50'}`} onClick={() => setStep(i)} />
            ))}
          </div>
          {step < TOUR.length - 1 ? (
            <button
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center transition-colors"
              onClick={() => setStep((v) => Math.min(v + 1, TOUR.length - 1))}
              aria-label="Next"
            >
              →
            </button>
          ) : (
            <Cta to="/register" className="!h-[42px] !px-5 !text-[14px]">Start free</Cta>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- small pieces ----------

function CheckRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-[11px]">
      <span className="w-[22px] h-[22px] rounded-[7px] bg-tint-success-2 flex items-center justify-center text-brand-500 shrink-0">
        <Icon d={CHECK} size={13} strokeWidth={3} />
      </span>
      <span className="text-[15px] font-medium text-ink">{children}</span>
    </div>
  );
}

function Split({
  eyebrow,
  title,
  body,
  checks,
  mock,
  flip,
  onPeek,
}: {
  eyebrow: string;
  title: string;
  body: string;
  checks: string[];
  mock: ReactNode;
  flip?: boolean;
  /** Opens the product tour at this feature's slide. */
  onPeek?: () => void;
}) {
  return (
    <Reveal>
      <div className="grid gap-12 lg:gap-14 items-center lg:grid-cols-2">
        <div className={flip ? 'lg:order-2' : ''}>
          <div className="eyebrow">{eyebrow}</div>
          <h2 className="mt-3.5 text-[32px] lg:text-[40px] font-bold tracking-[-1.4px] leading-[1.06]">{title}</h2>
          <p className="mt-4 text-[16.5px] text-ink-2 leading-[1.55]">{body}</p>
          <div className="mt-5 flex flex-col gap-3">
            {checks.map((c) => (
              <CheckRow key={c}>{c}</CheckRow>
            ))}
          </div>
        </div>
        <div className={flip ? 'lg:order-1' : ''}>
          {onPeek ? (
            <button
              type="button"
              onClick={onPeek}
              className="group relative block w-full text-left cursor-pointer transition-transform duration-300 hover:-translate-y-1 motion-reduce:transition-none"
              aria-label={`See ${title} in the product`}
            >
              {mock}
              <span className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center opacity-0 translate-y-1 transition-all duration-300 group-hover:opacity-100 group-hover:translate-y-0 motion-reduce:transition-none">
                <span className="inline-flex items-center gap-1.5 rounded-pill bg-brand-800 text-white text-[12px] font-semibold px-3.5 py-2 shadow-float">
                  See it in the product <Icon d={ARROW} size={13} strokeWidth={2.4} />
                </span>
              </span>
            </button>
          ) : (
            mock
          )}
        </div>
      </div>
    </Reveal>
  );
}

function MockCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface border border-border-strong rounded-panel p-5" style={{ boxShadow: '0 20px 50px -28px rgba(20,30,25,0.4)' }} aria-hidden="true">
      {children}
    </div>
  );
}

function MockRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between text-[13px] text-ink-2">
      <span>{label}</span>
      <span className="fig text-[13px] font-semibold" style={{ color: tone ?? '#16201B' }}>
        {value}
      </span>
    </div>
  );
}

// ---------- feature-split mocks ----------

function AppraisalMock() {
  return (
    <MockCard>
      <div className="rounded-[14px] p-[18px] text-white" style={{ background: 'linear-gradient(155deg,#1B6048,#14503B)' }}>
        <div className="label-mono text-white/60">Reconciled · high confidence</div>
        <div className="fig mt-2 text-[34px] font-semibold tracking-[-1.5px]">£1.24m</div>
        <div className="mt-1 text-[12px] text-white/65">residual land value · 42% profit on cost</div>
      </div>
      <div className="mt-3.5 flex flex-col gap-[9px]">
        <MockRow label="GDV" value="£8.69m" />
        <MockRow label="Build · £105/ft²" value="£2.49m" />
        <MockRow label="Finance" value="£0.31m" />
        <div className="flex items-center justify-between pt-[9px] border-t border-border-faint text-[13px] font-medium text-ink">
          <span>Planning risk</span>
          <span className="fig text-[13px] font-semibold text-brand-500">Low · 22/100</span>
        </div>
      </div>
    </MockCard>
  );
}

function WorkfileMock() {
  const docs: Array<[string, string]> = [
    ['Site plan — rev C.pdf', 'GIA extracted'],
    ['Cost plan v4.xlsx', '214 lines mapped'],
    ['Decision notice 24/01732/FUL.pdf', 'Conditions parsed'],
    ['Heads of terms.docx', 'SDLT computed'],
  ];
  return (
    <MockCard>
      <div className="label-mono text-ink-2b">Data room · Northgate Works</div>
      <div className="mt-3 flex flex-col">
        {docs.map(([name, chip], i) => (
          <div key={name} className={`flex items-center justify-between gap-3 py-2.5 ${i > 0 ? 'border-t border-border-faint' : ''}`}>
            <span className="text-[13px] font-medium text-ink truncate">{name}</span>
            <span className="label-mono shrink-0 rounded-[7px] px-2 py-[3px] bg-status-green-bg text-status-green">{chip}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-border-faint flex items-center justify-between">
        <span className="text-[12.5px] text-ink-2">Feeds the appraisal directly</span>
        <span className="fig text-[12px] font-semibold text-brand-500">0 re-keyed fields</span>
      </div>
    </MockCard>
  );
}

function CostMock() {
  const trades: Array<[string, number, string, string]> = [
    ['Substructure', 96, '−£8k', '#1E7A55'],
    ['Frame & envelope', 71, 'on plan', '#9AA09A'],
    ['M&E first fix', 38, '+£14k', '#B23A2E'],
  ];
  return (
    <MockCard>
      <div className="label-mono text-ink-2b">Budget vs actual · month 7 of 14</div>
      <div className="mt-4 flex flex-col gap-3.5">
        {trades.map(([trade, pct, delta, tone]) => (
          <div key={trade}>
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium text-ink">{trade}</span>
              <span className="fig text-[12.5px] font-semibold" style={{ color: tone }}>
                {delta}
              </span>
            </div>
            <div className="mt-1.5 h-[6px] rounded-[3px] bg-border-std overflow-hidden">
              <div className="h-full rounded-[3px] bg-brand-700" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-border-faint flex items-center justify-between text-[13px] font-medium text-ink">
        <span>Forecast at completion</span>
        <span className="fig font-semibold text-brand-500">£2.51m · +0.8%</span>
      </div>
    </MockCard>
  );
}

function PortalMock() {
  return (
    <MockCard>
      <div className="label-mono text-ink-2b">LP statement · Q2 2026</div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {(
          [
            ['Capital called', '£850k'],
            ['Distributions', '£312k'],
            ['Net IRR', '18.4%'],
            ['MOIC', '1.6×'],
          ] as Array<[string, string]>
        ).map(([label, value]) => (
          <div key={label} className="rounded-[12px] bg-sunken border border-border-strong px-3.5 py-3">
            <div className="label-mono text-ink-2b">{label}</div>
            <div className="fig mt-1.5 text-[19px] font-semibold tracking-[-1px] text-brand-700">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3.5 pt-3 border-t border-border-faint flex items-center justify-between text-[12.5px] text-ink-2">
        <span>Next capital call</span>
        <span className="fig font-semibold text-ink">£120k · 14 Aug 2026</span>
      </div>
    </MockCard>
  );
}

// ---------- hero product mock ----------

function HeroAppMock() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const onMove = (e: React.MouseEvent) => {
    if (reducedMotion() || !frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    setTilt({
      x: ((e.clientY - rect.top) / rect.height - 0.5) * -2.4,
      y: ((e.clientX - rect.left) / rect.width - 0.5) * 3.2,
    });
  };
  return (
    <div className={`${WRAP} relative`}>
      <div className="lg:pr-[240px]" style={{ perspective: '1600px' }}>
        <div
          ref={frameRef}
          onMouseMove={onMove}
          onMouseLeave={() => setTilt({ x: 0, y: 0 })}
          className="rounded-t-[18px] border border-b-0 border-white/10 bg-brand-950 px-2.5 pt-2.5"
          style={{
            boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.5)',
            transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
            transition: 'transform 0.25s ease-out',
            transformStyle: 'preserve-3d',
          }}
          aria-hidden="true"
        >
          {/* mini top bar */}
          <div className="flex items-center gap-[7px] px-2.5 pb-2">
            <span className="w-[11px] h-[11px] rounded-full bg-status-red" />
            <span className="w-[11px] h-[11px] rounded-full bg-status-amber" />
            <span className="w-[11px] h-[11px] rounded-full bg-status-green" />
            <span className="ml-2.5 font-mono text-[11px] font-medium text-accent-muted-1">app.apexappraise.co.uk</span>
          </div>
          {/* the real product, not a sketch */}
          <div className="rounded-t-[10px] overflow-hidden max-h-[380px]">
            {/* React 18 lacks the fetchPriority prop type — pass the DOM attribute directly */}
            <img src="/tour/hub.png" alt="" className="block w-full" decoding="async" {...({ fetchpriority: 'high' } as Record<string, string>)} />
          </div>
        </div>
      </div>
      {/* live engine card — overlaps the frame on desktop, stacks below on mobile */}
      <div className="mt-5 lg:mt-0 lg:absolute lg:right-7 lg:bottom-8 flex justify-center lg:block">
        <LiveEngineCard />
      </div>
    </div>
  );
}

// ---------- sticky mobile CTA ----------

/** Appears on phones once the hero scrolls away — the next step is always one thumb away. */
function StickyMobileCta({ onTour }: { onTour: () => void }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 640);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div
      className="lg:hidden fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 transition-transform duration-300 motion-reduce:transition-none"
      style={{
        transform: show ? 'translateY(0)' : 'translateY(110%)',
        background: 'linear-gradient(180deg, rgba(243,244,241,0) 0%, rgba(243,244,241,0.92) 30%)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
      aria-hidden={!show}
    >
      <div className="flex gap-2.5 max-w-[440px] mx-auto">
        <Link
          to="/register"
          tabIndex={show ? 0 : -1}
          className="flex-1 inline-flex items-center justify-center h-[48px] rounded-[13px] text-white text-[14.5px] font-semibold active:scale-[0.98] transition-transform motion-reduce:transition-none"
          style={{
            background: 'linear-gradient(180deg,#1B6048 0%,#14503B 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 26px -10px rgba(20,80,59,0.55)',
          }}
        >
          Start free
        </Link>
        <button
          type="button"
          onClick={onTour}
          tabIndex={show ? 0 : -1}
          className="inline-flex items-center justify-center h-[48px] px-4 rounded-[13px] bg-surface text-ink text-[14px] font-semibold active:scale-[0.98] transition-transform motion-reduce:transition-none"
          style={{ border: '1px solid rgba(20,30,25,0.14)', boxShadow: '0 6px 18px -8px rgba(20,30,25,0.25)' }}
        >
          60-sec tour
        </button>
      </div>
    </div>
  );
}

// ---------- page ----------

export default function Landing() {
  const [tourAt, setTourAt] = useState<number | null>(null);
  return (
    <div className="min-h-screen bg-canvas text-ink overflow-x-hidden">
      {tourAt !== null && <TourModal initial={tourAt} onClose={() => setTourAt(null)} />}
      <StickyMobileCta onTour={() => setTourAt(0)} />
      {/* NAV */}
      <div className="sticky top-0 z-50 border-b border-border-strong backdrop-blur-md" style={{ background: 'rgba(243,244,241,0.86)' }}>
        <div className="max-w-[1200px] mx-auto h-16 px-4 sm:px-7 flex items-center gap-3.5">
          <Link to="/welcome" className="flex items-center gap-2.5">
            <BrandMark size={30} />
            <span className="text-[16px] font-bold tracking-[-0.3px]">Apex Appraise</span>
          </Link>
          <nav className="ml-8 hidden lg:flex gap-[26px]">
            {NAV_LINKS.map(([label, href]) => (
              <a key={label} href={href} className="text-[13.5px] font-medium text-ink-2 hover:text-ink transition-all">
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3.5">
            <Link to="/login" className="text-[13.5px] font-semibold text-ink hover:text-brand-700">
              Sign in
            </Link>
            <a href={DEMO_MAILTO} className="hidden sm:inline-flex items-center text-[13.5px] font-semibold text-ink-2 hover:text-ink transition-colors">
              Book a demo
            </a>
            <Link
              to="/register"
              className="inline-flex items-center h-[38px] px-[17px] rounded-[11px] text-white text-[13px] font-semibold transition-all duration-200 hover:[filter:brightness(1.08)] active:scale-[0.97] motion-reduce:transition-none"
              style={{
                background: 'linear-gradient(180deg,#1B6048 0%,#14503B 100%)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 6px 16px -8px rgba(20,80,59,0.45)',
              }}
            >
              Start free
            </Link>
          </div>
        </div>
      </div>

      <main>
      {/* HERO */}
      <div className="relative text-white overflow-hidden" style={{ background: 'linear-gradient(165deg,#14503B 0%,#0F3528 55%,#0C2A20 100%)' }}>
        <div className="absolute -top-40 -right-32 w-[620px] h-[620px] rounded-full" style={{ background: 'rgba(63,216,148,0.08)' }} />
        <div className="absolute -bottom-56 -left-40 w-[520px] h-[520px] rounded-full" style={{ background: 'rgba(255,255,255,0.035)' }} />
        <div className="max-w-[1200px] mx-auto px-5 sm:px-7 pt-20 pb-24 relative">
          <div
            className="inline-flex items-center gap-[9px] px-3.5 py-[7px] rounded-pill"
            style={{ background: 'rgba(63,216,148,0.12)', border: '1px solid rgba(63,216,148,0.3)' }}
          >
            <span className="w-[7px] h-[7px] rounded-full bg-accent-300" />
            <span className="font-mono text-[12px] font-semibold tracking-[0.5px] text-accent-300">UK development &amp; valuation, end to end</span>
          </div>
          <h1 className="mt-[26px] max-w-[880px] text-[38px] sm:text-[46px] md:text-[68px] font-bold tracking-[-1.6px] sm:tracking-[-2px] md:tracking-[-3px] leading-[1.02]">
            From the front door to the signed report — one workfile.
          </h1>
          <p className="mt-6 max-w-[620px] text-[18px] md:text-[20px] leading-[1.5] text-accent-muted-3">
            Apex Appraise runs the whole deal: AI-assisted appraisals, live development modelling, comparables, construction monitoring and
            investor reporting — with every figure traceable.
          </p>
          <div className="mt-[34px] flex items-center gap-3.5 flex-wrap">
            <Cta to="/register">Start a free appraisal</Cta>
            <Cta onClick={() => setTourAt(0)} kind="outline-dark" arrow={false}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
              Watch the 60-second tour
            </Cta>
          </div>
          <div className="mt-4 font-mono text-[12px] text-accent-muted-1">Free 14-day trial · no card required · set up in 2 minutes</div>
          <div className="mt-10 flex items-center gap-[26px] flex-wrap">
            {TRUST_ROW.map((item, i) => (
              <span key={item} className="flex items-center gap-[26px]">
                {i > 0 && <span className="w-1 h-1 rounded-full bg-accent-muted-1/60" />}
                <span className="font-mono text-[12px] font-medium text-accent-muted-1">{item}</span>
              </span>
            ))}
          </div>
        </div>
        <HeroAppMock />
      </div>

      {/* LOGOS / TRUST */}
      <div className="bg-surface border-b border-border-strong">
        <div className={`${WRAP} py-[30px] flex items-center gap-7 flex-wrap justify-center`}>
          <span className="font-mono text-[12px] font-medium tracking-[0.5px] text-ink-2b">Trusted by developers &amp; surveying firms across the UK</span>
          <div className="flex gap-9 items-center flex-wrap justify-center">
            {LOGOS.map((name) => (
              <span key={name} className="text-[17px] font-bold text-ink-2b">
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* STAT BAND */}
      <div className={`${WRAP} pt-16 pb-4`}>
        <Reveal>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {STATS.map(([value, label]) => (
              <div key={value}>
                <div className="fig text-[44px] font-semibold tracking-[-2px] text-brand-700">
                  <CountUp text={value} />
                </div>
                <div className="mt-1.5 text-[14px] text-ink-2 leading-[1.4]">{label}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>

      {/* FEATURE SPLITS */}
      <div id="platform" className={`${WRAP} py-[72px] flex flex-col gap-[88px]`}>
        <Split
          eyebrow="AI Development Director"
          title="Documents in. Investment-grade appraisal out."
          body="Drop in drawings, a cost plan and the planning decision. Apex extracts the areas and assumptions, runs the residual appraisal, and hands you a defensible result — or do it all by hand. Your call."
          checks={[
            'GIA take-off, unit mix & values extracted',
            'CIL, S106, SDLT & VAT computed, not guessed',
            'Planning-risk score & recommendation',
          ]}
          mock={<AppraisalMock />}
          onPeek={() => setTourAt(2)}
        />
        <Split
          flip
          eyebrow="One connected workfile"
          title="Every figure traceable to its evidence."
          body="The data room isn't a filing cabinet — it's live. Drawings, cost plans, decision notices and heads of terms are extracted once and flow through the appraisal, the report and the audit trail. Change the source, and everything downstream updates."
          checks={[
            'Live extraction from deal documents',
            'Comparables adjusted to a supported £/ft²',
            'Red Book report assembled from the workfile',
          ]}
          mock={<WorkfileMock />}
          onPeek={() => setTourAt(5)}
        />
        <Split
          eyebrow="Cost control"
          title="Know you're over budget before the QS does."
          body="Trade-level budget vs actual, contractor assignment, valuations and retention — with a dated site photo log behind every claim. Variance rolls straight into the live appraisal, so the forecast profit is never stale."
          checks={[
            'Budget vs actual variance by trade',
            'Contractor valuations, timesheets & retention',
            'Forecast at completion, updated live',
          ]}
          mock={<CostMock />}
          onPeek={() => setTourAt(4)}
        />
        <Split
          flip
          eyebrow="Client & investor portals"
          title="Give investors the numbers, not a PDF."
          body="LP statements, distributions, capital calls and net IRR / MOIC per investor — computed from the same JV waterfall that runs the appraisal. One set of figures, from the deal team to the boardroom."
          checks={[
            'Per-investor positions & statements',
            'Capital calls & distribution notices',
            'Net IRR and MOIC from the live waterfall',
          ]}
          mock={<PortalMock />}
          onPeek={() => setTourAt(1)}
        />
      </div>

      {/* ONE WORKFILE PIPELINE */}
      <div id="workfile" className="bg-surface border-y border-border-strong">
        <div className={`${WRAP} py-[72px]`}>
          <div className="text-center max-w-[680px] mx-auto">
            <div className="eyebrow">One connected workfile</div>
            <h2 className="mt-3.5 text-[32px] lg:text-[40px] font-bold tracking-[-1.4px] leading-[1.06]">
              Every stage of the deal, nothing re-keyed.
            </h2>
          </div>
          <div className="mt-11 flex flex-col md:flex-row items-center md:items-stretch gap-4 md:gap-0">
            {STAGES.map(([num, title, desc], i) => (
              <div key={num} className="contents">
                {i > 0 && (
                  <div className="shrink-0 md:w-[34px] flex items-center justify-center text-brand-400 rotate-90 md:rotate-0">
                    <Icon d={ARROW} size={15} strokeWidth={2.2} />
                  </div>
                )}
                <div className="flex-1 text-center px-2">
                  <div className={`font-mono text-[13px] font-semibold ${i === STAGES.length - 1 ? 'text-brand-700' : 'text-ink-2b'}`}>{num}</div>
                  <div className={`mt-2 text-[16px] font-semibold ${i === STAGES.length - 1 ? 'text-brand-700' : ''}`}>{title}</div>
                  <div className="mt-[5px] text-[12.5px] text-ink-2b leading-[1.4]">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FEATURE GRID */}
      <div id="features" className={`${WRAP} py-[72px]`}>
        <h2 className="max-w-[620px] text-[30px] lg:text-[36px] font-bold tracking-[-1.2px]">
          A complete operating system for property development.
        </h2>
        <div className="mt-9 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon, title, desc }) => (
            <div key={title} className="bg-surface border border-border-strong rounded-card p-[22px] shadow-rest">
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-[11px] bg-tint-success text-brand-700">
                <Icon d={icon} size={20} strokeWidth={1.9} />
              </span>
              <div className="mt-4 text-[17px] font-semibold">{title}</div>
              <div className="mt-[7px] text-[14px] text-ink-2 leading-[1.5]">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* QUOTE */}
      <div id="customers" className="bg-brand-800 text-white">
        <div className="max-w-[900px] mx-auto px-5 sm:px-7 py-[72px] text-center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="#3FD894" className="opacity-50 mx-auto" aria-hidden="true">
            <path d="M10 7L7 12h3v5H4v-7l3-3h3zm10 0l-3 5h3v5h-6v-7l3-3h3z" />
          </svg>
          <p className="mt-5 text-[22px] md:text-[28px] font-medium tracking-[-0.8px] leading-[1.3]">
            &ldquo;It collapsed our appraisal-to-report cycle from days to hours — and for the first time every number in the pack traces
            back to its evidence.&rdquo;
          </p>
          <div className="mt-[26px] flex items-center justify-center gap-3">
            <span
              className="w-[42px] h-[42px] rounded-full flex items-center justify-center text-[14px] font-semibold"
              style={{ background: brandMarkGradient }}
            >
              DW
            </span>
            <span className="text-left">
              <span className="block text-[14px] font-semibold">Dana Whitlock MRICS</span>
              <span className="block text-[12.5px] text-accent-muted-2">Director, Brookfield Developments</span>
            </span>
          </div>
        </div>
      </div>

      {/* Pricing */}
      <div id="pricing" className={`${WRAP} py-20`}>
        <div className="text-center">
          <div className="eyebrow">Pricing</div>
          <h2 className="mt-2 text-[34px] md:text-[42px] font-bold tracking-[-1.6px]">Simple plans, serious tooling.</h2>
          <p className="mt-3 text-[15px] text-ink-2 max-w-[520px] mx-auto">
            Every plan includes the full appraisal engine, live UK data and print-ready reporting. No card required to start.
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3 items-stretch">
          {(
            [
              ['Starter', 49, 'For a single developer running a handful of deals', ['3 active deals', '2 team members', 'Appraisal engine + reports', 'Site pack (live UK data)'], false],
              ['Growth', 149, 'For teams running a live pipeline', ['Unlimited deals', '10 team members', 'AI Development Director', 'Buyer + investor portals', 'Benchmarking'], true],
              ['Enterprise', 399, 'Multi-entity groups and funds', ['Everything in Growth', 'Unlimited members', 'Priority support', 'Data exports + API access'], false],
            ] as Array<[string, number, string, string[], boolean]>
          ).map(([name, price, blurb, features, featured]) => (
            <div
              key={name}
              className="rounded-[22px] bg-surface p-7 flex flex-col shadow-rest"
              style={featured ? { border: '2px solid #14503B', boxShadow: '0 24px 60px -24px rgba(20,80,59,0.35)' } : undefined}
            >
              <div className="flex items-center justify-between">
                <span className="text-[17px] font-bold">{name}</span>
                {featured && <span className="label-mono rounded-[7px] bg-tint-success text-brand-700 px-2 py-[3px]">Most popular</span>}
              </div>
              <div className="fig mt-3 text-[38px] font-semibold tracking-[-1.5px]">
                £{price}
                <span className="text-[13px] text-ink-2b font-medium tracking-normal">/month</span>
              </div>
              <div className="mt-1.5 text-[13px] text-ink-2">{blurb}</div>
              <ul className="mt-5 flex flex-col gap-2.5 flex-1">
                {features.map((f) => (
                  <li key={f} className="flex gap-2 text-[13px] text-ink-2">
                    <span className="text-brand-500 font-bold" aria-hidden="true">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link
                to="/register"
                className={`mt-7 inline-flex items-center justify-center h-[44px] rounded-[12px] text-[14px] font-semibold transition-all duration-200 active:scale-[0.98] motion-reduce:transition-none ${featured ? 'text-white hover:[filter:brightness(1.08)]' : 'bg-surface text-ink-2 hover:bg-sunken'}`}
                style={
                  featured
                    ? {
                        background: 'linear-gradient(180deg,#1B6048,#14503B)',
                        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 26px -12px rgba(20,80,59,0.55)',
                      }
                    : { border: '1px solid rgba(20,30,25,0.14)' }
                }
              >
                {featured ? 'Start free — most popular' : 'Start free'}
              </Link>
            </div>
          ))}
        </div>
        <div className="mt-6 text-center text-[12px] text-ink-2b">
          14-day trial on every plan · cancel any time · prices exclude VAT
        </div>
      </div>

      {/* CTA */}
      <div id="cta" className={`${WRAP} py-20`}>
        <div
          className="relative overflow-hidden rounded-[24px] px-5 py-12 sm:px-7 sm:py-14 md:p-14 text-center"
          style={{ background: 'linear-gradient(155deg,#1B6048,#0F3528)' }}
        >
          <div className="absolute -top-20 -right-16 w-[300px] h-[300px] rounded-full" style={{ background: 'rgba(63,216,148,0.08)' }} />
          <h2 className="relative text-[34px] md:text-[42px] font-bold tracking-[-1.6px] text-white">Run your next deal on Apex.</h2>
          <p className="relative mt-4 mx-auto max-w-[520px] text-[17px] leading-[1.5] text-accent-muted-3">
            Start with a single appraisal — no card required. Bring your whole pipeline across when you&rsquo;re ready.
          </p>
          <div className="relative mt-[30px] flex items-center justify-center gap-3.5 flex-wrap">
            <Cta to="/register">Start free — no card required</Cta>
            <Cta href={DEMO_MAILTO} kind="outline-dark" arrow={false}>
              Book a demo
            </Cta>
          </div>
        </div>
      </div>

      </main>

      {/* FOOTER */}
      <footer id="footer" className="bg-surface border-t border-border-strong">
        <div className={`${WRAP} py-11`}>
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
            <div>
              <div className="flex items-center gap-2.5">
                <BrandMark size={26} />
                <span className="text-[14px] font-bold">Apex Appraise</span>
              </div>
              <p className="mt-3 max-w-[260px] text-[12.5px] text-ink-2b leading-[1.5]">
                UK development &amp; valuation, end to end — every figure traceable to its evidence.
              </p>
            </div>
            {(
              [
                ['Product', [['Platform', '#platform'], ['Features', '#features'], ['Pricing', '#pricing']]],
                ['Company', [['Customers', '#customers'], ['Security', '#footer'], ['Contact', DEMO_MAILTO]]],
                ['Legal', [['Privacy', '#footer'], ['Terms', '#footer']]],
              ] as Array<[string, Array<[string, string]>]>
            ).map(([heading, links]) => (
              <div key={heading}>
                <div className="label-mono text-ink-2b">{heading}</div>
                <div className="mt-3 flex flex-col gap-2">
                  {links.map(([label, href]) => (
                    <a key={label} href={href} className="text-[12.5px] font-medium text-ink-2b hover:text-ink">
                      {label}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-9 pt-5 border-t border-border-std flex items-center justify-between gap-4 flex-wrap">
            <span className="font-mono text-[11.5px] text-ink-2b">© 2026 Apex Appraise Ltd</span>
            <span className="font-mono text-[11.5px] text-ink-2b">Registered in England &amp; Wales</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
