import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { trpc, getToken } from '../lib/trpc';
import { useUnsavedWarning } from '../lib/unsaved';
import { fM } from '../lib/format';
import { useToast } from '../components/Toast';
import { Button, Listbox, Panel, Skeleton, SkeletonRows, StatusChip, TopBar } from '../components/ui';
import { DealNav } from '../components/DealNav';
import { openReport } from '../lib/download';

/**
 * Terms of engagement (RICS Red Book VPS 1) — drafted from the deal, edited by
 * the valuer, issued to the client, acceptance recorded. Every valuation is
 * supposed to have one settled before the report is written; the Red Book
 * report cites it.
 */

const BASIS = ['Market Value', 'Market Rent', 'Fair Value', 'Investment Value'] as const;

type Terms = {
  clientName: string;
  clientAddress: string;
  otherUsers: string;
  purpose: string;
  interest: string;
  basisOfValue: (typeof BASIS)[number];
  valuationDate: string | null;
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
};

const SECTIONS: Array<{ title: string; fields: Array<[keyof Terms, string, 'text' | 'area']> }> = [
  {
    title: 'Parties & instruction',
    fields: [
      ['clientName', 'Client', 'text'],
      ['clientAddress', 'Client address', 'text'],
      ['otherUsers', 'Other intended users', 'area'],
      ['purpose', 'Purpose of the valuation', 'area'],
      ['interest', 'Interest to be valued', 'area'],
    ],
  },
  {
    title: 'Scope of work',
    fields: [
      ['extentOfInvestigation', 'Extent of investigation', 'area'],
      ['sourcesOfInformation', 'Nature and source of information relied on', 'area'],
      ['assumptions', 'Assumptions', 'area'],
      ['specialAssumptions', 'Special assumptions', 'area'],
      ['reportFormat', 'Format of the report', 'area'],
      ['restrictionsOnUse', 'Restrictions on use, distribution and publication', 'area'],
    ],
  },
  {
    title: 'Commercial terms',
    fields: [
      ['feeBasis', 'Basis of fees', 'area'],
      ['complaintsProcedure', 'Complaints handling', 'area'],
    ],
  },
  {
    title: 'Use of artificial intelligence',
    fields: [['aiUse', 'Stated to the client before the work starts', 'area']],
  },
  {
    title: 'Valuer',
    fields: [
      ['valuerName', 'Valuer', 'text'],
      ['valuerReg', 'Registration', 'text'],
    ],
  },
];

const STATUS_TONE = { DRAFT: 'amber', ISSUED: 'blue', ACCEPTED: 'green' } as const;

