# Product direction and evidence readiness

Reviewed 9 October 2026. This is an engineering and product assessment, not a
claim of market leadership or professional valuation acceptance.

## Who this release serves

Focus the first customer release on UK development teams producing residual
appraisals and investment/lender packs. Validate that focus with intended buyers
before widening geography or promising automated property valuations. The
existing engine, comparable adjustments, scenarios, cost monitoring, sales,
engagements and document workflows provide breadth; source integrity and a
clear workfile workflow are the immediate product priorities.

Official product descriptions show the competitive baseline: [ARGUS EstateMaster](https://www.altusgroup.com/solutions/argus-estatemaster/)
provides development feasibility, cashflow and development management;
[Aprao](https://help.aprao.app/hc/en-gb/articles/4909838379421-An-overview-of-Aprao)
serves developers, valuers and lenders with development appraisal workflows.
A feature inventory does not establish superiority. Compare real customer tasks,
completion time, errors, evidence review and exported packs using the same scheme.

## Improvements implemented in this change

- The dashboard lets users choose the working deal and retains that choice for
  their browser session. Every deal tool targets a deal actually returned for
  their signed-in workspace. Site evidence has a direct front door.
- Maps offer street/aerial selection where imagery is configured, fit properties,
  labelled pins, source/configuration failure messages and imagery fallback.
  Popup labels are text nodes, not executable HTML. Images preserve the complete
  frame and attribution; printed Red Book maps omit screen controls.
- Site evidence separates available, fetching, unavailable, key-required and
  outside-coverage sources. Failed checks show unknown counts, not green zeroes.
  Planning screening and postcode-centre coordinates explain their limits.
- Land Registry queries request the newest records before taking a bounded
  sample. Failed or incomplete searches cannot become cached empty evidence.
  A geocoding outage cannot become 90 days of cached missing pins.
- Automatic EPC rates require exact normalized address and postcode identity
  and one certificate. Ambiguous matches remain unknown. The shared engine
  computes rates; the screen formats them in the workspace's area unit.
- Known unsupported countries are not searched as though an empty response
  were local evidence. Historic geocode caches without country remain unknown;
  the product does not infer nationality from a guessed postcode region.
- The connector catalogue carries coverage and limitations alongside capability.
  Customer release checks require an explicit production tile service, attribution
  and identifying user agent; the public OSM service has no availability guarantee.

## Data procurement decisions

| Need | Current implementation | Required commercial acceptance |
|---|---|---|
| Sale evidence | HM Land Registry bounded nearby-postcode sample | Check omissions, registration lag, property identity and suitability for the scheme. It is England/Wales data, not a complete local market search. |
| Exact address and site geometry | Postcode-centre geocoding; server-proxied maps | Evaluate [OS Places](https://docs.os.uk/os-apis/accessing-os-apis/os-places-api) for address/UPRN identity and separately licensed boundary sources. Postcode pins are not measured buildings or title boundaries. |
| Planning | planning.data.gov.uk point intersections | Confirm local authority/layer coverage; add boundary and adjacency evidence before promising full site screening. |
| Flood | Current Environment Agency warnings nearby | Procure long-term and surface-water risk evidence if required by the intended customer; current warnings cannot establish low flood risk. |
| EPC | Workspace credentials; certificate records and conservative area joins | Verify certificate identity, date and area basis. Record measured GIA/NIA separately where needed. |
| AVM and market intelligence | No licensed AVM connector | Evaluate Hometrack and PriceHubble on representative properties, coverage, source rights, confidence and costs; require a contracted test account before implementing a paid adapter. |
| Cost indices | Appraisal inputs and pooled completed-scheme benchmarks | Evaluate licensed BCIS data for customer requirements. Pooled benchmarks are not a published cost index. |
| Production mapping | Configurable server tile proxy and optional Google Static Maps | Confirm caching/proxy/export rights, attribution, capacity, availability and spend limits for the chosen provider. |

Primary evidence: [Land Registry coverage and limitations](https://www.gov.uk/guidance/about-the-price-paid-data),
[planning coverage](https://www.planning.data.gov.uk/about/),
[EPC service coverage](https://get-energy-performance-data.communities.gov.uk/),
[Environment Agency real-time API](https://environment.data.gov.uk/flood-monitoring/doc/reference),
[OSM tile usage and availability](https://operations.osmfoundation.org/policies/tiles/).
[Hometrack](https://www.hometrack.com/data-services/) advertises connected data
APIs, comparables and market intelligence. [PriceHubble's documentation](https://docs-prod.pricehubble.com/)
includes valuation and transaction endpoints. These establish candidate
capabilities, not our access, licensing rights or their performance on our cases.

## Provider adapter contract for the next integration

Keep provider credentials server-side and tenant-scoped. A provider response
must retain its provider/record identity, retrieval time, effective date, geography,
licence/attribution and property matching basis. Separate successful empty,
partial, unsupported, authentication failure and transient outage outcomes. Cache
only outcomes appropriate to their validity, and make freshness visible.

An AVM estimate remains external evidence with its own inputs and confidence.
It must not overwrite the deterministic development appraisal or masquerade as
an inspected, signed valuation. Introduce adapters only against actual versioned
provider documentation and fixtures from the licensed test account. Verify
schema changes, timeouts, rate limits, retries, tenant isolation and export rights.

## Acceptance before claiming a differentiated paid product

1. Intended customers complete a real scheme from source evidence to signed
   review and the delivered pack. Record usability findings and resolve them.
2. Compare the same work against their current tool: time, corrections, evidence
   traceability, scenario decisions and report quality. Customer preference and
   willingness to pay supply the commercial evidence.
3. Resolve the source procurement table with representative data and written
   rights, including customer/export use. Set provider spend limits.
4. Complete [SaaS release acceptance](SAAS-RELEASE.md): live billing/email,
   operator identity, deployment isolation, restore drill and support ownership.
5. Test every promised module in the intended role, viewport and geography.
   Maintain deterministic engine fixtures, API contract tests, browser journeys,
   accessibility checks and bundle budgets as release gates.

A continuing advantage requires customer feedback, source maintenance and
release evidence. No architecture can guarantee future compatibility or revenue.
