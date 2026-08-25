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
