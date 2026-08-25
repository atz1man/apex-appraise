import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * The portals, where the user is not a colleague.
 *
 * A buyer and an investor hold accounts in a firm's workspace without being part
 * of the firm. Two boundaries have to hold: they must not reach the firm's own
 * screens at all, and they must not reach EACH OTHER — one investor seeing
 * another's position, or a buyer seeing another buyer's unit and payment
 * schedule, would be a breach between the firm's own clients.
 */

let A: Tenant;
let investorA: { userId: string; investorId: string };
let investorB: { userId: string; investorId: string };
let buyerA: { userId: string; unitId: string };
let buyerB: { userId: string; unitId: string };

const principalFor = (u: { userId: string }, type: 'investor' | 'buyer', extra: Record<string, unknown>) =>
  ({
    userId: u.userId,
    orgId: A.orgId,
    principalType: type,
    role: 'VIEWER',
    name: 'Portal user',
    initials: 'PU',
    investorId: null,
    buyerUnitId: null,
    ...extra,
  }) as never;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Portals');

  const mkInvestor = async (name: string) => {
    const inv = await prisma.investor.create({ data: { orgId: A.orgId, name, documents: '[]' } });
    const user = await prisma.user.create({
      data: { orgId: A.orgId, email: `${name}@lp.test`, password: 'x', name, initials: 'LP', role: 'VIEWER', principalType: 'investor', investorId: inv.id },
    });
    await prisma.holding.create({ data: { investorId: inv.id, dealId: A.dealId, sharePct: 25, committed: 1_000_000_00 } });
    return { userId: user.id, investorId: inv.id };
  };
  const mkBuyer = async (name: string) => {
    const unit = await prisma.unit.create({
      data: { orgId: A.orgId, dealId: A.dealId, name: `Plot ${name}`, spec: '3 bed', appraisedValue: 450_000_00, status: 'RESERVED', buyerName: name },
    });
    const user = await prisma.user.create({
      data: { orgId: A.orgId, email: `${name}@buyer.test`, password: 'x', name, initials: 'BY', role: 'VIEWER', principalType: 'buyer', buyerUnitId: unit.id },
    });
    return { userId: user.id, unitId: unit.id };
  };

  investorA = await mkInvestor('Alpha LP');
  investorB = await mkInvestor('Bravo LP');
  buyerA = await mkBuyer('Ann');
  buyerB = await mkBuyer('Ben');
}, 120_000);

describe('an investor', () => {
  it('sees their own position', async () => {
    const c = callerFor(principalFor(investorA, 'investor', { investorId: investorA.investorId }));
    const pos = (await c.investors.myPosition()) as { investor?: { name?: string } } | null;
    expect(pos).toBeTruthy();
  });

  it('gets THEIR position, not whichever one the server felt like', async () => {
    /**
     * Scope comes from the principal, never from input, so there is no parameter
     * to point at someone else — but "no way to ask for the wrong one" is only
     * half of it. This checks the right one comes back: two investors in the same
     * workspace, each holding a different amount, must not receive each other's.
     */
    const a = (await callerFor(principalFor(investorA, 'investor', { investorId: investorA.investorId })).investors.myPosition()) as {
      id: string;
      name: string;
    };
    const b = (await callerFor(principalFor(investorB, 'investor', { investorId: investorB.investorId })).investors.myPosition()) as {
      id: string;
      name: string;
    };
    expect(a.id).toBe(investorA.investorId);
    expect(a.name).toBe('Alpha LP');
    expect(b.id).toBe(investorB.investorId);
    expect(b.name).toBe('Bravo LP');
  });

  it('cannot reach the firm’s own screens', async () => {
    const c = callerFor(principalFor(investorA, 'investor', { investorId: investorA.investorId }));
    await expectDenied('deals.list as investor', () => c.deals.list({} as never));
    await expectDenied('investors.get as investor', () => c.investors.get(investorB.investorId));
    await expectDenied('exposure as investor', () => c.deals.exposure());
    await expectDenied('auditLog as investor', () => c.org.auditLog({ limit: 10 } as never));
  });
});

