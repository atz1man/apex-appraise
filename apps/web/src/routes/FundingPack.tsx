import { useMemo } from 'react';
import { brand, neutral } from '@apex/ui-tokens';
import { trpc } from '../lib/trpc';
import { fM, n0 } from '../lib/format';
import { drawnAgainstWorksLabel, drawnBasis } from '../lib/drawn-basis';
import { Button, Spinner } from '../components/ui';
import { A4Page, PAGE_CONTENT_PX, PageFoot, PageHead, PRINT_CSS, docDate } from '../components/paper';

/**
 * The funding pack — the book, as a lender receives it.
 *
 * This is how development lending actually works between reporting cycles: the
 * borrower sends a monitoring pack. Building a lender LOGIN first would have been
 * the larger and less useful half — a portal nobody has been invited to is worth
 * less than a document that lands in an inbox this month.
 *
 * Every figure comes from the same `deals.exposure` the board reads, so the pack
 * and the screen cannot disagree.
 */

/** every date this document prints is in the firm's time — see paper.tsx */
const fmtLong = docDate;

/**
 * MEASURED against a rendered pack, not reasoned about: a position row is 32px,
 * the table header 34, the closing total 36, and the summary blocks on page one
 * come to 341 plus margins. The first guesses here were 30 and 470, which
 * under-filled page one and overran page two by 62px — the arithmetic looked
 * right and the page did not.
 */
const ROW_PX = 32;
const TABLE_HEAD_PX = 34;
const TOTAL_PX = 36;
const SUMMARY_PX = 420;

