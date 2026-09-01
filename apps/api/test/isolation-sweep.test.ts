import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { appRouter } from '../src/router.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Every procedure in the router, against another firm's ids.
 *
 * `tenancy.test.ts` asks this question by hand, one procedure at a time, and its
 * own note records what that audit found: "Five procedures shipped having
 * answered only the first" — they checked that the DEAL belonged to the caller
 * and then wrote a record identified by an id the caller also supplied.
 *
 * Five, in one audit. The guard against a sixth was somebody remembering. This
 * repo already refuses to rely on memory for two other whole-codebase
 * properties — `reachable.test.ts` walks the real router for procedures nothing
 * can call, `cascade.test.ts` walks the real schema for models the GDPR delete
 * would miss — and cross-tenant isolation is the one that matters most: this is
 * a multi-tenant SaaS holding competing firms' valuations, land bids and
 * clients' money.
 *
 * So: build two firms, give the second one of every record, then call EVERY
 * procedure as the first with the second's ids in every id-shaped field. Two
 * things must hold — the call is refused, and B's data is untouched afterwards.
 */

let A: Tenant;
let B: Tenant;

/** every id-shaped field name the router uses, mapped to the row it should name */
const ID_FIELDS = new Set([
  'id', 'dealId', 'versionId', 'fromId', 'toId', 'unitId', 'tenancyId', 'investorId',
  'contractorId', 'packageId', 'documentId', 'paymentId', 'userId', 'memberId',
  'scenarioId', 'comparableId', 'inspectionId', 'accountId', 'taskId', 'cashflowId',
]);

/**
 * Id-shaped input fields that name nothing of another firm's, each with the reason.
 *
 * Sorted, because the assertion below is an exact match: a new one has to be
 * looked at and written down, not absorbed.
 */
const EXEMPT_ID_FIELDS: string[] = [
  // the OIDC client id an admin pastes from their own identity provider — a
  // credential this app stores, not a row this app owns
  'clientId',
  // Xero's id for a tracking option, chosen from Xero's list. It names a row in
  // the customer's accounting package, and the guard that matters there is that
  // the deal is the caller's, which `dealId` in the same input already sweeps.
  'trackingOptionId',
];

/**
 * Procedures the sweep cannot decide, each with the reason.
 *
 * A refusal for the WRONG reason is a false pass, so anything that fails for
 * something other than ownership is listed here rather than counted as safe.
 */
const NOT_SWEPT: Record<string, string> = {};

/** B's rows, one per model the router can name, keyed by the field that names them */
const foreign: Record<string, string> = {};
/** the same rows as a plain list, for procedures that do not say which model they mean */
const ROWS: string[] = [];
const labelOf = (id: string) => Object.entries(foreign).find(([, v]) => v === id)?.[0] ?? id;

type Proc = { _def: { type: 'query' | 'mutation'; inputs?: z.ZodTypeAny[] } };
const procedures = () => (appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures;

/** a value that satisfies a schema, so the call reaches its ownership check rather than zod */
function sample(schema: z.ZodTypeAny, field = '', generic = ''): unknown {
  const def = (schema as unknown as { _def: Record<string, any> })._def;
  const t = def.typeName as string;
  switch (t) {
    case 'ZodOptional':
      // supply it anyway when it names a row — an optional id is still an id
      return ID_FIELDS.has(field) ? sample(def.innerType, field, generic) : undefined;
    case 'ZodNullable':
      // NOT the same as optional: the key is required, it is the value that may be null.
      // Omitting it is a zod error, and a zod error is a refusal for the wrong reason.
      return ID_FIELDS.has(field) ? sample(def.innerType, field, generic) : null;
    case 'ZodDefault':
      return sample(def.innerType, field, generic);
    case 'ZodEffects':
      return sample(def.schema, field, generic);
    case 'ZodObject': {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(def.shape() as Record<string, z.ZodTypeAny>)) {
        const val = sample(v, k, generic);
        if (val !== undefined) out[k] = val;
      }
      return out;
    }
    case 'ZodArray': {
      // an array with a minimum has to be filled, or the call never reaches the ownership check
      const min = (def.minLength?.value ?? 0) as number;
      return Array.from({ length: min }, () => sample(def.type, field, generic));
    }
    case 'ZodString': {
      // `id` and a bare string name no particular model, so the caller decides which row to try
      if (field === 'id' || field === '') return generic || foreign.id;
      if (ID_FIELDS.has(field)) return foreign[field] ?? generic ?? foreign.id;
      const checks = (def.checks ?? []) as Array<{ kind: string; value?: number; regex?: RegExp }>;
      if (checks.some((c) => c.kind === 'email')) return 'sweep@example.test';
      if (checks.some((c) => c.kind === 'url')) return 'https://example.test/hook';
      const min = checks.find((c) => c.kind === 'min')?.value ?? 1;
      return 'x'.repeat(Math.max(1, min));
    }
    case 'ZodNumber': {
      const checks = (def.checks ?? []) as Array<{ kind: string; value?: number }>;
      const min = checks.find((c) => c.kind === 'min')?.value;
      const max = checks.find((c) => c.kind === 'max')?.value;
      if (min != null && min > 0) return min;
      if (max != null && max < 1) return max;
      return 1;
    }
    case 'ZodBoolean':
      return false;
    case 'ZodDate':
      return new Date();
    case 'ZodEnum':
      return def.values[0];
    case 'ZodNativeEnum':
      return Object.values(def.values)[0];
    case 'ZodLiteral':
      return def.value;
    case 'ZodUnion':
      return sample(def.options[0], field, generic);
    case 'ZodRecord':
      return {};
    case 'ZodAny':
    case 'ZodUnknown':
      return {};
    case 'ZodVoid':
    case 'ZodUndefined':
      return undefined;
    default:
      return undefined;
  }
}

