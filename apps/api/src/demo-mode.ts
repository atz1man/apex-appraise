/**
 * May this deployment fabricate a result when the real integration is absent?
 *
 * Several features degrade to something plausible rather than failing: the
 * buyer portal settles a payment with no card processor behind it, and
 * Auto-Appraisal returns a built-in worked example when there is no
 * ANTHROPIC_API_KEY. Both are right for a demo instance and wrong anywhere
 * else, and in both cases the trigger is the ABSENCE of configuration — which
 * is not consent. A firm that has deployed but not yet set up Stripe, or an AI
 * key, is in exactly that state on day one.
 *
 * What makes it dangerous is that the fabrication does not stay where it was
 * shown. A demo settlement writes Payment.status = PAID, which the sales ledger
 * and exposure figures are built from. A sample extraction can be saved into a
 * real appraisal, carrying unit values and citations — "Drawing A-102" — for
 * documents this deal has never had.
 *
 * So in production it takes a decision, the same shape the seed uses for demo
 * accounts (prisma/seed.ts). Outside production it stays on, because a feature
 * that cannot be exercised locally is a feature nobody tests.
 */
export const demoFallbacksAllowed = () =>
  process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE === '1';
