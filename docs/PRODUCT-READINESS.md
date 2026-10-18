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
the earlier source writes too. Metadata edits, including a rename, also require
a retry because source labels and types are part of the prepared model input.

Guarded procedure regressions change storage, fingerprint, revision, metadata,
workspace/deal identity or delete a source during a stubbed model request. A database trigger fails the
second audit insert to verify complete rollback; the unchanged two-source case
verifies success. No live model call or financial arithmetic change is involved.
This checks database source identity at completion, not a second storage rehash,
model accuracy or a durable extraction receipt. The model request may already
have incurred provider usage when a concurrent source change is detected.
Durable receipts linking accepted inputs to a specific request remain the next
priority, followed by stacked-release integration and customer-pack acceptance.


### Workfile question source coverage — 11 October 2026

Ask the workfile now carries preparation warnings into its answer UI. It names
sources excluded by unsupported format, missing upload, superseded revision or
the existing newest-four-file selection cap, plus storage/integrity warnings from the
source reader. Successful answers list the files actually prepared for the model;
empty answers retain the reasons nothing could be read. Unconfigured AI reports
no reads and creates no AI-use audit; it does not inspect storage without a provider.
Long warning lists are collapsed behind a disclosure. Q&A remains limited to PDF and image files;
this change does not add spreadsheet Q&A or certify model interpretation.

Guarded API checks exercise partial integrity failure, cap/revision/format
exclusions, missing storage and unconfigured AI. The browser journey verifies a
real empty-workfile response and the rendering of a controlled partial-answer
response. No live provider call, financial calculation or schema change.
Durable extraction receipts and release/customer acceptance remain outstanding.


### Source-model request deadlines — 11 October 2026

Document extraction and workfile questions now share a 90-second provider network
deadline, covering response headers and body consumption. The tRPC proxy response
window is explicitly 120 seconds so it can relay this error. A timeout returns an
explicit retry error and does not mark files extracted or record a successful
AI answer. There is no automatic retry, so a timeout cannot trigger a second
billable request without the user's action. Provider usage may already have
occurred even though no successful result was recorded.

Regression checks use real local HTTP connections stalled before headers and
mid-body, plus both guarded procedures with abort-aware model stubs. The browser
question flow retains the question after a controlled timeout response and permits
an explicit retry. No live provider call, financial arithmetic or schema change.
This bounds these two provider requests, not file preparation, synchronous parsing,
all AI features or per-workspace concurrency. Durable extraction receipts and
release/customer acceptance remain outstanding.


### Source versions across review — 11 October 2026

Extraction now returns an opaque metadata version for each prepared source. The
review UI carries those versions to appraisal save, withholds a download link
when the current source version differs and blocks acceptance with re-extraction
guidance. The server compares submitted expected versions with its deal-scoped
source rows before recording the review; it refuses changed names, fingerprints,
storage identities and revisions rather than pinning a newer source to older
extracted inputs. Sharing and extraction-status changes do not invalidate a source.

API regressions exercise changed and unchanged sources and omitted/foreign
expected IDs; the extraction response is also round-tripped through document listing
and appraisal save. Claude review prompted clearer changed-source copy and an
accessible explanation beside the disabled acceptance control. Browser verification
covers controlled stale-extraction metadata
and existing review/export journeys. Older clients and source reviews remain
compatible. This is an optimistic concurrency stamp supplied by the client, not
an authenticated extraction receipt, a storage rehash or proof of model accuracy.
Durable extraction receipts and release/customer acceptance remain outstanding.


### Manually referenced source versions — 11 October 2026

Structured unit references can name a document that was not used for extraction.
Those selections now retain the source version seen by the reviewer and submit it
with extracted-source versions to the existing scoped save check. Editing a page
or locator preserves the selected version. Refreshing the source list never
silently updates that evidence. Known changed or missing references block acceptance
and identify the affected unit. A refresh action updates the list without losing
review edits; an unavailable reference remains removable even with no readable
documents left. Clearing and selecting a current source resets its
page/locator for review. An extracted source still requires re-extraction.

