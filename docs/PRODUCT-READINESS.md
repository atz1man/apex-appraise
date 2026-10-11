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
jobs remain outstanding. Persisted input acknowledgements are described below. Browser tests exercise
the labelled worked example and real engine; they do not establish live model
accuracy on customer drawings. Licensed provider activation and real source-pack
acceptance remain separate release requirements.

### Durable input acknowledgement

Source review now persists on the appraisal row in the same write as its inputs.
The server stamps the authenticated reviewer, review time, canonical input hash,
source-document metadata and user-reported omissions/sample status. Document IDs
must belong to the same workspace and deal. The full appraisal shows this record
after reload, warns when inputs change (including writes through other routes),
and reports changed or missing source identities without linking to a replacement.
An ordinary edit retains the historical record and checks its input hash; a new
unreviewed version starts without a record. Restoring an exact old version retains
its historical acknowledgement, including its original reviewer and time.

This acknowledgement is separate from professional approval. Source metadata is
captured at save time, not cryptographic proof of the file read during extraction.
Sample status and omissions are reported by the reviewing client. This increment
does not add file-content hashes, verified page/region citations, an append-only
review ledger or review export into PDF/Excel packs. Existing appraisals remain
explicitly unreviewed; no acceptance is fabricated or backfilled.

The nullable `Appraisal.sourceReview` column requires the included migration.

### Drawing references, revisions and portable evidence

A reviewer can now attach a source document plus a PDF page or drawing/sheet/cell
location to a unit. These are labelled user-entered references; page existence,
source interpretation and drawing measurements are not automatically verified.
References are validated against the reviewed source IDs and unit indices and
persist with the accepted unit labels.

The data room links an earlier uploaded document to a later revision without
replacing either file. Same-deal/workspace checks, strict upload ordering and
compare-and-set writes protect the links; changes and removals are audited in
the same transaction. Superseded documents are excluded from new extraction,
and existing appraisals report their superseded sources. Undoing a link is
explicit and keeps both files. A missing replacement never silently promotes
the older file to current; the revision panel exposes the missing link so a
reviewer can relink it or explicitly undo it. The nullable Document.supersededById migration
is required. Revision identity does not certify that the files represent the
same drawing; linking them remains a reviewer decision.

The development-appraisal PDF adds paginated source-evidence pages (at most twelve evidence pages, with explicit continuation notices directing readers to the complete Excel register). Excel adds a
Source evidence sheet. Both carry input-review status, reviewer/time, source
identities, references, omissions and worked-example warnings, without exporting
expiring download tokens. Excel exports of unsaved edits explicitly mark the old
review as not covering those inputs. This is a source register, not a ZIP bundle
of original files. Native CAD/BIM, calibrated measurement, region-level PDF
viewing, cryptographic source-content pins and live extraction accuracy testing
remain outstanding; Red Book and funding-pack exports are separate formats.


### Upload fingerprints — 11 October 2026

New workfile document uploads compute SHA-256 while streaming the file into exclusive storage.
The document row and subsequent input acknowledgements retain that server-owned
fingerprint. The appraisal source panel and development PDF/Excel register expose
it, allowing a recipient to compare a separately obtained file to the recorded
upload. A changed or removed recorded fingerprint marks a pinned source changed
and withholds its reviewed download link. Older source reviews remain readable
and explicitly say that no fingerprint was recorded; a later fingerprint is not
backfilled into a historical review.

This identifies the bytes received at upload. It does not rehash storage during
extraction or export, prove which bytes the model read, verify page references,
or establish professional acceptance. The nullable Document.sha256 migration
is required. No financial calculation changed.

Next priority: close the extraction-time integrity gap and measure the complete
source-to-appraisal workflow on representative customer packs. Integration of
the stacked PRs and the external SaaS acceptance checks remain release work.


### Extraction file integrity — 11 October 2026

Document extraction now hashes the bytes read from storage and compares them to
an available upload fingerprint before constructing model content. A mismatch is
excluded and named in the existing omission/error flow and recorded in the
mutation audit trail; an entirely mismatched
selection never calls the model or marks a document extracted. A mixed selection
sends only usable sources. Legacy files without upload fingerprints remain
readable with an explicit warning that their original upload cannot be verified.
Spreadsheets parse the same checked buffer rather than reopening the path after
verification; PDF and image blocks use that buffer too.

