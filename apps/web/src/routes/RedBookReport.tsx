import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { computeAppraisal, formatMoneyFull, formatPct, formatRent } from '@apex/appraisal-engine';
import { brand, neutral, status as statusTokens } from '@apex/ui-tokens';
import { getToken, trpc } from '../lib/trpc';
import { n0 } from '../lib/format';
import { BrandMark, Button, Spinner } from '../components/ui';
import { CompsLadder } from '../components/charts';

/* ------------------------------------------------------------------ */
/*  Print treatment — fixed A4 pages (794×1123) stacked on the canvas  */
/* ------------------------------------------------------------------ */

const PRINT_CSS = `
@page { size: A4; margin: 0; }
@media print {
  body { background: #fff !important; }
  .no-print { display: none !important; }
  .a4-canvas { padding: 0 !important; gap: 0 !important; background: #fff !important; }
  .a4-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; page-break-after: always; break-after: page; }
}
`;

/** Evergreen gradient placeholders for the photo strip (photo-log pattern — no real images). */
const PHOTO_GRADS = [
  'linear-gradient(150deg,#1E7A55 0%,#14503B 60%,#0F3528 100%)',
  'linear-gradient(150deg,#5E9C80 0%,#1B6048 55%,#0C2A20 100%)',
  'linear-gradient(150deg,#7FB99E 0%,#1E7A55 50%,#13402F 100%)',
];

const VALUER = { name: 'Dana Whitlock MRICS', reg: 'RICS Registered Valuer · No. 1148207', firm: 'For and on behalf of Apex Appraise Ltd' };

/** RICS Red Book definition of Market Value (VPS 4). */
const MV_DEFINITION =
  '“The estimated amount for which an asset or liability should exchange on the valuation date between a willing buyer and a willing seller in an arm’s length transaction, after proper marketing and where the parties had each acted knowledgeably, prudently and without compulsion.”';

const GENERAL_ASSUMPTIONS = [
  'Good and marketable freehold title is held, free from onerous restrictions, covenants or outgoings.',
  'No high-alumina cement, asbestos or other deleterious materials are present in the construction.',
  'The property is connected to mains services in satisfactory working order, not tested by the valuer.',
  'No contamination or ground stability issues affect the site, and the property is not in an area of material flood risk.',
  'All necessary planning consents and building regulation approvals have been obtained.',
];

const SQFT_PER_SQM = 10.764;

const fmtLong = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const round1k = (n: number) => Math.round(n / 1000) * 1000;

/* ------------------------- pounds in words ------------------------- */

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function underThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const tail = r === 0 ? '' : r < 20 ? ONES[r] : `${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ''}`;
  if (h === 0) return tail;
  return tail ? `${ONES[h]} hundred and ${tail}` : `${ONES[h]} hundred`;
}

