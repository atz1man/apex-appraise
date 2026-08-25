import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The firm's standing wording, saved by two administrators.
 *
 * This is where a firm keeps the clauses every instruction starts from — and
 * `toeSpecialAssumptions` among them, which `238d265` established is the field
 * that decides what a valuation MEANS. Seventeen fields, loaded once by the
 * settings panel (`if (policy && !form)`) and posted back in full, with
 * `updatedAt` explicitly destructured out and thrown away.
 *
 * `a4b516d` closed the same hole on the per-deal terms. This is the firm-level
 * one above it: a lost update here does not change one instruction, it changes
 * the wording every future instruction will draft from.
 */

let T: Tenant;
const caller = () => callerFor(T.principal);

const policy = (over: Record<string, unknown> = {}) => ({
  aiPolicy: 'Extraction only.',
  toePurpose: 'Secured lending.',
  toeOtherUsers: 'None.',
  toeInterest: 'Freehold.',
  toeExtentOfInvestigation: 'Desktop with inspection.',
  toeSourcesOfInformation: 'Client plans.',
  toeAssumptions: 'Standard RICS assumptions.',
  toeSpecialAssumptions: 'None.',
  toeReportFormat: 'Red Book Global.',
  toeRestrictionsOnUse: 'Addressee only.',
  toeFeeBasis: 'Fixed fee.',
  toeComplaintsProcedure: 'On request.',
  toeValuerReg: '1234567',
  toeLiabilityCap: 250_000,
  covLtgdvMaxPct: 65,
  covLtcMaxPct: 75,
  covMinProfitOnCostPct: 18,
  ...over,
});

const row = () => prisma.orgPolicy.findUniqueOrThrow({ where: { orgId: T.orgId } });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('House style');
  await caller().org.savePolicy(policy() as never);
}, 180_000);

describe('a second admin saving policy they loaded before the first save', () => {
  it('is refused, instead of silently restoring seventeen stale clauses', async () => {
    const opened = await row();

    // the first admin adds the firm's standing special assumption
    await caller().org.savePolicy({
      ...policy({ toeSpecialAssumptions: 'That any planning consent referred to is granted as applied for.' }),
      expectedUpdatedAt: opened.updatedAt,
    } as never);

    // @updatedAt has millisecond resolution; without this the two saves can land
    // in the same tick and the test would be measuring nothing
    await new Promise((r) => setTimeout(r, 5));

    // the second still holds what the panel loaded BEFORE the first saved
    await expect(
      caller().org.savePolicy({ ...policy({ toeFeeBasis: 'Hourly.' }), expectedUpdatedAt: opened.updatedAt } as never),
    ).rejects.toThrow(/after you opened it|Reload/i);

    const after = await row();
    expect(after.toeSpecialAssumptions, 'the standing special assumption was silently removed').toContain('planning consent');
    expect(after.toeFeeBasis, 'the refused save was applied anyway').toBe('Fixed fee.');
  });

  it('demands the stamp rather than accepting a save without one', async () => {
    await expect(caller().org.savePolicy(policy({ toeFeeBasis: 'Hourly.' }) as never)).rejects.toThrow(/stamp|Reload/i);
  });

  it('hands back the new stamp, so the same admin can save twice without reloading', async () => {
    const opened = await row();
    const first = await caller().org.savePolicy({ ...policy({ toePurpose: 'Internal.' }), expectedUpdatedAt: opened.updatedAt } as never);
    expect((first as { updatedAt?: Date }).updatedAt, 'the save did not return its own stamp').toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    // from the save's own response, never a refetch — see a48b7b3
    await caller().org.savePolicy({
      ...policy({ toePurpose: 'Secured lending.' }),
      expectedUpdatedAt: (first as { updatedAt: Date }).updatedAt,
    } as never);
    expect((await row()).toePurpose).toBe('Secured lending.');
  });

  it('needs no stamp the first time, when there is no policy to have changed', async () => {
    const fresh = await makeTenant('First time');
    await expect(callerFor(fresh.principal).org.savePolicy(policy() as never)).resolves.toBeTruthy();
  });
});