describe('a buyer', () => {
  it('sees their own unit', async () => {
    const c = callerFor(principalFor(buyerA, 'buyer', { buyerUnitId: buyerA.unitId }));
    const unit = (await c.buyer.myUnit()) as { id?: string } | null;
    expect(unit).toBeTruthy();
  });

  it('cannot pay against another buyer’s unit', async () => {
    // give buyer B a payment, then have buyer A try to act on it
    const payment = await prisma.payment.create({
      data: { orgId: A.orgId, unitId: buyerB.unitId, kind: 'Exchange deposit (10%)', amount: 45_000_00, status: 'DUE' },
    });
    const c = callerFor(principalFor(buyerA, 'buyer', { buyerUnitId: buyerA.unitId }));
    await expectDenied('pay another buyer’s payment', () => c.buyer.pay(payment.id));

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status, 'another buyer’s payment was altered').toBe('DUE');
  });

  it('cannot reach the firm’s own screens', async () => {
    const c = callerFor(principalFor(buyerA, 'buyer', { buyerUnitId: buyerA.unitId }));
    await expectDenied('deals.list as buyer', () => c.deals.list({} as never));
    await expectDenied('sales.units as buyer', () => c.sales.units(A.dealId));
  });

  it('cannot use the investor portal, and vice versa', async () => {
    const buyer = callerFor(principalFor(buyerA, 'buyer', { buyerUnitId: buyerA.unitId }));
    const investor = callerFor(principalFor(investorA, 'investor', { investorId: investorA.investorId }));
    await expectDenied('investor portal as buyer', () => buyer.investors.myPosition());
    await expectDenied('buyer portal as investor', () => investor.buyer.myUnit());
  });
});

/**
 * Settling a payment when no money moved.
 *
 * The buyer portal falls back to instant settlement when no Stripe key is
 * configured. That is right for a demo and dangerous anywhere else: a firm that
 * has deployed but not yet set up payments is in exactly that state on day one,
 * possibly with buyers already invited. The fabricated settlement writes
 * Payment.status = PAID, which is what the sales ledger and the exposure
 * figures are built from — the buyer sees a label, the developer sees a deposit
 * that does not exist.
 */
describe('paying without a payment processor', () => {
  const withEnv = async (env: Record<string, string | undefined>, run: () => Promise<void>) => {
    const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.entries(env).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
    try {
      await run();
    } finally {
      Object.entries(before).forEach(([k, v]) => (v === undefined ? delete process.env[k] : (process.env[k] = v)));
    }
  };

  /** A reserved plot, its buyer's portal login, and a payment they owe. */
  const duePayment = async (t: Tenant) => {
    const unit = await prisma.unit.create({
      data: { orgId: t.orgId, dealId: t.dealId, name: 'Plot 1', spec: '3 bed', appraisedValue: BigInt(450_000_00), status: 'RESERVED', buyerName: 'Buyer' },
    });
    const user = await prisma.user.create({
      data: {
        orgId: t.orgId, email: `buyer-${unit.id}@stripe.test`, password: 'x', name: 'Buyer',
        initials: 'BY', role: 'VIEWER', principalType: 'buyer', buyerUnitId: unit.id,
      },
    });
    const payment = await prisma.payment.create({
      data: { orgId: t.orgId, unitId: unit.id, kind: 'Reservation fee', amount: BigInt(500_000), status: 'PENDING' },
    });
    const principal = {
      userId: user.id, orgId: t.orgId, principalType: 'buyer' as const, role: 'VIEWER',
      name: 'Buyer', initials: 'BY', investorId: null, buyerUnitId: unit.id,
    };
    return { payment, principal };
  };

  it('refuses in production unless someone decided otherwise', async () => {
    const t = await makeTenant('NoStripe');
    const { payment, principal: buyer } = await duePayment(t);

    await withEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: undefined, DEMO_MODE: undefined }, async () => {
      await expect(callerFor(buyer as never).buyer.pay(payment.id)).rejects.toThrow(/contact the developer/i);
    });

    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status,
      'a deposit was recorded as received when no money had moved',
    ).toBe('PENDING');
  });

  it('still settles on a demo instance that asked for it', async () => {
    const t = await makeTenant('DemoStripe');
    const { payment, principal: buyer } = await duePayment(t);

    await withEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: undefined, DEMO_MODE: '1' }, async () => {
      const out = (await callerFor(buyer as never).buyer.pay(payment.id)) as { mode: string };
      expect(out.mode).toBe('demo');
    });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PAID');
  });

  it('still settles in development, so the flow can be exercised', async () => {
    const t = await makeTenant('DevStripe');
    const { payment, principal: buyer } = await duePayment(t);

    await withEnv({ NODE_ENV: 'test', STRIPE_SECRET_KEY: undefined, DEMO_MODE: undefined }, async () => {
      expect(((await callerFor(buyer as never).buyer.pay(payment.id)) as { mode: string }).mode).toBe('demo');
    });
  });

  it('tells the buyer which of the three states they are in', async () => {
    const t = await makeTenant('Modes');
    const { payment, principal: buyer } = await duePayment(t);
    const mode = async () => ((await callerFor(buyer as never).buyer.myUnit()) as { stripeMode: string }).stripeMode;

    await withEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: undefined, DEMO_MODE: undefined }, async () => {
      // not "demo" — the portal used to promise instant settlement it would not do
      expect(await mode()).toBe('unavailable');
    });
    await withEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: undefined, DEMO_MODE: '1' }, async () => {
      expect(await mode()).toBe('demo');
    });
    await withEnv({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x' }, async () => {
      expect(await mode()).toBe('live');
    });
  });
});