/**
 * Does the input leave the model unsaid?
 *
 * `unitId` names a unit. A bare `z.string()`, or a key called `id`, names whatever
 * that procedure happens to be about — and the sweep cannot read the procedure body
 * to find out. Handing such a procedure only a deal id is how a unit procedure with
 * its org scope removed scores as safe: it gets an id no unit has, refuses with
 * NOT_FOUND for a reason that has nothing to do with ownership, and passes. So
 * these get called once per row B owns.
 */
function usesGenericId(schema: z.ZodTypeAny | undefined): boolean {
  if (!schema) return false;
  const def = (schema as unknown as { _def: Record<string, any> })._def;
  if (def.typeName === 'ZodString') return true;
  if (def.typeName === 'ZodObject') return Object.keys(def.shape() as Record<string, unknown>).includes('id');
  if (def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable' || def.typeName === 'ZodDefault') {
    return usesGenericId(def.innerType);
  }
  if (def.typeName === 'ZodEffects') return usesGenericId(def.schema);
  return false;
}

/** does this procedure name a row at all? */
function namesARow(schema: z.ZodTypeAny | undefined): boolean {
  if (!schema) return false;
  const def = (schema as unknown as { _def: Record<string, any> })._def;
  if (def.typeName === 'ZodString') return true; // a bare string input IS an id here
  if (def.typeName === 'ZodObject') {
    return Object.keys(def.shape() as Record<string, unknown>).some((k) => ID_FIELDS.has(k));
  }
  if (def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable' || def.typeName === 'ZodDefault') {
    return namesARow(def.innerType);
  }
  if (def.typeName === 'ZodEffects') return namesARow(def.schema);
  return false;
}

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Alpha');
  B = await makeTenant('Bravo');

  // one of every record B could own, so every id-shaped field has something to point at
  const unit = await prisma.unit.create({
    data: { orgId: B.orgId, dealId: B.dealId, name: 'B Plot 1', spec: '2-bed', appraisedValue: 400_000_00n, status: 'RESERVED' },
  });
  const tenancyRow = await prisma.tenancy.create({
    data: { orgId: B.orgId, dealId: B.dealId, name: 'B Apt 1', spec: '1-bed', ervPcm: 1_200_00n },
  });
  const investor = await prisma.investor.create({ data: { orgId: B.orgId, name: 'B Capital LP' } });
  // a holding and a statement line, so the register's procedures have B's rows to be refused on
  await prisma.holding.create({
    data: { investorId: investor.id, dealId: B.dealId, sharePct: 100, committed: 1_000_000_00n },
  });
  const cashflow = await prisma.cashflow.create({
    data: { investorId: investor.id, dealId: B.dealId, kind: 'dist', label: 'B distribution', amount: 50_000_00n, date: new Date() },
  });
  const contractor = await prisma.contractor.create({ data: { orgId: B.orgId, name: 'B Build Ltd', trade: 'Groundworks', weeks: '[]' } });
  const pkg = await prisma.costPackage.create({
    data: { orgId: B.orgId, dealId: B.dealId, name: 'B Substructure', budget: 100_000_00n, forecast: 100_000_00n, contractorId: contractor.id },
  });
  const doc = await prisma.document.create({
    data: { orgId: B.orgId, dealId: B.dealId, name: 'B pack.pdf', category: 'Legal', ext: 'pdf', sizeBytes: 1_024n },
  });
  const payment = await prisma.payment.create({ data: { orgId: B.orgId, unitId: unit.id, kind: 'Reservation fee', amount: 2_000_00n } });
  const task = await prisma.task.create({ data: { orgId: B.orgId, dealId: B.dealId, title: 'B task', aspect: 'General', assignee: 'BB' } });
  const comparable = await prisma.comparable.create({
    data: { orgId: B.orgId, dealId: B.dealId, address: '1 B Road', basePsf: 400 },
  });
  const scenario = await prisma.scenario.create({
    data: { orgId: B.orgId, dealId: B.dealId, name: 'B Option', blendedPsf: 420, buildPsf: 180, gia: 20_000, targetProfitPct: 20 },
  });
  const inspection = await prisma.inspection.create({
    data: { orgId: B.orgId, dealId: B.dealId, rooms: '[]', approachWeights: '{}', status: 'draft' },
  });
  // through the real procedure — a hand-built appraisal row would not carry the
  // shape `submitForReview`, `review` and `restore` are handed
  await callerFor(B.principal).appraisal.save({
    dealId: B.dealId,
    label: 'B Base',
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
  const version = await prisma.appraisal.findFirstOrThrow({ where: { dealId: B.dealId, isCurrent: true } });
  const connection = await prisma.bankConnection.create({
    data: {
      orgId: B.orgId,
      institution: 'B Bank',
      accessToken: 'x',
      refreshToken: 'x',
      expiresAt: new Date(Date.now() + 86_400_000),
      consentExpiresAt: new Date(Date.now() + 86_400_000),
      createdById: B.userId,
    },
  });
  const account = await prisma.bankAccount.create({
    data: { orgId: B.orgId, connectionId: connection.id, externalId: 'b-1', name: 'B Current', last4: '4321' },
  });

  Object.assign(foreign, {
    id: B.dealId,
    dealId: B.dealId,
    unitId: unit.id,
    tenancyId: tenancyRow.id,
    investorId: investor.id,
    contractorId: contractor.id,
    packageId: pkg.id,
    documentId: doc.id,
    paymentId: payment.id,
    userId: B.userId,
    memberId: B.userId,
    taskId: task.id,
    comparableId: comparable.id,
    scenarioId: scenario.id,
    inspectionId: inspection.id,
    versionId: version.id,
    // `compare` takes two, and a diff of one firm's valuation against another's
    // is the single most damaging thing this router could be talked into
    fromId: version.id,
    toId: version.id,
    accountId: account.id,
    cashflowId: cashflow.id,
  });
  ROWS.push(...new Set(Object.values(foreign)));
}, 180_000);