export default function FundingPack() {
  const { data: exposure, isLoading } = trpc.deals.exposure.useQuery();
  const { data: org } = trpc.org.get.useQuery(undefined, { staleTime: 300_000 });

  const firmName = org?.name ?? 'Apex Appraise';
  const today = new Date();
  const refCode = `FP-${today.toISOString().slice(0, 10).replace(/-/g, '')}`;

  /**
   * Positions paginate. Page one carries the summary, so it holds fewer rows than
   * the ones after it — sizing every page the same would either waste a sheet or
   * overrun the first.
   */
  const pages = useMemo(() => {
    const positions = exposure?.positions ?? [];
    if (!positions.length) return [positions];
    const firstPageRows = Math.max(1, Math.floor((PAGE_CONTENT_PX - SUMMARY_PX - TABLE_HEAD_PX - TOTAL_PX) / ROW_PX));
    const laterPageRows = Math.max(1, Math.floor((PAGE_CONTENT_PX - TABLE_HEAD_PX - TOTAL_PX) / ROW_PX));
    const out: (typeof positions)[] = [positions.slice(0, firstPageRows)];
    for (let i = firstPageRows; i < positions.length; i += laterPageRows) {
      out.push(positions.slice(i, i + laterPageRows));
    }
    return out;
  }, [exposure]);

  if (isLoading || !exposure) {
    return (
      <div className="min-h-screen grid place-items-center bg-frame">
        <Spinner />
      </div>
    );
  }

  const t = exposure.totals;
  const breaching = exposure.positions.filter((p) => (p.covenants?.breaches.length ?? 0) > 0);
  const overdrawn = exposure.positions.filter((p) => p.drawdown?.status === 'overspending');
  const total = pages.length;
  /**
   * The pack states where "Drawn" came from instead of asserting one basis for
   * the whole book — see `drawn-basis.ts` for what it used to say and why that
   * mattered on a firm that had connected its bank feed.
   */
  const basis = drawnBasis(exposure.positions);

  /**
   * A pack over no schemes is not a pack.
   *
   * With an empty portfolio this rendered the whole lender-facing document —
   * facility £0, utilisation 0%, loan to GDV 0% — under the exceptions heading
   * "No covenants are set, so none are tested. Nothing is drawn ahead of works."
   * That is a clean bill of health issued over nothing examined, and it is the
   * sort of page somebody forwards. It says what it is instead.
   */
  if (t.deals === 0) {
    return (
      <div className="light min-h-screen bg-frame grid place-items-center px-6">
        <div className="max-w-[440px] text-center">
          <h1 className="text-[20px] font-semibold tracking-[-0.5px]">No schemes to report on yet</h1>
          <p className="mt-2.5 text-[13px] leading-[1.6] text-ink-2b">
            The funding pack reports facility, drawdown and covenant position across the schemes in your portfolio. Appraise a deal and it
            will appear here — an empty pack would state a position that has not been examined.
          </p>
          <Button to="/board" className="mt-5">
            Go to the pipeline
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="light min-h-screen bg-frame">
      <style>{PRINT_CSS}</style>
      <div className="a4-canvas flex flex-col items-center gap-6 px-5 pt-7 pb-14">
        {pages.map((rows, pi) => (
          <A4Page key={pi}>
            <PageHead
              title={pi === 0 ? 'Portfolio funding pack' : `Portfolio funding pack (${pi + 1} of ${total})`}
              scheme={firmName}
            />

            {pi === 0 && (
              <>
                <p className="mt-4 text-[12px] text-ink-2b leading-[1.6]">
                  Prepared {fmtLong(today)} from {t.deals} funded {t.deals === 1 ? 'scheme' : 'schemes'}. Facility figures are
                  recomputed from each scheme's current appraisal, not carried forward from a previous pack.
                  {basis.sentence ? ` ${basis.sentence}` : ''}
                </p>

                <div className="mt-4 grid grid-cols-3 gap-3">
                  {([
                    ['Facility', fM(t.facility), null],
                    ['Drawn', fM(t.drawn), null],
                    ['Undrawn', fM(t.undrawn), null],
                    ['Utilisation', `${Math.round(t.utilisation * 100)}%`, t.utilisation > 1 ? 'over facility' : null],
                    ['Loan to GDV', `${Math.round(t.loanToGdv * 100)}%`, null],
                    ['Equity', fM(t.equity), null],
                  ] as Array<[string, string, string | null]>).map(([k, v, warn]) => (
                    <div key={k} className="rounded-[10px] border border-border-std p-2.5">
                      <div className="text-[9.5px] uppercase tracking-wide text-ink-3">{k}</div>
                      <div
                        className="fig text-[15px] font-semibold"
                        style={warn ? { color: '#B23A2E' } : undefined}
                      >
                        {v}
                      </div>
                      {warn && <div className="text-[9px]" style={{ color: '#B23A2E' }}>{warn}</div>}
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-ink-3">By asset type</div>
                    {exposure.byAssetType.slice(0, 4).map((g) => (
                      <div key={g.key} className="mt-1 flex items-baseline gap-2 text-[11.5px]">
                        <span className="flex-1 truncate">{g.key.toLowerCase().replace('_', ' ')}</span>
                        <span className="fig text-ink-3">{Math.round(g.share * 100)}%</span>
                        <span className="fig font-semibold">{fM(g.facility)}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-ink-3">By postcode area</div>
                    {exposure.byRegion.slice(0, 4).map((g) => (
                      <div key={g.key} className="mt-1 flex items-baseline gap-2 text-[11.5px]">
                        <span className="flex-1 truncate">{g.key}</span>
                        <span className="fig text-ink-3">{Math.round(g.share * 100)}%</span>
                        <span className="fig font-semibold">{fM(g.facility)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {exposure.largest && (
                  <p className="mt-3 text-[11.5px] text-ink-2b">
                    Largest single concentration:{' '}
                    <b className="font-semibold">
                      {Math.round(exposure.largest.share * 100)}% in{' '}
                      {exposure.largest.dimension === 'deal'
                        ? exposure.largest.key
                        : exposure.largest.dimension === 'region'
                          ? `postcode area ${exposure.largest.key}`
                          : exposure.largest.key.toLowerCase().replace('_', ' ')}
                    </b>
                    .
                  </p>
                )}

                {/* Exceptions before the table, because they are the reason the
                    pack is read. A reader who has to find them in the rows will
                    not find them. */}
                <div className="mt-3 rounded-[10px] border border-border-std p-2.5">
                  <div className="text-[11px] uppercase tracking-wide text-ink-3">Exceptions</div>
                  {breaching.length === 0 && overdrawn.length === 0 ? (
                    <div className="mt-1 text-[11.5px] text-ink-2b">
                      {exposure.positions.every((p) => p.covenants?.untested !== false)
                        ? 'No covenants are set, so none are tested. Nothing is drawn ahead of works.'
                        : 'No covenant breaches. Nothing is drawn ahead of works.'}
                    </div>
                  ) : (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {breaching.map((p) =>
                        p.covenants!.breaches.map((b) => (
                          <div key={`${p.dealId}-${b.key}`} className="text-[11.5px]">
                            <b className="font-semibold">{p.name}</b> — {b.label} {b.actualPct.toFixed(1)}% against a{' '}
                            {b.direction === 'max' ? 'maximum' : 'minimum'} of {b.limitPct}%
                          </div>
                        )),
                      )}
                      {overdrawn.map((p) => (
                        <div key={`${p.dealId}-draw`} className="text-[11.5px]">
                          {/* the figure the verdict was actually reached on, under
                              the word that describes it — see drawn-basis.ts */}
                          <b className="font-semibold">{p.name}</b> — {fM(p.drawdown!.actualToDate)}{' '}
                          {drawnAgainstWorksLabel(p.drawnSource)} against {fM(p.drawdown!.expectedByProgress)} of works
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="mt-4 border border-border-std rounded-[10px] overflow-hidden">
              <div
                className="flex text-white fig text-[9.5px] font-semibold uppercase"
                style={{ background: brand[700], letterSpacing: '0.4px' }}
              >
                <div style={{ flex: 2.4, padding: '9px 10px' }}>Scheme</div>
                <div style={{ flex: 0.8, padding: '9px 6px' }}>Area</div>
                <div className="text-right" style={{ flex: 1.2, padding: '9px 6px' }}>GDV</div>
                <div className="text-right" style={{ flex: 1.2, padding: '9px 6px' }}>Facility</div>
                <div className="text-right" style={{ flex: 1.2, padding: '9px 6px' }}>Drawn</div>
                <div className="text-right" style={{ flex: 1.1, padding: '9px 10px' }}>LTGDV</div>
              </div>
              {rows.map((p) => (
                <div key={p.dealId} className="flex border-t border-border-faint fig text-[11px]">
                  <div className="font-ui" style={{ flex: 2.4, padding: '7px 10px' }}>{p.name}</div>
                  <div style={{ flex: 0.8, padding: '7px 6px' }}>{p.region}</div>
                  <div className="text-right" style={{ flex: 1.2, padding: '7px 6px' }}>{fM(p.gdv)}</div>
                  <div className="text-right" style={{ flex: 1.2, padding: '7px 6px' }}>{fM(p.facility)}</div>
                  {/* † only on a mixed book: where every row shares one basis the
                      methodology note above has already said so */}
                  <div className="text-right" style={{ flex: 1.2, padding: '7px 6px' }}>
                    {fM(p.drawn)}
                    {basis.markRows && p.drawnSource !== 'bank' ? <span className="text-ink-3">&thinsp;†</span> : null}
                  </div>
                  <div className="text-right font-semibold" style={{ flex: 1.1, padding: '7px 10px' }}>
                    {p.gdv > 0 ? `${Math.round((p.facility / p.gdv) * 100)}%` : '—'}
                  </div>
                </div>
              ))}
              {/* the book totals ONCE, on the last sheet */}
              {pi === total - 1 && (
                <div className="flex bg-sunken fig text-[11.5px] font-semibold" style={{ borderTop: `2px solid ${neutral.border}` }}>
                  <div className="font-ui" style={{ flex: 3.2, padding: '8px 10px' }}>
                    {t.deals} schemes · {n0(exposure.byRegion.length)} postcode {exposure.byRegion.length === 1 ? 'area' : 'areas'}
                  </div>
                  <div className="text-right" style={{ flex: 1.2, padding: '8px 6px' }}>{fM(t.gdv)}</div>
                  <div className="text-right" style={{ flex: 1.2, padding: '8px 6px', color: brand[700] }}>{fM(t.facility)}</div>
                  <div className="text-right" style={{ flex: 1.2, padding: '8px 6px' }}>{fM(t.drawn)}</div>
                  <div className="text-right" style={{ flex: 1.1, padding: '8px 10px' }}>{Math.round(t.loanToGdv * 100)}%</div>
                </div>
              )}
            </div>

            {pi === total - 1 && (
              <p className="mt-3 text-[10px] text-ink-3 leading-snug">
                Prepared for information. Facility figures are the appraised peak debt of each scheme under its current
                appraisal and are not a statement of amounts advanced. Covenant tests run only against limits this firm has
                set; where none are set, none are reported.
              </p>
            )}
            <PageFoot no={pi + 1} total={total} refCode={refCode} firmName={firmName} />
          </A4Page>
        ))}
      </div>
    </div>
  );
}