Tests cover combined/deduplicated expected sources, incompatible versions of one
source, missing sources, unknown/legacy state and removal. The browser journey
uses a deliberately stale document-list version with a real upload and real save:
the server refuses it, refreshing the list blocks acceptance, and explicit
reselection plus a new locator can be saved and reopened. No provider call,
financial arithmetic, API contract or schema change. Claude review also prompted
neutral server conflict guidance and an explicit citation payload without its
session-only version field; saved reviews retain the server-pinned document
metadata as before. These remain optional client
concurrency stamps, not authenticated extraction receipts. Durable receipts and
the documented integration/customer release gates remain the next priority.

### Original versus saved assumptions — 16 October 2026

The saved appraisal source-review panel now compares thirteen directly mapped
scheme assumptions against the server-issued extraction receipt. It shows original
and saved values, change status and the original origin label. The same comparison
travels with Excel and report evidence. Unsaved editor changes withhold comparison
rows; stale input-review warnings remain visible after subsequent saves. Missing
legacy receipts do not produce an invented baseline.

This comparison does not identify the author of a correction or establish which
value is correct. Unit schedules, build-cost lines, CIL, S106 and later-added inputs
are explicitly outside its scope: their saved shapes cannot safely be matched by
position or label. Financial calculations and persisted data are unchanged.

Local evidence: both application typechecks; 23 source-review API tests (including
all thirteen mappings, zero/equal values, unknown origins, tenant/signature/source
checks and subsequent saves); 419 web tests; real local browser journey covering
correction, save, reopen, mobile overflow, Excel export and unsaved-edit hiding.
The PR records exact-commit CI evidence. No provider activation or production
readiness claim. Next: preserve stable unit identity before adding unit-by-unit
extraction comparisons. External provider and customer acceptance gates remain.

### Original extracted unit evidence — 16 October 2026

The server-retained extraction receipt already contains the original unit schedule,
but reviewers could only see its receipt identifier. The saved appraisal now exposes
that historical schedule in a disclosure, and includes it in Excel/report evidence:
original label, count, area per unit, sales rate, confidence label and source text.
These are historical unverified outputs, not current appraisal inputs. Original row
numbers do not identify current units. Worked examples retain their existing warning.
Legacy absence and genuinely empty original schedules have separate messages.

Local verification: API and web typechecks; 23 source-review API tests, including
original preservation through renamed/reordered/current-unit edits; 420 web tests;
real local correction/save/reopen/mobile/Excel/report journey. Source text is rendered
as text. Existing evidence wrapping and PDF print limits remain in effect. No provider
calls, financial changes or schema migration are required by this increment.
Exact-head CI is recorded on the PR. This closes access to the retained original
schedule; it does not deliver unit matching. Next: introduce and preserve stable unit
identity through extraction, review, save and editing before comparing units. External
provider configuration and customer acceptance remain separate release gates.

### Extraction unit identity continuity — 16 October 2026

New extraction runs assign a fresh server UUID to every flat-schedule row before
issuing the signed receipt. Model-supplied IDs are replaced. The review flow,
what-if flow, save contract and current-appraisal response preserve these IDs
through corrections, renaming and reordering. Save rejects duplicate IDs and IDs
not present in the submitted receipt or that deal's existing current schedule.
Manual/legacy rows remain unlinked; missing IDs are not reconstructed by name or
position. Phased schedules deliberately omit this flat-schedule link.

This is continuity metadata, not independently verified source identity: it does
not prove a user corrected the right row, and no unit-by-unit comparison is yet
presented. Financial arithmetic and the engine version are unchanged; paired runs
with/without IDs produce identical results. Existing JSON storage carries the
optional field without a schema migration or backfill.

Validation is recorded on the PR: API/web typechecks, 66 targeted API tests,
420 web tests and the real local correction/save/reopen/edit/resave browser
journey. Tests cover server replacement of a model ID, different IDs across runs,
unknown/duplicate link rejection and preservation through actual multi-row
reordering and what-if changes. Full exact-commit CI is required before release.
Next: use these links for explicit original/current comparisons with unmatched
rows shown separately; never match legacy or phased rows by position. External
provider and customer acceptance remain open.

### Linked unit comparison — 16 October 2026

