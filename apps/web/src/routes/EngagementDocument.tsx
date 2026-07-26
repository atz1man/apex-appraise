import { type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { brand, neutral } from '@apex/ui-tokens';
import { getToken, trpc } from '../lib/trpc';
import { formatMoneyFull } from '@apex/appraisal-engine';
import { BrandMark, Button, Spinner } from '../components/ui';

/**
 * The client-facing terms of engagement (RICS Red Book VPS 1), printed to A4 by
 * the same chromium renderer as the reports. Content comes from the engagement
 * record — this file only lays it out.
 */

const PRINT_CSS = `
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

const fmtLong = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function A4Page({ children }: { children: ReactNode }) {
  return (
    <div
      className="a4-page bg-surface flex flex-col overflow-hidden"
      style={{
        width: 794,
        // 1122, not 1123 — chromium prints A4 at 1122.5px (see docs/COMPLIANCE.md)
        minHeight: 1122,
        borderRadius: 3,
        boxShadow: '0 4px 24px rgba(20,30,25,0.12)',
        padding: '54px 64px',
      }}
    >
      {children}
    </div>
  );
}

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

export default function EngagementDocument() {
  const { dealId = '' } = useParams();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: t, isLoading } = trpc.engagement.get.useQuery(dealId, { enabled: !!dealId });

  if (isLoading || !t) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const subject = deal?.name ?? 'the property';
  const ref = `AP-${dealId.slice(0, 4).toUpperCase()}-TOE`;
  const issued = t.issuedAt ? fmtLong(t.issuedAt) : null;

  return (
    <div className="light min-h-screen bg-frame">
      <style>{PRINT_CSS}</style>

      <div className="no-print sticky top-0 z-40 h-[54px] bg-surface border-b border-border-strong flex items-center gap-3.5 px-5">
        <Link to={`/deal/${dealId}/engagement`} className="flex items-center gap-2 text-[13px] font-medium text-inactive hover:text-brand-700">
          ‹ Back to terms
        </Link>
        <span className="text-[13px] font-semibold">Terms of engagement</span>
        <span className="fig text-[11px] text-ink-3">{ref}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => window.open(`/api/reports/${dealId}/engagement.pdf?t=${getToken()}`, '_blank')}>
            Download PDF
          </Button>
          <Button onClick={() => window.print()}>Print / Save PDF</Button>
        </div>
      </div>

      <div className="a4-canvas flex flex-col items-center gap-7 px-5 pt-7 pb-14">
        <A4Page>
          <div className="flex items-center gap-3 border-b border-border-std pb-4">
            <BrandMark size={30} />
            <span className="text-[17px] font-bold tracking-[-0.3px]">{t.orgName}</span>
            <span className="fig ml-auto text-[10.5px] font-medium uppercase text-ink-3" style={{ letterSpacing: '1px' }}>
              RICS Regulated
            </span>
          </div>

          <div className="mt-6">
            <div className="text-[22px] font-bold" style={{ letterSpacing: '-0.5px' }}>Terms of engagement</div>
            <div className="mt-1 text-[12.5px] text-ink-2">
              Valuation of {subject}{deal?.address ? `, ${deal.address}` : ''}
            </div>
            <div className="fig mt-2 text-[11px] text-ink-3">
              Reference {ref}
              {issued ? ` · Issued ${issued}` : ' · Draft — not yet issued'}
              {t.status === 'ACCEPTED' && t.acceptedAt ? ` · Accepted ${fmtLong(t.acceptedAt)}` : ''}
            </div>
          </div>

          <div className="mt-5 text-[12.5px] leading-[1.55]" style={{ color: '#2C342E' }}>
            These terms record what {t.orgName} has been instructed to do, on what basis, and on what commercial terms. They
            are issued in accordance with RICS Valuation – Global Standards (VPS 1) and take effect on the client's written
            acceptance. The valuation will not be reported until they are agreed.
          </div>

          <Clause n="1" title="Client">
            {t.clientName || '—'}
            {t.clientAddress ? <span className="text-ink-2">{` · ${t.clientAddress}`}</span> : null}
          </Clause>
          <Clause n="2" title="Valuer">
            {t.valuerName}, {t.valuerReg}, acting as an external valuer for and on behalf of {t.orgName}. The valuer has the
            knowledge, skills and understanding to undertake this instruction competently, and has disclosed no conflict of
            interest.
          </Clause>
          <Clause n="3" title="Other intended users">{t.otherUsers}</Clause>
          <Clause n="4" title="The asset to be valued">
            {subject}{deal?.address ? `, ${deal.address}` : ''}{deal?.postcode ? ` ${deal.postcode}` : ''}. Interest: {t.interest}
          </Clause>
          <Clause n="5" title="Purpose of the valuation">{t.purpose}</Clause>
          <Clause n="6" title="Basis of value">
            <b className="font-semibold">{t.basisOfValue}</b>, as defined in RICS Valuation – Global Standards.
          </Clause>
          <Clause n="7" title="Valuation date">
            {t.valuationDate ? fmtLong(t.valuationDate) : 'The date of the report, unless otherwise agreed in writing.'}
          </Clause>

          <div className="mt-auto pt-6 text-[11px] text-ink-3">Page 1 of 3 · {t.orgName} · {ref}</div>
        </A4Page>

        <A4Page>
          <div className="flex items-center justify-between border-b border-border-std pb-4">
            <div className="text-[16px] font-bold" style={{ letterSpacing: '-0.3px' }}>Scope of work</div>
            <div className="fig text-[11px] font-medium text-ink-3">{ref}</div>
          </div>

          <Clause n="8" title="Extent of investigation">{t.extentOfInvestigation}</Clause>
          <Clause n="9" title="Nature and source of information">{t.sourcesOfInformation}</Clause>
          <Clause n="10" title="Assumptions">{t.assumptions}</Clause>
          <Clause n="11" title="Special assumptions">{t.specialAssumptions}</Clause>
          <Clause n="12" title="Format of the report">{t.reportFormat}</Clause>

          <div className="mt-auto pt-6 text-[11px] text-ink-3">Page 2 of 3 · {t.orgName} · {ref}</div>
        </A4Page>

        <A4Page>
          <div className="flex items-center justify-between border-b border-border-std pb-4">
            <div className="text-[16px] font-bold" style={{ letterSpacing: '-0.3px' }}>Terms & acceptance</div>
            <div className="fig text-[11px] font-medium text-ink-3">{ref}</div>
          </div>

          <Clause n="13" title="Restrictions on use and publication">{t.restrictionsOnUse}</Clause>
          <Clause n="14" title="Use of artificial intelligence">{t.aiUse}</Clause>
          <Clause n="15" title="Fees">{t.feeBasis}</Clause>
          <Clause n="16" title="Limitation of liability">
            {t.liabilityCap
              ? `The firm's aggregate liability arising out of this instruction is limited to ${formatMoneyFull(t.liabilityCap)}.`
              : 'No cap on liability has been agreed; liability is governed by the firm’s standard terms of business.'}
          </Clause>
          <Clause n="17" title="Complaints">{t.complaintsProcedure}</Clause>

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
              <div style={{ height: 40, borderBottom: `1.5px solid ${neutral.crumb}`, marginTop: 14 }} />
              <div className="mt-2 text-[12.5px] font-semibold">{t.acceptedBy ?? (t.clientName || '—')}</div>
              <div className="text-[11.5px] text-ink-2">{t.status === 'ACCEPTED' ? 'Accepted' : 'Signature'}</div>
              <div className="fig mt-1 text-[11px] text-ink-3">{t.acceptedAt ? fmtLong(t.acceptedAt) : 'Date'}</div>
            </div>
          </div>

          <div className="mt-auto pt-6 text-[11px] text-ink-3">
            Page 3 of 3 · {t.orgName} · Issued under RICS Valuation – Global Standards (VPS 1)
          </div>
        </A4Page>
      </div>
    </div>
  );
}
