import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { appRouter } from '../src/router.js';
import { FAILURE_LIMIT, drainWebhooks, emitWebhook } from '../src/webhook-delivery.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * A row this server parks on its own, a person can unpark.
 *
 * `drainWebhooks` sets `active: false` on an endpoint after FAILURE_LIMIT
 * consecutive failures, which is right: an address that does not answer should
 * stop being posted to. Nothing anywhere set it back. `active: true` appeared
 * exactly once in this server — as the column default — so the only way out of
 * the parked state was Remove and Add again, and that mints a NEW signing
 * secret the receiver has to be re-keyed with. An integration that was down for
 * an afternoon needed a deployment to come back.
 *
 * Two more things the same defect was hiding, both found while writing this:
 *
 *   the PANEL showed neither `active` nor `lastAttemptAt`, though the query had
 *   always selected both — so a parked endpoint was indistinguishable from a
 *   working one on the only screen about it;
 *
 *   and the parking never fired for the commonest failure at all. The HTTP path
 *   stamped the endpoint row; the `catch` path — refused connection, DNS gone,
 *   timeout — updated the delivery and left the endpoint untouched. A receiver
 *   that answered badly was parked after twenty tries; one whose host had
 *   vanished was posted to for ever, with `failureCount` at zero and
 *   `lastAttemptAt` null.
 */

let T: Tenant;
const admin = () => callerFor({ ...T.principal, role: 'ADMIN' });

const endpoint = () => prisma.webhookEndpoint.findFirstOrThrow({ where: { orgId: T.orgId } });

const add = (url: string) =>
  admin().org.createWebhook({ url, events: ['deal.created'] } as never) as Promise<{ id: string; secret: string }>;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('HookResume');
}, 120_000);

describe('a parked endpoint can be resumed', () => {
  let madeId = '';
  let secret = '';

  beforeAll(async () => {
    const made = await add('https://receiver.example.com/apex');
    madeId = made.id;
    secret = made.secret;
    // one failure short of the limit, then the failure that parks it
    await prisma.webhookEndpoint.update({ where: { id: madeId }, data: { failureCount: FAILURE_LIMIT - 1 } });
    await emitWebhook(prisma, T.orgId, 'deal.created', { dealId: 'd1' });
    await drainWebhooks(prisma, { deliver: async () => ({ status: 503 }) });
  });

  it('is parked to begin with, and no longer selected for delivery', async () => {
    expect((await endpoint()).active).toBe(false);
    await emitWebhook(prisma, T.orgId, 'deal.created', { dealId: 'd2' });
    expect(await prisma.webhookDelivery.count({ where: { endpointId: madeId } })).toBe(1);
  });

  it('comes back, with the failure count cleared so it does not park again at once', async () => {
    await admin().org.resumeWebhook({ id: madeId } as never);
    const back = await endpoint();
    expect(back.active).toBe(true);
    expect(back.failureCount, 'resuming on twenty failures parks it again on the first delivery').toBe(0);
  });

  /** The whole reason delete-and-recreate was not an answer. */
  it('keeps the signing secret, so the receiver does not have to be re-keyed', async () => {
    const minted = await add('https://second.example.com/apex');
    expect(minted.secret).not.toBe(secret);
    // and the resumed row still holds the original, sealed
    const row = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: madeId } });
    expect(row.secret).not.toBe('');
    await prisma.webhookEndpoint.delete({ where: { id: minted.id } });
  });

  it('sends again once it is back', async () => {
    await emitWebhook(prisma, T.orgId, 'deal.created', { dealId: 'd3' });
    const sent: string[] = [];
    await drainWebhooks(prisma, {
      deliver: async (url) => {
        sent.push(url);
        return { status: 200 };
      },
    });
    expect(sent).toContain('https://receiver.example.com/apex');
  });

  it('writes the resumption to the audit trail', async () => {
    const events = await prisma.activityEvent.findMany({
      where: { orgId: T.orgId, action: 'resumed a webhook endpoint' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.target).toBe('https://receiver.example.com/apex');
  });

  it('refuses another firm’s endpoint', async () => {
    const other = await makeTenant('HookResumeOther');
    const theirs = await callerFor({ ...other.principal, role: 'ADMIN' }).org.createWebhook({
      url: 'https://theirs.example.com/apex',
      events: ['deal.created'],
    } as never) as { id: string };
    await expect(admin().org.resumeWebhook({ id: theirs.id } as never)).rejects.toThrow(/NOT_FOUND|not found/i);
  });

  /**
   * The address is checked again, not trusted from when it was added.
   * `outbound.ts` holds that rule for exactly this reason: DNS moves, and a
   * resume is the act of pointing this server at that address again. An
   * endpoint parked while its host changed hands is the case.
   */
  it('refuses to resume an endpoint that now points inside the network', async () => {
    const parked = await prisma.webhookEndpoint.create({
      data: {
        orgId: T.orgId,
        url: 'https://localhost/apex',
        secret: 'sealed',
        events: 'deal.created',
        active: false,
        createdById: T.userId,
      },
    });
    await expect(admin().org.resumeWebhook({ id: parked.id } as never)).rejects.toThrow();
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: parked.id } })).active).toBe(false);
    await prisma.webhookEndpoint.delete({ where: { id: parked.id } });
  });
});