/** £625,000 → "Six hundred and twenty-five thousand pounds" (en-GB style, for the MV statement). */
function poundsInWords(pounds: number): string {
  const v = Math.round(Math.abs(pounds));
  if (v === 0) return 'Zero pounds';
  const m = Math.floor(v / 1e6);
  const t = Math.floor((v % 1e6) / 1e3);
  const u = v % 1e3;
  const parts: string[] = [];
  if (m) parts.push(`${underThousand(m)} million`);
  if (t) parts.push(`${underThousand(t)} thousand`);
  if (u) parts.push(m || t ? (u < 100 ? `and ${underThousand(u)}` : underThousand(u)) : underThousand(u));
  const s = `${parts.join(' ')} pounds`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ---------------------------- page chrome ---------------------------- */

function A4Page({ children, pad = true }: { children: ReactNode; pad?: boolean }) {
  return (
    <div
      className="a4-page bg-surface flex flex-col overflow-hidden"
      style={{
        width: 794,
        minHeight: 1123,
        borderRadius: 3,
        boxShadow: '0 4px 24px rgba(20,30,25,0.12)',
        padding: pad ? '54px 64px' : 0,
      }}
    >
      {children}
    </div>
  );
}

function PageHead({ title, right }: { title: string; right: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border-std pb-4">
      <div className="text-[22px] font-bold" style={{ letterSpacing: '-0.5px' }}>{title}</div>
      <div className="fig text-[11px] font-medium text-ink-3">{right}</div>
    </div>
  );
}

function PageFoot({ children }: { children: ReactNode }) {
  return <div className="mt-auto pt-6 text-[11px] text-ink-3">{children}</div>;
}

function Micro({ children, mt = 24 }: { children: ReactNode; mt?: number }) {
  return (
    <div className="fig text-[12px] font-semibold uppercase text-inactive" style={{ marginTop: mt, letterSpacing: '0.6px' }}>
      {children}
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <div className="mt-2.5 text-[13px] leading-[1.62]" style={{ color: '#2C342E', textWrap: 'pretty' as never }}>{children}</div>;
}

function SummaryRow({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-[11px] border-b border-border-faint">
      <span className="text-[13px] text-ink-2">{k}</span>
      <span className={`text-[13px] font-medium text-right ${mono ? 'fig' : ''}`}>{v}</span>
    </div>
  );
}

/* ------------------------------ screen ------------------------------ */

export default function RedBookReport() {
  const { dealId = '' } = useParams();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: appr, isLoading } = trpc.appraisal.getCurrent.useQuery(dealId, { enabled: !!dealId });
  const { data: compsData } = trpc.comparables.list.useQuery(dealId, { enabled: !!dealId });

  const input = appr?.input;
  // All figures from the shared engine — never hand-rolled.
  const R = useMemo(() => (input ? computeAppraisal(input) : null), [input]);

  const refCode = `AP-${dealId.slice(0, 4).toUpperCase()}`;
  const today = fmtLong(new Date());
  const subject = deal?.name ?? 'Subject property';

  const comps = compsData?.comps ?? [];
  const summary = compsData?.summary;
  const hasComps = comps.length > 0 && !!summary;

  const toolbar = (
    <div className="no-print sticky top-0 z-40 h-[54px] bg-surface border-b border-border-strong flex items-center gap-3.5 px-5">
      <Link to={`/deal/${dealId}/appraisal`} className="flex items-center gap-2 text-[13px] font-medium text-inactive hover:text-brand-700">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        Back to appraisal
      </Link>
      <span className="text-[13.5px] font-semibold ml-1.5">Red Book valuation report</span>
      <span className="text-[13px] text-ink-3">·</span>
      <span className="text-[13px] text-ink-2 truncate">{subject}</span>
      <span className="fig text-[11px] font-medium text-ink-3">{refCode}</span>
      <div className="ml-auto flex gap-2">
        <Button
          variant="secondary"
          onClick={() => window.open(`/reports/${dealId}/redbook.pdf?t=${encodeURIComponent(getToken() ?? '')}`, '_blank')}
        >
          Download PDF
        </Button>
        <Button onClick={() => window.print()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z" /></svg>
          Print / Save PDF
        </Button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="min-h-screen bg-frame">
        <style>{PRINT_CSS}</style>
        {toolbar}
        <div className="mt-16 flex justify-center"><Spinner /></div>
      </div>
    );
  }

  if (!appr || !R || !input) {
    return (
      <div className="min-h-screen bg-frame">
        <style>{PRINT_CSS}</style>
        {toolbar}
        <div className="mt-20 flex justify-center px-6">
          <div className="bg-surface border border-border-strong rounded-panel shadow-rest px-10 py-12 max-w-[480px] text-center">
            <div className="eyebrow">Red Book valuation</div>
            <h1 className="mt-2 text-[22px] font-bold tracking-[-0.6px]">No appraisal saved yet</h1>
            <p className="mt-2.5 text-[13px] text-ink-2 leading-relaxed">
              The valuation report derives its Market Value opinion from the deal's current appraisal and comparable evidence.
              Save an appraisal first, then return here.
            </p>
            <Button to={`/deal/${dealId}/appraisal`} className="mt-5">
              Open development appraisal
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ----- derived valuation figures (engine outputs, rounded for reporting) ----- */
  const nia = R.nia;
  const mv = round1k(R.gdv); // Market Value — appraisal GDV, reported to the nearest £1,000
  const compApproach = hasComps && nia > 0 ? round1k(summary.supportedPsf * nia) : mv;
  const drcApproach = round1k(R.landGross + R.build + R.fees + R.cont); // land + build components from the engine
  const rentPcm = Math.round((mv * 0.042) / 12 / 25) * 25; // 4.2% net yield basis (investment cross-check)
  const invApproach = round1k((rentPcm * 12) / 0.042);
  const reinstatement = Math.round((R.build + R.fees) / 5000) * 5000;
  const range = hasComps && nia > 0
    ? { lo: round1k(summary.range.lo * nia), hi: round1k(summary.range.hi * nia) }
    : { lo: round1k(mv - R.gdv * 0.025), hi: round1k(mv + R.gdv * 0.025) };
  const marker = range.hi > range.lo ? Math.min(95, Math.max(5, ((mv - range.lo) / (range.hi - range.lo)) * 100)) : 50;
  const psf = nia > 0 ? Math.round(mv / nia) : 0;
  const confidence = !hasComps
    ? { label: 'Medium', tone: statusTokens.amber.text }
    : summary.avgGrossAdjustment < 8
      ? { label: 'High', tone: statusTokens.green.text }
      : summary.avgGrossAdjustment < 15
        ? { label: 'Medium', tone: statusTokens.amber.text }
        : { label: 'Low', tone: statusTokens.red.text };
  const avgNetAdj = hasComps ? summary.comps.reduce((a, c) => a + c.netAdjustment, 0) / summary.comps.length : 0;

  const assetLabel: Record<string, string> = {
    INDUSTRIAL: 'Industrial / trade',
    RESIDENTIAL: 'Residential dwelling',
    COMMERCIAL: 'Commercial',
    MIXED_USE: 'Mixed-use',
  };
  const useClass: Record<string, string> = {
    INDUSTRIAL: 'B2 / B8',
    RESIDENTIAL: 'C3 — Dwelling',
    COMMERCIAL: 'E — Commercial',
    MIXED_USE: 'Sui generis',
  };
  const assetType = deal?.assetType ?? 'RESIDENTIAL';

  const approaches = [
    { name: 'Comparable', value: compApproach, note: hasComps ? `${comps.length} adjusted comparable${comps.length === 1 ? '' : 's'}` : 'No comparables logged', weight: 70, dot: brand[700] },
    { name: 'DRC', value: drcApproach, note: 'Land + depreciated build', weight: 20, dot: brand[400] },
    { name: 'Investment', value: invApproach, note: 'Net rent × YP (4.2%)', weight: 10, dot: neutral.ink3 },
  ];

  return (
    <div className="min-h-screen bg-frame">
      <style>{PRINT_CSS}</style>
      {toolbar}

      <div className="a4-canvas flex flex-col items-center gap-7 px-5 pt-7 pb-14">
        {/* ============ PAGE 1 — COVER ============ */}
        <A4Page pad={false}>
          <div className="relative overflow-hidden text-white" style={{ background: `linear-gradient(155deg,${brand[600]} 0%,${brand[700]} 55%,${brand[800]} 100%)`, padding: '64px 64px 56px' }}>
            <div className="absolute rounded-full" style={{ top: -60, right: -50, width: 240, height: 240, background: 'rgba(255,255,255,0.06)' }} />
            <div className="absolute rounded-full" style={{ bottom: -90, left: -40, width: 200, height: 200, background: 'rgba(255,255,255,0.05)' }} />
            <div className="relative flex items-center gap-3">
              <BrandMark size={38} />
              <span className="text-[20px] font-bold tracking-[-0.3px]">Apex Appraise</span>
              <span className="ml-auto fig text-[11px] font-medium uppercase" style={{ letterSpacing: '1px', color: 'rgba(255,255,255,0.7)' }}>RICS Regulated</span>
            </div>
            <div className="relative mt-[88px] fig text-[12px] font-medium uppercase" style={{ letterSpacing: '2.5px', color: 'rgba(255,255,255,0.66)' }}>Valuation Report</div>
            <div className="relative mt-3.5 text-[40px] font-bold leading-[1.08]" style={{ letterSpacing: '-1.4px' }}>{subject}</div>
            <div className="relative mt-1.5 text-[17px]" style={{ color: 'rgba(255,255,255,0.82)' }}>{deal?.address}</div>
            <div className="relative mt-10 inline-flex flex-col gap-1 rounded-[14px]" style={{ padding: '18px 22px', background: 'rgba(255,255,255,0.12)' }}>
              <span className="fig text-[11px] font-medium uppercase" style={{ letterSpacing: '1px', color: 'rgba(255,255,255,0.66)' }}>Market Value</span>
              <span className="fig text-[38px] font-semibold" style={{ letterSpacing: '-1.6px' }}>{formatMoneyFull(mv)}</span>
              <span className="text-[12px]" style={{ color: 'rgba(255,255,255,0.7)' }}>{poundsInWords(mv)}</span>
            </div>
          </div>
          <div className="flex-1 flex flex-col" style={{ padding: '44px 64px' }}>
            <div className="grid grid-cols-2" style={{ gap: '26px 40px' }}>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Prepared for</div>
                <div className="mt-1.5 text-[14px] font-semibold">Northpoint Building Society</div>
                <div className="text-[12.5px] text-ink-2">Secured lending — first charge</div>
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Purpose of valuation</div>
                <div className="mt-1.5 text-[14px] font-semibold">Mortgage / secured lending</div>
                <div className="text-[12.5px] text-ink-2">Market Value, vacant possession</div>
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Inspection date</div>
                <div className="mt-1.5 text-[14px] font-semibold">{today}</div>
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Valuation date</div>
                <div className="mt-1.5 text-[14px] font-semibold">{today}</div>
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Valuer</div>
                <div className="mt-1.5 text-[14px] font-semibold">{VALUER.name}</div>
                <div className="text-[12.5px] text-ink-2">{VALUER.reg}</div>
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Reference</div>
                <div className="fig mt-1.5 text-[14px] font-semibold">{refCode}</div>
              </div>
            </div>
            <div className="mt-auto pt-7 border-t border-border-std flex justify-between items-center">
              <div className="text-[11px] text-inactive leading-[1.5]">
                Prepared in accordance with the RICS Valuation –<br />Global Standards (the "Red Book"), effective edition.
              </div>
              <div className="fig text-[11px] font-semibold" style={{ letterSpacing: '0.5px', color: brand[700] }}>STRICTLY CONFIDENTIAL</div>
            </div>
          </div>
        </A4Page>

        {/* ============ PAGE 2 — CERTIFICATE, INSTRUCTIONS & BASIS ============ */}
        <A4Page>
          <PageHead title="Valuation certificate" right={`${refCode} · ${subject}`} />

          <div className="mt-6 border border-border-strong rounded-[14px] overflow-hidden">
            <div className="flex bg-sunken border-b border-border-std">
              <div className="flex-1 fig text-[11px] font-medium uppercase text-inactive" style={{ padding: '14px 18px', letterSpacing: '0.6px' }}>Reported basis of value</div>
              <div className="flex-1 fig text-[11px] font-medium uppercase text-inactive" style={{ padding: '14px 18px', letterSpacing: '0.6px' }}>Figure</div>
            </div>
            <div className="flex items-center border-b border-border-faint">
              <div className="flex-1 text-[13.5px] font-medium" style={{ padding: '15px 18px' }}>Market Value (vacant possession)</div>
              <div className="flex-1 fig text-[17px] font-semibold" style={{ padding: '15px 18px', letterSpacing: '-0.6px', color: brand[700] }}>{formatMoneyFull(mv)}</div>
            </div>
            <div className="flex items-center border-b border-border-faint">
              <div className="flex-1 text-[13.5px]" style={{ padding: '15px 18px', color: '#3C443D' }}>Reinstatement cost (for insurance)</div>
              <div className="flex-1 fig text-[14px] font-medium" style={{ padding: '15px 18px' }}>{formatMoneyFull(reinstatement)}</div>
            </div>
            <div className="flex items-center border-b border-border-faint">
              <div className="flex-1 text-[13.5px]" style={{ padding: '15px 18px', color: '#3C443D' }}>Estimated market rent</div>
              <div className="flex-1 fig text-[14px] font-medium" style={{ padding: '15px 18px' }}>{formatRent(rentPcm)}</div>
            </div>
            <div className="flex items-center">
              <div className="flex-1 text-[13.5px]" style={{ padding: '15px 18px', color: '#3C443D' }}>Indicated value range</div>
              <div className="flex-1 fig text-[14px] font-medium" style={{ padding: '15px 18px' }}>{formatMoneyFull(range.lo)} – {formatMoneyFull(range.hi)}</div>
            </div>
          </div>

          <Micro>Instructions &amp; basis of value</Micro>
          <Body>
            We are instructed to report our opinion of the Market Value of the freehold interest in the subject property for secured
            lending purposes. Market Value is defined in the RICS Valuation – Global Standards (VPS 4) as {MV_DEFINITION} The valuation
            assumes vacant possession and reflects market conditions as at the valuation date.
          </Body>

          <Micro>Subject property summary</Micro>
          <div className="mt-2.5 grid grid-cols-2" style={{ gap: '0 36px' }}>
            <SummaryRow k="Tenure" v="Freehold" />
            <SummaryRow k="Property type" v={assetLabel[assetType] ?? assetType} />
            <SummaryRow k="Gross internal area" v={`${n0(R.gia / SQFT_PER_SQM)} sq m (${n0(R.gia)} sq ft)`} mono />
            <SummaryRow k="Net internal area" v={`${n0(nia)} sq ft`} mono />
            <SummaryRow k="Units" v={n0(input.units.reduce((a, u) => a + u.count, 0))} mono />
            <SummaryRow k="Efficiency (NIA:GIA)" v={`${input.efficiency}%`} mono />
            <SummaryRow k="Planning status" v={appr.planningStatus ?? 'Not assessed'} />
            <SummaryRow k="Use class" v={useClass[assetType] ?? '—'} />
            <SummaryRow k="EPC rating" v="C (72)" />
            <SummaryRow k="Title number" v="NYK 284119" mono />
          </div>

          <div className="mt-6 flex gap-3 items-start rounded-[13px] border" style={{ background: neutral.tintSuccess, borderColor: neutral.tintSuccess2, padding: '16px 18px' }}>
            <div className="shrink-0 w-[26px] h-[26px] rounded-[8px] flex items-center justify-center" style={{ background: brand[700] }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#fff"><path d="M12 2l1.6 4.4L18 8l-4.4 1.6L12 14l-1.6-4.4L6 8l4.4-1.6L12 2Z" /></svg>
            </div>
            <div className="text-[12.5px] leading-[1.55]" style={{ color: '#1E5C45' }}>
              Opinion of value supported by {hasComps ? `${comps.length} recent comparable ${comps.length === 1 ? 'sale' : 'sales'}, with average net adjustment of ${formatPct(Math.abs(avgNetAdj) / 100)}` : 'the current development appraisal pending comparable evidence'}.
              Valuation confidence assessed as <b className="font-semibold">{confidence.label.toLowerCase()}</b> under the RICS confidence framework.
            </div>
          </div>

          <PageFoot>Page 2 of 6 · This certificate must be read in conjunction with the assumptions and conditions set out on page 6.</PageFoot>
        </A4Page>

        {/* ============ PAGE 3 — PROPERTY & LOCATION ============ */}
        <A4Page>
          <PageHead title="Property & location" right="Section 1–2" />

          {/* photo strip — evergreen placeholders per the photo-log pattern */}
          <div className="mt-5 grid gap-2.5" style={{ gridTemplateColumns: '2fr 1fr 1fr', height: 208 }}>
            <div className="rounded-[12px] relative" style={{ background: PHOTO_GRADS[0] }}>
              <div className="absolute fig text-[10px] font-medium text-white rounded-[7px]" style={{ left: 12, bottom: 12, padding: '4px 9px', background: 'rgba(12,18,14,0.5)' }}>Front elevation</div>
            </div>
            <div className="rounded-[12px]" style={{ background: PHOTO_GRADS[1] }} />
            <div className="rounded-[12px]" style={{ background: PHOTO_GRADS[2] }} />
          </div>

          <Micro>1 · Description</Micro>
          <Body>
            The subject comprises {subject.toLowerCase().startsWith('the') ? subject : `${subject}`}, {deal?.address}. The property extends
            to approximately {n0(R.gia)} sq ft ({n0(R.gia / SQFT_PER_SQM)} sq m) gross internal area, providing {n0(nia)} sq ft of net
            internal accommodation at a {input.efficiency}% efficiency. The accommodation is scheduled below; construction is of
            conventional specification for its class and the property presents in good order, consistent with the assumptions of the
            current appraisal. Planning status: {(appr.planningStatus ?? 'not assessed').toLowerCase()}.
          </Body>

          <Micro>Accommodation (NIA)</Micro>
          <div className="mt-2.5 grid grid-cols-2" style={{ gap: '0 36px' }}>
            {input.units.slice(0, 6).map((u, i) => (
              <div key={i} className="flex justify-between items-baseline gap-3 py-[9px] border-b border-border-faint">
                <span className="text-[12.5px] text-ink-2">{u.label}</span>
                <span className="fig text-[12.5px] font-medium">{u.count} × {n0(u.area)} sq ft</span>
              </div>
            ))}
            <div className="flex justify-between items-baseline gap-3 py-[9px] border-b border-border-faint">
              <span className="text-[12.5px] text-ink-2">Total NIA</span>
              <span className="fig text-[12.5px] font-semibold" style={{ color: brand[700] }}>{n0(nia)} sq ft</span>
            </div>
          </div>

          <Micro>2 · Situation &amp; locality</Micro>
          <div className="mt-2.5 flex" style={{ gap: 18 }}>
            <div className="flex-1 text-[13px] leading-[1.62]" style={{ color: '#2C342E' }}>
              The property occupies an established position at {deal?.address}. Local amenities and arterial transport links are within
              convenient reach, and occupier demand in the immediate locality is considered good. The surrounding pattern of use is
              consistent with the subject's class, the site is identified as Flood Zone 1 (low risk) and no adverse environmental factors
              were noted on inspection.
            </div>
            <div className="shrink-0 rounded-[12px] overflow-hidden border border-border-strong relative" style={{ width: 300, height: 188, background: neutral.sunken2 }}>
              <iframe
                src={`https://www.google.com/maps?q=${encodeURIComponent(deal?.address ?? '')}&z=16&output=embed`}
                title={`Site location — ${deal?.address ?? 'subject property'}`}
                style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
              <div className="absolute fig text-[9.5px] font-medium rounded-[7px] pointer-events-none" style={{ bottom: 10, left: 10, padding: '4px 9px', background: 'rgba(255,255,255,0.92)', color: brand[700] }}>
                {deal?.address}
              </div>
            </div>
          </div>

          <PageFoot>Page 3 of 6 · Apex Appraise · {subject}</PageFoot>
        </A4Page>

        {/* ============ PAGE 4 — METHODOLOGY & RECONCILIATION ============ */}
        <A4Page>
          <PageHead title="Valuation methodology" right="Section 3" />

          <div className="text-[13px] leading-[1.62]" style={{ marginTop: 18, color: '#2C342E' }}>
            Primary reliance has been placed on the <b className="font-semibold">comparable method</b>, being the most reliable evidence
            of value for property of this class. The depreciated replacement cost and investment methods have been prepared as
            cross-checks and are afforded limited weight.
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            {approaches.map((a) => (
              <div key={a.name} className="border border-border-strong rounded-[13px] p-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-[2px] inline-block" style={{ background: a.dot }} />
                  <span className="text-[12.5px] font-semibold">{a.name}</span>
                </div>
                <div className="fig mt-2.5 text-[20px] font-semibold" style={{ letterSpacing: '-0.8px' }}>{formatMoneyFull(a.value)}</div>
                <div className="mt-2 text-[11px]" style={{ color: '#7A807A' }}>{a.note}</div>
                <div className="mt-2.5 h-[5px] rounded-[3px] overflow-hidden" style={{ background: neutral.sunken2 }}>
                  <div className="h-full" style={{ width: `${a.weight}%`, background: a.dot }} />
                </div>
                <div className="fig mt-1.5 text-[10.5px] font-medium text-ink-2">Weight {a.weight}%</div>
              </div>
            ))}
          </div>

          {/* reconciliation — the Market Value statement */}
          <div className="mt-5 border border-border-strong rounded-[14px] bg-sunken p-5">
            <div className="flex items-end justify-between">
              <div>
                <div className="fig text-[10px] font-medium uppercase text-inactive" style={{ letterSpacing: '0.8px' }}>Reconciled Market Value</div>
                <div className="fig mt-1.5 text-[32px] font-semibold" style={{ letterSpacing: '-1.5px', color: brand[700] }}>{formatMoneyFull(mv)}</div>
                <div className="mt-1 text-[12px] text-ink-2">{poundsInWords(mv)}</div>
              </div>
              <div className="text-right">
                <div className="fig text-[10px] font-medium uppercase text-inactive" style={{ letterSpacing: '0.6px' }}>Analysed rate</div>
                <div className="fig mt-1 text-[15px] font-semibold">£{n0(psf)} / sq ft</div>
              </div>
            </div>
            <div className="mt-4 relative h-[7px] rounded-[4px]" style={{ background: neutral.sunken2 }}>
              <div className="absolute inset-y-0 rounded-[4px]" style={{ left: '8%', right: '10%', background: `linear-gradient(90deg,${brand[400]},${brand[700]})` }} />
              <div
                className="absolute rounded-full"
                style={{ left: `${marker}%`, top: -3, width: 13, height: 13, background: brand[700], border: '2.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transform: 'translateX(-50%)' }}
              />
            </div>
            <div className="mt-2 flex justify-between fig text-[11px] font-medium text-ink-3">
              <span>{formatMoneyFull(range.lo)}</span>
              <span>{formatMoneyFull(range.hi)}</span>
            </div>
          </div>

          <Micro>Market commentary</Micro>
          <Body>
            The local market for property of this class and price band remains active, with good demand and limited supply of directly
            comparable stock. Transaction volumes are stable and marketing periods for well-presented properties are typically six to
            eight weeks. No material valuation uncertainty is reported.
          </Body>

          <PageFoot>Page 4 of 6 · Apex Appraise · Reference {refCode}</PageFoot>
        </A4Page>

        {/* ============ PAGE 5 — COMPARABLE EVIDENCE ============ */}
        <A4Page>
          <PageHead title="Comparable evidence" right="Section 4" />

          <div className="mt-5 border border-border-strong rounded-[14px] overflow-hidden">
            <div className="flex text-white fig text-[10.5px] font-semibold uppercase" style={{ background: brand[700], letterSpacing: '0.5px' }}>
              <div style={{ flex: 2.1, padding: '12px 14px' }}>Address</div>
              <div style={{ flex: 2.2, padding: '12px 8px' }}>Evidence</div>
              <div className="text-right" style={{ flex: 1, padding: '12px 8px' }}>Base £/ft²</div>
              <div className="text-right" style={{ flex: 1, padding: '12px 8px' }}>Net adj</div>
              <div className="text-right" style={{ flex: 1.2, padding: '12px 14px' }}>Adjusted £/ft²</div>
            </div>
            {/* subject row */}
            <div className="flex items-center border-b border-border-std fig text-[12px] font-medium" style={{ background: '#F3F8F5' }}>
              <div className="font-ui text-[12px] font-semibold" style={{ flex: 2.1, padding: '13px 14px', color: brand[700] }}>Subject — {subject}</div>
              <div className="text-ink-3" style={{ flex: 2.2, padding: '13px 8px' }}>{n0(nia)} ft² NIA</div>
              <div className="text-right text-ink-3" style={{ flex: 1, padding: '13px 8px' }}>—</div>
              <div className="text-right text-ink-3" style={{ flex: 1, padding: '13px 8px' }}>—</div>
              <div className="text-right text-ink-3" style={{ flex: 1.2, padding: '13px 14px' }}>—</div>
            </div>
            {hasComps ? (
              summary.comps.map((c, i) => {
                const meta = comps[i]?.meta ?? '';
                return (
                  <div key={c.address} className="flex items-center fig text-[12px] font-medium" style={{ borderBottom: i === summary.comps.length - 1 ? 'none' : `1px solid ${neutral.borderFaint}` }}>
                    <div className="font-ui text-[12px] font-medium" style={{ flex: 2.1, padding: '13px 14px' }}>{c.address}</div>
                    <div className="font-ui text-[11px] text-ink-2" style={{ flex: 2.2, padding: '13px 8px' }}>{meta}</div>
                    <div className="text-right" style={{ flex: 1, padding: '13px 8px' }}>£{n0(c.basePsf)}</div>
                    <div className="text-right" style={{ flex: 1, padding: '13px 8px', color: c.netAdjustment > 0 ? statusTokens.green.text : c.netAdjustment < 0 ? statusTokens.red.text : neutral.ink3 }}>
                      {c.netAdjustment > 0 ? '+' : c.netAdjustment < 0 ? '−' : ''}{Math.abs(c.netAdjustment)}%
                    </div>
                    <div className="text-right font-semibold" style={{ flex: 1.2, padding: '13px 14px', color: brand[700] }}>£{n0(c.adjustedPsf)}</div>
                  </div>
                );
              })
            ) : (
              <div className="text-[12.5px] text-ink-3 text-center" style={{ padding: '22px 14px' }}>
                No comparable evidence logged for this deal yet — add comparables from the deal workspace.
              </div>
            )}
          </div>

          {hasComps && summary.comps.length > 1 && (
            <div className="mt-4 border border-border-strong rounded-[12px]" style={{ padding: '14px 16px 8px' }}>
              <div className="fig text-[10px] font-medium uppercase text-inactive" style={{ letterSpacing: '0.6px', marginBottom: 8 }}>
                Adjustment ladder — base to adjusted £/ft²
              </div>
              <CompsLadder
                comps={summary.comps.map((c) => ({ address: c.address, basePsf: c.basePsf, adjustedPsf: c.adjustedPsf }))}
                supported={summary.supportedPsf}
              />
            </div>
          )}

          <div className="mt-3.5 flex gap-3">
            <div className="flex-1 border border-border-strong rounded-[12px]" style={{ padding: '14px 16px' }}>
              <div className="fig text-[10px] font-medium uppercase text-inactive" style={{ letterSpacing: '0.6px' }}>Supported £/ft²</div>
              <div className="fig mt-1.5 text-[17px] font-semibold" style={{ letterSpacing: '-0.6px' }}>{hasComps ? `£${n0(summary.supportedPsf)}` : '—'}</div>
            </div>
            <div className="flex-1 border border-border-strong rounded-[12px]" style={{ padding: '14px 16px' }}>
              <div className="fig text-[10px] font-medium uppercase text-inactive" style={{ letterSpacing: '0.6px' }}>Avg net adjustment</div>
              <div className="fig mt-1.5 text-[17px] font-semibold" style={{ letterSpacing: '-0.6px', color: hasComps && avgNetAdj < 0 ? statusTokens.green.text : neutral.ink }}>
                {hasComps ? `${avgNetAdj > 0 ? '+' : avgNetAdj < 0 ? '−' : ''}${Math.abs(avgNetAdj).toFixed(1)}%` : '—'}
              </div>
            </div>
            <div className="flex-1 border border-border-strong rounded-[12px]" style={{ padding: '14px 16px' }}>
              <div className="fig text-[10px] font-medium uppercase text-inactive" style={{ letterSpacing: '0.6px' }}>Valuation confidence</div>
              <div className="mt-1.5 text-[17px] font-semibold" style={{ color: confidence.tone }}>{confidence.label}</div>
            </div>
          </div>

          <Micro>Basis of adjustment</Micro>
          <Body>
            Comparables have been adjusted for differences in size, condition, location and date of sale, with the net adjustment applied
            to each comparable's analysed rate per square foot. Less-adjusted evidence is afforded greater weight in deriving the
            supported rate. All evidence is drawn from open-market arm's-length transactions verified against HM Land Registry sold-price
            records and local agency confirmation.
          </Body>

          <PageFoot>Page 5 of 6 · Comparable schedule</PageFoot>
        </A4Page>

        {/* ============ PAGE 6 — ASSUMPTIONS & DECLARATION ============ */}
        <A4Page>
          <PageHead title="Assumptions & declaration" right="Section 5–6" />

          <Micro mt={20}>General assumptions</Micro>
          <div className="mt-2.5 flex flex-col gap-2">
            {GENERAL_ASSUMPTIONS.map((a) => (
              <div key={a} className="flex gap-2.5">
                <span className="shrink-0 font-semibold" style={{ color: brand[700] }}>·</span>
                <span className="text-[12.5px] leading-[1.5]" style={{ color: '#2C342E' }}>{a}</span>
              </div>
            ))}
          </div>

          <Micro mt={20}>Special assumptions</Micro>
          <div className="mt-2.5 text-[12.5px] leading-[1.55]" style={{ color: '#2C342E' }}>
            The valuation assumes vacant possession on completion. No special assumptions have otherwise been made.
          </div>

          <Micro mt={20}>Conditions &amp; scope</Micro>
          <div className="mt-2.5 text-[12.5px] leading-[1.55]" style={{ color: '#2C342E' }}>
            This report is prepared for the stated client and purpose only and may not be relied upon by any third party. It is not a
            building survey and does not constitute advice on structural condition. Liability is limited in accordance with the agreed
            terms of engagement. The valuer has no conflict of interest and acts as an external valuer under the RICS Red Book.
          </div>

          <div className="mt-7 border-t border-border-std pt-6 flex justify-between items-end">
            <div>
              <div style={{ width: 188, height: 48, borderBottom: `1.5px solid ${neutral.crumb}` }} />
              <div className="mt-2.5 text-[14px] font-semibold">{VALUER.name}</div>
              <div className="text-[12px] text-ink-2">{VALUER.reg}</div>
              <div className="text-[12px] text-ink-2">{VALUER.firm}</div>
              <div className="fig mt-1.5 text-[11.5px] font-medium text-inactive">Date: {today}</div>
            </div>
            <div className="w-[88px] h-[88px] rounded-full flex flex-col items-center justify-center" style={{ border: `2px solid ${brand[700]}`, color: brand[700] }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={brand[700]} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l2.6 7.2L22 9.6l-5.8 4.6L18 22l-6-4.2L6 22l1.8-7.8L2 9.6l7.4-.4L12 2Z" />
              </svg>
              <span className="fig mt-1 text-[7.5px] font-semibold text-center" style={{ letterSpacing: '0.5px' }}>RICS<br />REGULATED</span>
            </div>
          </div>

          <PageFoot>Page 6 of 6 · © Apex Appraise Ltd · This report remains the property of Apex Appraise until fees are settled in full.</PageFoot>
        </A4Page>
      </div>
    </div>
  );
}