Regression evidence includes same-size alterations of PDF, image and workbook
files, a real workbook parsed without a second path read, legacy warnings, and
guarded extraction calls with a stubbed model transport. No live model call or
claim of extraction accuracy is involved. No engine arithmetic or schema changed.

This verifies source bytes at model-input preparation, not model interpretation,
page locations or exported storage. It does not yet persist an extraction receipt
binding the accepted inputs to that particular model request. Next priority:
carry a durable extraction receipt into review, then integrate the stacked PRs
and validate real customer packs against the SaaS release acceptance checklist.


### Bounded source reads — 11 October 2026

Extraction previously loaded a complete uploaded file before enforcing its 20 MB
shared input budget. It now reads at most the remaining budget plus one overflow
byte, closes the stream on overflow, and names the excluded source. Rejected
large files do not consume the remaining budget, so a later smaller source can
still be processed. Stored size metadata is not trusted for this decision.

Tests measure actual stream bytes read and descriptor closure, exact-fit and
zero-byte boundaries, missing storage, invalid budgets, and a multi-document
selection that exceeds the shared limit. This bounds encoded source reads only:
workbook decompression/parser memory, model context limits and overall extraction
concurrency remain separate resource controls. No engine arithmetic or schema
changed. The extraction-receipt and release-integration priorities above remain.


### Unavailable source selections — 11 October 2026

A deleted or inaccessible selected document previously disappeared from the
scoped source lookup. When other sources remained readable, extraction could
succeed without disclosing the incomplete selection. It now reports the number
of unique unavailable selections and asks the reviewer to reload the source
list. Missing and foreign-workspace IDs produce the same generic warning; no
foreign filename, ID, storage path or existence claim is disclosed. Duplicate
IDs do not inflate the count. Entirely unavailable selections refuse the model
request; mixed selections retain the warning in the existing review flow.

Regression evidence covers tenant non-disclosure, duplicate IDs, mixed valid/
unavailable selections and the guarded extraction procedure. No live model call,
financial arithmetic or schema change is involved. Durable extraction receipts,
release integration and customer-pack acceptance remain the next priorities.


### Report renderer termination — 11 October 2026

Rendering a PDF installed Playwright signal handlers in the API process. Its
SIGTERM/SIGHUP handlers closed Chromium but left the HTTP listener running,
turning a normal deployment stop into a forced kill. Renderer launches now leave
TERM, HUP and INT handling to the host process. These checks do not establish
browser-child cleanup following a signal.

A real-process smoke check opens an HTTP listener, renders an actual PDF with
the production renderer module and sends each signal. The old implementation
failed TERM/HUP by timing out and replaced INT with exit code 130; the change
preserves native signal exits. CI runs this check inside the built API image
with its system Chromium after the browser journeys. This establishes signal
behaviour, not graceful draining of active requests or operational rollback
acceptance. No financial arithmetic, credentials or schema changed. Durable
extraction receipts and integration/customer acceptance remain next priorities.


### Extraction completion integrity — 11 October 2026

After a model response, extraction previously marked each selected file extracted
and wrote its audit separately, without checking whether its source had changed
while the model was running. Completion now compares the prepared document
identity (workspace/deal, file path, fingerprint, name/type/size/upload time and
current revision status) in the status update. All successful source statuses
and audits commit in one transaction. A changed, superseded or deleted source
refuses the result with reload/re-extract guidance; an audit failure rolls back
the earlier source writes too.

Guarded procedure regressions change storage, fingerprint and revision state or
delete a source during a stubbed model request. A database trigger fails the
second audit insert to verify complete rollback; the unchanged two-source case
verifies success. No live model call or financial arithmetic change is involved.
This checks database source identity at completion, not a second storage rehash,
model accuracy or a durable extraction receipt. The model request may already
have incurred provider usage when a concurrent source change is detected.
Durable receipts linking accepted inputs to a specific request remain the next
priority, followed by stacked-release integration and customer-pack acceptance.
