import { useEffect, useMemo, useLayoutEffect, useState } from 'react';
import { nextReserve } from '../lib/pack-relayout';
import { brand, neutral } from '@apex/ui-tokens';
import { trpc } from '../lib/trpc';
import { fM, n0 } from '../lib/format';
import { drawnAgainstWorksLabel, drawnBasis } from '../lib/drawn-basis';
import { Button, EmptyState, Spinner } from '../components/ui';
import { A4Page, PAGE_CONTENT_PX, PageFoot, PageHead, PRINT_CSS, docDate } from '../components/paper';
import { PACK_LAYOUT, paginatePack } from '../lib/pack-pagination';
import type { CovenantTest, ExposurePosition } from '@apex/appraisal-engine';

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
// the sheet arithmetic lives in lib/pack-pagination.ts, where its boundaries are tested
const LAYOUT = { ...PACK_LAYOUT, pageContentPx: PAGE_CONTENT_PX };

/** one line of the Exceptions box */
type PackException = { kind: 'breach'; p: ExposurePosition; b: CovenantTest } | { kind: 'overdrawn'; p: ExposurePosition };

/** the one line of an Exceptions box, wherever the sheet it lands on */
function ExceptionLine({ e }: { e: PackException }) {
  if (e.kind === 'breach') {
    return (
      <div className="pack-line text-[11.5px]">
        <b className="font-semibold">{e.p.name}</b> — {e.b.label} {e.b.actualPct.toFixed(1)}% against a{' '}
        {e.b.direction === 'max' ? 'maximum' : 'minimum'} of {e.b.limitPct}%
      </div>
    );
  }
  return (
    <div className="pack-line text-[11.5px]">
      {/* the figure the verdict was actually reached on, under the word that describes it — see drawn-basis.ts */}
      <b className="font-semibold">{e.p.name}</b> — {fM(e.p.drawdown!.actualToDate)} {drawnAgainstWorksLabel(e.p.drawnSource)} against{' '}
      {fM(e.p.drawdown!.expectedByProgress)} of works
    </div>
  );
}

