/**
 * A demo build must not hold a key that costs money.
 *
 * `SEED_DEMO=1` creates the three demo logins with the password `demo`, and
 * they are published — in the README, in `prisma/seed.ts`, and by the login
 * page itself, which offers them. That is the point of a demo instance. It also
 * means the sign-in is not a barrier: anybody who can reach the host can be an
 * ADMIN of the seeded workspace, whose plan is ENTERPRISE and therefore carries
 * every AI feature.
 *
 * So a billable key on such a build is an open spend channel. Measured on a
 * real deployment: `ANTHROPIC_API_KEY` was set on a publicly reachable demo
 * whose credentials were in the repo, and nothing in the product bounded the
 * spend — the AI procedures are gated on the `aiDirector` feature and sit in
 * the general rate-limit bucket (600 requests/min per IP), and there is no
 * per-org usage cap anywhere. Nothing was actually spent, and it was luck
 * rather than design that nothing was.
 *
 * This WARNS rather than refusing to boot, and the distinction is deliberate:
 * a demo with a spend-capped key is a legitimate thing to run — it is the most
 * persuasive version of the product — so the operator gets told loudly and
 * keeps the decision. What it removes is the silence.
 *
 * A Stripe TEST key is not billable and does not fire. That nuance is the
 * difference between a guard somebody heeds and one they learn to ignore: the
 * first version of this warning would have shouted about `sk_test_…`, which is
 * exactly the false positive that teaches people to stop reading warnings.
 */
export interface BillableKey {
  /** the variable, so the fix is unambiguous */
  name: string;
  /** what it costs, in the operator's terms */
  cost: string;
}

const isSet = (v: string | undefined) => typeof v === 'string' && v.trim() !== '';

/**
 * The billable keys this environment holds, given that it seeds the published
 * demo logins. Empty when it does not seed them — a real deployment creates its
 * own accounts and its keys are nobody else's to spend.
 */
export function billableKeysOnPublicDemo(env: NodeJS.ProcessEnv = process.env): BillableKey[] {
  if (env.SEED_DEMO !== '1') return [];
  const found: BillableKey[] = [];
  if (isSet(env.ANTHROPIC_API_KEY)) {
    found.push({ name: 'ANTHROPIC_API_KEY', cost: 'every extraction, narrative and data-room question is a paid API call' });
  }
  /**
   * Live keys only. `sk_test_…` moves no money, and a demo instance running the
   * buyer journey against Stripe's test mode is doing the right thing.
   */
  if (isSet(env.STRIPE_SECRET_KEY) && env.STRIPE_SECRET_KEY!.trim().startsWith('sk_live')) {
    found.push({ name: 'STRIPE_SECRET_KEY', cost: 'a LIVE Stripe key — buyer payments would take real money' });
  }
  return found;
}

/** The warning an operator can act on, or null when there is nothing to say. */
export function demoKeyWarning(env: NodeJS.ProcessEnv = process.env): { keys: string[]; msg: string } | null {
  const found = billableKeysOnPublicDemo(env);
  if (found.length === 0) return null;
  return {
    keys: found.map((k) => k.name),
    msg:
      `SEED_DEMO=1 publishes the demo logins (password "demo"), so anyone who can reach this host is an admin here — ` +
      `and this build holds ${found.length === 1 ? 'a key' : 'keys'} that ${found.length === 1 ? 'costs' : 'cost'} money: ` +
      found.map((k) => `${k.name} (${k.cost})`).join('; ') +
      `. Either remove ${found.length === 1 ? 'it' : 'them'}, or put the instance behind authentication and a spend cap.`,
  };
}