Saved source reviews now compare original and last-saved flat-schedule rows by
unique recorded extraction-unit IDs. The appraisal, workbook and report share
comparison text for names, counts, areas and sales rates. Renaming/reordering does
not break the link; row positions are displayed only for orientation. Rows without
a unique link, including duplicate identities and legacy rows, are listed separately
without claiming they were added or deleted. Phased appraisals explicitly withhold
comparison because their retained flat schedule is not the active phase schedule.
Unsaved edits and unverified editor snapshots withhold comparisons as before.

This records continuity of user-editable inputs, not correctness, authorship or
professional approval. Original source text/confidence remain in the historical
schedule; they are not part of the displayed-input change classification. No new
provider, schema migration, data rewrite or financial calculation.

Local evidence: both typechecks; 28 API tests including actual receipt/save/reorder
round-trip, duplicate IDs, identical labels, missing/unknown links, empty schedules,
zero values and phased suppression; 421 web tests; real local correction/save/reopen,
mobile, Excel/report and dirty-editor browser journey. Exact-head CI is recorded in
the PR. Next: release the comparison after its release gates pass, then validate it
with a valuer using real project evidence. Provider and customer acceptance gates
remain open; green checks do not establish valuation accuracy.

### Source omission priority in exports — 16 October 2026

Long original-unit histories could consume the bounded PDF evidence appendix
before the reported-omissions section, leaving the reader with a generic print
limit warning but no explicit incomplete-source warning. Source evidence now
places a coverage warning and reported omissions before extraction history.
The empty-omissions wording still says this is not a completeness certification.
Unverified snapshots still withhold cached review content. The PDF remains
bounded to twelve evidence pages; the workbook retains the full record.

Validation: web typecheck, 422 web tests, and the real local correction/save/export
browser journey. A synthetic 300-row response exceeds the PDF cap: the rendered
report retains the specific omission and warning while Excel retains the final
unit row. No synthetic receipt was saved, and no provider or financial behavior
changed. Exact-head CI and release status are recorded on the PR. Next: release
this export safeguard after its gates, then real-source customer/valuer acceptance.

### Concurrent-save failure investigation — 16 October 2026

PR #90's first CI attempt passed 239 browser tests but the subsequent workload
returned HTTP 409 from appraisal.save at the start of the three-workspace phase.
The single-worker phase and fixture cleanup passed; the unchanged rerun passed.
The original assertion did not retain the refusal message, so the exact cause
cannot be inferred from HTTP 409 alone. Release remains on hold for investigation.

An isolated local PostgreSQL experiment exercised the real router with 20 rounds
of three synthetic workspaces and 50 saves per worker. Nineteen serialization
aborts recovered through the existing retry helper; no terminal save failed.
This does not reproduce or fix the CI failure. No production data was used.

The retry-exhaustion path previously reused the same message as a confirmed
competing first save. It now reports database contention and asks the user to
reload/retry, without claiming another person saved. A forced-abort API test
verifies four attempts, no created version and successful recovery after the
fault clears. Workload failures now include only the returned error code/message
alongside the route, not request inputs, tokens or the full response. Retry
limits, serialization, tenant guards and financial calculations are unchanged.
Targeted tests/typecheck and HTTP workload evidence are recorded on the PR.
Next: capture the exact refusal on recurrence before choosing a concurrency fix;
a passing rerun or this diagnostic improvement does not close that finding.

### Bounded first-save contention recovery — 16 October 2026

Further isolated PostgreSQL testing reproduced retry exhaustion with 40 distinct
synthetic workspaces. The old four-attempt, 5–24ms jitter policy produced eight
terminal conflicts in its first round (77 serialization aborts). Eight attempts
with exponential jitter capped at 254ms per wait recovered 855 aborts over ten
rounds without terminal failure. Reverting only the policy on the same enlarged
test database reproduced nine terminal conflicts (80 aborts), ruling out database
growth alone as the explanation for that improvement. Each worker made 50 saves.

The helper now allows eight fresh transactions with at most 1,078ms total added
waiting. It retries only the database's P2034 abort, never an application conflict
or ordinary error. Genuine competing first saves still re-read within the
serializable transaction and refuse the loser. Attempts remain bounded; the
contention refusal remains if exhausted. No financial or tenant logic changed.

API typecheck and 23 targeted tests pass, including recovery on the eighth
attempt, delay bounds, terminal exhaustion, genuine races and non-retryable
errors. The heavy workload used only a disposable local database; it is not a
production capacity claim. The original CI 409 had no message, so its precise
cause remains unproven; this addresses a reproduced failure class rather than
retroactively identifying that event. Full exact-head CI is recorded on PR #90.
Next: review the combined candidate and its release evidence before deployment.

