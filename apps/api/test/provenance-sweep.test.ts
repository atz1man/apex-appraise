import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { settlePayment } from '../src/payments.js';
import { appRouter } from '../src/router.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Every mutation, and whether anything is written down when it runs.
 *
 * "Provenance on every figure" is one of this product's stated non-negotiables,
 * and `audit.ts` says who the trail is for in its own words: an insurer, a
 * lender's credit committee, or an RICS review, asking "who signed in, who
 * changed the valuation, who was given access, and when". Not features —
 * questions that arrive after something has gone wrong.
 *
 * `23a7c2b` found the sales router answering none of them: six mutations, no
 * events, so a plot's agreed value could move £50,000 with no actor and no time.
 * That was found by reading. This sweep asked the same question of all 87
 * mutations at once and found thirty-two more, including `org.setRole` — the
 * procedure that makes somebody an administrator — sitting directly beneath
 * `removeMember`, which records.
 *
 * The mechanism is the resolver itself rather than a grep of the files: tRPC
 * keeps the real handler on `_def.resolver`, so this reads the exact function
 * bound to the exact path. A procedure that is renamed, moved between files or
 * re-exported cannot drift away from its own classification.
 */

let T: Tenant;

/**
 * What counts as writing something down.
 *
 * Two direct forms, and two helpers that record on the caller's behalf. The
 * helpers are named here rather than assumed, and the test below opens each one
 * to check it really does record — otherwise this list would be a way to mark a
 * mutation covered by naming a function that does nothing.
 */
