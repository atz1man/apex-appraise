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
    }
  | { readonly connects: false; readonly instead: string };

export const INTEGRATION_CONNECTORS: Record<IntegrationProvider, IntegrationConnector> = {
  // `fetchSoldPrices` — the open Price Paid data, no key
  'HM Land Registry': { connects: true, auth: 'none', feeds: 'Comparables and the site pack', syncs: true },
  // `fetchEpc` — MHCLG's service, Bearer token from the workspace's own key.
  // NOT syncable: the sync branch wrote a Document row for a certificate PDF
  // that does not exist, which is the rule about a portal never offering a file
  // it cannot open, one layer up. The records themselves are live on the pack.
  'EPC Register': { connects: true, auth: 'key', feeds: 'The site pack’s EPC panel', syncs: false },
  'Companies House': { connects: true, auth: 'key', feeds: 'The site pack’s counterparty panel', syncs: false },
  // `fetchConstraints` — planning.data.gov.uk, no key. Designations and
  // constraints, which is what the card says now; it is not application history.
  'Planning Portal': { connects: true, auth: 'none', feeds: 'The site pack’s planning constraints', syncs: false },
  // `fetchFloodWarnings` — the Environment Agency's flood-monitoring API, no key
  'Environment Agency': { connects: true, auth: 'none', feeds: 'The site pack’s flood panel', syncs: false },
  // `xero.ts` — a real OAuth connector with its own panel in Settings
  Xero: { connects: true, auth: 'oauth', feeds: 'Cost monitoring, via Settings → Integrations', syncs: false },

  'Ordnance Survey': {
    connects: false,
    instead:
      'Mapping and site measurement are already served without an OS Data Hub key: the site map is this '
      + 'server’s own tile proxy, and areas are entered as GIA/NIA on the appraisal.',
  },
  BCIS: {
    connects: false,
    instead:
      'Build-rate validation comes from Benchmarking — the pooled medians of real schemes this and other '
      + 'firms have completed, which is evidence of what things cost here rather than a published index.',
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
      'A cross-check on the valuation comes from the comparables and the UKHPI series on Benchmarking. An '
      + 'automated estimate from a third party would enter the evidence file as a figure nobody can source.',
  },
};

/** Providers a firm can actually connect — the Connect button's own list. */
export const CONNECTABLE_PROVIDERS = INTEGRATION_PROVIDERS.filter(
  (p) => INTEGRATION_CONNECTORS[p].connects,
);
