import { beforeAll, describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Editing a deal, and what a person is not allowed to type.
 *
 * deals.update had no caller anywhere in the app — a deal could be created on
 * the Board and never corrected, so a mistyped address stood for the life of the
 * scheme on a document a client is sent.
 *
 * The interesting half is what it USED to accept. Alongside the address it took
 * gdv, forecastProfit, equityRequired, roc and viability: every headline figure
 * on the deal card. Those are written by appraisal.save from computeAppraisal
 * output — the deal row is a cache of engine results, under a comment in
 * appraisal.ts saying exactly that. So the procedure was a way to put a number
 * on the pipeline, in portfolio exposure and in the funding pack that no engine
 * had produced, standing until the next save silently overwrote it.
 *
 * One shared calculation engine for every surface is the rule this product does
 * not bend. It survived only because nothing called the procedure.
 */

let T: Tenant;
let B: Tenant;

const caller = (t: Tenant) => callerFor(t.principal);

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Details');
  B = await makeTenant('Rival');
}, 120_000);

/** Engine-owned figures, as appraisal.save would have left them. */
async function seedEngineFigures(dealId: string) {
  await prisma.deal.update({
    where: { id: dealId },
    data: {
      gdv: 4_278_000_00n,
      forecastProfit: 406_711_36n,
      equityRequired: 900_000_00n,
      roc: 0.25,
      viability: 'PROCEED',
    },
  });
}

describe('the details a person owns', () => {
  it('corrects them, and says so in the trail', async () => {
    await caller(T).deals.update({
      id: T.dealId,
      patch: { name: 'Northgate Yard', address: '14 Northgate Street, Bournemouth', probability: 65, nextMilestone: 'Planning committee' },
    } as never);

    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: T.dealId } });
    expect(deal.name).toBe('Northgate Yard');
    expect(deal.address).toBe('14 Northgate Street, Bournemouth');
    expect(deal.probability).toBe(65);
    expect(deal.nextMilestone).toBe('Planning committee');

    /**
     * The address is not cosmetic — comparables, the site pack and the Red Book
     * report all read it, and a valuer asked months later why a scheme moved
     * street needs an answer.
     */
    const events = await prisma.activityEvent.findMany({ where: { dealId: T.dealId, action: 'edited deal details' } });
    expect(events).toHaveLength(1);
    expect(events[0]!.target).toContain('address');
    expect(events[0]!.target).toContain('name');
  });

  it('records only what actually moved', async () => {
    const before = await prisma.activityEvent.count({ where: { dealId: T.dealId, action: 'edited deal details' } });
    // re-saving the same values is not an edit, and a trail full of no-ops is a
    // trail nobody reads
    await caller(T).deals.update({ id: T.dealId, patch: { name: 'Northgate Yard' } } as never);
    expect(await prisma.activityEvent.count({ where: { dealId: T.dealId, action: 'edited deal details' } })).toBe(before);

    await caller(T).deals.update({ id: T.dealId, patch: { probability: 70 } } as never);
    const latest = await prisma.activityEvent.findFirst({
      where: { dealId: T.dealId, action: 'edited deal details' },
      orderBy: { at: 'desc' },
    });
    expect(latest!.target).toBe('probability');
  });
});

describe('the figures the engine owns', () => {
  it('cannot be typed in through this door', async () => {
    await seedEngineFigures(T.dealId);
    const before = await prisma.deal.findUniqueOrThrow({ where: { id: T.dealId } });

    // a valuer, or anything holding a session, asking for a GDV of its own
    await caller(T).deals.update({
      id: T.dealId,
      patch: {
        address: 'Still editable',
        gdv: 9_999_999,
        forecastProfit: 9_999_999,
        equityRequired: 1,
        roc: 0.99,
        viability: 'PROCEED',
      },
    } as never);

    const after = await prisma.deal.findUniqueOrThrow({ where: { id: T.dealId } });
    // the field it may change, changed
    expect(after.address).toBe('Still editable');
    // and every figure the engine wrote is exactly where the engine left it
    expect(after.gdv).toBe(before.gdv);
    expect(after.forecastProfit).toBe(before.forecastProfit);
    expect(after.equityRequired).toBe(before.equityRequired);
    expect(after.roc).toBe(before.roc);
    expect(after.viability).toBe(before.viability);
  });

  it('is not merely ignored but absent from the contract', () => {
    /**
     * zod strips unknown keys silently, so the test above would pass either way
     * — with the fields removed, and with them still accepted but dropped
     * somewhere downstream. This asks the schema itself, so the two cannot be
     * confused, and it fails the day somebody adds a money field back.
     */
    expect(Object.keys(patchShape()).sort()).toEqual(['address', 'name', 'nextMilestone', 'postcode', 'probability']);
  });
});

describe('somebody else’s deal', () => {
  it('is not editable', async () => {
    await expectDenied('editing another org deal', () =>
      caller(B).deals.update({ id: T.dealId, patch: { name: 'Taken' } } as never),
    );
    const deal = await prisma.deal.findUniqueOrThrow({ where: { id: T.dealId } });
    expect(deal.name).toBe('Northgate Yard');
  });
});


/** The zod shape of deals.update's `patch`, read off the real router. */
function patchShape(): Record<string, unknown> {
  type ZodObjectish = { _def: { shape: () => Record<string, unknown> } };
  const procedures = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { inputs: unknown[] } } > } })._def
    .procedures;
  const input = procedures['deals.update']!._def.inputs[0] as ZodObjectish;
  return (input._def.shape().patch as ZodObjectish)._def.shape();
}

/**
 * A deal created with a postcode keeps it.
 *
 * Measured on a fresh workspace on 4 September: `deals.create` did not name
 * `postcode` in its schema, zod strips what a schema does not name, and the
 * row stored null — so the first thing a new deal's site pack did was ask for
 * the postcode the caller had just supplied. The map, the site pack and the
 * benchmark REGION all hang off that column. `update` has always taken one.
 */
describe('deals.create keeps the postcode it was given', () => {
  it('stores it, and the site pack does not ask for it again', async () => {
    const t = await makeTenant('postcode-create');
    const created = await caller(t).deals.create({ name: 'Postcode Site', address: '1 Quay Road, Poole', postcode: ' BH15 1JF ', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' });
    const row = await prisma.deal.findUniqueOrThrow({ where: { id: created.id }, select: { postcode: true } });
    expect(row.postcode).toBe('BH15 1JF');
    const pack = await caller(t).sitePack.get({ dealId: created.id });
    expect(pack.status).not.toBe('no-postcode');
  });

  it('stores null, not an empty string, when none is given', async () => {
    const t = await makeTenant('postcode-none');
    const created = await caller(t).deals.create({ name: 'No Postcode', address: '2 Quay Road, Poole', assetType: 'RESIDENTIAL' });
    const row = await prisma.deal.findUniqueOrThrow({ where: { id: created.id }, select: { postcode: true } });
    expect(row.postcode).toBeNull();
  });
});
