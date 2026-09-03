import { beforeAll, describe, expect, it } from 'vitest';
import { anonymous, callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { appRouter } from '../src/router.js';
import { JWT_SECRET } from '../src/context.js';
import { internalWriter } from '../src/http-guards.js';
import type { Principal } from '../src/context.js';

/**
 * "View" was a word on a screen, not a rule.
 *
 * `ops.access` maps a member's role to a permission the team screen prints:
 * ADMIN → Full, VIEWER → View, everything else → Edit. Settings offers VIEWER in
 * the invite picker and in the per-member dropdown, and an SSO connection can be
 * configured to hand it to everyone who signs in. Nothing enforced it anywhere.
 *
 * `internalProcedure` asked two questions — is this principal internal, and is
 * the trial live — and never asked what the member was allowed to do.
 * `adminProcedure`, the only role gate in the codebase, guards the thirty admin
 * mutations and is silent about the rest.
 *
 * Measured against the real router before the fix: of 87 mutations, 30 refused
 * by the admin gate, 3 buyer-only, and 47 authed-only mutations that a VIEWER
 * reached — `deals.create`, `deals.update`, `appraisal.save`,
 * `appraisal.restore`, `appraisal.submitForReview`, `engagement.issue`,
 * `engagement.withdraw`, `sales.deleteUnit`, `sales.deleteTenancy`,
 * `cost.upsertPackage`, `integrations.saveCredentials` among them.
 */

let T: Tenant;
const viewer = (): Principal => ({ ...T.principal, role: 'VIEWER' });
const analyst = (): Principal => ({ ...T.principal, role: 'ANALYST' });

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('viewerrole');
});