### Atomic in-place appraisal edits — 17 October 2026

A deterministic overlap test found two edits could both pass the timestamp
precheck and then both succeed, silently replacing the first edit. In-place
appraisal updates now compare the opened timestamp, organisation, deal, current
flag and review state in the database write itself. A failed comparison returns
CONFLICT with reload/reapply guidance. A successful edit advances its timestamp
even within the same clock tick or when the stored timestamp is ahead.

The regression holds both initial reads until both callers have read the same
snapshot: before the fix both succeeded; afterward one wins and its values persist.
Additional tests change approval/current state between precheck and write while
holding timestamps equal, proving late edits cannot overwrite those transitions.
Existing review withdrawal, first-version, version-branching and stamp requirements
remain. No schema or financial-engine change is involved.

Validation: API typecheck, 43 targeted API tests and four real browser editor/
refresh/conflict/reload/export journeys passed. An isolated PostgreSQL run of the
same forced overlap verified one winner, a CONFLICT loser, winner persistence
and monotonic timestamp advance. No production records were changed. Exact-head
CI/release evidence is recorded on the PR. This closes the in-place edit window;
it is not a claim that every workflow's concurrency has been audited. Next:
release this safeguard after exact-commit checks and review approval transitions.

CI initially identified a classifier false positive: approval sweeps treated the
new reviewStatus WHERE predicate as a status write. The shared detector now parses
only update data properties, with positive cases for real/dynamic approvals and
negative cases for predicates in either property order. No path exemption was
added. All 57 targeted API/review/classifier tests pass after this correction.

### Approval snapshot transitions — 17 October 2026

Forced interleavings reproduced two gaps after the in-place edit fix: a delayed
submission could reopen an approved version and erase its reviewer details; a
review decision could approve stale inputs after an edit withdrew and resubmitted
the same version. The latter could pin an earlier snapshot to newer inputs.

Submission now conditionally matches its read timestamp, review state and tenant.
Decisions additionally match the timestamp used to build the approval pin. Both
transitions advance that timestamp monotonically, including same-tick changes and
future stored timestamps. Conflicts give reload/review guidance before any audit
or webhook side effect. Historical version review remains supported.

All three forced races failed before the fix and pass afterward. The targeted
54-test API set and API typecheck pass; three real browser checks cover analyst
submission, administrator approval/return notes, and approval verification on both
reports. Tests also confirm refused stale decisions create no decision event or
approval webhook, and a fresh approval verifies against the resubmitted inputs.
No production/customer records or provider calls were used. Exact-head CI evidence
belongs on the PR; this entry is not a deployment or professional acceptance claim.

Next: verify client-held review snapshots and failure recovery for audit/webhook
recording. This increment guards changes during a request; it does not yet require
the review screen to send the revision the reviewer originally opened.

### Reviewer-held revision — 17 October 2026

Review decisions now require the timestamp returned with the version the reviewer
opened. An absent timestamp is refused; an edited/resubmitted version is refused
as stale even if it is back in review. The database compare-and-set from PR #92
still covers changes after this check. Both approval and requests for changes use
the displayed revision; historical versions remain reviewable.

The conflict presents a Reload versions action and preserves the reviewer's note.
Reload explicitly bypasses fresh-cache reuse, disables duplicate reload clicks,
and clears the conflict only after a successful fetch. A failed fetch leaves the
note and retry action available. Existing older clients must refresh to send the
new required review timestamp. No schema or engine changes are involved.

Validation: 78 targeted API tests, API/web typechecks and 30 UI safeguards passed.
Removing the new check makes both stale-review regression cases fail. Browser
coverage exercises a real edit/resubmission behind an open review screen, refused
approval, failed reload, successful reload with preserved note, fresh approval
and verified report. Existing analyst/admin notes and report/date journeys pass.
Full exact-head CI and delivery evidence are recorded on the PR. No production
records, provider settings or credentials were changed during this increment.
Next priority: failure recovery for approval audit/webhook recording; successful
CI alone is not professional acceptance or customer-release readiness.

### Durable review decision records — 17 October 2026

