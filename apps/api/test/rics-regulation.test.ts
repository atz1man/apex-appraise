import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * A claim about the firm, not about the valuation.
 *
 * "RICS Regulated" was a literal in two components — the Red Book cover, its
 * signature seal, and the terms of engagement — printed for every firm on the
 * platform. `Organisation` held no field that could ever have made it true, so
 * the badge said exactly the same thing about a regulated firm and an
 * unregulated one, on documents that go to a lender under professional
 * indemnity.
 *
 * The same defect the Red Book already had to be cured of one level down, where
 * the valuer's name and RICS registration number were hardcoded — "they belong
 * to a real registered valuer who has never seen the property". There the claim
 * was about a person; here it is about the firm.
 *
 * The number rather than a boolean, deliberately: a flag set true with no number
 * is the same unverifiable claim with an extra step, and a reader who can look
 * the firm up on the register is a reader the mark is worth something to.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Regulation');
}, 120_000);

describe('a firm that has declared nothing', () => {
  it('starts with no claim on file', async () => {
    const org = (await caller().org.get()) as { ricsFirmNumber: string };
    expect(org.ricsFirmNumber, 'a new workspace asserted a regulatory status nobody gave it').toBe('');
  });

  it('hands the documents nothing to print', async () => {
    const firm = (await caller().org.firm()) as { ricsFirmNumber: string };
    expect(firm.ricsFirmNumber).toBe('');
    const terms = (await caller().engagement.get(T.dealId as never)) as { orgRicsFirmNumber: string };
    expect(terms.orgRicsFirmNumber).toBe('');
  });
});

describe('a firm that has declared its number', () => {
  it('reaches every document that carries the mark', async () => {
    await caller().org.update({ ricsFirmNumber: '123456' } as never);
    expect(((await caller().org.get()) as { ricsFirmNumber: string }).ricsFirmNumber).toBe('123456');
    expect(((await caller().org.firm()) as { ricsFirmNumber: string }).ricsFirmNumber).toBe('123456');
    const terms = (await caller().engagement.get(T.dealId as never)) as { orgRicsFirmNumber: string };
    expect(terms.orgRicsFirmNumber, 'the terms of engagement could not print the number').toBe('123456');
  });

  it('records who asserted it, because a reviewer will ask about the claim itself', async () => {
    const events = await prisma.activityEvent.findMany({
      where: { orgId: T.orgId, action: 'declared the firm RICS regulated' },
    });
    expect(events.length, 'a regulatory claim was recorded on signed documents with no trail').toBeGreaterThan(0);
    expect(events[0]!.target).toContain('123456');
  });

  it('records the withdrawal too, which is the half a trail usually loses', async () => {
    await caller().org.update({ ricsFirmNumber: '' } as never);
    expect(((await caller().org.get()) as { ricsFirmNumber: string }).ricsFirmNumber).toBe('');
    const events = await prisma.activityEvent.findMany({
      where: { orgId: T.orgId, action: 'withdrew the firm’s RICS regulation' },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.target).toContain('123456');
  });
});