/** a fingerprint of everything B owns, so "untouched" is checkable rather than asserted */
async function snapshotB() {
  /**
   * Holdings, cashflows, contractors and photos were NOT in this fingerprint
   * until the register procedures were written, so "B's data untouched" was
   * blind to exactly the tables those procedures write.
   *
   * Measured with care, because the obvious mutant does not prove it: dropping
   * the `investor: { orgId }` scope from `deleteCashflow` is caught by the
   * ACCEPTED list above — the call returns `{ ok: true }` instead of throwing —
   * so it fails the sweep with or without this fingerprint. The mutant the
   * fingerprint exists for is the one that refuses for the RIGHT reason having
   * already done the damage: an unscoped `deleteMany` before the scoped
   * `findFirst`, so B's line is gone and A is told NOT_FOUND. That one passes
   * the old fingerprint and fails this one.
   */
  const [deals, units, tenancies, investors, holdings, cashflows, contractors, photos, packages, documents, payments, tasks, comparables, scenarios, inspections, users, appraisals, accounts] =
    await Promise.all([
      prisma.deal.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.unit.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.tenancy.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.investor.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.holding.findMany({ where: { investor: { orgId: B.orgId } }, orderBy: { id: 'asc' } }),
      prisma.cashflow.findMany({ where: { investor: { orgId: B.orgId } }, orderBy: { id: 'asc' } }),
      prisma.contractor.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.sitePhoto.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.costPackage.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.document.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.payment.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.task.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.comparable.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.scenario.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.inspection.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.user.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.appraisal.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
      prisma.bankAccount.findMany({ where: { orgId: B.orgId }, orderBy: { id: 'asc' } }),
    ]);
  return JSON.stringify(
    { deals, units, tenancies, investors, holdings, cashflows, contractors, photos, packages, documents, payments, tasks, comparables, scenarios, inspections, users, appraisals, accounts },
    (_k, v) => (typeof v === 'bigint' ? v.toString() : v),
  );
}

