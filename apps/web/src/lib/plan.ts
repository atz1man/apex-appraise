import { FEATURE_COPY, cheapestPlanWith, planLabel, type Feature } from '@apex/types/plan';
import { trpc } from './trpc';

/**
 * What this workspace's plan switches on.
 *
 * The API is what ENFORCES a feature; this only decides what the screen looks
 * like before it is asked. So while the plan is still loading every feature reads
 * as available: a paying customer must never see their own product flash a
 * paywall, and being optimistic here costs nothing because the request behind the
 * control is refused on the server regardless.
 */
export function usePlanFeatures() {
  const { data } = trpc.org.get.useQuery(undefined, { staleTime: 60_000 });
  return {
    plan: data?.plan ?? null,
    loaded: data !== undefined,
    has: (feature: Feature) => (data ? data.features.includes(feature) : true),
  };
}

/** "AI Development Director is included from Growth." */
export const featureUpgradeLine = (feature: Feature) =>
  `${FEATURE_COPY[feature]} is included from ${planLabel(cheapestPlanWith(feature))}.`;

export const featureName = (feature: Feature) => FEATURE_COPY[feature];
export const featurePlanName = (feature: Feature) => planLabel(cheapestPlanWith(feature));
