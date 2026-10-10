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
  and one certificate. Ambiguous matches remain unknown. A certificate without a retrieved floor area says “Area unavailable”. The shared engine
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

## Competitive capability review — 10 October 2026

The completed security, onboarding and regression work establishes reliability
of implemented behaviour. It does not establish parity with mature appraisal or
site-intelligence products. The next product milestone is a complete,
evidence-backed development appraisal workflow, evaluated on real source packs.

### External benchmark and observed implementation gaps

These are vendor-described capabilities, not independent performance results:

- [ARGUS Developer](https://www.altusgroup.com/solutions/argus-developer/):
  development feasibility, scenario comparison, cashflow and live-project reporting.
- [Aprao](https://www.aprao.com/): cloud development appraisal, residual land
  value, cashflow forecasting and lender-facing reports.
- [LandInsight Assessor](https://support.land.tech/en/articles/14088258-fact-sheet-assessor-explained):
  ownership/title information, planning, environmental evidence, comparables,
  property attributes and reports in a site-centred workflow.

The comparison spans different product categories. The intended first release
should compete on UK development appraisal and its supporting evidence; this
review does not establish coverage for every valuation purpose or asset class.

| Area | Evidence in this checkout | Required capability before claiming parity |
|---|---|---|
| Drawing/document intake | `documentBlocks` in `apps/api/src/routers/appraisal.ts` sends PDF/image content to extraction; spreadsheets now read up to ten worksheets, 400 rows and 40 columns per sheet with cell addresses and a shared 100,000-character budget; up to twelve documents within 20MB are read, with explicit omission warnings. DWG requires a PDF export. | A document register with sheet/revision identity, selectable pages/sheets, durable extraction jobs, explicit completeness and side-by-side source review. |
| Extracted inputs | Units carry source text and confidence; the model is instructed to cite documents/pages. | Structured document/page/region references, observed versus inferred values, GIA/NIA/unit checks, conflicting-revision handling and reviewer acceptance before promotion into the appraisal. Prompt-generated source text alone is not verified evidence. |
| Drawing measurement | PDF/image interpretation is available; this review found no calibrated drawing take-off workflow. | User-confirmed scale/dimensions, explicit area basis, manual correction, and versioned measurements. Native CAD/BIM support is a separate adapter and validation project. Never infer reliable measurement from a visually plausible plan. |
| Property identity and maps | Postcode geocoding, tile maps and optional Google Static Maps adapter. The connector table explicitly marks OS unavailable. | Exact address/UPRN selection, verified coordinates, saved site geometry, source-labelled overlays, adjacent-site checks and licensed exportable map snapshots. |
| Land Registry | Open Price Paid evidence for comparables. | Separate acquisition paths for title references, ownership, title documents and boundary datasets; a price-paid connection cannot represent these services. |
| Comparables and costs | Recorded comparables, adjustments and pooled completed-scheme benchmarks; no implemented PriceHubble or BCIS connector. | Appropriate sold/rental/commercial evidence for the asset, identity matching, dates and provenance; sourced QS/cost-index assumptions. Buy the sources the launch workflow needs rather than every catalogue entry. |
| Export/review | PDF reports and substantive Excel workbooks already exist, including selected formulas and engine-derived results. | A reproducible evidence pack linking accepted inputs, drawing revisions, comparable selection, map sources, assumptions, scenario versions and reviewer sign-off. Explicitly distinguish editable spreadsheet cells from engine snapshots. |

### Ordered delivery programme

1. **Source-to-appraisal workbench.** Start with PDF drawings, an accommodation
   schedule and an XLSX cost plan. Preserve the existing engine. Build source
   selection, structured extraction evidence and an accept/correct workflow.
   Acceptance: no silently omitted document/page/sheet; every imported input
   is traceable or explicitly marked as a manual assumption; a changed drawing
   cannot silently replace previously approved inputs.
2. **Property identity and site evidence.** Implement an address/UPRN adapter,
   save site geometry with its provenance, then connect the chosen mapping and
   title/constraints sources. Acceptance: exact-property identity is separate
   from postcode-centre screening; every overlay states coverage and freshness;
   unavailable sources remain visibly unknown; printed maps retain attribution.
3. **Commercial appraisal and pack benchmark.** Have intended users complete
   the same representative residential, mixed-use and commercial development
   cases in Apex and their existing tool. Test only supported valuation methods.
   Record completion time, correction count, source traceability, cashflow and
   scenario reconciliation, and report usability. Fix failed tasks before adding
   more modules. Customer and professional acceptance remain unproven until run.

This is a delivery specification, not a claim these capabilities were implemented
by this review. A market-leadership claim needs measured customer outcomes.

### Provider decisions that must be separated

- [Google Maps Static API](https://developers.google.com/maps/documentation/maps-static/overview)
  needs an enabled, billed project and credentials. The adapter already exists;
  live activation and acceptance remain outstanding. Interactive Google Maps
  would also change the current browser privacy/third-party-loading design and
  needs an explicit implementation decision.
- [OS Places](https://docs.os.uk/os-apis/accessing-os-apis/os-places-api) supplies
  address lookup and UPRN identity. It is a separate capability from imagery.
- [HM Land Registry Price Paid Data](https://www.gov.uk/guidance/about-the-price-paid-data)
  provides registered transaction evidence for England/Wales, with reporting lag.
  [Business Gateway official copies](https://www.api.gov.uk/hmlr/official-copy-title-known/)
  and the licensed [National Polygon Service](https://www.gov.uk/guidance/national-polygon-service)
  serve different needs. Confirm access, permitted use and costs for each selected
  product before presenting it as available to customers.
- Title plans/registered polygons must retain their source's boundary limitations;
  they are not a substitute for a measured survey. Do not label a drawn user
  polygon as an authoritative title boundary.

Existing account/licence availability is requested from the owner. Secrets must
be configured through the approved secret store, never pasted into the workfile
or committed. No subscriptions, provider contracts or live paid calls were made
as part of this assessment.

### First source-review increment

The Auto-Appraisal screen now starts with empty project notes; the worked example
is an explicit action and remains labelled as sample data. Excel files appear in
the source picker. Extracted units can be corrected before saving, recalculated
through the existing server engine, and accepted explicitly in the UI. Corrections
retain their previous source text and are labelled user-corrected. Source-document
links use the data room's scoped download URLs. Formula errors, missing cached
results and workbook limits are reported beside the review acknowledgement.

The compute query uses an authenticated POST transport because complete extraction
payloads can exceed URL limits. No financial arithmetic or database schema changed.

This is an initial review workflow, not a complete drawing workbench: PDF page/region
citations, revision conflict detection, calibrated measurement, durable extraction
jobs and persisted reviewer attestations remain outstanding. Browser tests exercise
the labelled worked example and real engine; they do not establish live model
accuracy on customer drawings. Licensed provider activation and real source-pack
acceptance remain separate release requirements.