Approval and return decisions previously committed their status before writing
the decision audit and outbound notification queue. Those helpers suppress errors
by default, so a database write failure could leave a signed version with a lost
audit or notification and no safe retry of the approval action.

Review now commits the conditional status/pin update, decision audit, consented
benchmark changes and applicable approval/covenant delivery records in one database
transaction. The decision audit and queue helpers use an explicit strict mode in
this workflow; unrelated callers keep their existing behavior. Delivery to an
external endpoint still happens later through the existing worker. No external
network call occurs inside this transaction, and no schema or engine changes are
required. Client revision and atomic state guards remain in place.

Validation: 69 targeted review/approval/webhook/benchmark API tests, 21 related
provenance/approval/benchmark sweep tests, API typecheck and eight browser review/
report/date journeys passed. Four injected failures cover approval audit, return
audit, approval queue and covenant queue; each leaves the version and timestamp
unchanged with no partial decision event, queue entry or benchmark contribution.
A clean retry creates exactly one decision and each applicable delivery. Restoring
failure suppression makes all four regression cases fail. A disposable PostgreSQL
replay independently verified audit/queue rollback and retry with matching pins.
No customer records or real webhook destinations were contacted.

Full exact-head CI is recorded on the PR. This does not backfill previously lost
events or prove receipt by an external subscriber. Next: review submission records
for the same durability gap, then assess delivery-worker recovery separately.

### Durable review submissions — 17 October 2026

Submission now commits the conditional version transition, submission audit and
applicable notification queue entries in one transaction, using the strict helper
modes introduced for decisions. A persistence failure leaves the prior timestamp,
status and reviewer fields intact. This matters especially for resubmission:
a returned version must not lose its reviewer note before the new submission and
its evidence commit. Delivery remains asynchronous; no external request occurs
inside the transaction. Approved-version and concurrent-change guards remain.

Validation: 64 targeted review/webhook/provenance/immutability API tests, API
typecheck and eight browser review/report/date journeys passed. Four injected
faults cover audit and queue writes for draft and returned versions; each verifies
complete row rollback, no partial audit/delivery, then one successful retry with
a matching submitted timestamp. Restoring failure suppression makes all four
regressions fail. Isolated PostgreSQL independently verified submission audit and
queue rollback/retry. No customer writes or external webhook calls were used.

Exact-head CI and delivery evidence are recorded on the PR. Historical lost events
are not reconstructed, and a queued notification does not prove external receipt.
Next: inspect delivery-worker claim/retry behavior and test interrupted delivery
without contacting real subscribers. No professional acceptance is implied.

### Notification outcome integrity — 17 October 2026

The delivery worker previously caught endpoint-statistics and delivery-record
write failures as though the external request had failed. After an HTTP success,
a statistics failure could rewrite a delivered row to pending and count one POST
twice. The worker now catches transport failures only and persists the outcome
once. Persistence/statistics failures reach the existing worker error logger.
A recorded success stays delivered; HTTP errors and timeouts retain their actual
outcome, attempt count and backoff. No schema or financial calculation changes.

Validation: 44 webhook delivery/resumption API tests and API typecheck passed.
New cases create endpoints through the router, queue real database rows, inject
statistics failures after 200/503/timeout responses, and verify the next drain
never resends a recorded success. An outcome-write failure preserves the claim
lease, reports the failure and recovers using the same delivery ID after expiry.
Restoring the old worker makes three new fault cases fail; timeout is a control.
All delivery functions are stubbed; no external subscriber was contacted.
One initial existing timeout-backoff test reported zero attempts and passed on
rerun; the final expanded targeted suite passed. Full exact-head CI is recorded
on the PR and remains the release gate.

Limits: this is at-least-once delivery, not exactly-once. A successful POST whose
outcome cannot be saved can still be retried with the same ID; receivers must
deduplicate. Endpoint statistics may remain stale after their write fails; no
historical outcomes are repaired. Next: inspect claim completion fencing when a
worker outlives its lease, using isolated concurrency tests. Professional and
paid-provider acceptance remain separate release requirements.

### Notification claim completion fencing — 17 October 2026

