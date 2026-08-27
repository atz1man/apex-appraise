import { type ReactNode } from 'react';
import { brand, neutral } from '@apex/ui-tokens';
import { formatMoneyFull } from '@apex/appraisal-engine';
import { FirmMark } from './ui';
import { A4Page as PaperPage, PRINT_CSS, docDate } from './paper';

/**
 * The client-facing terms of engagement (RICS VPS 1), laid out for A4. Shared by
 * the internal preview and the public signing page so the client signs exactly
 * the document the valuer previewed — one layout, no second copy to drift.
 */

export interface TermsDocumentProps {
  t: {
    orgName: string;
    status: string;
    clientName: string;
    clientAddress: string;
    otherUsers: string;
    purpose: string;
    interest: string;
    basisOfValue: string;
    valuationDate: string | Date | null;
    extentOfInvestigation: string;
    sourcesOfInformation: string;
    assumptions: string;
    specialAssumptions: string;
    reportFormat: string;
    restrictionsOnUse: string;
    feeBasis: string;
    liabilityCap: number | null;
    complaintsProcedure: string;
    aiUse: string;
    valuerName: string;
    valuerReg: string;
    orgLogoUrl?: string | null;
    /**
     * The firm's RICS Regulated Firm number, or empty where it holds none.
     * "RICS Regulated" used to be a literal here, printed for every firm on the
     * platform — a claim about a real organisation's regulatory standing, on a
     * document the client signs.
     */
    orgRicsFirmNumber?: string | null;
    issuedAt: string | Date | null;
    acceptedAt: string | Date | null;
    acceptedBy: string | null;
    signedName?: string | null;
    signedAt?: string | Date | null;
  };
  subject: string;
  address: string;
  postcode?: string;
  refCode: string;
}

export const TERMS_PRINT_CSS = `
@page { size: A4; margin: 0; }
@media print {
  body { background: #fff !important; }
  .no-print { display: none !important; }
  .a4-canvas { padding: 0 !important; gap: 0 !important; background: #fff !important; }
  .a4-page { box-shadow: none !important; margin: 0 !important; border-radius: 0 !important; page-break-after: always; break-after: page; }
  /* the final forced break would otherwise emit a trailing blank sheet */
  .a4-page:last-child { page-break-after: auto !important; break-after: auto !important; }
}
`;

/**
 * Every date this document prints is in the firm's time — see paper.tsx.
 *
 * This one was measured: a valuation date the valuer typed as 30 June 2026
 * rendered as 29 June 2026 to a client opening the signing link from New York.
 * The signing link is deliberately public and deliberately for someone outside
 * the firm, so that reader is the ordinary case here.
 */
const fmtLong = docDate;

/** the engagement letter sets its own margins — see components/paper.tsx */
const A4Page = ({ children }: { children: ReactNode }) => <PaperPage padding="54px 64px">{children}</PaperPage>;

function Clause({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div className="flex gap-2.5">
        <span className="fig text-[12px] font-semibold shrink-0" style={{ color: brand[700], width: 22 }}>{n}</span>
        <span className="fig text-[12px] font-semibold uppercase" style={{ letterSpacing: '0.6px', color: neutral.inactive }}>{title}</span>
      </div>
      <div className="text-[12.5px] leading-[1.55]" style={{ marginTop: 6, marginLeft: 22, color: '#2C342E' }}>{children}</div>
    </div>
  );
}


/**
 * Pagination for a document whose length is decided by the FIRM.
 *
 * Every clause below is house style out of Settings, capped between 600 and 2000
 * characters each. A firm that fills the form in produces roughly fourteen
 * thousand characters, which is not three pages of anything — and the document
 * used to be three hand-placed sheets with "Page 1 of 3" written into them. With
 * a real house style it printed SIX sheets while claiming three, splitting
 * clauses wherever the paper happened to run out. On a document a client signs.
 *
 * Heights are estimated from character count because the text is arbitrary. The
 * constants are measured, not guessed: nine thousand characters of clause body
 * rendered 1730px, which is 0.192px per character — a hundred characters to a
 * line at 19.5px per line.
 */