describe('a view-only member', () => {
  it('cannot create a deal', async () => {
    const before = await prisma.deal.count({ where: { orgId: T.orgId } });
    await expectDenied('viewer creating a deal', () =>
      callerFor(viewer()).deals.create({
        name: 'Viewer Made This', address: '1 X Road', postcode: 'BH1 1AA',
        assetType: 'RESIDENTIAL', stage: 'APPRAISAL',
      } as never),
    );
    expect(await prisma.deal.count({ where: { orgId: T.orgId } })).toBe(before);
  });

  it('cannot move a deal to another stage', async () => {
    await expectDenied('viewer advancing a stage', () =>
      callerFor(viewer()).deals.setStage({ id: T.dealId, stage: 'BUILD' } as never),
    );
  });

  it('cannot write an appraisal', async () => {
    await expectDenied('viewer saving an appraisal', () =>
      callerFor(viewer()).appraisal.save({ dealId: T.dealId, input: {} } as never),
    );
  });

  it('is told why, in words naming the way out', async () => {
    await expect(
      callerFor(viewer()).deals.create({ name: 'x', address: 'y', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' } as never),
    ).rejects.toThrow(/view-only access[\s\S]*administrator can change your role/i);
  });

  /**
   * The half that matters as much. A view-only account is not a disabled one:
   * every read stays open, or the role is useless and people will ask for
   * ANALYST instead — which is how a permission model quietly stops being used.
   */
  it('still reads everything a colleague reads', async () => {
    const asViewer = await callerFor(viewer()).deals.list();
    const asAnalyst = await callerFor(analyst()).deals.list();
    expect(asViewer.deals.length).toBeGreaterThan(0);
    // not merely "a read succeeded" — the SAME read, with nothing withheld
    expect(asViewer.deals.map((d) => d.id)).toEqual(asAnalyst.deals.map((d) => d.id));
    expect(asViewer.rollup).toEqual(asAnalyst.rollup);
  });

  /**
   * And can still change their own password. `changePassword` is built on
   * `authedProcedure`, not `internalProcedure`, so the rule lands above it —
   * which is the correct side. Locking a view-only member out of their own
   * credentials would turn a permission into a security problem: the one
   * mutation everybody must always be able to run is the one that ends a
   * session someone else is holding.
   */
  it('can still change their own password', async () => {
    const { hashPassword } = await import('../src/auth/password.js');
    await prisma.user.update({ where: { id: T.userId }, data: { password: hashPassword('old-secret-1') } });
    const out = await callerFor(viewer()).auth.changePassword({ current: 'old-secret-1', next: 'new-secret-2' });
    expect(out).toBeTruthy();
    // and it really changed — a mutation that quietly no-ops would pass the line above
    const after = await prisma.user.findUniqueOrThrow({ where: { id: T.userId } });
    const { verifyPassword } = await import('../src/auth/password.js');
    expect(verifyPassword('new-secret-2', after.password)).toBe(true);
  });
});

/** No over-correction: the roles that were meant to write still write. */
describe('an editing member', () => {
  it('can still create a deal', async () => {
    const made = await callerFor(analyst()).deals.create({
      name: 'Analyst Made This', address: '2 Y Road', postcode: 'BH1 1AA',
      assetType: 'RESIDENTIAL', stage: 'APPRAISAL',
    } as never);
    expect(made).toBeTruthy();
  });
});

/**
 * The sweep. Every internal mutation, asked the question directly.
 *
 * The three tiers are told apart by CALLING, not by a list kept here: a
 * procedure anonymous can reach is public; one a buyer principal can reach is
 * `authedProcedure`, open to anyone signed in; what is left is
 * `internalProcedure`, and every one of those must refuse a view-only member.
 * An exemption list would have to be edited by the person adding procedure 88,
 * which is the person least likely to know the rule exists.
 */
describe('every internal mutation', () => {
  const mutationNames = () =>
    Object.entries((appRouter as any)._def.procedures as Record<string, any>)
      .filter(([, p]) => p._def.type === 'mutation')
      .map(([n]) => n);

  const at = (c: any, path: string) => path.split('.').reduce((o: any, k) => o?.[k], c);
  /** Where does the call stop? We never care whether it SUCCEEDS, only who it refuses. */
  const stop = async (c: any, name: string): Promise<'ran' | 'unauth' | 'forbidden' | 'past-the-gate'> => {
    try {
      await at(c, name)({ __probe: true });
      return 'ran';
    } catch (e: any) {
      if (e?.code === 'UNAUTHORIZED') return 'unauth';
      if (e?.code === 'FORBIDDEN') return 'forbidden';
      return 'past-the-gate';
    }
  };

  it('finds the router it is meant to be sweeping', () => {
    // a sweep over an empty procedure list passes silently, reporting success
    // for a question it never asked
    expect(mutationNames().length, 'no mutations found — has the router moved?').toBeGreaterThan(50);
    expect(mutationNames()).toContain('deals.create');
    expect(mutationNames()).toContain('appraisal.save');
  });

  /**
   * Classification comes FIRST, and never looks at the viewer.
   *
   * The obvious way to write this loop — skip anything the viewer is refused on,
   * then check what is left — passes for the wrong reason the moment the fix
   * lands: every internal mutation short-circuits out before it is counted, and
   * the sweep reports success having examined nothing. Measured, that is exactly
   * what it did: internal=0, leaked=0, green. So the tier is decided by two
   * principals that know nothing about roles — anonymous, and a buyer — and the
   * viewer is asked only afterwards, about a set whose size is asserted.
   */
  it('refuses a view-only member', async () => {
    const anon = anonymous();
    const buyer = callerFor({ ...T.principal, principalType: 'buyer', role: 'ANALYST' });
    const v = callerFor(viewer());

    const internal: string[] = [];
    for (const name of mutationNames()) {
      if ((await stop(anon, name)) !== 'unauth') continue; // public by design
      if ((await stop(buyer, name)) !== 'forbidden') continue; // authedProcedure: any signed-in user
      internal.push(name); // internalProcedure — ours
    }

    // the sweep must have something to sweep. Without this, a classifier that
    // quietly stopped recognising internal procedures would report success.
    expect(
      internal.length,
      'the classifier found almost no internal mutations — it is no longer recognising them',
    ).toBeGreaterThan(40);
    expect(internal).toContain('deals.create');
    expect(internal).toContain('appraisal.save');

    const leaked: string[] = [];
    for (const name of internal) {
      if ((await stop(v, name)) !== 'forbidden') leaked.push(name);
    }
    expect(
      leaked,
      'these internal mutations let a view-only member write. The rule belongs in assertCanWrite(), reached from internalProcedure and internalWriter() — not in the router.',
    ).toEqual([]);
  });
});

/**
 * The surface that is not tRPC.
 *
 * The upload routes are plain Fastify. They cannot use the middleware chain, and
 * `http-guards.ts` exists — with its own history written into it — because they
 * have already fallen out of that chain TWICE, for two different rules, and both
 * times it was invisible: once for the session cutoff, so a phished password shut
 * the attacker out of the app and left them the data room; once for the trial, so
 * a workspace that stopped paying went on filling it.
 *
 * This rule is the third. A view-only member refused everywhere in tRPC could
 * still POST a document or a site photo, and the file would land with their name
 * on it. `internalWriter()` is where the two chains are supposed to agree, so it
 * is asked here directly, with a real signed token, rather than by testing the
 * predicate it happens to call — that is the check that would have caught the
 * previous two.
 */
describe('the upload routes, which are not tRPC', () => {
  const bearer = (userId: string) => ({ headers: { authorization: `Bearer ${jwt.sign({ sub: userId }, JWT_SECRET)}` } });

  const memberWith = async (role: string, tag: string) => {
    const u = await prisma.user.create({
      data: {
        orgId: T.orgId, email: `${tag}-${Date.now()}@upload.test`, password: 'x',
        name: `${tag} Person`, initials: 'UP', role, principalType: 'internal',
      },
    });
    return u.id;
  };

  it('refuses a view-only member', async () => {
    const id = await memberWith('VIEWER', 'viewer');
    await expect(internalWriter(bearer(id), 'uploads.document', prisma)).rejects.toThrow(/view-only access/i);
    await expect(internalWriter(bearer(id), 'uploads.photo', prisma)).rejects.toThrow(/view-only access/i);
    await expect(internalWriter(bearer(id), 'uploads.logo', prisma)).rejects.toThrow(/view-only access/i);
  });

  it('still lets an editing member upload', async () => {
    const id = await memberWith('ANALYST', 'analyst');
    const principal = await internalWriter(bearer(id), 'uploads.document', prisma);
    expect(principal.userId).toBe(id);
    expect(principal.orgId).toBe(T.orgId);
  });
});

/**
 * The browser's copy of the rule, checked against the real router.
 *
 * `apps/web/src/lib/read-only.ts` refuses a view-only member's mutations in the
 * tRPC link chain, before the network — instant, same words, no half-submitted
 * form against a doomed request. To do that it needs to know which mutations
 * the server would NOT refuse, and that is a list: exactly the shape of defect
 * this branch has spent its whole length on, a rule written down in two places
 * that agree until one of them is edited.
 *
 * So the list is not trusted. It is read out of the web source and compared
 * against what the server actually does, measured by calling every mutation as
 * a view-only member. Add an `authedProcedure` mutation and forget the web file
 * and this fails naming it; leave a stale entry behind and it fails naming that
 * too. Reading another package's source from a test is the same move
 * `trial.test.ts` makes on `uploads.ts` and `raw-route-sweep` makes on
 * `main.ts` — a rule about two places agreeing cannot be enforced from inside
 * one of them.
 */
describe("the browser's copy of the rule", () => {
  const webList = (): string[] => {
    const src = readFileSync(new URL('../../web/src/lib/read-only.ts', import.meta.url), 'utf8');
    const block = /export const VIEWER_MAY_RUN = \[([\s\S]*?)\] as const;/.exec(src);
    if (!block) throw new Error('VIEWER_MAY_RUN not found — has read-only.ts moved or been reshaped?');
    /**
     * Entries only — a line that is exactly a quoted procedure path and a comma.
     * A looser `/'([^']+)'/g` also matched the apostrophe in a prose comment
     * ("the member's own browser"), which produced a phantom entry and a
     * baffling diff. The shape below cannot see inside a comment.
     */
    return [...block[1]!.matchAll(/^\s*'([\w.]+)',\s*$/gm)].map((m) => m[1]!).sort();
  };

  it('finds the list it is meant to be checking', () => {
    // a regex that quietly matched nothing would make every comparison below
    // pass against an empty set
    const list = webList();
    expect(list.length, 'the web allowlist read as empty').toBeGreaterThan(0);
    expect(list).toContain('auth.changePassword');
    // every entry must LOOK like a procedure path. The first version of this
    // regex scraped an apostrophe out of a comment and produced an entry made
    // of prose; the length and contains checks above both passed on it.
    for (const entry of list) {
      expect(entry, `not a procedure path: ${JSON.stringify(entry)}`).toMatch(/^[a-z][\w]*\.[a-zA-Z][\w]*$/);
    }
  });

  it('matches exactly what the server lets a view-only member run', async () => {
    const v = callerFor(viewer());
    const at = (c: any, path: string) => path.split('.').reduce((o: any, k) => o?.[k], c);
    const serverAllows: string[] = [];
    for (const name of Object.entries((appRouter as any)._def.procedures as Record<string, any>)
      .filter(([, p]) => p._def.type === 'mutation')
      .map(([n]) => n)) {
      try {
        await at(v, name)({ __probe: true });
        serverAllows.push(name);
      } catch (e: any) {
        if (e?.code !== 'FORBIDDEN') serverAllows.push(name);
      }
    }
    expect(
      webList(),
      'apps/web/src/lib/read-only.ts disagrees with the router about what a view-only member may run. Left = the web file, right = what the server actually does.',
    ).toEqual(serverAllows.sort());
  });
});
