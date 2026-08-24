import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Two lists have to stay in step with the schema, and neither can be trusted to a
 * person's memory:
 *
 *   orgCascadeDeletes — what "delete my workspace" removes. A model missing here
 *   means a firm that exercised its right to erasure still has rows in the
 *   database, which is a compliance failure and, for share links, leaves a public
 *   token pointing at a workspace that no longer exists.
 *
 *   the seed wipe list — what a forced reseed clears. A model missing here leaves
 *   orphans behind that outlive the organisation they belonged to.
 *
 * This has already happened twice: once before (see the note in the seed) and
 * again with ReportShare and ErrorEvent, added in the same week this test was
 * written. So the rule is enforced by reading the schema rather than by asking.
 */

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const orgScopedModels = () => {
  const schema = read('../prisma/schema.prisma');
  const models = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
  return models.filter(([, , body]) => /^\s+orgId\s/m.test(body!)).map(([, name]) => name!);
};

const lowerFirst = (s: string) => s[0]!.toLowerCase() + s.slice(1);

describe('every org-scoped model is accounted for', () => {
  it('appears in the GDPR workspace cascade', () => {
    const cascade = read('../src/org-delete.ts');
    const missing = orgScopedModels().filter(
      (m) => !cascade.includes(`prisma.${lowerFirst(m)}.deleteMany`) && !cascade.includes(`prisma.${lowerFirst(m)}.delete(`),
    );
    expect(missing, `add these to orgCascadeDeletes: ${missing.join(', ')}`).toEqual([]);
  });

  it('appears in the seed wipe list', () => {
    const seed = read('../prisma/seed.ts');
    const missing = orgScopedModels().filter((m) => !seed.includes(`'${m}'`));
    expect(missing, `add these to the seed wipe list: ${missing.join(', ')}`).toEqual([]);
  });

  it('is looking at a schema it actually found', () => {
    // a regex that silently matched nothing would make both tests above pass
    // against an empty list, which is the failure mode of a structural test
    const models = orgScopedModels();
    expect(models.length).toBeGreaterThan(15);
    expect(models).toContain('Deal');
    expect(models).toContain('Appraisal');
  });
});

import { callerFor, makeTenant, prisma, resetDatabase } from './harness.js';
import { orgCascadeDeletes } from '../src/org-delete.js';
import { recordFailure, throttleKeysFor, tooManyResetRequests } from '../src/auth/password.js';

describe('deleting a workspace actually empties it', () => {
  it('leaves no row anywhere carrying that org id', async () => {
    resetDatabase();
    const doomed = await makeTenant('Doomed');
    const survivor = await makeTenant('Survivor');

    // give the workspace something in as many corners as possible
    await callerFor(doomed.principal).appraisal.save({
      dealId: doomed.dealId,
      input: {
        units: [{ label: 'Units', count: 4, area: 700, cap: 380 }],
        efficiency: 85,
        trades: [{ label: 'Build', rate: 120 }],
        profFeePct: 11,
        contingencyPct: 5,
        otherCosts: [],
        finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 12, salesMonths: 3, arrangementFeePct: 1.5, spendProfile: 'scurve' },
        site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
        disposal: { agentPct: 1.5, legalPct: 0.5 },
        targetProfitOnGdvPct: 20,
      },
      label: 'Base',
    } as never);
    await callerFor(doomed.principal).appraisal.createShare({ dealId: doomed.dealId, kind: 'appraisal' } as never);
    await prisma.errorEvent.create({
      data: { orgId: doomed.orgId, method: 'POST', path: '/x', statusCode: 500, message: 'boom' },
    });
    const survivorShare = await callerFor(survivor.principal).appraisal.createShare({
      dealId: survivor.dealId,
      kind: 'appraisal',
    } as never);

    await prisma.$transaction(await orgCascadeDeletes(prisma, doomed.orgId));

    // nothing left of the deleted workspace, in any table
    for (const model of ['deal', 'appraisal', 'reportShare', 'errorEvent', 'activityEvent', 'user'] as const) {
      const left = await (prisma[model] as { count: (a: unknown) => Promise<number> }).count({
        where: { orgId: doomed.orgId },
      });
      expect(left, `${model} rows survived the workspace deletion`).toBe(0);
    }
    expect(await prisma.organisation.count({ where: { id: doomed.orgId } })).toBe(0);

    // and the firm next door is untouched — a cascade that over-reaches is worse
    // than one that under-reaches
    expect(await prisma.deal.count({ where: { orgId: survivor.orgId } })).toBe(1);
    expect(await prisma.reportShare.count({ where: { orgId: survivor.orgId } })).toBe(1);
    expect(survivorShare).toBeTruthy();
  }, 120_000);
});