export default function FundingPack() {
  const { data: exposure, isLoading, error, refetch } = trpc.deals.exposure.useQuery();
  const { data: org } = trpc.org.get.useQuery(undefined, { staleTime: 300_000 });

  const firmName = org?.name ?? 'Apex Appraise';
  const today = new Date();
  const refCode = `FP-${today.toISOString().slice(0, 10).replace(/-/g, '')}`;

  /**
   * Positions paginate. Page one carries the summary, so it holds fewer rows than
   * the ones after it — sizing every page the same would either waste a sheet or
   * overrun the first.
   */
  /**
   * Height the arithmetic did not know about, measured off the rendered
   * sheets. The budget below is close, and three times it has been wrong by
   * a line: exception lines, the closing note on a sheet that was also full,
   * and the dagger footnote a mixed book prints. Each was "fixed" by adding
   * a constant, and the next unbudgeted line was already there. So after
   * render the sheets are measured, and any that overruns A4 hands its
   * overrun back as reserve and the pack lays out again — one pass in
   * practice, bounded to a handful so a pathological book cannot loop.
   */
  const [layout, setLayout] = useState({ reserve: 0, passes: 0 });
  const { reserve } = layout;
  /**
   * A new book gets its own pass budget. Without this a long session that
   * refetches its exposure spends the budget once and then stops reclaiming
   * rows on every pack after it. Returning the same object bails the render
   * out, so the common case (the budget already untouched) costs nothing.
   */
  useEffect(() => {
    setLayout((l) => (l.reserve === 0 && l.passes === 0 ? l : { reserve: 0, passes: 0 }));
  }, [exposure]);
  /**
   * The row and the exception line are budgeted at their measured height for
   * a name that fits on one line. A long scheme name wraps and the row is
   * taller, on EVERY sheet — a uniform reserve taken off every sheet for that
   * starves the sheets it did not happen on (measured: page one down to eight
   * exception lines from twenty-seven). So the tallest rendered row and line
   * are read back and the layout uses those; the reserve is left for what the
   * arithmetic still cannot see.
   */
  const [measured, setMeasured] = useState({ rowPx: LAYOUT.rowPx, exceptionLinePx: LAYOUT.exceptionLinePx });
  const pages = useMemo(() => {
    const positions = exposure?.positions ?? [];
    /**
     * The exception lines, in the order they print: every covenant breach,
     * then every overspending scheme. Page one's budget used to be a constant
     * that assumed one line, and twelve breach lines put 220px of the pack off
     * the bottom of the sheet; then the lines themselves grew past the sheet —
     * 43 of them on a forty-scheme book — so the box paginates like the table.
     */
    const exceptions: PackException[] = [
      ...positions.flatMap((p) => (p.covenants?.breaches ?? []).map((b) => ({ kind: 'breach' as const, p, b }))),
      ...positions.filter((p) => p.drawdown?.status === 'overspending').map((p) => ({ kind: 'overdrawn' as const, p })),
    ];
    return paginatePack(positions, exceptions, { ...LAYOUT, ...measured }, reserve);
  }, [exposure, reserve, measured]);
  useLayoutEffect(() => {
    const tallest = (selector: string) =>
      Math.ceil(Math.max(0, ...Array.from(document.querySelectorAll<HTMLElement>(selector)).map((el) => el.getBoundingClientRect().height)));
    const rowPx = Math.max(measured.rowPx, tallest('.pack-row'));
    const exceptionLinePx = Math.max(measured.exceptionLinePx, tallest('.pack-line'));
    // heights only ever grow, so this settles; a sheet laid out for its tallest row cannot then overrun on rows
    if (rowPx !== measured.rowPx || exceptionLinePx !== measured.exceptionLinePx) {
      setMeasured({ rowPx, exceptionLinePx });
      return;
    }
    const sheets = Array.from(document.querySelectorAll<HTMLElement>('.a4-page'));
    // 1122 is the sheet; anything past it is content the page cannot hold
    const overrun = Math.max(0, ...sheets.map((el) => el.getBoundingClientRect().height - 1122));
    /**
     * Whether to lay out again is decided in `pack-relayout.ts`, where the
     * bound can be driven to its boundaries. It used to be decided here, in
     * pixels, and a book overrunning by a fraction of one took 52 passes
     * against React's limit of 50 — the pack rendered as "This screen stopped
     * working". See that file for the measurement.
     */
    const next = nextReserve({ overrun, reserve, passes: layout.passes });
    if (next !== null) setLayout((l) => ({ reserve: next, passes: l.passes + 1 }));
  }, [pages, reserve, measured, layout.passes]);

  /**
   * A pack that could not be built says so. It used to spin for ever on a
   * failed exposure read — `isLoading || !exposure` is true of an error too —
   * which in the browser suite read as "the pack never rendered" and told a
   * person printing one nothing at all.
   */
  if (error) {
    return (
      <div className="min-h-screen grid place-items-center bg-frame p-6">
        <EmptyState title="The funding pack could not be built" cta={<Button onClick={() => refetch()}>Try again</Button>}>
          <span data-testid="pack-error">{error.message}</span>
        </EmptyState>
      </div>
    );
  }
  if (isLoading || !exposure) {
    return (
      <div className="min-h-screen grid place-items-center bg-frame">
        <Spinner />
      </div>
    );
  }

  const t = exposure.totals;
  const total = pages.length;
  const anyExceptions = pages.some((s) => s.exceptions.length > 0);
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
        {pages.map(({ rows, exceptions, continued }, pi) => (
          <A4Page key={pi}>
            <PageHead
              title={pi === 0 ? 'Portfolio funding pack' : `Portfolio funding pack (${pi + 1} of ${total})`}
              scheme={firmName}
              heading={pi === 0}
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
                  {!anyExceptions ? (
                    <div className="mt-1 text-[11.5px] text-ink-2b">
                      {exposure.positions.every((p) => p.covenants?.untested !== false)
                        ? 'No covenants are set, so none are tested. Nothing is drawn ahead of works.'
                        : 'No covenant breaches. Nothing is drawn ahead of works.'}
                    </div>
                  ) : (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {exceptions.map((e) => (
                        <ExceptionLine key={e.kind === 'breach' ? `${e.p.dealId}-${e.b.key}` : `${e.p.dealId}-draw`} e={e} />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* a box the first sheet could not hold goes on, sheet by sheet, before the table */}
            {continued && (
              <div className="mt-3 rounded-[10px] border border-border-std p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-3">Exceptions (continued)</div>
                <div className="mt-1 flex flex-col gap-0.5">
                  {exceptions.map((e) => (
                    <ExceptionLine key={e.kind === 'breach' ? `${e.p.dealId}-${e.b.key}` : `${e.p.dealId}-draw`} e={e} />
                  ))}
                </div>
              </div>
            )}

            {/* a first sheet the exceptions have filled carries no table; the rows start on the next */}
            {(rows.length > 0 || pi === total - 1) && (
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
                <div key={p.dealId} className="pack-row flex border-t border-border-faint fig text-[11px]">
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
            )}

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