/**
 * The failure the parking rule never saw.
 *
 * `postWebhook` THROWS for a refused connection, a DNS failure or a timeout —
 * the commonest way a receiver goes away, and the one the file's own comment
 * calls "the likelier failure of the two". That path updated the delivery and
 * never touched the endpoint, so the twenty-failure rule applied only to
 * receivers polite enough to answer.
 */
describe('an endpoint whose host has gone is parked too', () => {
  let id = '';

  beforeAll(async () => {
    const t = await makeTenant('HookDead');
    const made = (await callerFor({ ...t.principal, role: 'ADMIN' }).org.createWebhook({
      url: 'https://gone.example.com/apex',
      events: ['deal.created'],
    } as never)) as { id: string };
    id = made.id;
    await prisma.webhookEndpoint.update({ where: { id }, data: { failureCount: FAILURE_LIMIT - 1 } });
    await emitWebhook(prisma, t.orgId, 'deal.created', { dealId: 'd1' });
    const due = await prisma.webhookDelivery.findFirstOrThrow({ where: { orgId: t.orgId } });
    await drainWebhooks(prisma, {
      now: () => due.nextAttemptAt,
      deliver: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
  });

  it('counts the failure against the endpoint, not only the delivery', async () => {
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id } })).failureCount).toBe(FAILURE_LIMIT);
  });

  it('records that it was tried, so the panel can say when', async () => {
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id } })).lastAttemptAt).not.toBeNull();
  });

  it('parks it at the same limit as a receiver that answers badly', async () => {
    expect((await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id } })).active).toBe(false);
  });
});

/* ------------------------- the sweep ------------------------- */

const SRC = join(import.meta.dirname, '..', 'src');

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return full.endsWith('.ts') ? [full] : [];
  });

/**
 * Comments become blank space rather than vanishing, so a comment explaining a
 * parking rule does not read AS the rule and a line number does not drift up by
 * however much prose sat above it. `route-reachable` and `announcements` both
 * had to learn this, each after a sweep passed on the strength of its own
 * explanatory comment.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');

/**
 * The models a chunk of source DISABLES, and the models it RE-ENABLES.
 *
 * A write is attributed to the nearest `prisma.<model>.` above it, not to a
 * name→model map over the whole chunk. `destructive` reads its bindings the
 * same way and for the same reason: a whole-file map attributes every write to
 * whichever model was declared last, which gives the right count under the
 * wrong name — and somebody reads the name.
 */