An expired worker could previously overwrite the outcome recorded by a replacement
worker, reopening a delivered notification or discarding its retry schedule.
Completion now conditionally matches the pending status, loaded attempt count and
exact lease timestamp. A superseded worker cannot change the delivery, endpoint
statistics or drain counters. Claim acquisition also checks the loaded attempt
count so a stale candidate cannot silently take a changed attempt.

Validation: 48 delivery/resumption API tests and API typecheck passed. Three
forced interleavings cover late HTTP failure, success and timeout after a newer
worker finishes. All three fail against the previous implementation. A fourth
case holds the replacement POST in flight while the old worker finishes; removing
the lease-timestamp match makes that case fail. Endpoints are created through the
router and queued rows use the real test database; all outbound delivery is
stubbed. No external subscribers contacted, customer records changed, schema or
financial calculation changes. Exact-commit CI is recorded on the PR.

This fences stored outcomes; it cannot undo a request already sent or guarantee
exactly-once receipt. Receivers still need delivery-ID deduplication. Next: inspect
whether the batch-wide clock can give later candidates shortened or expired
leases, using controlled clocks. Release and professional acceptance remain
separate evidence gates.

### Contractor-save browser release gate — 17 October 2026

PR #97 merged as `590043eca8d433e4a1dc0f545e23fedacbd1b55b`, but its
main CI run 39035800777 failed one browser test (239 passed): the contractor
selection test reloaded immediately after observing the outgoing request, before
waiting for the save response. Deployment was held; its built images were not
released. Application tests/build and PostgreSQL schema passed.

The browser test now waits for the POST response, checks HTTP and tRPC success,
and only then reloads to verify persistence. Each run selects a different
contractor rather than potentially reselecting the saved value. The narrow
payload assertion still forbids sending budget/committed/spent/forecast fields.
Ten repeated local browser journeys passed with the final test. This changes
only the test and readiness record; no application behavior or customer data.
Full exact-head CI is recorded on the repair PR. Next: merge the repair after
CI, require green CI on the merged release, then deploy #97 and this repair
together. The old Apex host stays stopped with autostart disabled.

### Notification batch timing — 17 October 2026

The worker captured one time for the whole batch. Slow earlier requests could
leave later claims already expired, signatures outside the receiver tolerance,
and retries due before their intended backoff elapsed. Claims and signatures now
use a fresh time per candidate; completion timestamps, endpoint attempt time and
retry scheduling use the time after the request finishes. Claim fencing remains.

Two controlled-clock cases advance a batch by six minutes and then ten seconds,
covering HTTP success and failure. They verify each lease, signature freshness,
completion timestamp and full retry delay. Both fail against the previous worker.
All 50 delivery/resumption tests and API typecheck pass. No real external calls,
customer writes, schema changes or financial-engine changes. Full exact-head CI
and deployment evidence belong on the PR. This does not guarantee exactly-once
external receipt or fix historical statistics. Next product priority is verified
email ownership and customer activation, followed by actual recovery acceptance;
commercial/provider details remain owner-supplied and unconfirmed.

### Recovery email throttle concurrency — 17 October 2026

Before adding activation mail, recovery inspection found that concurrent reset
requests read the same count and overwrote each other. Store errors were also
swallowed, granting unrecorded allowances. Reset throttling now resets only an
expired window through a conditional write and uses an atomic increment/upsert
for each request. Database errors stop processing before account lookup/mail.
The existing three-request, fifteen-minute policy and uniform account response
are retained. Login-failure counting is unchanged and requires a separate audit.

Evidence: four new regressions fail on the prior implementation: concurrent new,
expired and active windows, plus a failed throttle store. 29 API tests across
throttling, recovery, cleanup and cascade passed with API typecheck. Two isolated
PostgreSQL clients sent 24 concurrent requests per window; exactly three were
allowed for new/expired windows and one for an active window already at two.
Six signup/SSO recovery browser journeys passed after starting the local servers
(the first browser attempt failed because the web server was not running).
No external mail was sent; no live credentials, customer data or schema changed.
Full exact-head CI is recorded on the PR. This is a prerequisite safeguard, not
completed email verification or proof of inbox delivery. Next: verified-email
activation with expiring single-use links and atomic resend limits; separately
inspect login-failure counting under concurrency. Owner/provider details remain
pending as directed, without blocking independent engineering work.

### Concurrent sign-in failure lockout — 18 October 2026

