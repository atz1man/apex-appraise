import { Link, useParams } from 'react-router-dom';
import { getToken, trpc } from '../lib/trpc';
import { Button, Spinner } from '../components/ui';
import { TermsDocument, TERMS_PRINT_CSS } from '../components/TermsDocument';
import { openReport } from '../lib/download';

/**
 * Internal preview of the terms of engagement. The layout itself lives in
 * TermsDocument so the client signs precisely what was previewed here.
 */
export default function EngagementDocument() {
  const { dealId = '' } = useParams();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: t, isLoading } = trpc.engagement.get.useQuery(dealId, { enabled: !!dealId });
  const mintDownload = trpc.appraisal.downloadToken.useMutation();

  if (isLoading || !t) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const ref = `AP-${dealId.slice(0, 4).toUpperCase()}-TOE`;

  return (
    <div className="light min-h-screen bg-frame">
      <style>{TERMS_PRINT_CSS}</style>

      <div className="no-print sticky top-0 z-40 h-[54px] bg-surface border-b border-border-strong flex items-center gap-3.5 px-5">
        <Link to={`/deal/${dealId}/engagement`} className="flex items-center gap-2 text-[13px] font-medium text-inactive hover:text-brand-ink">
          ‹ Back to terms
        </Link>
        <span className="text-[13px] font-semibold">Terms of engagement</span>
        <span className="fig text-[11px] text-ink-3">{ref}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => void openReport(mintDownload.mutateAsync, 'engagement', `/reports/${dealId}/engagement.pdf`, dealId)}>
            Download PDF
          </Button>
          <Button onClick={() => window.print()}>Print / Save PDF</Button>
        </div>
      </div>

      <TermsDocument
        t={t}
        subject={deal?.name ?? 'the property'}
        address={deal?.address ?? ''}
        postcode={deal?.postcode ?? ''}
        refCode={ref}
      />
    </div>
  );
}
