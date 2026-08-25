/**
 * Plans: what each tier switches on.
 *
 * A file of its OWN, exported as `@apex/types/plan`, because the browser needs
 * it and index.ts is a wall of zod. Importing the catalogue through the barrel
 * shipped the whole of zod — 58 kB — to every visitor of Settings and
 * Benchmarking, to read four string constants. Heavy deps stay out of the app
 * bundle; this is the same rule applied to a package boundary.
 */
/**
 * The catalogue lives here, not in the API, because BOTH sides need it and a
 * second copy is how the pricing page and the server drifted apart in the first
 * place. The API enforces it (src/entitlements.ts); the app uses it to show a
 * locked surface with an upgrade route instead of a live control that answers
 * FORBIDDEN. The server refusal is what protects the feature — this only decides
 * what the screen looks like before it is asked.
 */
export const PLAN_KEYS = ['TRIAL', 'STARTER', 'GROWTH', 'ENTERPRISE'] as const;
export type PlanKey = (typeof PLAN_KEYS)[number];

export const FEATURES = ['aiDirector', 'portals', 'benchmarking', 'publicApi'] as const;
export type Feature = (typeof FEATURES)[number];

/** The exact words the pricing page sells each key with. */
export const FEATURE_COPY: Record<Feature, string> = {
  aiDirector: 'AI Development Director',
  portals: 'Buyer + investor portals',
  benchmarking: 'Benchmarking',
  publicApi: 'Public API + webhooks',
};

/**
 * The trial carries every feature, not Starter's — deliberately unlike the
 * volumes, which are Starter's exactly. The limit people meet is what makes them
 * decide, and a trial that hides the AI Development Director cannot sell Growth.
 */
export const PLAN_FEATURES: Record<PlanKey, readonly Feature[]> = {
  TRIAL: ['aiDirector', 'portals', 'benchmarking', 'publicApi'],
  STARTER: [],
  GROWTH: ['aiDirector', 'portals', 'benchmarking'],
  ENTERPRISE: ['aiDirector', 'portals', 'benchmarking', 'publicApi'],
};

/** Cheapest first. Pinned against the real prices by the API's guard test. */
export const PAID_PLANS_BY_PRICE: readonly PlanKey[] = ['STARTER', 'GROWTH', 'ENTERPRISE'];

/**
 * An unrecognised plan gets NO features — the OPPOSITE fallback to the volumes,
 * which fall back to TRIAL. TRIAL is the tightest set of volumes and the most
 * generous set of features, so one constant for both would hand a Stripe typo the
 * entire product.
 */
export const featuresFor = (plan: string): readonly Feature[] =>
  PLAN_FEATURES[(plan as PlanKey) in PLAN_FEATURES ? (plan as PlanKey) : 'STARTER'];

export const planHasFeature = (plan: string, feature: Feature) => featuresFor(plan).includes(feature);

/** The cheapest plan that includes a feature — what a refusal tells you to buy. */
export const cheapestPlanWith = (feature: Feature): PlanKey =>
  PAID_PLANS_BY_PRICE.find((p) => PLAN_FEATURES[p].includes(feature)) ?? 'ENTERPRISE';

/** "GROWTH" → "Growth", for a sentence rather than a shout. */
export const planLabel = (plan: PlanKey | string) => plan.charAt(0) + plan.slice(1).toLowerCase();

/**
 * The plans, as sold.
 *
 * One definition, because there were two. The API owned this list and the
 * landing page kept its own copy of the same three columns, and they had already
 * parted company: the public page offered Enterprise "Data exports + API
 * access" where the product sells "Public API + webhooks", and described the
 * site pack with different words on each side. A prospect and a subscriber were
 * reading different promises about the same tier.
 *
 * "Data exports" is gone from the Enterprise column rather than reworded,
 * because it was never true as a differentiator: org.exportData is open on every
 * plan and must stay that way — taking your data out is how you leave, and a
 * paywall in front of leaving is not a feature. The landing page says so in its
 * "every plan includes" line instead.
 *
 * Prices are in pence to match everything else that touches money.
 */
export interface PlanDef {
  key: Exclude<PlanKey, 'TRIAL'>;
  name: string;
  pricePencePerMonth: number;
  blurb: string;
  features: string[];
  /** the column drawn with the border and the "Most popular" tag */
  featured?: boolean;
}

export const PLANS: PlanDef[] = [
  {
    key: 'STARTER',
    name: 'Starter',
    pricePencePerMonth: 4900,
    blurb: 'For a single developer running a handful of deals',
    features: ['3 active deals', '2 team members', 'Appraisal engine + reports', 'Site pack (open data)'],
  },
  {
    key: 'GROWTH',
    name: 'Growth',
    pricePencePerMonth: 14900,
    blurb: 'For teams running a live pipeline',
    features: ['Unlimited deals', '10 team members', 'AI Development Director', 'Buyer + investor portals', 'Benchmarking'],
    featured: true,
  },
  {
    key: 'ENTERPRISE',
    name: 'Enterprise',
    pricePencePerMonth: 39900,
    blurb: 'Multi-entity groups and funds',
    features: ['Everything in Growth', 'Unlimited members', 'Priority support', 'Public API + webhooks'],
  },
];