const PAGE_BUDGET_PX = 924;
const CHARS_PER_LINE = 100;
const LINE_PX = 19.5;
const CLAUSE_HEAD_PX = 28;
const CLAUSE_GAP_PX = 18;

interface ClauseSpec {
  n: string;
  title: string;
  /** what actually renders */
  body: ReactNode;
  /** plain text, for estimating how much room it needs */
  text: string;
}

const clauseHeight = (c: ClauseSpec) =>
  CLAUSE_HEAD_PX + CLAUSE_GAP_PX + Math.max(1, Math.ceil(c.text.length / CHARS_PER_LINE)) * LINE_PX;

/**
 * Pack clauses into sheets. `firstBudget` is smaller on a sheet that also carries
 * the letterhead and the opening paragraph, or a section heading.
 *
 * A clause is never split across sheets. Splitting one would put a client's
 * signature under half an obligation, and no reader can tell whether the rest was
 * meant to be there.
 */
function packClauses(clauses: ClauseSpec[], firstBudget: number, laterBudget: number): ClauseSpec[][] {
  const pages: ClauseSpec[][] = [[]];
  let used = 0;
  let budget = firstBudget;
  for (const c of clauses) {
    const h = clauseHeight(c);
    if (used + h > budget && pages[pages.length - 1]!.length > 0) {
      pages.push([]);
      used = 0;
      budget = laterBudget;
    }
    pages[pages.length - 1]!.push(c);
    used += h;
  }
  return pages;
}

