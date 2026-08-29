import { beforeAll, describe, expect, it } from 'vitest';
import { anonymous, callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

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


/**
 * Two signatures on one instruction.
 *
 * `sign` is a PUBLIC procedure reached by anyone holding the link, and it read
 * the status, saw it was not ACCEPTED, and then wrote — the exact shape
 * `a0acf31` found across the three payment paths and fixed with a
 * compare-and-set. A double-click is the ordinary way in. Measured before the
 * fix:
 *
 *   outcomes            fulfilled, fulfilled
 *   signedName recorded Jane Marchmont
 *   SIGNATURE EVENTS    2 — Somebody Else | Jane Marchmont
 *
 * Two people recorded as having signed one set of terms, both told they had,
 * and the signature evidence — who agreed, when, from which address — left as
 * whichever write happened to land last. This is the document `238d265`
 * established a Red Book valuation's meaning is measured against.
 */
describe('two people signing the same terms at once', () => {
  const SIGNED = 'signed the terms of engagement for';

  it('records one signature, one signatory and one event', async () => {
    const S = await makeTenant('Countersign');
    await callerFor(S.principal).engagement.save({ dealId: S.dealId, terms: terms() } as never);
    await callerFor(S.principal).engagement.issue({ dealId: S.dealId } as never);
    const issued = await prisma.engagementTerms.findFirstOrThrow({ where: { dealId: S.dealId } });
    const token = issued.signToken!;

    const settled = await Promise.allSettled([
      anonymous().engagement.sign({ token, name: 'Jane Marchmont', agreed: true } as never),
      anonymous().engagement.sign({ token, name: 'Somebody Else', agreed: true } as never),
    ]);
    const won = settled.filter((r) => r.status === 'fulfilled');
    expect(won, 'exactly one signature is accepted').toHaveLength(1);
    for (const r of settled) {
      if (r.status === 'rejected') expect(String((r.reason as Error).message)).toMatch(/already been signed/i);
    }

    const after = await prisma.engagementTerms.findFirstOrThrow({ where: { dealId: S.dealId } });
    const events = await prisma.activityEvent.findMany({ where: { dealId: S.dealId, action: SIGNED } });
    expect(events, 'one instruction, one signature in the trail').toHaveLength(1);

    /**
     * The trail and the document must name the SAME person. Counting events
     * alone would pass a fix that recorded once while letting the loser
     * overwrite the signature block.
     */
    expect(after.signedName).toBe(events[0]!.actor);
    expect(after.acceptedBy).toBe(after.signedName);
    expect(after.signedAt).not.toBeNull();
    expect(after.signedIp).not.toBeNull();
  });

  it('still refuses a second signature arriving later, with the same sentence', async () => {
    // the sequential path the pre-check answers — it must not have been lost
    const S = await makeTenant('Countersign2');
    await callerFor(S.principal).engagement.save({ dealId: S.dealId, terms: terms() } as never);
    await callerFor(S.principal).engagement.issue({ dealId: S.dealId } as never);
    const token = (await prisma.engagementTerms.findFirstOrThrow({ where: { dealId: S.dealId } })).signToken!;

    await anonymous().engagement.sign({ token, name: 'Jane Marchmont', agreed: true } as never);
    await expect(
      anonymous().engagement.sign({ token, name: 'Somebody Else', agreed: true } as never),
    ).rejects.toThrow(/already been signed/i);

    const after = await prisma.engagementTerms.findFirstOrThrow({ where: { dealId: S.dealId } });
    expect(after.signedName, 'the later caller overwrote the signature block').toBe('Jane Marchmont');
    expect(await prisma.activityEvent.count({ where: { dealId: S.dealId, action: SIGNED } })).toBe(1);
  });
});


/**
 * An electronic signature is not something the firm can type over.
 *
 * `engagement.accept` records acceptance that reached the firm some other way —
 * an email, a phone call, a wet signature by post — which is a real need. What
 * it must not do is REPLACE a signature the client already gave. It rewrote
 * `acceptedBy` and `acceptedAt` and left the signature block alone, so one row
 * asserted two different acceptances at once:
 *
 *   acceptedBy   Someone At The Firm     (typed, just now)
 *   signedName   Jane Marchmont          (signed, with the IP it came from)
 *
 * Same rule `approved-immutable` states for an approved appraisal: a thing that
 * has been signed off is not edited in place.
 */
describe('recording acceptance over a signature', () => {
  const issued = async (label: string) => {
    const S = await makeTenant(label);
    await callerFor(S.principal).engagement.save({ dealId: S.dealId, terms: terms() } as never);
    await callerFor(S.principal).engagement.issue({ dealId: S.dealId } as never);
    const row = await prisma.engagementTerms.findFirstOrThrow({ where: { dealId: S.dealId } });
    return { S, token: row.signToken! };
  };

  it('is refused once the client has signed, and leaves the signature intact', async () => {
    const { S, token } = await issued('Overtype');
    await anonymous().engagement.sign({ token, name: 'Jane Marchmont', agreed: true } as never);

    await expect(
      callerFor(S.principal).engagement.accept({ dealId: S.dealId, acceptedBy: 'Someone At The Firm' } as never),
    ).rejects.toThrow(/signed electronically/i);

    const after = await prisma.engagementTerms.findFirstOrThrow({ where: { dealId: S.dealId } });
    expect(after.acceptedBy, 'the typed name replaced the signatory').toBe('Jane Marchmont');
    expect(after.signedName).toBe('Jane Marchmont');
    // the two records of who accepted must not diverge
    expect(after.acceptedBy).toBe(after.signedName);
    expect(after.acceptedAt?.getTime()).toBe(after.signedAt?.getTime());
  });

  it('still records acceptance that arrived some other way', async () => {
    // the case this procedure exists for: issued, never signed electronically,
    // accepted by email or post. Refusing that would break a real workflow.
    const { S } = await issued('ByPost');
    const out = (await callerFor(S.principal).engagement.accept({
      dealId: S.dealId,
      acceptedBy: 'Jane Marchmont (by post)',
    } as never)) as { status: string; acceptedBy: string | null };
    expect(out.status).toBe('ACCEPTED');
    expect(out.acceptedBy).toBe('Jane Marchmont (by post)');
    const after = await prisma.engagementTerms.findFirstOrThrow({ where: { dealId: S.dealId } });
    expect(after.signedAt, 'no electronic signature was invented').toBeNull();
  });
});