export default function Engagement() {
  const { dealId = '' } = useParams();
  const utils = trpc.useUtils();
  const mintDownload = trpc.appraisal.downloadToken.useMutation();
  const toast = useToast();
  const { data: deal } = trpc.deals.get.useQuery(dealId, { enabled: !!dealId });
  const { data: saved, isLoading } = trpc.engagement.get.useQuery(dealId, { enabled: !!dealId });

  const [terms, setTerms] = useState<Terms | null>(null);
  /**
   * The stamp of the terms this page loaded, so a save can be refused rather
   * than silently restoring nineteen fields somebody else has since changed.
   *
   * Held in state and refreshed from the SAVE's own response — never re-read
   * from the query. `a48b7b3` found a drawer doing the latter: it re-read the
   * stamp from the list, which had not refetched yet, so the same person's
   * second edit was refused as a conflict with themselves.
   */
  const [stamp, setStamp] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  // the tab must not close on unsaved work without a word — see lib/unsaved.ts
  useUnsavedWarning(dirty);
  const [acceptedBy, setAcceptedBy] = useState('');

  useEffect(() => {
    if (saved && !terms) {
      setTerms({
        clientName: saved.clientName,
        clientAddress: saved.clientAddress,
        otherUsers: saved.otherUsers,
        purpose: saved.purpose,
        interest: saved.interest,
        basisOfValue: saved.basisOfValue as Terms['basisOfValue'],
        valuationDate: saved.valuationDate ? new Date(saved.valuationDate).toISOString().slice(0, 10) : null,
        extentOfInvestigation: saved.extentOfInvestigation,
        sourcesOfInformation: saved.sourcesOfInformation,
        assumptions: saved.assumptions,
        specialAssumptions: saved.specialAssumptions,
        reportFormat: saved.reportFormat,
        restrictionsOnUse: saved.restrictionsOnUse,
        feeBasis: saved.feeBasis,
        liabilityCap: saved.liabilityCap ?? null,
        complaintsProcedure: saved.complaintsProcedure,
        aiUse: saved.aiUse,
        valuerName: saved.valuerName,
        valuerReg: saved.valuerReg,
      });
      setStamp(saved.updatedAt ? new Date(saved.updatedAt) : null);
    }
  }, [saved, terms]);

  /**
   * Follow the server's stamp while there is nothing unsaved to protect.
   *
   * `save` is not the only mutation on this row: Issue, Withdraw & revise and
   * Record acceptance all write it and move `updatedAt`. Seeding the stamp once
   * on load meant that after any of those, the next Save was refused — the user
   * told their own terms had changed underneath them, which is the exact failure
   * `a48b7b3` found in the sales drawer and which I reintroduced here in a new
   * shape.
   *
   * Only while clean. Once there are unsaved edits the stamp must stay at the
   * one those edits were made against, because that is what makes the refusal
   * mean anything.
   */
  useEffect(() => {
    if (!saved || dirty) return;
    const fromQuery = saved.updatedAt ? new Date(saved.updatedAt) : null;
    /**
     * Never BACKWARDS.
     *
     * This effect depends on `dirty`, so a save re-runs it the moment
     * `setDirty(false)` lands — before the refetch it just triggered has
     * returned. `saved` is therefore still the copy from before the save, and
     * setting the stamp from it threw away the fresh one the save had just
     * handed back. The next save then carried a stamp one version old and was
     * refused: the user told their own terms had changed underneath them.
     *
     * Invisible on a fast machine, where the refetch always won the race —
     * it passed ten runs in a row locally and failed in CI, which runs two
     * workers against a docker stack. Reproduced deterministically by holding
     * `engagement.get` back for three seconds.
     *
     * A row's `updatedAt` only ever moves forward, so keeping the later of the
     * two is correct whichever arrives first — and a query that has NO stamp is
     * not later than one that has. That case is the first save on a deal with no
     * terms yet: the create returns a real stamp while the query still holds the
     * unsaved draft's `null`, and treating null as "newer" wiped it, so the next
     * save carried nothing and was refused for having no stamp at all. Which is
     * why this looked intermittent and was in fact exact — it failed on the
     * first run after a reseed and passed on every run after.
     */
    setStamp((current) => {
      if (!fromQuery) return current;
      if (current && fromQuery < current) return current;
      return fromQuery;
    });
  }, [saved, dirty]);

  const invalidate = () => {
    utils.engagement.get.invalidate(dealId);
    utils.documents.activity.invalidate(dealId);
  };
  const save = trpc.engagement.save.useMutation({
    onSuccess: (res) => {
      setDirty(false);
      setStamp(res.updatedAt ? new Date(res.updatedAt) : null);
      invalidate();
      toast.success('Terms saved');
    },
  });
  const issue = trpc.engagement.issue.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Terms issued — send the client their signing link');
    },
  });
  const revokeLink = trpc.engagement.revokeLink.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Link revoked — the client can no longer sign it');
    },
  });
  const [copied, setCopied] = useState(false);
  const [expiryDays, setExpiryDays] = useState(30);
  const signUrl = saved?.signToken ? `${window.location.origin}/terms/${saved.signToken}` : null;
  const accept = trpc.engagement.accept.useMutation({
    onSuccess: () => {
      setAcceptedBy('');
      invalidate();
      toast.success('Client acceptance recorded');
    },
  });
  const withdraw = trpc.engagement.withdraw.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Terms withdrawn — back to draft');
    },
  });

  const status = (saved?.status ?? 'DRAFT') as keyof typeof STATUS_TONE;
  const locked = status === 'ACCEPTED';
  const set = (k: keyof Terms, v: string | number | null) => {
    setTerms((t) => (t ? { ...t, [k]: v } : t));
    setDirty(true);
  };

  if (isLoading || !terms) {
    return (
      <div className="min-h-screen">
        <TopBar crumb="Terms of engagement" />
        <DealNav dealId={dealId} active="engagement" />
        <main className="max-w-[1640px] mx-auto px-4 sm:px-6 pb-14">
          <div className="mt-5 grid grid-cols-1 gap-4 lg:[grid-template-columns:minmax(0,1fr)_330px]">
            <Panel>
              <Skeleton height={16} width="40%" />
              <SkeletonRows rows={10} height={18} />
            </Panel>
            <Panel>
              <SkeletonRows rows={5} height={14} />
            </Panel>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <TopBar
        crumb={
          <span>
            <Link to="/board" className="hover:text-brand-ink">Pipeline</Link> / {deal?.name ?? 'Terms of engagement'}
          </span>
        }
        right={
          <>
            <StatusChip status={STATUS_TONE[status]} label={status} />
            <Button variant="secondary" to={`/deal/${dealId}/engagement/document`}>Preview</Button>
            <Button
              variant="secondary"
              onClick={() => void openReport(mintDownload.mutateAsync, 'engagement', `/reports/${dealId}/engagement.pdf`, dealId)}
            >
              Download PDF
            </Button>
            <Button onClick={() => save.mutate({ dealId, terms, expectedUpdatedAt: stamp ?? undefined })} loading={save.isPending} disabled={!dirty || locked}>
              {dirty ? 'Save terms' : 'Saved'}
            </Button>
          </>
        }
      />
      <DealNav dealId={dealId} active="engagement" />

      <main className="max-w-[1640px] mx-auto px-4 sm:px-6 pb-14">
        <div className="mt-5 grid grid-cols-1 gap-4 lg:[grid-template-columns:minmax(0,1fr)_330px]">
          <div className="flex flex-col gap-4">
            <Panel title="Basis of value & date">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="block">
                  <span className="label-mono text-ink-3 block mb-1">Basis of value</span>
                  <select
                    className="w-full"
                    aria-label="Basis of value"
                    disabled={locked}
                    value={terms.basisOfValue}
                    onChange={(e) => set('basisOfValue', e.target.value)}
                  >
                    {BASIS.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="label-mono text-ink-3 block mb-1">Valuation date</span>
                  <input
                    type="date"
                    className="w-full fig"
                    aria-label="Valuation date"
                    disabled={locked}
                    value={terms.valuationDate ?? ''}
                    onChange={(e) => set('valuationDate', e.target.value || null)}
                  />
                </label>
                <label className="block">
                  <span className="label-mono text-ink-3 block mb-1">Liability cap (£)</span>
                  <input
                    type="number"
                    className="w-full fig"
                    aria-label="Liability cap"
                    placeholder="No stated cap"
                    disabled={locked}
                    value={terms.liabilityCap ?? ''}
                    onChange={(e) => set('liabilityCap', e.target.value === '' ? null : parseFloat(e.target.value) || 0)}
                  />
                </label>
              </div>
            </Panel>

            {SECTIONS.map((section) => (
              <Panel key={section.title} title={section.title}>
                <div className="flex flex-col gap-3">
                  {section.fields.map(([key, label, kind]) => (
                    <label key={key} className="block">
                      <span className="label-mono text-ink-3 block mb-1">{label}</span>
                      {kind === 'area' ? (
                        <textarea
                          className="w-full text-[12.5px] leading-[1.55]"
                          rows={key === 'specialAssumptions' ? 2 : 3}
                          aria-label={label}
                          disabled={locked}
                          value={String(terms[key] ?? '')}
                          onChange={(e) => set(key, e.target.value)}
                        />
                      ) : (
                        <input
                          className="w-full"
                          aria-label={label}
                          disabled={locked}
                          value={String(terms[key] ?? '')}
                          onChange={(e) => set(key, e.target.value)}
                        />
                      )}
                    </label>
                  ))}
                </div>
              </Panel>
            ))}
          </div>

          <aside className="flex flex-col gap-4">
            <Panel title="Status">
              <div className="flex flex-col gap-2.5 text-[12.5px]">
                <Row k="State" v={status === 'DRAFT' ? 'Draft — not yet with the client' : status === 'ISSUED' ? 'Issued, awaiting acceptance' : 'Accepted by the client'} />
                <Row k="Issued" v={saved?.issuedAt ? fmtDate(saved.issuedAt) : '—'} />
                {status === 'ISSUED' && (
                  <Row
                    k="Link"
                    v={
                      saved?.linkExpired
                        ? `Expired ${saved.signTokenExpiresAt ? fmtDate(saved.signTokenExpiresAt) : ''}`.trim()
                        : saved?.signTokenExpiresAt
                          ? `Valid until ${fmtDate(saved.signTokenExpiresAt)}`
                          : '—'
                    }
                  />
                )}
                <Row k="Accepted" v={saved?.acceptedAt ? `${fmtDate(saved.acceptedAt)} · ${saved.acceptedBy}` : '—'} />
                <Row k="Liability cap" v={terms.liabilityCap ? fM(terms.liabilityCap) : 'None stated'} />
              </div>

              <div className="mt-3.5 border-t border-border-std pt-3.5 flex flex-col gap-2.5">
                {status === 'DRAFT' && (
                  <>
                    <label className="block">
                      <span className="label-mono text-ink-3 block mb-1">Link valid for</span>
                      <Listbox
                        ariaLabel="Link valid for"
                        value={String(expiryDays)}
                        onChange={(v: string) => setExpiryDays(Number(v))}
                        options={[
                          { value: '7', label: '7 days' },
                          { value: '14', label: '14 days' },
                          { value: '30', label: '30 days' },
                          { value: '90', label: '90 days' },
                        ]}
                      />
                    </label>
                    <Button writes
                      size="sm"
                      loading={issue.isPending}
                      disabled={dirty || !saved?.saved}
                      onClick={() => issue.mutate({ dealId, expiryDays })}
                    >
                      Issue to client
                    </Button>
                  </>
                )}
                {status === 'ISSUED' && signUrl && (
                  <div className="rounded-[10px] bg-sunken-2 px-3 py-2.5">
                    <div className="label-mono text-ink-3">
                      {saved?.linkExpired ? 'Signing link — EXPIRED, the client cannot sign' : 'Signing link — send this to the client'}
                    </div>
                    <div className="fig mt-1 text-[10.5px] text-ink-2 break-all leading-snug">{signUrl}</div>
                    <div className="mt-2 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          navigator.clipboard?.writeText(signUrl);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                      >
                        {copied ? 'Copied' : 'Copy link'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => window.open(signUrl, '_blank')}>
                        Open
                      </Button>
                    </div>
                    <div className="mt-2 text-[11px] text-ink-3 leading-snug">
                      Anyone with the link can sign, so treat it like the document itself. Withdrawing or reissuing revokes it.
                      {saved?.signTokenExpiresAt && !saved.linkExpired && (
                        <> It stops working on <b className="font-semibold">{fmtDate(saved.signTokenExpiresAt)}</b>.</>
                      )}
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      {saved?.linkExpired ? (
                        <Button writes size="sm" loading={issue.isPending} onClick={() => issue.mutate({ dealId, expiryDays })}>
                          Reissue link
                        </Button>
                      ) : (
                        <Button writes size="sm" variant="secondary" loading={revokeLink.isPending} onClick={() => revokeLink.mutate(dealId)}>
                          Revoke link
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                {status === 'ISSUED' && (
                  <>
                    <div className="label-mono text-ink-3 mt-1">Or record a signature made elsewhere</div>
                    <input
                      className="w-full"
                      aria-label="Accepted by"
                      placeholder="Name of the person accepting"
                      value={acceptedBy}
                      onChange={(e) => setAcceptedBy(e.target.value)}
                    />
                    <Button writes
                      size="sm"
                      variant="secondary"
                      loading={accept.isPending}
                      disabled={acceptedBy.trim().length < 2}
                      onClick={() => accept.mutate({ dealId, acceptedBy: acceptedBy.trim() })}
                    >
                      Record acceptance
                    </Button>
                  </>
                )}
                {status === 'ACCEPTED' && saved?.signedAt && (
                  <div className="rounded-[10px] bg-tint-success px-3 py-2.5">
                    <div className="label-mono text-brand-ink">Signed electronically</div>
                    <div className="mt-1 text-[12px] text-ink-2 leading-snug">
                      {saved.signedName} · {fmtDate(saved.signedAt)}
                      {saved.signedIp ? ` · from ${saved.signedIp}` : ''}
                    </div>
                  </div>
                )}
                {status !== 'DRAFT' && (
                  <Button writes size="sm" variant="secondary" loading={withdraw.isPending} onClick={() => withdraw.mutate(dealId)}>
                    Withdraw & revise
                  </Button>
                )}
                {dirty && status === 'DRAFT' && (
                  <div className="text-[11px] text-ink-3 leading-snug">Save your edits before issuing.</div>
                )}
                {locked && (
                  <div className="text-[11px] text-ink-3 leading-snug">
                    Accepted terms are locked. Withdraw to draft a revision — the acceptance stays in the audit trail.
                  </div>
                )}
              </div>
            </Panel>

            <Panel title="Why this matters">
              <div className="text-[12px] text-ink-2 leading-relaxed">
                RICS Red Book VPS 1 requires written terms of engagement agreed with the client before the valuation is
                reported. The Red Book report cites these terms, and the AI paragraph tells the client up front what may be
                used — the report afterwards states what actually was.
              </div>
            </Panel>
          </aside>
        </div>
      </main>
    </div>
  );
}

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-3">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}