export function TermsDocument({ t, subject, address, postcode, refCode: ref }: TermsDocumentProps) {
  const issued = t.issuedAt ? fmtLong(t.issuedAt) : null;
  const deal = { name: subject, address, postcode };
  const where = `${subject}${deal.address ? `, ${deal.address}` : ''}`;

  /**
   * The clauses as DATA, so they can be measured and placed. They used to be
   * literal JSX on three fixed sheets, which is why a firm's own house style
   * overflowed them silently.
   */
  const opening: ClauseSpec[] = [
    {
      n: '1',
      title: 'Client',
      text: `${t.clientName ?? ''} ${t.clientAddress ?? ''}`,
      body: (
        <>
          {t.clientName || '—'}
          {t.clientAddress ? <span className="text-ink-2">{` · ${t.clientAddress}`}</span> : null}
        </>
      ),
    },
    {
      n: '2',
      title: 'Valuer',
      text: `${t.valuerName}, ${t.valuerReg}, acting as an external valuer for and on behalf of ${t.orgName}. The valuer has the knowledge, skills and understanding to undertake this instruction competently, and has disclosed no conflict of interest.`,
      body: (
        <>
          {t.valuerName}, {t.valuerReg}, acting as an external valuer for and on behalf of {t.orgName}. The valuer has the
          knowledge, skills and understanding to undertake this instruction competently, and has disclosed no conflict of
          interest.
        </>
      ),
    },
    { n: '3', title: 'Other intended users', text: t.otherUsers ?? '', body: t.otherUsers },
    {
      n: '4',
      title: 'The asset to be valued',
      text: `${where}${deal.postcode ? ` ${deal.postcode}` : ''}. Interest: ${t.interest ?? ''}`,
      body: (
        <>
          {where}
          {deal.postcode ? ` ${deal.postcode}` : ''}. Interest: {t.interest}
        </>
      ),
    },
    { n: '5', title: 'Purpose of the valuation', text: t.purpose ?? '', body: t.purpose },
    {
      n: '6',
      title: 'Basis of value',
      text: `${t.basisOfValue}, as defined in RICS Valuation – Global Standards.`,
      body: (
        <>
          <b className="font-semibold">{t.basisOfValue}</b>, as defined in RICS Valuation – Global Standards.
        </>
      ),
    },
    {
      n: '7',
      title: 'Valuation date',
      text: t.valuationDate ? fmtLong(t.valuationDate) : 'The date of the report, unless otherwise agreed in writing.',
      body: t.valuationDate ? fmtLong(t.valuationDate) : 'The date of the report, unless otherwise agreed in writing.',
    },
  ];

  const scope: ClauseSpec[] = [
    { n: '8', title: 'Extent of investigation', text: t.extentOfInvestigation ?? '', body: t.extentOfInvestigation },
    { n: '9', title: 'Nature and source of information', text: t.sourcesOfInformation ?? '', body: t.sourcesOfInformation },
    { n: '10', title: 'Assumptions', text: t.assumptions ?? '', body: t.assumptions },
    { n: '11', title: 'Special assumptions', text: t.specialAssumptions ?? '', body: t.specialAssumptions },
    { n: '12', title: 'Format of the report', text: t.reportFormat ?? '', body: t.reportFormat },
  ];

  const liability = t.liabilityCap
    ? `The firm's aggregate liability arising out of this instruction is limited to ${formatMoneyFull(t.liabilityCap)}.`
    : 'No cap on liability has been agreed; liability is governed by the firm\u2019s standard terms of business.';

  const terms: ClauseSpec[] = [
    { n: '13', title: 'Restrictions on use and publication', text: t.restrictionsOnUse ?? '', body: t.restrictionsOnUse },
    { n: '14', title: 'Use of artificial intelligence', text: t.aiUse ?? '', body: t.aiUse },
    { n: '15', title: 'Fees', text: t.feeBasis ?? '', body: t.feeBasis },
    { n: '16', title: 'Limitation of liability', text: liability, body: liability },
    { n: '17', title: 'Complaints', text: t.complaintsProcedure ?? '', body: t.complaintsProcedure },
  ];

  // letterhead + title + opening paragraph on sheet one; a section heading on the
  // first sheet of each later section; the signature block reserved at the end
  const openingPages = packClauses(opening, PAGE_BUDGET_PX - 300, PAGE_BUDGET_PX);
  const scopePages = packClauses(scope, PAGE_BUDGET_PX - 60, PAGE_BUDGET_PX);
  const termsPages = packClauses(terms, PAGE_BUDGET_PX - 60 - 260, PAGE_BUDGET_PX - 260);

  const sheets = [
    ...openingPages.map((cs, i) => ({ kind: 'opening' as const, clauses: cs, first: i === 0 })),
    ...scopePages.map((cs, i) => ({ kind: 'scope' as const, clauses: cs, first: i === 0 })),
    ...termsPages.map((cs, i) => ({ kind: 'terms' as const, clauses: cs, first: i === 0, last: i === termsPages.length - 1 })),
  ];
  const total = sheets.length;

  return (
      <div className="a4-canvas flex flex-col items-center gap-7 px-5 pt-7 pb-14">
        {sheets.map((sheet, i) => (
          <A4Page key={i}>
            {sheet.kind === 'opening' && sheet.first ? (
              <>
                <div className="flex items-center gap-3 border-b border-border-std pb-4">
                  <FirmMark logoUrl={t.orgLogoUrl} size={30} alt={`${t.orgName} logo`} />
                  <span className="text-[17px] font-bold tracking-[-0.3px]">{t.orgName}</span>
                  {t.orgRicsFirmNumber?.trim() ? (
                    <span className="fig ml-auto text-[10.5px] font-medium uppercase text-ink-3" style={{ letterSpacing: '1px' }}>
                      RICS Regulated · {t.orgRicsFirmNumber.trim()}
                    </span>
                  ) : null}
                </div>
                <div className="mt-6">
                  <div className="text-[22px] font-bold" style={{ letterSpacing: '-0.5px' }}>Terms of engagement</div>
                  <div className="mt-1 text-[12.5px] text-ink-2">Valuation of {where}</div>
                  <div className="fig mt-2 text-[11px] text-ink-3">
                    Reference {ref}
                    {issued ? ` · Issued ${issued}` : ' · Draft — not yet issued'}
                    {t.status === 'ACCEPTED' && t.acceptedAt ? ` · Accepted ${fmtLong(t.acceptedAt)}` : ''}
                  </div>
                </div>
                <div className="mt-5 text-[12.5px] leading-[1.55]" style={{ color: '#2C342E' }}>
                  These terms record what {t.orgName} has been instructed to do, on what basis, and on what commercial terms.
                  They are issued in accordance with RICS Valuation – Global Standards (VPS 1) and take effect on the client's
                  written acceptance. The valuation will not be reported until they are agreed.
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between border-b border-border-std pb-4">
                <div className="text-[16px] font-bold" style={{ letterSpacing: '-0.3px' }}>
                  {sheet.kind === 'scope' ? 'Scope of work' : sheet.kind === 'terms' ? 'Terms & acceptance' : 'Terms of engagement'}
                  {!sheet.first ? ' (continued)' : ''}
                </div>
                <div className="fig text-[11px] font-medium text-ink-3">{ref}</div>
              </div>
            )}

            {sheet.clauses.map((c) => (
              <Clause key={c.n} n={c.n} title={c.title}>
                {c.body}
              </Clause>
            ))}

            {sheet.kind === 'terms' && sheet.last && (
              <>
                <div className="mt-7 border-t border-border-std pt-5 flex justify-between gap-8">
                  <div className="flex-1">
                    <div className="fig text-[10px] font-medium uppercase text-inactive" style={{ letterSpacing: '0.6px' }}>For the firm</div>
                    <div style={{ height: 40, borderBottom: `1.5px solid ${neutral.crumb}`, marginTop: 14 }} />
                    <div className="mt-2 text-[12.5px] font-semibold">{t.valuerName}</div>
                    <div className="text-[11.5px] text-ink-2">{t.valuerReg}</div>
                    <div className="fig mt-1 text-[11px] text-ink-3">{issued ? `Issued ${issued}` : 'Date'}</div>
                  </div>
                  <div className="flex-1">
                    <div className="fig text-[10px] font-medium uppercase text-inactive" style={{ letterSpacing: '0.6px' }}>Accepted for the client</div>
                    <div className="flex items-end" style={{ height: 40, borderBottom: `1.5px solid ${neutral.crumb}`, marginTop: 14 }}>
                      {t.signedName && (
                        <span
                          className="text-[19px]"
                          style={{ fontFamily: '"Snell Roundhand", "Apple Chancery", "Segoe Script", cursive', color: brand[800], paddingBottom: 2 }}
                        >
                          {t.signedName}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 text-[12.5px] font-semibold">{t.acceptedBy ?? (t.clientName || '—')}</div>
                    <div className="text-[11.5px] text-ink-2">
                      {t.signedAt ? 'Signed electronically' : t.status === 'ACCEPTED' ? 'Accepted' : 'Signature'}
                    </div>
                    <div className="fig mt-1 text-[11px] text-ink-3">{t.acceptedAt ? fmtLong(t.acceptedAt) : 'Date'}</div>
                  </div>
                </div>
                {t.signedAt && (
                  <div className="mt-3 text-[10.5px] leading-snug" style={{ color: '#7A807A' }}>
                    Signed electronically by {t.signedName} on {fmtLong(t.signedAt)} via the secure link issued with these
                    terms. The firm holds the full signing record, including timestamp and originating address.
                  </div>
                )}
              </>
            )}

            <div className="mt-auto pt-6 text-[11px] text-ink-3">
              Page {i + 1} of {total} · {t.orgName}
              {sheet.kind === 'terms' && sheet.last ? ' · Issued under RICS Valuation – Global Standards (VPS 1)' : ` · ${ref}`}
            </div>
          </A4Page>
        ))}
      </div>
  );
}
