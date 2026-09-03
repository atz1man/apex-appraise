import { beforeAll, describe, expect, it } from 'vitest';
import { autoAppraise } from '@apex/appraisal-engine';
import { screeningVerdict } from '../src/routers/appraisal.js';
import { callerFor, makeTenant, resetDatabase, type Tenant } from './harness.js';

/**
 * The screening tool that could not say no.
 *
 * Auto-Appraisal exists to answer one question about a site nobody has yet
 * spent money on: is this worth pursuing? Its verdict badge — Proceed, Caution,
 * Decline — was computed from `rocAtAsking`, the return on cost if you paid the
 * asking price. The engine returns null for that whenever no asking price was
 * given, because there is no price to divide by.
 *
 * The router read the null as `?? 0.2`. Twenty per cent is over the 0.17
 * Proceed threshold, and the clause beside it, `asking === 0`, was satisfied by
 * that same absence — so BOTH halves of the Proceed test passed because a price
 * was missing. No unpriced screen could come back as anything else, for any
 * scheme, ever. The `?? 0.2` also meant the Decline test (`< 0.1`) could never
 * fire on an unpriced screen either; there was no input at all that reached it.
 *
 * This was the live path. The extraction tool declares `asking` as nullable,
 * the prompt instructs "anything the documents do not state: null", and
 * `numOr(0)` turns that null into zero — so a planning pack with no price
 * quoted in it screened Proceed on its way in.
 *
 * These tests are written as the grid below rather than as three examples,
 * because the defect was not a wrong number in one case: it was a verdict with
 * only one reachable value. A test that asserts "this particular unbuildable
 * scheme now Declines" passes again the moment someone reintroduces a constant
 * that happens to sit under 0.17. The grid asserts the property — an unpriced
 * verdict tracks the residual's sign — which a constant cannot satisfy in both
 * directions at once.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('screening');
});

/** A scheme of twelve flats, dialled from buildable to hopeless by cost and value. */
const scheme = (buildPerSqft: number, psf: number, asking: number) =>
  autoAppraise({
    units: [{ label: '2-bed flat', count: 12, area: 750, cap: psf, conf: 'high', source: 'probe' }],
    efficiency: 85,
    buildPerSqft,
    profFeePct: 12,
    contingencyPct: 5,
    cilPerSqm: 0,
    s106: 0,
    agentPct: 1.5,
    legalPct: 0.5,
    ltcPct: 65,
    ratePct: 9,
    periodMonths: 18,
    salesMonths: 6,
    arrangementFeePct: 1,
    targetProfitPct: 20,
    acqPct: 6.8,
    asking,
  });

describe('no asking price', () => {
  /**
   * The measurement that named the defect: at a £500/ft² build against £200/ft²
   * values the residual is minus £4.9m — you would have to be PAID nearly five
   * million to take the site on — and the badge said Proceed, in green.
   */
  it('declines a scheme that does not work at any land price', () => {
    const r = scheme(500, 200, 0);
    expect(r.residualNet).toBeLessThan(0);
    expect(r.rocAtAsking).toBeNull();
    expect(screeningVerdict(r, 0)).toBe('Decline');
  });

  it('still proceeds on a scheme the land can support', () => {
    const r = scheme(105, 420, 0);
    expect(r.residualNet).toBeGreaterThan(0);
    expect(screeningVerdict(r, 0)).toBe('Proceed');
  });

  /**
   * The unpriced verdict is the residual's SIGN and nothing else, so the
   * boundary is exactly zero: a site whose scheme leaves nothing over for the
   * land is one you cannot buy, not one you might.
   */
  it('declines at a residual of exactly nothing', () => {
    expect(screeningVerdict({ rocAtAsking: null, headroom: null, residualNet: 0 }, 0)).toBe('Decline');
    expect(screeningVerdict({ rocAtAsking: null, headroom: null, residualNet: 1 }, 0)).toBe('Proceed');
  });

  /**
   * The shape test. Sweeping build cost against sales value walks the residual
   * from comfortably positive to hopeless; the verdict must follow it. A verdict
   * stuck on one value — which is what shipped — fails this in one direction or
   * the other whichever constant is chosen, and so does a verdict computed from
   * anything that is not the residual.
   */
  it('tracks the residual across the whole grid, never one constant', () => {
    const seen = new Set<string>();
    for (const build of [95, 105, 140, 180, 220, 260, 340, 500]) {
      for (const psf of [200, 240, 300, 360, 420, 500]) {
        const r = scheme(build, psf, 0);
        const v = screeningVerdict(r, 0);
        seen.add(v);
        expect(v, `build £${build}/ft², value £${psf}/ft², residual ${Math.round(r.residualNet)}`).toBe(
          r.residualNet > 0 ? 'Proceed' : 'Decline',
        );
      }
    }
    // both outcomes are actually reachable — otherwise the assertion above is
    // satisfied by a grid that only ever exercises one branch
    expect([...seen].sort()).toEqual(['Decline', 'Proceed']);
  });
});

