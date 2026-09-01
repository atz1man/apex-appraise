import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  DEFAULT_PURCHASER_COSTS_PCT,
  analysedPsf,
  capitaliseIncome,
  computeAppraisal,
  discountedCashflow,
  formatMoneyFull,
  formatPct,
  formatRent,
  reportedMarketValue,
  toNearestThousand,
  type IncomeInput,
} from '@apex/appraisal-engine';
import { brand, neutral, status as statusTokens } from '@apex/ui-tokens';
import { getToken, trpc } from '../lib/trpc';
import { poundsInWords } from '../lib/words';
import { valuationConfidence } from '../lib/valuation-confidence';
import { situationStatement } from '../lib/situation';
import { n0 } from '../lib/format';
import { Button, FirmMark, Spinner } from '../components/ui';
import { ShareLinks } from '../components/ShareLinks';
import { A4Page as PaperPage, PRINT_CSS, docDate } from '../components/paper';
import { reportDates } from '../lib/report-dates';
import { approvalCheck } from '../lib/approval-check';

/** the Red Book sets its own margins — see the note in components/paper.tsx */
const A4Page = ({ children, pad = true }: { children: React.ReactNode; pad?: boolean }) => (
  <PaperPage pad={pad} padding="54px 64px">
    {children}
  </PaperPage>
);
import { CompsLadder } from '../components/charts';
import { SiteMap } from '../components/SiteMap';
import { openReport } from '../lib/download';
import { namedModel } from '../lib/ai-model';

/* ------------------------------------------------------------------ */
/*  Print treatment — fixed A4 pages (794×1123) stacked on the canvas  */
/* ------------------------------------------------------------------ */


/**
 * The valuer signing this report.
 *
 * This was a hardcoded name and RICS registration number — "Dana Whitlock MRICS,
 * No. 1148207" — printed in both signature blocks of every Red Book valuation
 * this platform produced, for every firm. A Red Book valuation is a signed
 * professional document: the valuer's name and registration number are the whole
 * of its authority and where its liability attaches, and that number may well
 * belong to a real registered valuer who has never seen the property.
 *
 * The valuer is the one NAMED IN THE TERMS OF ENGAGEMENT for the instruction —
 * the person the client agreed would carry it out. Where the terms do not name
 * one, the report says so and prints no credentials, because an unsigned
 * valuation is a fixable state and a falsely signed one is not.
 */
const valuerFrom = (toe?: { valuerName?: string | null; valuerReg?: string | null } | null) => {
  const name = toe?.valuerName?.trim() ?? '';
  const reg = toe?.valuerReg?.trim() ?? '';
  return name ? { named: true as const, name, reg } : { named: false as const, name: '', reg: '' };
};

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

/** every date this document prints is in the firm's time — see paper.tsx */
const fmtLong = docDate;

/* ---------------------------- page chrome ---------------------------- */

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

/**
 * Screen-only provenance flag beside AI-drafted narrative sections — never printed.
 *
 * Rendered only when a model actually wrote them. The commentary falls back to a
 * deterministic template with no ANTHROPIC_API_KEY, and whenever the figure guard
 * rejects a draft — and labelling those "AI-drafted" is the same misstatement the
 * disclosure page used to make, in the margin instead of the declaration.
 */
