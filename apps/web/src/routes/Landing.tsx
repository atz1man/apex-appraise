import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { brandMarkGradient } from '@apex/ui-tokens';
import { BrandMark, Icon } from '../components/ui';

const DEMO_MAILTO = 'mailto:hello@apexappraise.co.uk?subject=Apex%20Appraise%20%E2%80%94%20book%20a%20demo';
const ARROW = 'M5 12h14|M13 6l6 6-6 6';
const CHECK = 'm5 12 5 5 9-10';

const WRAP = 'max-w-[1100px] mx-auto px-7';

// ---------- data ----------

const NAV_LINKS: Array<[string, string]> = [
  ['Platform', '#platform'],
  ['Pricing', '#cta'],
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
}: {
  eyebrow: string;
  title: string;
  body: string;
  checks: string[];
  mock: ReactNode;
  flip?: boolean;
}) {
  return (
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
      <div className={flip ? 'lg:order-1' : ''}>{mock}</div>
    </div>
  );
}

function MockCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-surface border border-border-strong rounded-panel p-5" style={{ boxShadow: '0 20px 50px -28px rgba(20,30,25,0.4)' }}>
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
      <div className="label-mono text-ink-3">Data room · Northgate Works</div>
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
      <div className="label-mono text-ink-3">Budget vs actual · month 7 of 14</div>
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
      <div className="label-mono text-ink-3">LP statement · Q2 2026</div>
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
            <div className="label-mono text-ink-3">{label}</div>
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
  const deals: Array<[string, string, string]> = [
    ['Northgate Works', '£8.69m GDV', 'Appraisal'],
    ['Harbour Yard', '£4.2m GDV', 'On site'],
    ['Stour Mills', '£12.4m GDV', 'Offer'],
  ];
  const bars = [40, 62, 50, 78, 58, 88];
  return (
    <div className={`${WRAP} relative`}>
      <div
        className="rounded-t-[18px] border border-b-0 border-white/10 bg-brand-950 px-2.5 pt-2.5"
        style={{ boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.5)' }}
      >
        {/* mini top bar */}
        <div className="flex items-center gap-[7px] px-2.5 pb-2">
          <span className="w-[11px] h-[11px] rounded-full bg-status-red" />
          <span className="w-[11px] h-[11px] rounded-full bg-status-amber" />
          <span className="w-[11px] h-[11px] rounded-full bg-status-green" />
          <span className="ml-2.5 font-mono text-[11px] font-medium text-accent-muted-1">app.apexappraise.co.uk/appraisals</span>
        </div>
        <div className="bg-canvas rounded-t-[10px] h-[300px] p-5 flex gap-4 overflow-hidden text-left text-ink">
          {/* deal cards column */}
          <div className="w-[210px] shrink-0 hidden md:flex flex-col gap-2.5">
            <div className="h-[30px] rounded-[8px] bg-brand-700" />
            <div className="label-mono text-ink-3">Pipeline · 3 live deals</div>
            {deals.map(([name, fig, stage]) => (
              <div key={name} className="rounded-[10px] bg-surface border border-border-strong px-3 py-2">
                <div className="text-[11.5px] font-semibold">{name}</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="fig text-[10.5px] font-semibold text-brand-700">{fig}</span>
                  <span className="label-mono text-ink-3">{stage}</span>
                </div>
              </div>
            ))}
          </div>
          {/* KPI cards + chart */}
          <div className="flex-1 min-w-0 flex flex-col gap-3.5">
            <div className="flex gap-3.5">
              <div className="flex-1 h-[84px] rounded-[12px] px-3.5 py-3" style={{ background: 'linear-gradient(155deg,#1B6048,#14503B)' }}>
                <div className="label-mono text-accent-muted-3">Residual land</div>
                <div className="fig mt-1.5 text-[20px] font-semibold tracking-[-1px] text-white">£1.24m</div>
              </div>
              <div className="flex-1 h-[84px] rounded-[12px] bg-surface border border-border-strong px-3.5 py-3">
                <div className="label-mono text-ink-3">GDV</div>
                <div className="fig mt-1.5 text-[20px] font-semibold tracking-[-1px]">£8.69m</div>
              </div>
              <div className="flex-1 h-[84px] rounded-[12px] bg-surface border border-border-strong px-3.5 py-3">
                <div className="label-mono text-ink-3">Profit on cost</div>
                <div className="fig mt-1.5 text-[20px] font-semibold tracking-[-1px] text-status-green">42%</div>
              </div>
            </div>
            <div className="flex-1 rounded-[12px] bg-surface border border-border-strong flex items-end gap-2 px-[18px] pt-[18px]">
              {bars.map((h, i) => (
                <div key={i} className={`flex-1 rounded-t-[4px] ${i % 2 ? 'bg-brand-700' : 'bg-border-strong'}`} style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- page ----------

export default function Landing() {
  return (
    <div className="min-h-screen bg-canvas text-ink overflow-x-hidden">
      {/* NAV */}
      <div className="sticky top-0 z-50 border-b border-border-strong backdrop-blur-md" style={{ background: 'rgba(243,244,241,0.86)' }}>
        <div className="max-w-[1200px] mx-auto h-16 px-7 flex items-center gap-3.5">
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
            <a
              href={DEMO_MAILTO}
              className="flex items-center h-[38px] px-[17px] rounded-[10px] bg-brand-700 hover:bg-brand-600 text-white text-[13px] font-semibold transition-all"
            >
              Book a demo
            </a>
          </div>
        </div>
      </div>

      {/* HERO */}
      <div className="relative text-white overflow-hidden" style={{ background: 'linear-gradient(165deg,#14503B 0%,#0F3528 55%,#0C2A20 100%)' }}>
        <div className="absolute -top-40 -right-32 w-[620px] h-[620px] rounded-full" style={{ background: 'rgba(63,216,148,0.08)' }} />
        <div className="absolute -bottom-56 -left-40 w-[520px] h-[520px] rounded-full" style={{ background: 'rgba(255,255,255,0.035)' }} />
        <div className="max-w-[1200px] mx-auto px-7 pt-20 pb-24 relative">
          <div
            className="inline-flex items-center gap-[9px] px-3.5 py-[7px] rounded-pill"
            style={{ background: 'rgba(63,216,148,0.12)', border: '1px solid rgba(63,216,148,0.3)' }}
          >
            <span className="w-[7px] h-[7px] rounded-full bg-accent-300" />
            <span className="font-mono text-[12px] font-semibold tracking-[0.5px] text-accent-300">UK development &amp; valuation, end to end</span>
          </div>
          <h1 className="mt-[26px] max-w-[880px] text-[46px] md:text-[68px] font-bold tracking-[-2px] md:tracking-[-3px] leading-[1.02]">
            From the front door to the signed report — one workfile.
          </h1>
          <p className="mt-6 max-w-[620px] text-[18px] md:text-[20px] leading-[1.5] text-accent-muted-3">
            Apex Appraise runs the whole deal: AI-assisted appraisals, live development modelling, comparables, construction monitoring and
            investor reporting — with every figure traceable.
          </p>
          <div className="mt-[34px] flex items-center gap-3.5 flex-wrap">
            <Link
              to="/login"
              className="flex items-center gap-[9px] h-[50px] px-6 rounded-[13px] bg-surface text-brand-800 text-[15px] font-semibold hover:-translate-y-0.5 transition-all"
            >
              Start a free appraisal
              <Icon d={ARROW} size={17} strokeWidth={2.2} />
            </Link>
            <a
              href={DEMO_MAILTO}
              className="flex items-center gap-[9px] h-[50px] px-[22px] rounded-[13px] text-[15px] font-semibold text-white hover:bg-white/5 transition-all"
              style={{ border: '1px solid rgba(255,255,255,0.22)' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              Watch 2-min tour
            </a>
          </div>
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
          <span className="font-mono text-[12px] font-medium tracking-[0.5px] text-ink-3">Trusted by developers &amp; surveying firms across the UK</span>
          <div className="flex gap-9 items-center opacity-70 flex-wrap justify-center">
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          {STATS.map(([value, label]) => (
            <div key={value}>
              <div className="fig text-[44px] font-semibold tracking-[-2px] text-brand-700">{value}</div>
              <div className="mt-1.5 text-[14px] text-ink-2 leading-[1.4]">{label}</div>
            </div>
          ))}
        </div>
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
                  <div className={`font-mono text-[13px] font-semibold ${i === STAGES.length - 1 ? 'text-brand-700' : 'text-ink-3'}`}>{num}</div>
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
        <div className="max-w-[900px] mx-auto px-7 py-[72px] text-center">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="#3FD894" className="opacity-50 mx-auto">
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

      {/* CTA */}
      <div id="cta" className={`${WRAP} py-20`}>
        <div
          className="relative overflow-hidden rounded-[24px] px-7 py-14 md:p-14 text-center"
          style={{ background: 'linear-gradient(155deg,#1B6048,#0F3528)' }}
        >
          <div className="absolute -top-20 -right-16 w-[300px] h-[300px] rounded-full" style={{ background: 'rgba(63,216,148,0.08)' }} />
          <h2 className="relative text-[34px] md:text-[42px] font-bold tracking-[-1.6px] text-white">Run your next deal on Apex.</h2>
          <p className="relative mt-4 mx-auto max-w-[520px] text-[17px] leading-[1.5] text-accent-muted-3">
            Start with a single appraisal — no card required. Bring your whole pipeline across when you&rsquo;re ready.
          </p>
          <div className="relative mt-[30px] flex items-center justify-center gap-3.5 flex-wrap">
            <a
              href={DEMO_MAILTO}
              className="flex items-center gap-[9px] h-[50px] px-[26px] rounded-[13px] bg-surface text-brand-800 text-[15px] font-semibold hover:-translate-y-0.5 transition-all"
            >
              Book a demo
              <Icon d={ARROW} size={17} strokeWidth={2.2} />
            </a>
            <Link
              to="/login"
              className="flex items-center h-[50px] px-6 rounded-[13px] text-[15px] font-semibold text-white hover:bg-white/5 transition-all"
              style={{ border: '1px solid rgba(255,255,255,0.25)' }}
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>

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
                ['Product', [['Platform', '#platform'], ['Features', '#features'], ['Pricing', '#cta']]],
                ['Company', [['Customers', '#customers'], ['Security', '#footer'], ['Contact', DEMO_MAILTO]]],
                ['Legal', [['Privacy', '#footer'], ['Terms', '#footer']]],
              ] as Array<[string, Array<[string, string]>]>
            ).map(([heading, links]) => (
              <div key={heading}>
                <div className="label-mono text-ink-3">{heading}</div>
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
            <span className="font-mono text-[11.5px] text-ink-3">© 2026 Apex Appraise Ltd</span>
            <span className="font-mono text-[11.5px] text-ink-3">Registered in England &amp; Wales</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