describe('an asking price was given', () => {
  /** Unchanged behaviour: this branch was never the defect and must not move. */
  it('grades on return at asking and land headroom', () => {
    expect(screeningVerdict(scheme(105, 420, 1_200_000), 1_200_000)).toBe('Proceed');
    expect(screeningVerdict(scheme(105, 420, 4_000_000), 4_000_000)).toBe('Decline');
  });

  it('cautions between the thresholds', () => {
    // roc at asking between 0.10 and 0.17, headroom negative but inside 10% of asking
    const r = { rocAtAsking: 0.14, headroom: -50_000, residualNet: 950_000 };
    expect(screeningVerdict(r, 1_000_000)).toBe('Caution');
  });

  it('declines on headroom alone even when the return looks acceptable', () => {
    // 20% return on cost, but the asking is more than 10% over what the land is worth
    const r = { rocAtAsking: 0.2, headroom: -200_000, residualNet: 800_000 };
    expect(screeningVerdict(r, 1_000_000)).toBe('Decline');
  });

  /**
   * A positive residual does NOT rescue a bad price. If the priced branch ever
   * falls through to the unpriced one, this is the test that notices: every
   * input here has a healthy residual and must still be refused.
   */
  it('does not let a healthy residual override a ruinous price', () => {
    for (const asking of [3_000_000, 4_000_000, 6_000_000]) {
      const r = scheme(105, 420, asking);
      expect(r.residualNet).toBeGreaterThan(0);
      expect(screeningVerdict(r, asking)).toBe('Decline');
    }
  });
});

/**
 * The wire shape the screen reads. `roc` is what the "Profit on cost" headline
 * prints; it used to fall back to `targetProfit / (gdv - targetProfit)`, which
 * is the target profit percentage restated — 0.20/0.80 = 25.0% for every
 * unpriced scheme ever screened, including the one worth minus five million.
 * A figure that is the same for all inputs is not a measurement, and the screen
 * now shows an em dash instead, beside the Asking land and Land headroom cells
 * that already did.
 */
describe('autoAppraisal.compute', () => {
  const extraction = (asking: number, psf: number) => ({
    scheme: 'Twelve flats',
    address: '1 Test Road',
    assetType: 'residential' as const,
    units: [{ label: '2-bed flat', count: 12, area: 750, value: psf, conf: 'high' as const, source: 'probe' }],
    efficiency: 85,
    profFee: 12,
    contingency: 5,
    finance: { ltc: 65, rate: 9, period: 18, sales: 6, arrFee: 1 },
    targetProfit: 20,
    asking,
    cilPerSqm: 0,
    s106: 0,
    agent: 1.5,
    legal: 0.5,
    acq: 6.8,
  });

  it('reports no return on cost when no price was named', async () => {
    const out = await caller().autoAppraisal.compute({ extraction: extraction(0, 420), buildPerSqft: 105 });
    expect(out.roc).toBeNull();
    expect(out.profitAtAsking).toBeNull();
    expect(out.verdict).toBe('Proceed');
  });

  it('declines an unbuildable scheme instead of reporting a constant 25%', async () => {
    const out = await caller().autoAppraisal.compute({ extraction: extraction(0, 200), buildPerSqft: 500 });
    expect(out.roc).toBeNull();
    expect(out.residualNet).toBeLessThan(0);
    expect(out.verdict).toBe('Decline');
  });

  it('reports a real return once a price is named', async () => {
    const out = await caller().autoAppraisal.compute({
      extraction: extraction(1_200_000, 420),
      buildPerSqft: 105,
    });
    expect(out.roc).toBeCloseTo(0.35, 2);
    expect(out.verdict).toBe('Proceed');
  });
});
