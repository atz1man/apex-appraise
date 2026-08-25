import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Two people drafting one instruction.
 *
 * `238d265` established what these terms are for: the special assumptions a Red
 * Book valuation declares are the ones recorded HERE, and the narrative guard
 * checks the report against them. So this is not a form — it is the document a
 * valuation's meaning is measured by.
 *
 * The form holds nineteen fields. It loads them once (`if (saved && !terms)`)
 * and posts every one of them back, which is the same shape as the appraisal
 * workfile in `b39f174`, the phone/desk handoff in `81c398b` and the sales
 * drawer in `a48b7b3` — three separate findings of one defect. An analyst
 * drafting while a director revises meant the second save carried nineteen
 * fields read before the first, and silently restored all of them.
 *
 * The one that costs money is `specialAssumptions`: a director adding "assuming
 * planning is granted" could have it removed by an analyst who never saw it,
 * with no version, no conflict and no event — and the valuation would then be
 * checked against terms nobody meant.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const terms = (over: Record<string, unknown> = {}) => ({
  clientName: 'Northgate Estates Ltd',
  clientAddress: '1 Client Road, London',
  otherUsers: 'None',
  purpose: 'Secured lending',
  interest: 'Freehold',
  basisOfValue: 'Market Value',
  valuationDate: '2026-06-30',
  extentOfInvestigation: 'Desktop with site inspection',
  sourcesOfInformation: 'Client-supplied plans',
  assumptions: 'Standard RICS assumptions apply.',
  specialAssumptions: 'None.',
  reportFormat: 'Red Book Global',
  restrictionsOnUse: 'For the addressee only.',
  feeBasis: 'Fixed fee',
  liabilityCap: 250_000,
  complaintsProcedure: 'Available on request.',
  aiUse: 'Used for extraction only.',
  valuerName: 'A Valuer MRICS',
  valuerReg: '1234567',
  ...over,
});

const row = () => prisma.engagementTerms.findFirstOrThrow({ where: { dealId: T.dealId } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Instruction');
  await caller().engagement.save({ dealId: T.dealId, terms: terms() } as never);
}, 180_000);

describe('a second person saving terms they loaded before the first save', () => {
  it('is refused, instead of silently restoring nineteen stale fields', async () => {
    const opened = await row();

    // the director adds the special assumption that decides what the figure means
    await caller().engagement.save({
      dealId: T.dealId,
      terms: terms({ specialAssumptions: 'That full planning permission for 10 dwellings is granted.' }),
      expectedUpdatedAt: opened.updatedAt,
    } as never);

    // @updatedAt has millisecond resolution; without this the two saves can land
    // in the same tick and the test would be measuring nothing
    await new Promise((r) => setTimeout(r, 5));

    // the analyst still holds what the page loaded BEFORE the director saved
    await expect(
      caller().engagement.save({
        dealId: T.dealId,
        terms: terms({ feeBasis: 'Hourly' }),
        expectedUpdatedAt: opened.updatedAt,
      } as never),
    ).rejects.toThrow(/changed|reload/i);

    const after = await row();
    expect(after.specialAssumptions, 'the special assumption was silently removed').toContain('planning permission');
    expect(after.feeBasis, 'the refused save was applied anyway').toBe('Fixed fee');
  });

  it('demands the stamp rather than accepting a save without one', async () => {
    /**
     * Optional-when-present is how this hole reopens for whoever forgets next —
     * `appraisal.save` and `inspections.save` both demand it for the same reason.
     * Creating the first version needs none: there is nothing to have changed.
     */
    await expect(
      caller().engagement.save({ dealId: T.dealId, terms: terms({ feeBasis: 'Hourly' }) } as never),
    ).rejects.toThrow(/reload|changed|stamp/i);
  });

  it('hands back the new stamp, so the same person can save twice without reloading', async () => {
    const opened = await row();
    const first = await caller().engagement.save({
      dealId: T.dealId,
      terms: terms({ purpose: 'Internal appraisal' }),
      expectedUpdatedAt: opened.updatedAt,
    } as never);

    expect((first as { updatedAt?: Date }).updatedAt, 'the save did not return its own stamp').toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));

    /**
     * `a48b7b3` found this by mutation: the drawer re-read the stamp from the
     * LIST rather than from the save's own response, so a second edit was
     * refused as a conflict with itself. Whatever the client holds after a save
     * has to come from the save.
     */
    await caller().engagement.save({
      dealId: T.dealId,
      terms: terms({ purpose: 'Secured lending' }),
      expectedUpdatedAt: (first as { updatedAt: Date }).updatedAt,
    } as never);
    expect((await row()).purpose).toBe('Secured lending');
  });
});
