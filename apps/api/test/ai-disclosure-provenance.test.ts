import { beforeAll, describe, expect, it } from 'vitest';
import { AI_ACTOR } from '../src/ai-disclosure.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Declaring an AI use that did not happen.
 *
 * RICS requires the valuer to state whether and how artificial intelligence was
 * used, and this product does it properly: the declaration is derived from the
 * audit trail rather than hand-written, so it cannot say one thing while the
 * record says another.
 *
 * It was derived from the wrong fact. `model` was set to
 * `ANTHROPIC_API_KEY ? NARRATIVE_MODEL : 'demo'` — a fact about the deployment,
 * not about the words on the page — and the AI_ACTOR audit event was filed
 * whichever produced them. So a valuation whose commentary a deterministic
 * template wrote carried "Artificial intelligence was used in preparing this
 * valuation", in the section that exists to be accurate about exactly that.
 *
 * Worse with a key configured: when the figure guard rejected the model's draft
 * and the template was used instead, the report NAMED the model that had not
 * written the sentences it was credited with.
 */

let T: Tenant;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Disclosure');
}, 120_000);

const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
  const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.entries(env).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  try {
    await run();
  } finally {
    Object.entries(before).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
  }
};

/** A deal with a current appraisal, ready to draft a narrative for. */
async function dealWithAppraisal(t: Tenant) {
  const caller = callerFor(t.principal);
  await caller.appraisal.save({
    dealId: t.dealId,
    source: 'manual',
    input: {
      units: [{ label: 'Houses', count: 10, area: 1000, cap: 400, conf: 'high', source: 'note' }],
      efficiency: 90,
      trades: [{ label: 'Build', rate: 150 }],
      profFeePct: 11,
      contingencyPct: 5,
      otherCosts: [],
      finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 3, arrangementFeePct: 1.5, spendProfile: 'scurve' },
      site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
      disposal: { agentPct: 1.5, legalPct: 0.5 },
      targetProfitOnGdvPct: 20,
    },
  } as never);
  return caller;
}

describe('what the valuation says about how it was written', () => {
  it('does not declare an AI use when a template wrote the words', async () => {
    const caller = await dealWithAppraisal(T);

    await withEnv({ ANTHROPIC_API_KEY: undefined }, async () => {
      const payload = (await caller.appraisal.draftNarrative(T.dealId)) as { model: string };
      expect(payload.model, 'the prose came from the template, and the record should say so').toBe('template');
    });

    const disclosure = (await caller.appraisal.aiDisclosure(T.dealId)) as { used: boolean; model: string | null };
    expect(
      disclosure.used,
      'a signed valuation declared that AI was used to prepare it, over prose no model wrote',
    ).toBe(false);
    expect(disclosure.model).toBe('template');
  });

  it('files the audit event against the person, not the AI, when no model ran', async () => {
    // the drafting is still recorded — the trail should show a narrative was
    // produced — but not as an AI use, because it was not one
    const events = await prisma.activityEvent.findMany({
      where: { dealId: T.dealId, action: 'drafted Red Book narrative for' },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.actor !== AI_ACTOR), 'the template was filed as an AI use').toBe(true);
    expect(events.some((e) => e.actor === T.principal.name)).toBe(true);
  });
});