const DIRECT = [/recordAudit\(/, /activityEvent\.create\(/];
const HELPERS: Array<{ call: RegExp; name: string; source: string }> = [
  { call: /settlePayment\(/, name: 'settlePayment', source: 'src/payments.ts' },
  { call: /\brecord\(/, name: 'record', source: 'src/routers/sales.ts' },
  // the benchmark feed records each contribution; the manual button now only calls it
  { call: /feedApproved\(/, name: 'feedApproved', source: 'src/benchmark-feed.ts' },
];

/**
 * Mutations that write no provenance, each with the reason it does not need to.
 *
 * The bar is not "nothing important happens" — it is that the event a reader
 * would look for is recorded somewhere else, or there is no reader. A new entry
 * is a decision somebody has to write down, which is the whole point: every one
 * of the thirty-two this sweep found had been a decision nobody made.
 */
const NO_PROVENANCE: Record<string, string> = {
  'appraisal.downloadToken':
    'mints a short-lived token for the caller’s own download. The download itself is recorded where it happens, in reports.ts — recording the token as well would double every export in the trail.',
  'auth.ssoStart':
    'builds a redirect URL and holds a state in memory. Nothing is persisted and no identity is established yet; `auth.ssoComplete` records the sign-in that results.',
  'autoAppraisal.whatIf':
    'pure computation returned to the caller. It persists nothing at all, so there is no change for a trail to describe.',
  'bank.connect':
    'begins the PSD2 consent redirect. `bank.complete` records the connection once the customer has actually granted it — recording the attempt would put consents in the trail that were never given.',
  'billing.checkout':
    'creates a Stripe Checkout session. Whether the subscription changed is Stripe’s answer, not ours, and `billing.sync` records it when it arrives.',
  'org.clearLogo':
    'removes the firm’s logo image. Cosmetic: it changes how a document looks, never a figure, a permission or a date.',
  'org.deleteWorkspace':
    'the GDPR erasure. It removes the workspace including its activity events, so an event describing it would be deleted by the same call that wrote it.',
  'org.register':
    'creates the workspace and its first admin. There is no prior state to compare against, the Organisation row IS the record of creation, and `auth.login` records the sign-in that immediately follows.',
  'org.reportClientError':
    'writes a browser fault into the error log. It is itself the record; auditing the act of logging would say nothing the log does not.',
  'tasks.create':
    'an internal to-do on a deal. Not a figure, not access, not a document — and the task row already carries its author and date.',
  'tasks.toggle':
    'ticks that to-do off. Same reasoning; the checkbox is the record.',
  'xero.connect':
    'begins the Xero consent redirect. `xero.complete` records the connection once the organisation is actually granted.',
};

type Proc = { _def: { type: 'query' | 'mutation'; resolver?: unknown } };
const mutations = () =>
  Object.entries((appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures).filter(
    ([, p]) => p._def.type === 'mutation',
  );

const recordsProvenance = (src: string) =>
  DIRECT.some((r) => r.test(src)) || HELPERS.some((h) => h.call.test(src));

const API_ROOT = resolve(new URL('..', import.meta.url).pathname);

describe('the sweep itself', () => {
  it('reads the real resolvers, not a grep of the files', () => {
    const muts = mutations();
    expect(muts.length, 'no mutations were found — the router walk is broken').toBeGreaterThan(80);
    for (const [path, p] of muts) {
      expect(typeof p._def.resolver, `${path} has no resolver to read`).toBe('function');
    }
  });

  /**
   * Naming a helper here marks every mutation that calls it as covered, so a
   * helper that does not record would silently absolve all of them. Each is
   * opened and checked.
   */
  it('every helper it trusts actually records', () => {
    expect(recordsProvenance(String(settlePayment)), 'settlePayment no longer records').toBe(true);
    for (const h of HELPERS) {
      const src = readFileSync(resolve(API_ROOT, h.source), 'utf8');
      const at = src.indexOf(`const ${h.name} =`) >= 0 ? src.indexOf(`const ${h.name} =`) : src.indexOf(`function ${h.name}`);
      expect(at, `${h.name} was not found in ${h.source}`).toBeGreaterThanOrEqual(0);
      const body = src.slice(at, at + 1500);
      expect(DIRECT.some((r) => r.test(body)), `${h.name} in ${h.source} does not record`).toBe(true);
    }
  });

  it('has no stale exemptions', () => {
    const paths = new Set(mutations().map(([p]) => p));
    const gone = Object.keys(NO_PROVENANCE).filter((p) => !paths.has(p));
    expect(gone, `exempted mutations that no longer exist: ${gone.join(', ')}`).toEqual([]);

    // an exemption that has since started recording is a reason that stopped
    // being true, and the map should say what is actually so
    const nowRecording = mutations()
      .filter(([p, proc]) => p in NO_PROVENANCE && recordsProvenance(String(proc._def.resolver)))
      .map(([p]) => p);
    expect(nowRecording, `exempted, but they do record now: ${nowRecording.join(', ')}`).toEqual([]);

    const unreasoned = Object.entries(NO_PROVENANCE).filter(([, why]) => why.trim().length < 40);
    expect(unreasoned.map(([p]) => p), 'an exemption needs a reason, not a placeholder').toEqual([]);
  });
});

describe('every mutation in the router', () => {
  it('writes down what it did, or says here why it does not', () => {
    const silent = mutations()
      .filter(([path, p]) => !recordsProvenance(String(p._def.resolver)) && !(path in NO_PROVENANCE))
      .map(([path]) => path);

    expect(
      silent,
      'these change something and record nothing. Add provenance, or add the path to NO_PROVENANCE '
        + `with the reason a reader would not look for it: ${silent.join(', ')}`,
    ).toEqual([]);
  });
});

/**
 * Static detection proves a recording call is present. It cannot prove the call
 * is reached, so the four sharpest fixes are driven for real — three of them
 * answer "who was given access" and "who changed the valuation" directly.
 */
describe('and it lands, not just compiles', () => {
  beforeAll(async () => {
    resetDatabase();
    T = await makeTenant('Provenance');
  }, 180_000);

  const eventsFor = async (action: RegExp) =>
    (await prisma.activityEvent.findMany({ where: { orgId: T.orgId } })).filter((e) => action.test(e.action));

  it('records who was made an administrator, and what they were before', async () => {
    const caller = callerFor(T.principal);
    const { tempPassword } = await caller.org.invite({ name: 'Pat Newcomer', email: `new-${Date.now()}@prov.test`, role: 'VIEWER' });
    expect(tempPassword, 'the invite did not complete').toBeTruthy();

    const invited = await eventsFor(/invited a team member/);
    expect(invited, 'inviting somebody into the workspace recorded nothing').toHaveLength(1);
    expect(invited[0]!.target).toContain('VIEWER');

    const member = await prisma.user.findFirstOrThrow({ where: { orgId: T.orgId, name: 'Pat Newcomer' } });
    await caller.org.setRole({ userId: member.id, role: 'ADMIN' });

    const promoted = await eventsFor(/role/);
    expect(promoted, 'making somebody an administrator recorded nothing').toHaveLength(1);
    // the FROM matters as much as the to: "VIEWER → ADMIN" is the event
    expect(promoted[0]!.target).toContain('VIEWER → ADMIN');
  });

  it('records the inspection a valuation rests on, and the value reconciled from it', async () => {
    const caller = callerFor(T.principal);
    await caller.inspections.save({
      dealId: T.dealId,
      rooms: [],
      reconciledValue: 450_000,
      approachWeights: { salesComparison: 100, cost: 0, income: 0 },
      status: 'submitted',
    } as never);

    const done = await eventsFor(/inspection/);
    expect(done, 'a submitted inspection recorded nothing').toHaveLength(1);
    expect(done[0]!.action).toBe('submitted an inspection');
    expect(done[0]!.target, 'the reconciled value is the figure a reviewer asks about').toContain('£450,000');
  });

  it('records comparables being written onto the appraisal, with what the caps were before', async () => {
    const caller = callerFor(T.principal);
    await caller.appraisal.save({
      dealId: T.dealId,
      input: {
        units: [{ label: '2-bed apartments', count: 10, area: 750, cap: 420 }],
        efficiency: 85,
        trades: [{ label: 'Superstructure', rate: 110 }],
        profFeePct: 11,
        contingencyPct: 5,
        otherCosts: [],
        finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
        site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
        disposal: { agentPct: 1.5, legalPct: 0.5 },
        targetProfitOnGdvPct: 20,
      },
    } as never);
    await caller.comparables.upsert({
      dealId: T.dealId,
      address: '2 Evidence Row',
      basePsf: 500,
      adjSize: 0,
      adjCondition: 0,
      adjDate: 0,
      adjLocation: 0,
    } as never);
    expect(await eventsFor(/comparable/), 'a valuer’s own comparable recorded nothing').toHaveLength(1);

    await caller.comparables.applyToAppraisal(T.dealId);
    const applied = await eventsFor(/applied comparables/);
    expect(applied, 'overwriting every unit cap recorded nothing').toHaveLength(1);
    // the cap it replaced, not only the one it set: a reviewer asks what changed
    expect(applied[0]!.target).toContain('£420');
  });
});
