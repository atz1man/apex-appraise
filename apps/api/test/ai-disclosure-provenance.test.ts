import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AI_ACTOR, AI_TOUCHPOINTS } from '../src/ai-disclosure.js';
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

/**
 * The same fault in the other two touchpoints.
 *
 * Fixing the Red Book narrative fixed one of four. AI_TOUCHPOINTS declares
 * extraction, narrative, data-room questions and scenario risk commentary, and
 * the disclosure lists whichever appear in the audit trail under AI_ACTOR.
 *
 * Extraction was safe by construction — it only files the event for documents,
 * and reading documents requires a key. The other two were not.
 */
describe('the other AI touchpoints', () => {
  const aiEvents = (dealId: string, action: string) =>
    prisma.activityEvent.count({ where: { dealId, action, actor: AI_ACTOR } });

  it('does not declare scenario risk commentary as an AI use when a template wrote it', async () => {
    const t = await makeTenant('Scenarios');
    const caller = callerFor(t.principal);
    // two options are the minimum the comparison needs
    for (const [name, psf] of [['Option A', 400], ['Option B', 430]] as const) {
      await caller.scenarios.upsert({
        dealId: t.dealId, name, descriptor: '10 houses',
        gia: 10_000, blendedPsf: psf, buildPsf: 150, targetProfitPct: 20,
      } as never);
    }

    await withEnv({ ANTHROPIC_API_KEY: undefined }, async () => {
      await caller.scenarios.draftRisk(t.dealId as never);
    });

    expect(
      await aiEvents(t.dealId, 'drafted scenario risk commentary for'),
      'a template was filed as an AI use, and would print in the valuation’s AI declaration',
    ).toBe(0);
    // still recorded, under whoever asked — the trail should show it happened
    expect(
      await prisma.activityEvent.count({
        where: { dealId: t.dealId, action: 'drafted scenario risk commentary for', actor: t.principal.name },
      }),
    ).toBe(1);

    const disclosure = (await caller.appraisal.aiDisclosure(t.dealId)) as { items: Array<{ key: string }> };
    expect(disclosure.items.map((i) => i.key)).not.toContain('scenarioRisk');
  });

  it('does not declare a data-room question as an AI use when no model answered it', async () => {
    const t = await makeTenant('Workfile');
    await prisma.document.create({
      data: {
        orgId: t.orgId, dealId: t.dealId, name: 'Cost plan.pdf', category: 'Cost plans',
        ext: 'pdf', sizeBytes: BigInt(1000), extraction: 'STORED', url: '/uploads/files/1-cost-plan.pdf',
      },
    });

    await withEnv({ ANTHROPIC_API_KEY: undefined }, async () => {
      const res = (await callerFor(t.principal).documents.ask({
        dealId: t.dealId, question: 'What is the contingency?',
      } as never)) as { status: string; answer: string };
      // the "answer" is a sentence telling the reader to configure a key
      expect(res.status).toBe('demo');
      expect(res.answer).toMatch(/ANTHROPIC_API_KEY/);
    });

    expect(
      await aiEvents(t.dealId, 'asked the workfile about'),
      'a canned non-answer was filed as an AI use',
    ).toBe(0);
    const disclosure = (await callerFor(t.principal).appraisal.aiDisclosure(t.dealId)) as {
      used: boolean;
      items: Array<{ key: string }>;
    };
    expect(disclosure.items.map((i) => i.key)).not.toContain('dataroom');
    expect(disclosure.used, 'the valuation declared an AI use over a model that was never called').toBe(false);
  });

  it('declares every touchpoint that IS a real AI use', () => {
    /**
     * The converse matters as much: under-declaring is worse than over. Each
     * touchpoint's `action` must be written by some procedure, or a genuine AI
     * use would never reach the disclosure.
     */
    const src = ['appraisal.ts', 'ops.ts']
      .map((f) => readFileSync(new URL(`../src/routers/${f}`, import.meta.url), 'utf8'))
      .join('\n');
    for (const t of AI_TOUCHPOINTS) {
      expect(src, `no procedure writes "${t.action}" — ${t.label} could never be disclosed`).toContain(
        `'${t.action}'`,
      );
    }
  });
});