describe('the sweep itself', () => {
  it('reads the real router and finds the procedures that name a row', () => {
    const procs = procedures();
    expect(Object.keys(procs).length).toBeGreaterThan(100);
    const naming = Object.entries(procs).filter(([, p]) => namesARow(p._def.inputs?.[0]));
    expect(naming.length, 'no procedure was found to name a row — the walker is broken').toBeGreaterThan(40);
  });

  it('has a row of B’s for every id-shaped field the router uses', () => {
    // a field with nothing to point at silently degrades to `foreign.id`, and a deal id
    // handed to a unit procedure is refused for the wrong reason — a false pass
    const missing = [...ID_FIELDS].filter((f) => !(f in foreign));
    expect(missing, `no row of B's for: ${missing.join(', ')}`).toEqual([]);
    expect(ROWS.length, 'the candidate rows are empty — every generic id falls back to one value').toBeGreaterThan(10);
  });

  /**
   * The last thing in here anybody has to remember.
   *
   * `ID_FIELDS` is what turns a key into an id, and a key it does not know about
   * gets a made-up string — which no row anywhere has, so the procedure refuses,
   * and the sweep records a pass it did not earn. This walks the real inputs for
   * anything id-shaped and fails until the list covers it.
   */
  it('knows every id-shaped input field the router actually accepts', () => {
    const seen = new Set<string>();
    const walk = (schema: z.ZodTypeAny | undefined) => {
      if (!schema) return;
      const def = (schema as unknown as { _def: Record<string, any> })._def;
      switch (def.typeName) {
        case 'ZodObject':
          for (const [k, v] of Object.entries(def.shape() as Record<string, z.ZodTypeAny>)) {
            if (/^id$|Id$/.test(k)) seen.add(k);
            walk(v);
          }
          return;
        case 'ZodOptional':
        case 'ZodNullable':
        case 'ZodDefault':
          return walk(def.innerType);
        case 'ZodEffects':
          return walk(def.schema);
        case 'ZodArray':
          return walk(def.type);
        case 'ZodUnion':
          return (def.options as z.ZodTypeAny[]).forEach(walk);
        case 'ZodRecord':
          return walk(def.valueType);
        default:
          return;
      }
    };
    for (const p of Object.values(procedures())) walk(p._def.inputs?.[0]);

    const unknown = [...seen].filter((f) => !ID_FIELDS.has(f)).sort();
    expect(
      unknown,
      `id-shaped input fields the sweep would not recognise — add each to ID_FIELDS with a row of B's, `
        + `or to NOT_SWEPT with the reason it names nothing of another firm's: ${unknown.join(', ')}`,
    ).toEqual(EXEMPT_ID_FIELDS);
  });
});

describe('holding org A, naming org B’s rows', () => {
  it('refuses every one, and leaves B’s data untouched', async () => {
    const before = await snapshotB();
    const caller = callerFor(A.principal);
    const procs = procedures();

    const accepted: string[] = [];
    const inconclusive: string[] = [];
    let swept = 0;

    for (const [path, proc] of Object.entries(procs)) {
      if (path in NOT_SWEPT) continue;
      const schema = proc._def.inputs?.[0];
      if (!namesARow(schema)) continue;

      const segs = path.split('.');
      let fn: any = caller;
      for (const s of segs) fn = fn?.[s];
      if (typeof fn !== 'function') continue;

      const candidates = usesGenericId(schema) ? ROWS : [foreign.id];
      for (const row of candidates) {
        swept += 1;
        try {
          await fn(sample(schema!, '', row));
          accepted.push(`${path}(${labelOf(row)})`);
        } catch (e) {
          const code = (e as { code?: string; cause?: { code?: string } })?.code
            ?? (e as { data?: { code?: string } })?.data?.code
            ?? '';
          const msg = String((e as Error)?.message ?? '');
          const ownership = /NOT_FOUND|FORBIDDEN|UNAUTHORIZED/.test(code) || /not found|forbidden|Admin|permission/i.test(msg);
          if (!ownership) inconclusive.push(`${path}(${labelOf(row)}): ${code || msg.slice(0, 80)}`);
        }
      }
    }

    expect(swept, 'the sweep ran nothing').toBeGreaterThan(400);
    expect(accepted, `these accepted another firm's id: ${accepted.join(', ')}`).toEqual([]);
    // an error for some other reason is not evidence of isolation
    expect(inconclusive, `refused for a reason that is not ownership: ${inconclusive.join(' | ')}`).toEqual([]);

    expect(await snapshotB(), 'org B’s data changed while org A was calling').toBe(before);
  }, 180_000);
});
