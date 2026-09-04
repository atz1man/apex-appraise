import { computeAppraisal } from '@apex/appraisal-engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../src/demo-seed.js';
import { appraisalRowToEngineInput } from '../src/mappers.js';
import { prisma, resetDatabase } from './harness.js';

/**
 * Every demo deal carries what its STAGE implies.
 *
 * Measured on 4 September, signed in and walking every deal and every tab
 * with a browser: the demo workspace rendered 197 empty states. Eight of its
 * eleven deals were shells — a name, a stage and a headline GDV, with no
 * appraisal behind the figure, no comparables, no scenarios, no terms, no
 * documents. A scheme marked COMPLETED had never had a cost plan. The
 * marketing page promises "appraisals, comparables, cost monitoring, sales"
 * and the only workspace anyone can try showed each of those on one deal.
 *
 * `demo-seed-depth.ts` fills the eleven in by stage. This says it stays
 * filled: it seeds the throwaway database exactly as `prisma/seed.ts` and the
 * demo reset do, then asks each deal for the rows its stage promises. A
 * twelfth deal added to `SPECS` as a shell fails here naming the deal and the
 * table. After the fill the same walk rendered 96, every one of them either
 * stage-appropriate (no cost plan on a scheme still being appraised), the
 * extraction screen's idle state before a run, or a live open-data panel the
 * test host cannot reach.
 *
 * The second rule is the one the seed's own comment used to get wrong: a
 * closed-out cost plan's budgets sum to the appraisal's construction cost TO
 * THE PENNY, checked by running the engine on the stored row rather than by
 * repeating the seed's arithmetic. The first version priced the packages over
 * net area where the engine prices over gross, and the cost monitor read a 12%
 * saving nobody had earned. The comment said "to the pound" throughout.
 */

const RANK = { SOURCING: 0, APPRAISAL: 1, OFFER: 2, ACQUISITION: 3, CONSTRUCTION: 4, SALES_LETTING: 5, COMPLETED: 6 } as const;
type Stage = keyof typeof RANK;
const atLeast = (s: string, floor: Stage) => (RANK[s as Stage] ?? -1) >= RANK[floor];

let orgId: string;

beforeAll(async () => {
  resetDatabase();
  orgId = await seedDemo(prisma);
});

async function dealsWithCounts() {
  return prisma.deal.findMany({
    where: { orgId },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      stage: true,
      postcode: true,
      _count: { select: { appraisals: true, comparables: true, scenarios: true, documents: true, tasks: true, units: true, costPackages: true, sitePhotos: true, inspections: true } },
    },
  });
}

describe('demo seed depth', () => {
  it('gives every deal the rows its stage implies', async () => {
    const deals = await dealsWithCounts();
    const terms = new Set((await prisma.engagementTerms.findMany({ where: { orgId }, select: { dealId: true } })).map((t) => t.dealId));
    const activity = new Set((await prisma.activityEvent.findMany({ where: { orgId }, select: { dealId: true } })).map((a) => a.dealId));
    const missing: string[] = [];
    for (const d of deals) {
      const c = d._count;
      const want: Array<[string, boolean]> = [
        ['documents', c.documents > 0],
        ['tasks', c.tasks > 0],
        ['activity', activity.has(d.id)],
        ['a geocode the map can render offline', !!d.postcode],
      ];
      if (atLeast(d.stage, 'APPRAISAL')) {
        want.push(['an appraisal', c.appraisals > 0], ['comparables (three or more)', c.comparables >= 3], ['scenarios', c.scenarios > 0], ['terms of engagement', terms.has(d.id)]);
      }
      if (atLeast(d.stage, 'CONSTRUCTION')) {
        want.push(['a cost plan', c.costPackages > 0], ['site photos', c.sitePhotos > 0], ['a field inspection', c.inspections > 0], ['units', c.units > 0]);
      }
      for (const [what, ok] of want) if (!ok) missing.push(`${d.name} (${d.stage}) lacks ${what}`);
    }
    expect(missing, `a deal that is a shell on the demo:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('caches a geocode for every deal so the map renders with no route to postcodes.io', async () => {
    const deals = await dealsWithCounts();
    const keys = new Set((await prisma.openDataCache.findMany({ where: { key: { startsWith: 'geocode:' } }, select: { key: true } })).map((r) => r.key));
    const missing = deals.filter((d) => !keys.has(`geocode:${(d.postcode ?? '').replace(/\s+/g, '').toUpperCase()}`)).map((d) => d.name);
    expect(missing).toEqual([]);
  });

  it('sums a closed-out cost plan to the appraisal’s construction cost, to the penny', async () => {
    const deals = await dealsWithCounts();
    const closed = deals.filter((d) => atLeast(d.stage, 'SALES_LETTING'));
    expect(closed.length, 'the demo has a scheme past construction').toBeGreaterThan(0);
    for (const d of closed) {
      const row = await prisma.appraisal.findFirst({ where: { dealId: d.id, isCurrent: true } });
      expect(row, `${d.name} has a current appraisal`).toBeTruthy();
      const engine = computeAppraisal(appraisalRowToEngineInput(row!));
      const budgets = await prisma.costPackage.findMany({ where: { dealId: d.id }, select: { budget: true, progressPct: true } });
      const sum = budgets.reduce((a, b) => a + b.budget, 0n);
      expect(sum, `${d.name}: package budgets vs engine build`).toBe(BigInt(Math.round(engine.build * 100)));
      expect(budgets.every((b) => b.progressPct === 100), `${d.name}: every package certified`).toBe(true);
    }
  });

  /** A sweep over an empty list passes in silence. This says it seeded what it thinks it did. */
  it('finds the deals it is meant to be checking', async () => {
    const deals = await dealsWithCounts();
    expect(deals.length).toBeGreaterThanOrEqual(11);
    expect(new Set(deals.map((d) => d.stage)).size).toBeGreaterThanOrEqual(6);
    expect(deals.map((d) => d.name)).toContain('Northgate Trade & Industrial Park');
  });
});