/**
 * The one table the structural test above cannot see.
 *
 * AuthThrottle is keyed by the email address someone typed and carries no
 * orgId, so "every model with an orgId is in the cascade" says nothing about
 * it — and a firm that exercised its right to erasure was left with its
 * people's addresses in a lockout table.
 */
describe('erasure reaches the table with no org id', () => {
  it('takes the lockout rows for its people with it', async () => {
    const doomed = await makeTenant('Erasure');
    const bystander = await makeTenant('Bystander');
    const [gone, kept] = await Promise.all([
      prisma.user.findFirstOrThrow({ where: { orgId: doomed.orgId, principalType: 'internal' } }),
      prisma.user.findFirstOrThrow({ where: { orgId: bystander.orgId, principalType: 'internal' } }),
    ]);

    /**
     * Deliberately chosen so one address is a SUFFIX of the other. A
     * `key endsWith email` filter reads as the obvious way to do this and
     * would, on these two, delete the surviving firm's rows as well —
     * emails are unique but they are not suffix-free.
     */
    const stamp = Date.now();
    await prisma.user.update({ where: { id: gone.id }, data: { email: `bob-${stamp}@erasure.test` } });
    await prisma.user.update({ where: { id: kept.id }, data: { email: `xbob-${stamp}@erasure.test` } });
    const goneEmail = `bob-${stamp}@erasure.test`;
    const keptEmail = `xbob-${stamp}@erasure.test`;

    // every shape the module writes, for both firms
    for (const email of [goneEmail, keptEmail]) {
      await recordFailure(prisma, email);
      await recordFailure(prisma, `register:${email}`);
      await tooManyResetRequests(prisma, email);
    }
    expect(await prisma.authThrottle.count({ where: { key: { in: throttleKeysFor(goneEmail) } } })).toBe(3);

    await prisma.$transaction(await orgCascadeDeletes(prisma, doomed.orgId));

    expect(
      await prisma.authThrottle.count({ where: { key: { in: throttleKeysFor(goneEmail) } } }),
      'a deleted workspace left its people’s email addresses in the lockout table',
    ).toBe(0);
    expect(
      await prisma.authThrottle.count({ where: { key: { in: throttleKeysFor(keptEmail) } } }),
      'deleting one firm cleared another firm’s lockouts',
    ).toBe(3);
  });

  it('knows every key shape the throttle can write', async () => {
    /**
     * The list is hand-written, so it is checked against what the module
     * actually produces rather than against itself. Registration is the one
     * that catches people out: it passes "register:<email>" as the subject and
     * checkLockout prefixes it, so the row lands under "login:register:...".
     */
    const email = `shapes-${Date.now()}@erasure.test`;
    await recordFailure(prisma, email);
    await recordFailure(prisma, `register:${email}`);
    await tooManyResetRequests(prisma, email);

    const written = await prisma.authThrottle.findMany({ where: { key: { contains: email } }, select: { key: true } });
    expect(written.map((r) => r.key).sort()).toEqual([...throttleKeysFor(email)].sort());
  });
});
