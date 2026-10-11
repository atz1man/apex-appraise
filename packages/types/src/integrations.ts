/**
 * The data sources this product integrates with, and which of them it can
 * actually contact.
 *
 * Its OWN module, not a corner of the index, and the reason is measured: the
 * Integrations screen used to import `type IntegrationProvider` from the index,
 * which is erased at compile time and costs nothing. Importing the connector
 * TABLE from the same place pulled the index in for real — every zod schema with
 * it — and `check:bundle` failed naming the route: Integrations grew 60K to 69K,
 * nine-tenths of it schemas a settings screen never opens. `plan`,
 * `asset-classes`, `regions` and `uk-regions` are separate entry points for
 * exactly this reason; this is the fifth.
 */

/**
 * The data providers a workspace can connect.
 *
 * `integrations.connect` took `z.string()` and looked the provider up with
 * `findFirst`, so an unknown name simply found no row and 404'd — the provider
 * was never validated, it merely failed. `isolation-sweep` relied on that
 * accident: it feeds every procedure another firm's ids, and this one refused
 * them because no IntegrationConnection had a cuid for a provider name. The
 * moment `connect` became an upsert (so a firm could connect a provider it had
 * no placeholder row for) the accident stopped holding, and the sweep said so
 * immediately.
 *
 * So the set is named. Shared rather than kept in the router because the
 * Integrations screen renders a card per provider and typed its own copy of
 * these strings; `ProviderMeta.provider` is this type, so a card naming a
 * provider the server will not accept is now a typecheck failure rather than a
 * button that 400s.
 */
export const INTEGRATION_PROVIDERS = [
  'HM Land Registry',
  'EPC Register',
  'Companies House',
  'PriceHubble AVM',
  'Planning Portal',
  'Ordnance Survey',
  'Environment Agency',
  'BCIS',
  'Xero',
  'DocuSign',
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

/**
 * Whether this server can actually contact a provider.
 *
 * `integrations.connect` was an upsert that set `status: 'CONNECTED'` and
 * `lastSync: new Date()` for ANY of the ten names above, with no credential, no
 * handshake and no request leaving the building. So the Integrations screen read
 * "Connected · Synced just now" for providers nothing in this codebase can talk
 * to — Ordnance Survey, BCIS, DocuSign and PriceHubble have no connector at all,
 * and the Planning Portal card promised "application history, decision notices
 * and conditions", which is a commercial submission service and not the open
 * dataset this product actually reads.
 *
 * A green dot is a claim about a capability. Four of the ten were a claim the
 * product could not meet, made to a paying customer on the screen whose whole
 * purpose is to tell them what works. So the table says which, in one place, and
 * `connect` refuses the rest: a provider that cannot be reached cannot be
 * connected.
 *
 * `instead` is not consolation copy. A provider with no connector is a dead end
 * unless the firm is told what does the job, and in every case here something
 * does — this product's own comparables, its own benchmark pool, its own
 * signature flow. Saying so is the difference between "not available" and
 * "you already have this".
 */
export type IntegrationConnector =
  | {
      readonly connects: true;
      /** none = open data, key = the workspace's own API key, oauth = a consent flow. */
      readonly auth: 'none' | 'key' | 'oauth';
      /** Where in the product the data arrives, so "connected" names an outcome. */
      readonly feeds: string;
      /** Whether `integrations.sync` writes rows onto a deal for it. */
      readonly syncs: boolean;
      /** Geographic/product coverage, not a promise of completeness or health. */
      readonly coverage: string;
      readonly limitations: string;
    }
  | { readonly connects: false; readonly instead: string };

export const INTEGRATION_CONNECTORS: Record<IntegrationProvider, IntegrationConnector> = {
  // `fetchSoldPrices` — the open Price Paid data, no key
  'HM Land Registry': { connects: true, auth: 'none', feeds: 'Comparables and the site pack', syncs: true, coverage: 'England and Wales', limitations: 'Registered sales, not asking prices or title ownership. Nearby-postcode sample; recent registrations can be incomplete.' },
  // `fetchEpc` — MHCLG's service, Bearer token from the workspace's own key.
  // NOT syncable: the sync branch wrote a Document row for a certificate PDF
  // that does not exist, which is the rule about a portal never offering a file
  // it cannot open, one layer up. The records themselves are live on the pack.
  'EPC Register': { connects: true, auth: 'key', feeds: 'The site pack’s EPC panel', syncs: false, coverage: 'England and Wales', limitations: 'Recorded certificates, not a measured survey. Floor areas contribute a rate only after an unambiguous address and postcode match.' },
  'Companies House': { connects: true, auth: 'key', feeds: 'The site pack’s counterparty panel', syncs: false, coverage: 'UK registered companies', limitations: 'Filed company information; not land ownership, a credit check or verification of the accuracy of filings.' },
  // `fetchConstraints` — planning.data.gov.uk, no key. Designations and
  // constraints, which is what the card says now; it is not application history.
  'Planning Portal': { connects: true, auth: 'none', feeds: 'The site pack’s planning constraints', syncs: false, coverage: 'England; coverage varies by dataset and authority', limitations: 'Postcode-centre intersections, not full site-boundary or adjacent-property checks. No application history or legal search.' },
  // `fetchFloodWarnings` — the Environment Agency's flood-monitoring API, no key
  'Environment Agency': { connects: true, auth: 'none', feeds: 'The site pack’s flood panel', syncs: false, coverage: 'England', limitations: 'Current warnings nearby; no warnings does not mean low flood risk. No long-term risk, surface-water or contamination assessment.' },
  // `xero.ts` — a real OAuth connector with its own panel in Settings
  Xero: { connects: true, auth: 'oauth', feeds: 'Cost monitoring, via Settings → Integrations', syncs: false, coverage: 'The authorised Xero organisation', limitations: 'Requires OAuth and mapping of deals to accounting records. Connection alone does not reconcile a deal.' },

  'Ordnance Survey': {
    connects: false,
    instead:
      'Street maps and optional aerial imagery are available on the site pack. This product does not yet '
      + 'provide OS address identification, title boundaries or measured site polygons. Enter verified GIA/NIA on the appraisal.',
  },
  BCIS: {
    connects: false,
    instead:
      'Benchmarking provides pooled evidence from completed schemes. It is not a substitute for a licensed '
      + 'BCIS index. Add your quantity surveyor’s sourced cost assumptions to the appraisal.',
  },
  DocuSign: {
    connects: false,
    instead:
      'Terms of engagement are signed in the product: the client opens a signing link, types their name and '
      + 'ticks the box, and the signature is stored on the engagement with its own audit trail.',
  },
  'PriceHubble AVM': {
    connects: false,
    instead:
      'A licensed AVM connector is not implemented. Use recorded comparables and UKHPI as cross-checks for now. '
      + 'A future provider estimate must retain its valuation date, inputs, confidence and source, separately from the engine appraisal.',
  },
};

/** Providers a firm can actually connect — the Connect button's own list. */
export const CONNECTABLE_PROVIDERS = INTEGRATION_PROVIDERS.filter(
  (p) => INTEGRATION_CONNECTORS[p].connects,
);
