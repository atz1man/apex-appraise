import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The field app and the workbench, on one inspection.
 *
 * They edit the same row by design — the get procedure calls it "the field app ⇄
 * workbench handoff" — and save wrote every field with no check on what it was
 * overwriting. A surveyor taking notes on a phone and then continuing at a desk
 * lost one or the other, with no version and nothing to say it happened.
 *
 * Offline is what turns that from unlucky into systematic. react-query HOLDS a
 * write made with no signal and replays it on reconnect, so the phone's older
 * copy lands after the desk edit that happened later, by construction. The bar
 * added in the previous commit tells a surveyor their work is held, which is
 * exactly what makes them rely on it.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const rooms = (note: string) => [{ name: 'Kitchen', condition: 4, photos: 0, notes: note }];
const weights = { salesComparison: 60, cost: 20, income: 20 };

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Site');
}, 120_000);

describe('two surfaces on one inspection', () => {
  it('refuses the stale copy instead of silently discarding the newer notes', async () => {
    const first = (await caller().inspections.save({
      dealId: T.dealId,
      rooms: rooms('as found'),
      reconciledValue: 450000,
      approachWeights: weights,
      status: 'draft',
    } as never)) as { id: string; updatedAt: Date };

    // both surfaces are now holding this stamp
    const opened = first.updatedAt;

    // the desk saves first
    await caller().inspections.save({
      id: first.id,
      dealId: T.dealId,
      rooms: rooms('damp to the north wall'),
      reconciledValue: 430000,
      approachWeights: weights,
      status: 'draft',
      expectedUpdatedAt: opened,
    } as never);

    // @updatedAt has millisecond resolution
    await new Promise((r) => setTimeout(r, 5));

    /**
     * The phone's write, queued while offline and replayed now. It carries what
     * the phone had — which no longer includes the damp.
     */
    await expect(
      caller().inspections.save({
        id: first.id,
        dealId: T.dealId,
        rooms: rooms('as found'),
        reconciledValue: 450000,
        approachWeights: weights,
        status: 'submitted',
        expectedUpdatedAt: opened,
      } as never),
    ).rejects.toThrow(/saved.*after you opened it/i);

    const row = await prisma.inspection.findUniqueOrThrow({ where: { id: first.id } });
    expect(JSON.parse(row.rooms)[0].notes, 'the desk notes were overwritten by the phone').toBe('damp to the north wall');
    // and the refusal did not half-apply: the status the phone wanted is not set
    expect(row.status).toBe('draft');
  });

  it('tells a caller that forgot the stamp what to send', async () => {
    const made = (await caller().inspections.save({
      dealId: T.dealId,
      rooms: rooms('second site'),
      reconciledValue: 1,
      approachWeights: weights,
      status: 'draft',
    } as never)) as { id: string };

    await expect(
      caller().inspections.save({
        id: made.id,
        dealId: T.dealId,
        rooms: rooms('changed'),
        reconciledValue: 2,
        approachWeights: weights,
        status: 'draft',
      } as never),
    ).rejects.toThrow(/expectedUpdatedAt/);
  });

  it('needs no stamp to record a first inspection', async () => {
    // nothing to overwrite, so nothing to check
    const other = await makeTenant('Fresh site');
    await expect(
      callerFor(other.principal).inspections.save({
        dealId: other.dealId,
        rooms: rooms('first visit'),
        reconciledValue: 100,
        approachWeights: weights,
        status: 'draft',
      } as never),
    ).resolves.toBeTruthy();
  });

  it('hands back a stamp that works for the next save', async () => {
    // the offline case: a second save must not wait on a refetch to learn the
    // new stamp, because offline the refetch does not happen either
    const made = (await caller().inspections.save({
      dealId: T.dealId,
      rooms: rooms('a'),
      reconciledValue: 1,
      approachWeights: weights,
      status: 'draft',
    } as never)) as { id: string; updatedAt: Date };

    const again = (await caller().inspections.save({
      id: made.id,
      dealId: T.dealId,
      rooms: rooms('b'),
      reconciledValue: 2,
      approachWeights: weights,
      status: 'draft',
      expectedUpdatedAt: made.updatedAt,
    } as never)) as { updatedAt: Date };

    await expect(
      caller().inspections.save({
        id: made.id,
        dealId: T.dealId,
        rooms: rooms('c'),
        reconciledValue: 3,
        approachWeights: weights,
        status: 'draft',
        expectedUpdatedAt: again.updatedAt,
      } as never),
    ).resolves.toBeTruthy();
  });
});