const modelsWritten = (src: string, value: 'true' | 'false'): string[] => {
  const clean = stripComments(src);
  const out: string[] = [];
  for (const m of clean.matchAll(new RegExp(`active:\\s*${value}`, 'g'))) {
    const owner = [...clean.slice(0, m.index).matchAll(/prisma\.(\w+)\.(?:update|updateMany|upsert|create)\(/g)].pop();
    if (owner) out.push(owner[1]!);
  }
  return out;
};

/** Where in this server a row is parked, by model. */
const parkedModels = (): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  for (const file of sources(SRC)) {
    for (const model of modelsWritten(readFileSync(file, 'utf8'), 'false')) {
      found.set(model, [...(found.get(model) ?? []), file.slice(SRC.length + 1)]);
    }
  }
  return found;
};

/** Which models a MUTATION on the real router puts back, by model. */
const restorers = (): Map<string, string[]> => {
  const procs = (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string; resolver?: unknown } }> } })
    ._def.procedures;
  const found = new Map<string, string[]>();
  for (const [path, p] of Object.entries(procs)) {
    if (p._def.type !== 'mutation') continue;
    for (const model of modelsWritten(String(p._def.resolver ?? ''), 'true')) {
      found.set(model, [...(found.get(model) ?? []), path]);
    }
  }
  return found;
};

describe('nothing this server parks on its own stays parked', () => {
  /**
   * Narrow on purpose, and the narrowness IS the rule.
   *
   * A flag a PERSON sets is not this sweep's business. `revokedAt` on an API
   * key and on a report share is one-way by design — revoking is meant to be
   * final and you mint a new one — and the SSO `enforced` switch is a one-way
   * door guarded on its own terms. What needs an undo is a flag this server
   * flips AGAINST a customer without being asked, because they never chose it
   * and so cannot be expected to know how to reverse it. Widen it to a second
   * such flag when there is one, rather than to every boolean column.
   */
  it('finds the places that park a row, from the real sources', () => {
    expect([...parkedModels().keys()], 'the known parking site has moved or gone').toContain('webhookEndpoint');
  });

  it('has something a person can reach for every one of them', () => {
    const back = restorers();
    const stuck = [...parkedModels().entries()]
      .filter(([model]) => !back.has(model))
      .map(([model, files]) => `${model} is parked in ${files.join(', ')} and no mutation sets active back to true`);
    expect(
      stuck,
      'A row this server disables by itself needs a procedure that re-enables it. Delete-and-recreate is not one: '
        + `it changes the identity a receiver was configured with.\n  ${stuck.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * Finds what it is meant to be sweeping. A sweep over source that matched
   * nothing passes silently, reporting success for a question it never asked —
   * so the matcher is run over planted source carrying both shapes it has to
   * tell apart, and over the two things that produce a confident wrong answer
   * rather than an error.
   */
  describe('the matcher itself', () => {
    it('finds a parking write and names its own model', () => {
      expect(
        modelsWritten(`await prisma.planningFeed.update({ where: { id }, data: { active: false } });`, 'false'),
      ).toEqual(['planningFeed']);
    });

    it('attributes each write to its nearest model, not the last one in the file', () => {
      const two = `
        await prisma.webhookEndpoint.update({ data: { active: false } });
        await prisma.planningFeed.update({ data: { active: false } });
      `;
      expect(modelsWritten(two, 'false')).toEqual(['webhookEndpoint', 'planningFeed']);
    });

    it('does not read a comment about parking as a parking write', () => {
      const prose = `
        // an endpoint that keeps failing gets active: false
        /** prisma.planningFeed.update sets active: false after a run of failures */
        await prisma.webhookEndpoint.update({ data: { failureCount: 0 } });
      `;
      expect(modelsWritten(prose, 'false')).toEqual([]);
    });

    it('does not count a parking write as a restoration, or the reverse', () => {
      const src = `await prisma.planningFeed.update({ data: { active: false } });`;
      expect(modelsWritten(src, 'true')).toEqual([]);
      expect(modelsWritten(`await prisma.planningFeed.update({ data: { active: true } });`, 'false')).toEqual([]);
    });

    /** The real router, through the matcher: the fix is what satisfies it. */
    it('sees the procedure that answers this defect', () => {
      expect(restorers().get('webhookEndpoint')).toContain('org.resumeWebhook');
    });
  });
});