The follow-on audit of the shared authentication guard reproduced lost failure
counts in new, active and expired login windows. A failed database read also
answered as unlocked. Failure recording now uses an atomic increment and
conditional expiry reset inside the same transaction as publishing the lock.
Already-running failures do not extend an established lock. Lockout reads and
failure writes propagate storage errors instead of silently allowing progress.
The existing five-failure/fifteen-minute policy and successful-login recovery
remain; already-in-flight credential checks are not a strict five-request quota.

Four new regressions fail on the old implementation. Additional tests inject a
lock-publication failure and verify rollback/retry, and drive concurrent wrong
passwords through the real auth router followed by refusal and expiry recovery.
64 API tests (throttle, recovery, SSO recovery, cleanup and cascade), API typecheck
and six browser signup/SSO recovery journeys passed. The router test initially
used a fixture label with a space, producing an invalid email; correcting the
fixture allowed the intended journey to run. Isolated PostgreSQL: two clients,
24 concurrent failures for each of three window states, every failure counted,
shared lock established and existing lock expiry preserved. Diff reviewed.

No schema, financial, live credential or customer-data changes. Exact-commit CI
and release status belong on the PR. Verified-email activation and actual inbox
delivery remain open; this increment closes the related concurrency audit only.
Next: expiring single-use activation links and atomic resend limits.

The first PR CI run exposed SQLite writer timeouts with the interactive
transaction on Linux, despite local SQLite and PostgreSQL passing. Replaced it
with a batch transaction: identical ordered writes, no JavaScript round trips
while holding the write lock. Repeated the 64 API tests, typecheck and isolated
PostgreSQL replay successfully. Full CI must pass on the revised commit before
this is a release candidate.

### Customer-mode email activation — 18 October 2026

New self-serve customer-mode accounts now wait for proof of email ownership:
registration returns no session, password login refuses pending accounts, and
the bearer-session resolver independently rejects them. Verification uses a
random 256-bit credential, stored only as a digest, expiring after one hour and
consumed by a conditional update. The email carries its credential in a URL
fragment, and the recipient explicitly confirms it; opening/scanning a link
does not activate an account. Existing accounts retain access without invented
verification evidence. Development and explicitly enabled demo signup retain
the existing immediate-entry flow, with emailVerifiedAt left empty.

The verification screen handles delivery failure, expiry, confirmation and
resends. Resends return the same public response for unknown/already-verified
addresses, use the shared atomic three-per-fifteen-minute throttle and cannot
reopen a verified account. Only the latest issued link works. Verification and
resend use the strict HTTP rate-limit bucket. Workspace erasure includes the
new namespaced throttle key. PostgreSQL migration adds nullable proof fields
and a false-by-default requirement flag; no financial data is rewritten.

Evidence: 86 targeted API tests, API/web typechecks and 58 UI guard tests pass.
Nine browser checks pass, including three intercepted UI cases for customer
signup/delivery failure, expired-link/resend and confirmation. The first expiry
browser fixture assumed an unbatched tRPC request; corrected it to inspect the
actual batch payload. A separate local browser journey with a synthetic pending
account exercised real HTTP login refusal, persisted verification and successful
sign-in, then erased that fixture. No external mail was sent. Removing the
pending-account bearer guard makes the activation regression fail.

Not yet production acceptance: real SMTP delivery/reputation, owner contact and
company configuration, treatment of historical unverified accounts and abandoned
pending registrations remain open. The active public demo is not proof of email
ownership. Exact-head CI and deployment evidence belong on the PR. Next: review
this migration/release and close actual delivery acceptance when configured.

### Mail service stall recovery — 18 October 2026

Activation revealed a reliability gap in the shared mail path: Nodemailer's
default connection wait is two minutes and socket inactivity wait ten minutes.
Signup could therefore keep waiting instead of returning its delivery-failure
state. SMTP connection, DNS and greeting waits are now capped at ten seconds,
and socket inactivity at twenty seconds. Shorter configured values and existing
credentials/TLS/provider options are preserved. Invalid SMTP configuration now
returns the same sanitized failure result instead of escaping before the catch.