function AiDraftNote() {
  return (
    <span className="no-print print:hidden fig text-[10px] font-medium normal-case text-inactive" style={{ marginLeft: 10, letterSpacing: '0.3px' }}>
      AI-drafted — valuer to review
    </span>
  );
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
  // client-facing documents carry the firm's identity, not the product's
  const { data: org } = trpc.org.get.useQuery();
  // AI-use disclosure — derived from the deal's audit trail, printed with the report
  const { data: ai } = trpc.appraisal.aiDisclosure.useQuery(dealId, { enabled: !!dealId });
  // the report is written under the agreed terms of engagement — cite them (VPS 1)
  const { data: toe } = trpc.engagement.get.useQuery(dealId, { enabled: !!dealId });
  /**
   * Photographs of the subject. A Red Book report's photographs are part of the
   * record of inspection — this page previously drew three gradients and captioned
   * the first "Front elevation", asserting an inspection exhibit that did not
   * exist, in a document carrying professional indemnity.
   */
  const { data: sitePhotos } = trpc.photos.list.useQuery(dealId, { enabled: !!dealId });
  /**
   * The inspection this report is written on the back of. Same reason as the
   * photographs above: the report stated an inspection date of *today*, so a
   * property nobody has ever attended was reported as inspected on whatever day
   * the reader opened the file.
   */
  const { data: inspection } = trpc.inspections.get.useQuery(dealId, { enabled: !!dealId });
  const valuer = valuerFrom(toe);
  /**
   * Whether the signed figure still holds. An approved version carries a pin
   * of the engine that signed it and the figures it signed; this re-derives it
   * with the engine the API runs today. Asked only of an approved version — a
   * draft has no signed figure to hold to.
   */
  const { data: verification } = trpc.appraisal.verifyApproved.useQuery(
    { versionId: appr?.id ?? '' },
    { enabled: !!appr && appr.reviewStatus === 'approved' },
  );
  const check = approvalCheck(verification, appr?.reviewStatus === 'approved');
  /**
   * The client and the purpose are the terms of engagement's. The cover printed
   * "Northpoint Building Society · Secured lending — first charge" for every
   * deal of every firm — on Northgate, whose accepted terms name Halewood Asset
   * Finance Ltd two pages later. A lender's name on a valuation is who it may
   * be relied on by; an invented one is a document addressed to nobody.
   */
  const termsSaved = !!toe?.saved;
  const clientName = termsSaved ? String((toe as { clientName?: string | null }).clientName ?? '').trim() : '';
  const client = clientName
    ? { name: clientName, sub: toe?.status === 'ACCEPTED' ? 'Under the accepted terms of engagement' : 'Terms of engagement not yet accepted' }
    : { name: 'Not yet named in the terms of engagement', sub: 'Agree the terms before this report is issued' };
  const purposeText = termsSaved ? String((toe as { purpose?: string | null }).purpose ?? '').trim() : '';
  const purpose = purposeText
    ? {
        name: purposeText,
        sub: [(toe as { basisOfValue?: string | null }).basisOfValue, (toe as { interest?: string | null }).interest].filter(Boolean).join(', '),
      }
    : { name: 'Not yet stated in the terms of engagement', sub: '' };
  const utils = trpc.useUtils();
  const mintDownload = trpc.appraisal.downloadToken.useMutation();
  const draftNarrative = trpc.appraisal.draftNarrative.useMutation({
    onSuccess: () => {
      utils.appraisal.getCurrent.invalidate(dealId);
      // drafting IS an AI use — the disclosure has to change with it, not on next reload
      utils.appraisal.aiDisclosure.invalidate(dealId);
    },
  });
  const narrative = appr?.narrative ?? null;
  /**
   * Whether a model wrote the commentary, as opposed to the deterministic
   * template. `model` records what produced the prose currently in the report;
   * 'template' is the value for the fallback, and 'demo' meant the same before
   * that field recorded provenance rather than configuration.
   */
  const modelDrafted = !!namedModel(narrative?.model);

  const input = appr?.input;
  // All figures from the shared engine — never hand-rolled.
  const R = useMemo(() => (input ? computeAppraisal(input) : null), [input]);

  // Pagination: AI-drafted commentary earns its own sheet, so the page count is
  // dynamic. Footers must match what actually prints — a "6 of 6" on a nine-sheet
  // PDF is exactly the kind of thing a client notices.
  const hasCommentaryPage = !!narrative;
  const pageNo = {
    cover: 1,
    certificate: 2,
    property: 3,
    methodology: 4,
    comparables: 5,
    commentary: hasCommentaryPage ? 6 : 0,
    declaration: hasCommentaryPage ? 7 : 6,
  };
  const pageTotal = pageNo.declaration;

  const firmName = org?.name ?? 'Apex Appraise';
  /**
   * The firm's RICS Regulated Firm number, or empty. "RICS Regulated" was a
   * literal on the cover and on the signature seal, printed for every firm on
   * the platform with nothing in the record that could make it true — the same
   * defect as the hardcoded valuer name and registration number this file
   * already had to be cured of, one level up: there the claim was about a
   * person, here it is about the firm.
   */
  const ricsFirmNumber = org?.ricsFirmNumber?.trim() ?? '';
  const refCode = `AP-${dealId.slice(0, 4).toUpperCase()}`;
  const dates = reportDates({ appraisal: appr, terms: toe, inspection });
  const subject = deal?.name ?? 'Subject property';

  const comps = compsData?.comps ?? [];
  const summary = compsData?.summary;
  const hasComps = comps.length > 0 && !!summary;

  /**
   * The subject's coordinates, geocoded and cached by the API — the same
   * `comparables.list` this page already calls, so plotting the site costs
   * nothing extra. The situation panel used to embed google.com/maps in an
   * iframe, which handed Google the subject property's address every time
   * anybody opened a valuation and was the last third-party request left in
   * the product. "Nobody else" is what the privacy notice says.
   */
  const located = compsData?.subject;
  const subjectPin =
    located?.status === 'located'
      ? [{ lat: located.geo.latitude, lng: located.geo.longitude, label: deal?.name ?? 'Subject site', sub: deal?.address, kind: 'subject' as const }]
      : [];

  /**
   * There is nothing to export until an appraisal exists. Offering the buttons
   * anyway sent the user to a report route that waited fifteen seconds for a page
   * that would never render and then returned a 500 — telling them the server was
   * broken when the truth was that this deal has no appraisal yet.
   */
  const exportable = !!appr && !!R && !!input;
  const toolbar = (
    <div className="no-print sticky top-0 z-40 h-[54px] bg-surface border-b border-border-strong flex items-center gap-3.5 px-5 relative">
      <Link to={`/deal/${dealId}/appraisal`} className="flex items-center gap-2 text-[13px] font-medium text-inactive hover:text-brand-700">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        Back to appraisal
      </Link>
      <span className="text-[13.5px] font-semibold ml-1.5">Red Book valuation report</span>
      <span className="text-[13px] text-ink-3">·</span>
      <span className="text-[13px] text-ink-2 truncate">{subject}</span>
      <span className="fig text-[11px] font-medium text-ink-3">{refCode}</span>
      <div className="ml-auto flex gap-2">
        {exportable && (
          <Button writes
            variant="secondary"
            className="print:hidden"
            loading={draftNarrative.isPending}
            onClick={() => draftNarrative.mutate(dealId)}
          >
            Draft narrative with AI
          </Button>
        )}
        {exportable && (
          <Button
            variant="secondary"
            onClick={() => void openReport(mintDownload.mutateAsync, 'redbook', `/reports/${dealId}/redbook.pdf`, dealId)}
          >
            Download PDF
          </Button>
        )}
        {exportable && <ShareLinks dealId={dealId} kind="redbook" />}
        {exportable && (
        <Button onClick={() => window.print()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a1 1 0 0 1-1 1h-2M6 14h12v7H6z" /></svg>
          Print / Save PDF
        </Button>
        )}
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="light min-h-screen bg-frame">
        <style>{PRINT_CSS}</style>
        {toolbar}
        <div className="mt-16 flex justify-center"><Spinner /></div>
      </div>
    );
  }

  if (!appr || !R || !input) {
    return (
      <div className="light min-h-screen bg-frame">
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
  const mv = reportedMarketValue(R.gdv); // Market Value — appraisal GDV, to the nearest £1,000
  const compApproach = hasComps && nia > 0 ? toNearestThousand(summary.supportedPsf * nia) : mv;
  const drcApproach = toNearestThousand(R.landGross + R.build + R.fees + R.cont); // land + build components from the engine
  /**
   * Investment cross-check, run THROUGH THE ENGINE.
   *
   * This used to capitalise inline — a fourth place money maths lived, with its
   * own purchaser's-costs handling. It now builds the basis and calls
   * capitaliseIncome, so the deductions, the years-purchase and the costs
   * convention are the ones the appraisal itself used.
   *
   * The basis is the WHOLE property let at the analysed net rate: this panel
   * compares whole-property values, while a rent roll usually covers only the
   * held part. Without a rent roll it falls back to the 4.2% net-yield
   * convention applied to the reported Market Value.
   */
  const inv = R.income;
  const invYieldPct = input.income?.yieldPct ?? 4.2;
  const investmentBasis: IncomeInput = {
    lines: [
      {
        label: 'Whole property',
        count: 1,
        area: nia,
        /**
         * With no rental evidence the rent is implied from Market Value at the
         * SAME yield the capitalisation below uses. This was hardcoded to 4.2%
         * while the capitalisation used the firm's own figure — so on any
         * instruction with a different yield the cross-check derived rent at one
         * rate and capitalised it at another, and then reported the disagreement
         * it had manufactured as evidence about the valuation.
         */
        rentPsf:
          inv && inv.totalArea > 0 && nia > 0
            ? inv.netRent / inv.totalArea
            : nia > 0
              ? (mv * (invYieldPct / 100)) / nia
              : 0,
      },
    ],
    // the rate above is already NET, so no further deductions are taken
    nonRecoverablePct: 0,
    yieldPct: invYieldPct,
    purchaserCostsPct: input.income?.purchaserCostsPct ?? DEFAULT_PURCHASER_COSTS_PCT,
  };
  const invCap = capitaliseIncome(investmentBasis);
  const rentPcm = Math.round(invCap.netRent / 12 / 25) * 25;
  /**
   * With a DCF on the appraisal the cross-check becomes growth-explicit and
   * reports the equated yield — the rate at which the two methods agree.
   */
  const invDcf = input.dcf ? discountedCashflow(investmentBasis, input.dcf) : null;
  const invApproach = toNearestThousand(invDcf ? invDcf.netPresentValue : invCap.netCapitalValue);
  const reinstatement = Math.round((R.build + R.fees) / 5000) * 5000;
  /**
   * The range and the grade are claims about the evidence, so they come from
   * the evidence or they are not made. `valuationConfidence` returns nulls
   * where there is nothing to grade, and every panel below prints its `note`
   * instead of a figure it cannot support.
   */
  const { range, marker, confidence, note: confidenceNote } = valuationConfidence({
    marketValue: mv,
    compRange: hasComps ? summary.range : null,
    netInternalArea: nia,
    avgGrossAdjustment: hasComps ? summary.avgGrossAdjustment : 0,
    compCount: comps.length,
  });
  const confidenceTone = confidence === 'High'
    ? statusTokens.green.text
    : confidence === 'Low'
      ? statusTokens.red.text
      : confidence === 'Medium'
        ? statusTokens.amber.text
        : neutral.ink3;
  const psf = analysedPsf(mv, nia);
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

  /**
   * Weights follow the scheme. A held-and-let element carrying most of the GDV
   * cannot sensibly be a 10% afterthought, and a pure sales scheme should not
   * pretend the investment method matters. They always total 100.
   */
  const incomeShare = R.gdv > 0 ? R.investmentValue / R.gdv : 0;
  const investmentWeight = Math.round(10 + incomeShare * 45);
  const drcWeight = 20 - Math.round(incomeShare * 10);
  const comparableWeight = 100 - investmentWeight - drcWeight;
  const approaches = [
    { name: 'Comparable', value: compApproach, note: hasComps ? `${comps.length} adjusted comparable${comps.length === 1 ? '' : 's'}` : 'No comparables logged', weight: comparableWeight, dot: brand[700] },
    { name: 'DRC', value: drcApproach, note: 'Land + depreciated build', weight: drcWeight, dot: brand[400] },
    {
      name: 'Investment',
      value: invApproach,
      note: invDcf
        ? `DCF at ${input.dcf!.rentalGrowthPct}% growth · equated ${formatPct(invDcf.equatedYield, 2)}`
        : inv
          ? `Rent roll ${formatMoneyFull(inv.netRent)} pa net @ ${invYieldPct}%`
          : 'Net rent × YP (4.2%)',
      weight: investmentWeight,
      dot: neutral.ink3,
    },
  ];

  return (
    <div className="light min-h-screen bg-frame">
      <style>{PRINT_CSS}</style>
      {toolbar}

      <div className="a4-canvas flex flex-col items-center gap-7 px-5 pt-7 pb-14">
        {/* ============ PAGE 1 — COVER ============ */}
        <A4Page pad={false}>
          <div className="relative overflow-hidden text-white" style={{ background: `linear-gradient(155deg,${brand[600]} 0%,${brand[700]} 55%,${brand[800]} 100%)`, padding: '64px 64px 56px' }}>
            <div className="absolute rounded-full" style={{ top: -60, right: -50, width: 240, height: 240, background: 'rgba(255,255,255,0.06)' }} />
            <div className="absolute rounded-full" style={{ bottom: -90, left: -40, width: 200, height: 200, background: 'rgba(255,255,255,0.05)' }} />
            <div className="relative flex items-center gap-3">
              <FirmMark logoUrl={org?.logoUrl} size={38} alt={`${org?.name ?? 'Firm'} logo`} />
              <span className="text-[20px] font-bold tracking-[-0.3px]">{org?.name ?? 'Apex Appraise'}</span>
              {ricsFirmNumber ? (
                <span className="ml-auto fig text-[11px] font-medium uppercase" style={{ letterSpacing: '1px', color: 'rgba(255,255,255,0.7)' }}>
                  RICS Regulated · {ricsFirmNumber}
                </span>
              ) : null}
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
                <div className="mt-1.5 text-[14px] font-semibold">{client.name}</div>
                <div className="text-[12.5px] text-ink-2">{client.sub}</div>
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Purpose of valuation</div>
                <div className="mt-1.5 text-[14px] font-semibold">{purpose.name}</div>
                {purpose.sub && <div className="text-[12.5px] text-ink-2">{purpose.sub}</div>}
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Inspection date</div>
                {dates.inspection ? (
                  <div className="mt-1.5 text-[14px] font-semibold">{dates.inspection}</div>
                ) : (
                  /* the same rule as the valuer's name and the photographs: state
                     the gap rather than fill it, because a reader relies on this */
                  <div className="mt-1.5 text-[12.5px] leading-[1.45] text-ink-2">
                    No inspection is recorded for this property. This valuation is made without
                    inspection and on the assumptions stated.
                  </div>
                )}
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Valuation date</div>
                <div className="mt-1.5 text-[14px] font-semibold">{dates.valuation}</div>
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Valuer</div>
                {valuer.named ? (
                  <>
                    <div className="mt-1.5 text-[14px] font-semibold">{valuer.name}</div>
                    {valuer.reg && <div className="text-[12.5px] text-ink-2">{valuer.reg}</div>}
                  </>
                ) : (
                  <div className="mt-1.5 text-[12.5px] text-ink-2">Not named in the terms of engagement</div>
                )}
              </div>
              <div>
                <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Reference</div>
                <div className="fig mt-1.5 text-[14px] font-semibold">{refCode}</div>
              </div>
              {check && (
                <div className="col-span-2" data-approval-check={check.tone}>
                  <div className="fig text-[10px] font-medium uppercase text-ink-3" style={{ letterSpacing: '0.8px' }}>Approved figures</div>
                  <div
                    className="mt-1.5 text-[12.5px] leading-[1.45]"
                    style={{ color: check.tone === 'drift' ? statusTokens.red.text : check.tone === 'unverified' ? statusTokens.amber.text : neutral.ink2 }}
                  >
                    {check.text}
                  </div>
                </div>
              )}
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
              <div className="flex-1 fig text-[14px] font-medium" style={{ padding: '15px 18px' }}>
                {range ? `${formatMoneyFull(range.lo)} – ${formatMoneyFull(range.hi)}` : 'Not assessed — no comparable evidence'}
              </div>
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
            <div className="text-[12.5px] leading-[1.55]" style={{ color: 'rgb(var(--ink-green-deep, 30 92 69))' }}>
              Opinion of value supported by {hasComps ? `${comps.length} recent comparable ${comps.length === 1 ? 'sale' : 'sales'}, with average net adjustment of ${formatPct(Math.abs(avgNetAdj) / 100)}` : 'the current development appraisal pending comparable evidence'}.
              {confidenceNote}
            </div>
          </div>

          <PageFoot>Page {pageNo.certificate} of {pageTotal} · This certificate must be read in conjunction with the assumptions and conditions set out on page {pageNo.declaration}.</PageFoot>
        </A4Page>

        {/* ============ PAGE 3 — PROPERTY & LOCATION ============ */}
        <A4Page>
          <PageHead title="Property & location" right="Section 1–2" />

          {/**
           * Photographs of the subject, with their own captions. Where none have
           * been taken the report SAYS so — a valuation that appears to carry a
           * photographic record it does not have misstates the inspection, and a
           * reader has no way to tell from a captioned rectangle.
           */}
          {(() => {
            const withFile = (sitePhotos ?? []).filter((ph) => ph.url).slice(0, 3);
            if (withFile.length === 0) {
              return (
                <div
                  className="mt-5 rounded-[12px] border border-dashed border-border-std flex items-center justify-center text-center"
                  style={{ height: 96 }}
                >
                  <span className="text-[11.5px] text-ink-3">
                    No inspection photographs are held on file for this property.
                  </span>
                </div>
              );
            }
            const cols = withFile.length === 1 ? '1fr' : withFile.length === 2 ? '2fr 1fr' : '2fr 1fr 1fr';
            return (
              <div className="mt-5 grid gap-2.5" style={{ gridTemplateColumns: cols, height: 208 }}>
                {withFile.map((ph) => (
                  <div key={ph.id} className="rounded-[12px] relative overflow-hidden">
                    <img src={ph.url} alt={ph.caption} style={{ height: '100%', width: '100%', objectFit: 'cover', display: 'block' }} />
                    <div
                      className="absolute fig text-[10px] font-medium text-white rounded-[7px]"
                      style={{ left: 12, bottom: 12, padding: '4px 9px', background: 'rgba(12,18,14,0.5)' }}
                    >
                      {ph.caption}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

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
              {situationStatement({ address: deal?.address ?? null, inspectedOn: dates.inspection })}
            </div>
            <div className="shrink-0 rounded-[12px] overflow-hidden border border-border-strong relative" style={{ width: 300, height: 188, background: neutral.sunken2 }}>
              {subjectPin.length ? (
                <SiteMap pins={subjectPin} height={188} />
              ) : (
                /* Nothing plotted rather than a map of somewhere else: without a
                   resolved postcode there is no position to draw, and a panel
                   saying so is what the certificate can stand behind. */
                <div className="w-full h-full flex items-center justify-center text-center text-[11.5px] leading-[1.5]" style={{ padding: '0 22px', color: '#5F625F' }}>
                  {located?.status === 'no-postcode'
                    ? 'No postcode on this deal, so the site is not plotted.'
                    : located?.status === 'bad-postcode'
                      ? `“${located.postcode}” is not a recognised UK postcode, so the site is not plotted.`
                      : 'The postcode lookup is unavailable, so the site is not plotted.'}
                </div>
              )}
              <div className="absolute fig text-[9.5px] font-medium rounded-[7px] pointer-events-none" style={{ bottom: 10, left: 10, zIndex: 500, padding: '4px 9px', background: 'rgba(255,255,255,0.92)', color: brand[700] }}>
                {deal?.address}
              </div>
            </div>
          </div>

          <PageFoot>Page {pageNo.property} of {pageTotal} · {firmName} · {subject}</PageFoot>
        </A4Page>

        {/* ============ PAGE 4 — METHODOLOGY & RECONCILIATION ============ */}
        <A4Page>
          <PageHead title="Valuation methodology" right="Section 3" />

          <div className="text-[13px] leading-[1.62]" style={{ marginTop: 18, color: '#2C342E' }}>
            Primary reliance has been placed on the <b className="font-semibold">comparable method</b>, being the most reliable evidence
            of value for property of this class.{' '}
            {investmentWeight >= 30 ? (
              <>
                A substantial part of the scheme is held and let, so the <b className="font-semibold">investment method</b> is
                afforded material weight alongside it; depreciated replacement cost is a cross-check only.
              </>
            ) : (
              <>The depreciated replacement cost and investment methods have been prepared as cross-checks and are afforded limited weight.</>
            )}
            {invDcf && (
              <>
                {' '}The investment figure values the WHOLE property at the analysed net rate, so that it compares like for like
                with the other approaches, and is stated on a growth-explicit basis — {input.dcf!.rentalGrowthPct}% rental growth
                over {input.dcf!.holdYears} years, discounted at {input.dcf!.discountRatePct}% — implying an equated yield of{' '}
                <b className="font-semibold">{formatPct(invDcf.equatedYield, 2)}</b> against an all-risks yield of {invYieldPct}%.
                The appraisal report states the same cross-check on the let element alone, so its equated yield differs.
              </>
            )}
          </div>

          <div className="mt-5 grid grid-cols-3 gap-3">
            {approaches.map((a) => (
              <div key={a.name} className="border border-border-strong rounded-[13px] p-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-[2px] inline-block" style={{ background: a.dot }} />
                  <span className="text-[12.5px] font-semibold">{a.name}</span>
                </div>
                <div className="fig mt-2.5 text-[20px] font-semibold" style={{ letterSpacing: '-0.8px' }}>{formatMoneyFull(a.value)}</div>
                <div className="mt-2 text-[11px]" style={{ color: 'rgb(var(--ink-3))' }}>{a.note}</div>
                <div className="mt-2.5 h-[5px] rounded-[3px] overflow-hidden" style={{ background: neutral.sunken2 }}>
                  <div className="h-full" style={{ width: `${a.weight}%`, background: a.dot }} />
                </div>
                <div className="fig mt-1.5 text-[10.5px] font-medium text-ink-2">Weight {a.weight}%</div>
              </div>
            ))}
          </div>

          {/*
            * The Market Value statement — a conclusion, not a blend.
            *
            * This was headed "Reconciled Market Value" above three approach
            * cards each printing a "Weight N%". That invites a reader to do the
            * sum, and on the seeded scheme the sum does not come out:
            *
            *   Comparable  £14,925,000 × 70%  = 10,447,500
            *   DRC         £10,847,000 × 20%  =  2,169,400
            *   Investment  £13,975,000 × 10%  =  1,397,500
            *                                    ——————————
            *   the blend the heading implies     14,014,400
            *   the figure stated beneath it      14,925,000
            *
            * £910,600 apart, under a valuer's signature. The weights are real
            * and deliberate — they follow the scheme rather than sitting at a
            * fixed 70/20/10, and a spec holds them to that — but they express
            * EMPHASIS, which is what the prose above already says: primary
            * reliance on the comparable method, the others "prepared as
            * cross-checks and afforded limited weight". They are not a formula.
            *
            * The Market Value is `reportedMarketValue(R.gdv)`, the derivation
            * `one-engine-sweep` owns so that one answer serves every surface. It
            * is not a blend and must not become one. So the word claiming an
            * arithmetic nobody performed is what goes.
            */}
          <div className="mt-5 border border-border-strong rounded-[14px] bg-sunken p-5">
            <div className="flex items-end justify-between">
              <div>
                <div className="fig text-[10px] font-medium uppercase text-inactive" style={{ letterSpacing: '0.8px' }}>Market Value</div>
                <div className="fig mt-1.5 text-[32px] font-semibold" style={{ letterSpacing: '-1.5px', color: brand[700] }}>{formatMoneyFull(mv)}</div>
                <div className="mt-1 text-[12px] text-ink-2">{poundsInWords(mv)}</div>
              </div>
              <div className="text-right">
                <div className="fig text-[10px] font-medium uppercase text-inactive" style={{ letterSpacing: '0.6px' }}>Analysed rate</div>
                <div className="fig mt-1 text-[15px] font-semibold">£{n0(psf)} / sq ft</div>
              </div>
            </div>
            {range && marker !== null ? (
              <>
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
              </>
            ) : (
              /* No bar where there is no range: a scale drawn around a single
                 opinion reads as a spread of evidence that does not exist. */
              <div className="mt-3 text-[11.5px] leading-[1.55] text-ink-3">{confidenceNote}</div>
            )}
          </div>

          {/* Drafted commentary moves to its own page — three narrative sections do
              not fit under the reconciliation without spilling the sheet. */}
          {!narrative && (
            <>
              <Micro>Market commentary</Micro>
              <Body>
                The local market for property of this class and price band remains active, with good demand and limited supply of directly
                comparable stock. Transaction volumes are stable and marketing periods for well-presented properties are typically six to
                eight weeks. No material valuation uncertainty is reported.
              </Body>
            </>
          )}

          <PageFoot>Page {pageNo.methodology} of {pageTotal} · {firmName} · Reference {refCode}</PageFoot>
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
            <div className="flex items-center border-b border-border-std fig text-[12px] font-medium" style={{ background: 'rgb(var(--tint-green-soft, 243 248 245))' }}>
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
              <div className="mt-1.5 text-[17px] font-semibold" style={{ color: confidenceTone }}>{confidence ?? '—'}</div>
            </div>
          </div>

          {/*
            * Printed only where comparables exist, and no longer claiming a
            * verification nothing records.
            *
            * The paragraph was unconditional, so two inches under "No comparable
            * evidence logged for this deal yet" the same page said "Comparables
            * have been adjusted for differences in size, condition, location and
            * date of sale" — describing work done on evidence it had just said
            * did not exist.
            *
            * Its last sentence was worse, and wrong even WITH comparables: "All
            * evidence is drawn from open-market arm's-length transactions
            * verified against HM Land Registry sold-price records and local
            * agency confirmation." `Comparable` has no field that could ever
            * make that true — address, meta, basePsf and four adjustment
            * percentages, nothing about where the evidence came from or who
            * checked it. A comparable typed by hand and one imported by
            * `sitepack.applyComps` are indistinguishable to this report, and it
            * asserted Land Registry verification over both. Same shape as the
            * RICS mark before `Organisation.ricsFirmNumber` existed: a claim the
            * record cannot support, printed identically whether it is true.
            *
            * It also contradicted the valuer's own words. The terms of
            * engagement carry `sourcesOfInformation`, which the valuer writes and
            * which says by default that information "is relied upon as accurate
            * and is not independently verified". The report never printed that
            * and printed this instead.
            *
            * What survives is what the record does hold: the four adjustments
            * ARE stored per comparable, and each one's provenance is already in
            * the Evidence column beside it — so the reader is pointed there
            * rather than given a summary nothing backs.
            */}
          {hasComps && (
            <>
              <Micro>Basis of adjustment</Micro>
              <Body>
                Comparables have been adjusted for differences in size, condition, location and date of sale, with the net adjustment
                applied to each comparable's analysed rate per square foot. Less-adjusted evidence is afforded greater weight in deriving
                the supported rate. The source of each comparable is stated against it in the Evidence column above; the nature and
                source of all information relied on is set out in the terms of engagement.
              </Body>
            </>
          )}

          <PageFoot>Page {pageNo.comparables} of {pageTotal} · Comparable schedule</PageFoot>
        </A4Page>

        {/* ====== PAGE — DRAFTED COMMENTARY (only when a narrative exists) ====== */}
        {narrative && (
          <A4Page>
            <PageHead title="Valuation commentary" right="Section 5" />

            <Micro mt={20}>Valuation rationale{modelDrafted && <AiDraftNote />}</Micro>
            <Body>{narrative.valuationRationale}</Body>

            <Micro>Market commentary{modelDrafted && <AiDraftNote />}</Micro>
            <Body>{narrative.marketCommentary}</Body>

            <Micro>Risk commentary{modelDrafted && <AiDraftNote />}</Micro>
            <Body>{narrative.riskCommentary}</Body>

            <PageFoot>
              Page {pageNo.commentary} of {pageTotal} ·{' '}
              {modelDrafted ? (
                <>
                  Commentary drafted with AI assistance and reviewed by the valuer — see the AI-use disclosure on page{' '}
                  {pageNo.declaration}.
                </>
              ) : (
                <>Commentary prepared from the appraisal figures and reviewed by the valuer.</>
              )}
            </PageFoot>
          </A4Page>
        )}

        {/* ============ FINAL PAGE — ASSUMPTIONS & DECLARATION ============ */}
        <A4Page>
          <PageHead title="Assumptions & declaration" right={narrative ? 'Section 6–7' : 'Section 5–6'} />

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

          {/* RICS professional standards require the valuer to state whether and how
              AI was used — derived from the audit trail, never hand-declared. */}
          <Micro mt={20}>Use of artificial intelligence</Micro>
          <div className="mt-2.5 text-[12.5px] leading-[1.55]" style={{ color: '#2C342E' }}>
            {ai?.used ? (
              <>
                <div>
                  Artificial intelligence was used in preparing this valuation, as follows
                  {namedModel(ai.model)}:
                </div>
                <div className="mt-1.5 flex flex-col gap-1">
                  {ai.items.map((t) => (
                    <div key={t.key} className="flex gap-2.5">
                      <span className="shrink-0 font-semibold" style={{ color: brand[700] }}>·</span>
                      <span>
                        <b className="font-semibold">{t.label}</b> — {t.purpose}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-1.5">{ai.statement}</div>
                {ai.firmPolicy && <div className="mt-1.5">{ai.firmPolicy}</div>}
              </>
            ) : (
              <>
                {ai?.statement ?? 'No artificial intelligence was used in the preparation of this valuation.'}
                {ai?.firmPolicy ? <div className="mt-1.5">{ai.firmPolicy}</div> : null}
              </>
            )}
          </div>

          <Micro mt={20}>Conditions &amp; scope</Micro>
          <div className="mt-2.5 text-[12.5px] leading-[1.55]" style={{ color: '#2C342E' }}>
            This report is prepared for the stated client and purpose only and may not be relied upon by any third party. It is not a
            building survey and does not constitute advice on structural condition.{' '}
            {toe?.status === 'ACCEPTED' && toe.acceptedAt ? (
              <>
                It is issued under the terms of engagement accepted by {toe.acceptedBy} on {fmtLong(new Date(toe.acceptedAt))}, on a{' '}
                {toe.basisOfValue} basis, and liability is limited in accordance with those terms.
              </>
            ) : toe?.status === 'ISSUED' && toe.issuedAt ? (
              <>
                It is issued under the terms of engagement dated {fmtLong(new Date(toe.issuedAt))}, which remain to be accepted in
                writing, and liability is limited in accordance with those terms.
              </>
            ) : (
              <>Liability is limited in accordance with the agreed terms of engagement.</>
            )}{' '}
            The valuer has no conflict of interest and acts as an external valuer under the RICS Red Book.
          </div>

          <div className="mt-7 border-t border-border-std pt-6 flex justify-between items-end">
            <div>
              <div style={{ width: 188, height: 48, borderBottom: `1.5px solid ${neutral.crumb}` }} />
              {valuer.named ? (
                <>
                  <div className="mt-2.5 text-[14px] font-semibold">{valuer.name}</div>
                  {valuer.reg && <div className="text-[12px] text-ink-2">{valuer.reg}</div>}
                  <div className="text-[12px] text-ink-2">For and on behalf of {firmName}</div>
                  {dates.signedOff ? (
                    <>
                      <div className="fig mt-1.5 text-[11.5px] font-medium text-inactive">Date: {dates.report}</div>
                      {check && (
                        <div
                          className="mt-1 text-[10.5px] leading-[1.4]"
                          style={{ maxWidth: 320, color: check.tone === 'drift' ? statusTokens.red.text : check.tone === 'unverified' ? statusTokens.amber.text : neutral.ink3 }}
                        >
                          {check.text}
                        </div>
                      )}
                    </>
                  ) : (
                    /* the unnamed branch below already refuses to print "a date
                       pretending it was signed"; a version nobody approved is
                       the same claim with a name on it */
                    <div className="mt-1.5 text-[11.5px] leading-[1.45] text-ink-2">
                      Prepared {dates.report}. This version has not been approved for issue.
                    </div>
                  )}
                </>
              ) : (
                /* no name, no registration number, and no date pretending it was signed */
                <div className="mt-2.5 text-[12px] leading-[1.5] text-ink-2" style={{ maxWidth: 300 }}>
                  This report is unsigned. Name the valuer and their RICS registration number in the terms of engagement before it is issued.
                </div>
              )}
            </div>
            {/* A seal is the strongest form the claim takes on this document, so
                it appears only where the firm has declared the number it rests on. */}
            {ricsFirmNumber ? (
              <div className="w-[88px] h-[88px] rounded-full flex flex-col items-center justify-center" style={{ border: `2px solid ${brand[700]}`, color: brand[700] }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={brand[700]} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2l2.6 7.2L22 9.6l-5.8 4.6L18 22l-6-4.2L6 22l1.8-7.8L2 9.6l7.4-.4L12 2Z" />
                </svg>
                <span className="fig mt-1 text-[7.5px] font-semibold text-center" style={{ letterSpacing: '0.5px' }}>RICS<br />REGULATED</span>
                <span className="fig text-[7px] font-medium text-center" style={{ letterSpacing: '0.3px' }}>{ricsFirmNumber}</span>
              </div>
            ) : null}
          </div>

          <PageFoot>Page {pageNo.declaration} of {pageTotal} · © {firmName} · This report remains the property of {firmName} until fees are settled in full.</PageFoot>
        </A4Page>
      </div>
    </div>
  );
}
