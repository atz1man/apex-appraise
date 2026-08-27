import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { SCENARIO_ASSUMPTIONS, scenarioMetrics } from '@apex/appraisal-engine';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * One scenario model, not two that agree.
 *
 * The assumptions existed twice — thirteen numbers in
 * apps/web/src/routes/Scenarios.tsx and thirteen in the API, the API's copy
 * carrying the comment "kept in lockstep with the grid in Scenarios.tsx". So did
 * the derivation, and it had already drifted in FORM: the screen takes the
 * engine's totals straight, under a comment recording that it "used to re-add
 * the cost lines and regross the land itself, with its own copy of the
 * acquisition-cost rule". The server was still doing exactly that.
 *
 * Measured across three scenarios, the two agreed to the pound. That is why
 * this test asserts the SHAPE rather than the values: a duplicate that agrees
 * today passes a value comparison, which is how a reverted webhook-event list
 * stayed green earlier on this branch.
 */

let T: Tenant;
const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Scenarios');
}, 120_000);

describe('neither surface keeps its own copy', () => {
  it('the API imports the model rather than defining one', () => {
    const src = read('../src/routers/appraisal.ts');
    expect(src).toContain("from '@apex/appraisal-engine'");
    expect(src, 'the API declared its own assumptions again').not.toMatch(/const SCENARIO_ASSUMPTIONS\s*=/);
    expect(src, 'the API declared its own metrics function again').not.toMatch(/function scenarioMetrics/);
  });

  it('the screen imports it too, and does not re-derive the totals', () => {
    const src = read('../../web/src/routes/Scenarios.tsx');
    expect(src).toContain('scenarioMetrics');
    expect(src, 'the screen declared its own assumptions again').not.toMatch(/const ASSUMPTIONS\s*=\s*\{/);
    // the shape the screen was explicitly fixed to stop using
    expect(src, 'the screen re-grossed the land again').not.toMatch(/residualNet\s*\*\s*\(1\s*\+/);
  });

  it('no copy of the acquisition re-grossing survives on the server either', () => {
    const src = read('../src/routers/appraisal.ts');
    expect(src, 'the server re-grossed the land again').not.toMatch(/residualNet\s*\*\s*\(1\s*\+/);
  });
});

describe('the figures the commentary is written from', () => {
  it('are the ones the grid computes, by construction', async () => {
    /**
     * The deterministic commentary quotes each option's profit on cost, GDV and
     * residual. Those have to be the numbers the shared function produces — the
     * same ones the grid renders — or the prose and the table beside it are two
     * different appraisals.
     */
    const options = [
      { name: 'Option A', descriptor: 'consented', blendedPsf: 430, buildPsf: 190, gia: 22_000, targetProfitPct: 21 },
      { name: 'Option B', descriptor: 'unconsented uplift', blendedPsf: 470, buildPsf: 205, gia: 28_000, targetProfitPct: 24 },
    ];
    for (const o of options) {
      await prisma.scenario.create({ data: { orgId: T.orgId, dealId: T.dealId, ...o } });
    }

    const { commentary } = (await callerFor(T.principal).scenarios.draftRisk(T.dealId as never)) as { commentary: string };
    const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`;

    for (const o of options) {
      const m = scenarioMetrics(o);
      expect(commentary, `${o.name}: profit on cost`).toContain(`${(m.poc * 100).toFixed(1)}% on cost`);
      expect(commentary, `${o.name}: GDV`).toContain(gbp(m.gdv));
      expect(commentary, `${o.name}: residual`).toContain(gbp(m.residual));
    }
  });

  it('name the assumptions they were computed under', async () => {
    // the commentary says "all options assume 60% loan-to-cost at 7.5%"; those
    // numbers have to be the ones the figures used
    expect(SCENARIO_ASSUMPTIONS.ltcPct).toBe(60);
    expect(SCENARIO_ASSUMPTIONS.ratePct).toBe(7.5);
    const src = read('../src/routers/appraisal.ts');
    expect(src).toContain('${SCENARIO_ASSUMPTIONS.ltcPct}');
    expect(src).toContain('${SCENARIO_ASSUMPTIONS.ratePct}');
  });
});