A loopback SMTP fixture proves silent-greeting timeout (~10s), stalled dialogue
closure (~20s), successful delivery to a responsive fixture and customer signup
returning emailSent=false while keeping access pending. The silent-server test
fails against the previous code at its 15-second deadline. Configuration tests
cover caps, shorter values, credentials/TLS preservation and sanitized malformed
configuration. 21 API tests and API typecheck pass; nine activation/signup/SSO
browser checks pass against the restarted local API. Diff and whitespace reviewed.

These are transport-phase and inactivity limits, not a whole-request deadline
or proof that a provider did not queue a message before a lost acknowledgement.
No external email, provider activation, credential change or deployment occurred
for these local checks. Exact-commit CI/release evidence belongs on the PR.
Actual inbox delivery remains blocked on configured mail acceptance; independent
next work is pending-signup recovery and trial timing before activation.

### Activation preserves the full trial — 18 October 2026

A delayed verification email could consume the customer's trial before they
could sign in. Successful first activation now sets a new, unsubscribed TRIAL
workspace's expiry to fourteen days after its verified timestamp. The original
signup clock remains provisional until activation; no existing paid or recorded
subscription state is changed. Conditional credential consumption, trial update
and an activation audit event commit together. A replay cannot extend the trial,
and an audit failure rolls everything back so the link remains retryable.

34 API tests cover activation, concurrent consumption, expiry, replay, billing
preservation, audit failure rollback, signup and trial rules. API and web
typechecks pass. Seven signup/verification browser checks pass. A separate real
local browser activation of a synthetic delayed account persisted proof, exactly
fourteen days and one audit event; its fixture was removed afterwards. No mail
provider was called. The verification page explains when the trial begins.

Exact-commit CI and deployment evidence belong on the PR. Actual inbox delivery,
commercial setup and professional acceptance remain open. Next independent
engineering priority: recovery and retention of abandoned pending signups,
without deleting existing customer work or inventing email ownership evidence.

The first activation CI run exposed a scanner gap: lost-update discovery only
recognised `prisma` writes, missing `tx` transaction writes. It now discovers both,
with a positive/negative probe. Existing task updates are recognised by their
expected-snapshot predicate and conflict refusal, with probes that remove each;
`task-edit` regressions also pass. Extraction updates only source status against
prepared document identity, so its documented no-held-content classification is
explicit. No application guard was weakened to satisfy the scanner.

### Resume an unfinished signup — 18 October 2026

A customer retrying an unfinished signup reached a duplicate-account error whose
recovery choices only offered sign-in and password reset. Signup errors now also
offer Continue email verification, including uncertain service failures where the
workspace may already have been created. The entered email travels in router
state, not a URL; passwords are not transferred. Sign-in's verification link also
preserves the typed address. Navigation does not send mail: resend remains an
explicit action using the existing opaque, throttled server endpoint.

Eight local browser checks cover duplicate signup, transient failure, private
email continuity, no automatic resend and explicit recovery. A separate real
local pending-account journey hit the duplicate endpoint, followed the link and
rotated the credential only after resend, preserving one unverified account; its
synthetic rows were removed. All 422 web tests and web typecheck pass. No provider
mail was sent. Exact-commit CI/release evidence belongs on the PR. Retention of
abandoned registrations and real mail acceptance remain outstanding; this change
does not erase records or grant access based on an entered address.

### Refuse unusable signup when mail is absent — 18 October 2026

The active API's read-only configuration check showed no SMTP transport. Customer
signup previously created a pending workspace anyway, reserving the address even
though no verification mail could be attempted. Customer-mode registration now
refuses missing or whitespace-only SMTP configuration before any organisation,
user or integration creation, with a clear no-account-created error. Existing
account lookup remains first, so pending-account recovery still follows its
existing path. Explicit demo/development signup remains usable.

Presence of SMTP is not proof it works: configured delivery failure still creates
a pending account with honest emailSent=false and the retry flow. No provider
activation is claimed, and no live credential was changed.

24 targeted API tests and API typecheck pass; nine entry/verification browser
checks pass. A separate browser journey used the real local customer-mode HTTP
server without SMTP: 412, preserved form, and unchanged organisation/user/
integration counts. No external mail was sent. Diff and whitespace reviewed.
Exact-commit CI and release evidence belong on the PR. Next: expose signup
availability before the customer fills the form; actual delivery acceptance and
safe retention policy for abandoned registrations remain open.
