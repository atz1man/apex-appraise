# Product completion audit

Updated 11 October 2026. Owner request: complete the product audit, tests and
remaining implementation across the customer and operator lifecycle.

**Overall state: incomplete for paying-customer launch.** Existing code and green
CI are engineering evidence. They do not establish live provider operation,
professional acceptance, market preference or a sustainable operating cost.
This register extends, rather than replaces, SAAS-RELEASE.md and
PRODUCT-READINESS.md. Historical deployment observations are not fresh inspections.

Working scope until the owner confirms otherwise: UK property-development
appraisals with reviewed source evidence and deterministic calculations. Do not
silently broaden this to every valuation purpose, geography or asset class.

## Completion matrix

| Area | Evidence already available | Acceptance still required | Responsibility |
| --- | --- | --- | --- |
| First customer and scope | Product readiness defines UK development appraisal as the first workflow. | Confirm initial customer role, supported scheme types, exclusions and their first successful task. | Owner + intended users |
| Financial depth | Engine golden/cash tests; API appraisal-roundtrip.test.ts checks persisted input paths. | Reconcile representative residential, phased and supported mixed-use schemes against independently accepted workbooks; document unsupported tax, funding and valuation assumptions. | Engineering + qualified reviewer |
| AI source-to-report | Real local Codex runs: text 8/8, drawing 3/3, PDF 2/2. Recorded-ai-report browser test now uploads the PDF to a new workspace, corrects an input, records a page reference, saves/reloads, compares results to the engine and downloads a report. | Representative anonymised packs, extraction omissions/conflicts, durable extraction receipts, real provider integration and professional review. Synthetic counts are not an accuracy estimate. | Engineering + users; provider account owner |
| Collaboration and issued versions | appraisal-concurrency, appraisal-first-version, review, audit and source-review API tests; stale-source browser journeys. | Walk simultaneous edits, reviewer return/approval, issued-version retention and reopening with actual team roles; reconcile report/version history. | Engineering + pilot team |
| AI cost and abuse controls | Model deadlines, input/file limits and local test runner with no API fallback. | Measured cost/latency per supported pack, tenant budgets and usage policy, concurrency/load acceptance, failure/refund behaviour and manual fallback usability. A personal subscription is not the SaaS funding model. | Engineering + owner |
| Privacy and document lifecycle | Tenant/role checks, workfile-upload, export, token revocation and deletion regressions. | Verify a data-flow inventory covering providers, documents, logs, support access, backups and erasure; confirm actual retention and published policies with the operator. | Engineering + operator/reviewer |
| Migration and portability | Export tests and substantive Excel/report exports; spreadsheet extraction has explicit coverage limits. | Import representative existing customer workbooks with field mapping, dry-run discrepancies and reconciliation; prove portable source/review/version evidence. Do not advertise arbitrary workbook fidelity. | Engineering + pilot users |
| Scale and reliability | CI built-stack browser suite; bounded model/report requests; renderer process and recovery checks. | Reproducible load profile for concurrent workspaces, large scans, uploads, reports and long portfolios; owner-approved latency/capacity targets and measured resource costs. | Engineering + operator |
| Onboarding, UI and accessibility | saas-customer-lifecycle covers fresh signup through manual appraisal, PDF, export and erasure; mobile/contrast/navigation browser guards. | Observe first-time users completing their first appraisal without coaching; record dead ends, corrections and accessibility issues; resolve findings. | Engineering + intended users |
| Support and product measurement | Client-error reporting and audit infrastructure exist. | Named incident/support owner; actionable correlation without leaking documents; agreed activation/abandonment/correction metrics, appropriate data collection and a support runbook exercise. | Engineering + owner |
| Differentiation and pricing | Competitor capability review is recorded, without a parity claim. | Compare the same accepted schemes on completion time, corrections, traceability and report usefulness; validate willingness to pay and price/cost margin. | Owner + pilot users |
| Payments and email | Billing protocol and signup/recovery safeguards have automated tests. Last recorded live inspection: test Stripe, absent SMTP. | Real delivery and controlled billing lifecycle acceptance using configured accounts, signed webhooks, portal, renewal/failure/recovery/cancellation. | Account owner + engineering |
| Property identity and licensed data | Open-data adapters, optional static maps and explicit limitations. | Exact-property/UPRN identity, sourced geometry, selected licensed title/maps/cost evidence and real provider acceptance; verify coverage/export rights. | Owner procurement + engineering |
| Customer production boundary | Deployed app and serving checks; CI recovery drill with synthetic DB/uploads. | Demo/customer separation, independent encryption configuration, offsite production restore, rollback, external monitoring and incident ownership. | Operator + engineering |
| Company and commercial readiness | Release checker refuses unconfirmed operator identity. | Legal company details, customer domain, contact channels, confirmed plan catalogue and applicable commercial/policy review. | Owner |

## New end-to-end evidence

`apps/web/e2e/recorded-ai-report.spec.ts` runs a fresh customer workspace and
uploads the exact synthetic two-page PDF used by the saved Codex evaluation.
It intercepts only the extraction HTTP response and supplies that recorded
response. It does **not** activate a provider, call the production extraction
handler, verify its request construction or consume an AI subscription in CI.

The real server computes the initial figures. The browser changes the extracted
area from 775 to 800, must apply recalculation before accepting, selects the
uploaded source and PDF page 2, saves, reloads and checks the review and document
identity survived. It compares the persisted result with the shared engine and
checks GDV and the reviewer locator on the report before downloading real PDF
bytes. This checks the report DOM and a generated PDF signature, not semantic
text extraction from every page of the exported PDF. The temporary workspace is
removed by the test. No existing customer data is modified.

Local browser run on 11 October 2026: passed. Exact-commit full CI evidence is
recorded on PR #49; previous-head results are not evidence for subsequent edits.

## Ordered remaining work

1. PR #49 merged at `50edabf8e8a1ea17d100087cc3c7c47638f65708`. Retain its
   boundary: local AI evaluations plus browser replay, not customer-facing
   subscription integration. Exact-main CI evidence is tracked separately.
2. Exercise multi-user review/issued versions and a representative migration
   fixture, addressing evidenced defects rather than adding disconnected modules.
3. Establish a repeatable load/cost baseline and close document lifecycle/support
   observability gaps identified by a code and operational review.
4. Complete owner configuration, live-service tests and the separate production
   recovery exercise in SAAS-RELEASE.md. Do not copy credentials into fixtures.
5. Run and record intended-user/professional acceptance on the agreed scheme set,
   then resolve findings and make the launch decision against the exact release.

For each item, record the commit, environment, input/data provenance, test result,
limits, owner and next action. An unresolved external acceptance item stays open;
adding a checklist or a mocked test does not close it. No overall percentage or
launch date is justified until the scope and external commitments are confirmed.


## Team review note isolation — 11 October 2026

The team-workflow audit found that all version rows shared a single review-note
state. A browser regression reproduced text entered for one version appearing in
another version's field. A reviewer could attach the wrong explanation to an
approval or return; completing one decision also cleared the other draft.

Each keyed version row now owns its note and has an accessible field name. A
two-session browser journey has the seeded analyst submit two newly created
synthetic versions, then an administrator enter distinct notes, approve one and
return the other. It verifies the unfinished note survives the other decision,
both saved notes survive reload, the analyst sees the returned explanation and
the approved current report verifies its pinned figures. The analyst cannot see
approval controls. Existing API tests separately enforce those permissions.

The regression failed before the fix and the new journey plus both report-pin
journeys passed after it. This does not establish complete concurrent-edit,
issued-report retention or real-team usability acceptance; those remain in the
matrix. No financial computation, schema or provider configuration changed.

## Spreadsheet formula evidence — 11 October 2026

The migration-fixture audit found two extraction defects: cached formula results
were presented as ordinary values without a recalculation limitation, and the
spreadsheet library's copied value dropped cached zero/false results. Apex now
reads the underlying result accessor, labels cached values individually and
returns a sheet-specific review warning. It does not evaluate workbook formulas.

A real XLSX regression contains a deliberately stale result (150 for `100*2`),
zero, false, an Excel error and a literal input. It verifies source coordinates,
unchanged cached values, visible errors, retained document identity and warning
propagation through the actual extraction API with a mocked model response.
The regression failed before the fix; the extraction, source-review and appraisal
round-trip suites passed afterwards (68 tests). This is parser/API evidence,
not live-provider acceptance or a general workbook migration guarantee.

PR #50's team-review fix was merged as
`f7cbe55c76763012128bf1be2784b83f243c6c6e`; its exact-head CI passed at
`6632aeb28d2037a4cb1c872b688b26a703bb0eba` (run 38154807209).
Exact-commit CI for this increment is recorded on its pull request. No production
deployment, credentials, schema or financial calculations changed. Next: retain
these import limitations during representative customer migration acceptance,
and establish the load/cost baseline in the ordered work above. Owner setup and
professional acceptance remain open.

## Concurrent workspace baseline — 11 October 2026

Added a bounded, reproducible HTTP workload and retained CI artifact, described
in LOAD-BASELINE.md. One then three workers exercise separate synthetic workspaces
through 800 requests, including 200 save/reload engine comparisons and 200 foreign
read refusals. Local development-stack verification passed with complete cleanup.
Exact built-stack CI evidence is recorded on the pull request. This begins the
load baseline item; it does not close capacity, large-document, sustained-load,
resource-cost or live-AI budget acceptance. Next extend representative data sizes
and measure the report/upload workload before proposing customer service targets.
PR #51's spreadsheet fix is merged at `1d247ae7527d7a2144028d3c9e34ecd7c569f552`.

## Report/upload contention and lifecycle finding — 11 October 2026

The new report/upload profile verifies six concurrent same-name uploads across
two synthetic workspaces, byte-exact downloads, foreign access refusals, bounded
PDF renderer busy responses and successful retry after the burst. Both HTTP
profiles passed locally; exact-head built-stack results belong to the PR artifact.
The baseline increment PR #52 merged as `12625c98bd153f1eeb8baf84a53602bff7205853`.

**New open defect:** workspace erasure deletes records but its current path does
not delete uploaded file bytes. Do not claim physical document erasure from the
existing workspace-deletion tests. Prioritise durable file cleanup and its failure,
concurrency and isolation regressions before further capacity expansion. See
LOAD-BASELINE.md. No production deployment or live-provider activation occurred.

## Field Companion project continuity — 11 October 2026

The field audit found that the workbench's field link discarded the selected
project, and Field Companion defaulted to the first available project. Project
navigation and the existing workbench link now carry the deal ID. Field Companion
retains that selection on reload and refuses an unavailable project instead of
quietly opening another. A connected-project panel shows the current saved
appraisal/version status, inspection state and comparable count, with same-project
links to overview, appraisal, documents and workbench, plus explicit refresh.
Errors remain distinct from missing evidence. Phone controls use 44px targets.

The fixed decorative comparable pins are replaced with the existing map component
using saved coordinates only, with missing-location and source-limit disclosures.
Removed the unsupported caption claiming a native mobile build. No valuation
arithmetic or inspection approval behavior changed; field observations remain
reviewable evidence rather than automatically replacing appraisal inputs.

Local evidence: five Field Companion browser journeys passed, including existing
photo/offline recovery and the new two-project navigation/refresh/unavailable-ID
journey. Web's 388 unit/safeguard tests, TypeScript, production build and bundle
checks passed. The phone context panel was visually inspected. Exact-commit CI is
recorded on the PR. This is a connected-workflow increment, not complete mobile
acceptance or automated appraisal intelligence. Real-device camera/storage tests,
fully offline project access, configurable inspection templates, explicit review
of observation-to-appraisal changes and shared-task handoff remain open.

The prior contention profile PR #53 passed CI and merged at
`43c9841` (full SHA in Git). Its artifact verified six distinct file uploads,
foreign-read refusals, four busy PDF responses, two successful burst reports and
two successful subsequent reports. The physical-upload erasure defect remains
open and must not be obscured by the Field Companion work.

## Inspection snapshot conflict protection — 11 October 2026

Following PR #54's project-context flow, browser regressions reproduced a silent
lost-update defect in both Field Companion and Workbench. Query refresh advanced
`expectedUpdatedAt` while the editable notes/weights remained on the older
snapshot. A subsequent field save overwrote newer desk notes; a workbench save
overwrote newer approach weights. The existing server conflict check received the
wrong (newer) stamp and therefore could not detect either stale draft.

Each surface now captures the stamp when it hydrates its editable snapshot and
advances it only after its own successful save. Query refresh does not rebase an
unsaved draft. Two real browser/API regressions failed before their respective
fixes and passed afterwards: the stale save returns CONFLICT, persisted notes,
weights and timestamp remain unchanged, and the local draft stays visible.
Seven focused field/project/photo/offline journeys passed. Exact-head CI belongs
to the PR; this does not prove arbitrary concurrent-edit merging or native/offline
acceptance. No engine arithmetic, schema or provider configuration changed.

PR #54 was merged before this increment. Next retain explicit conflict recovery
and reviewable observation-to-task/appraisal handoffs in the field roadmap; the
physical-upload erasure defect remains open and is still a release concern.


## Inspection conflict recovery — 11 October 2026

PR #55's snapshot protection was merged at `c426c86054f60dda78a23bc9fc1c26c6df82bb5c`
before this increment. Field and Workbench now present a persistent recovery panel
when a save conflicts. Users can download their current draft and open the latest
same-project record in a separate tab, compare it and explicitly enter reviewed
changes. Recovery never silently adopts a newer save stamp or overwrites the
original tab. The JSON is labelled unsaved/manual-review only; it includes photo
references, not image bytes or queued photos, and has no automatic import.

The real browser regressions now verify draft contents and original version stamp,
absence of the session token in the export, latest-record loading in a new tab,
successful reviewed saves checked against the API, and preservation of the original
draft. Both surfaces passed at 390px without horizontal overflow. Seven focused
field/photo/offline/project journeys, 388 web unit/guard checks, web typecheck,
production build and bundle budget passed locally. Exact-commit CI is recorded
on the PR. This is manual recovery, not automatic merging, cold-offline notes
backup, full mobile acceptance or production deployment.

Next priorities remain durable physical-upload erasure and explicit reviewed
observation-to-task/appraisal handoff. Live provider, release and professional
acceptance gaps in this audit remain open.

## Durable workspace file cleanup — 11 October 2026

PR #56 was green and merged at `5e277f131a791bef2a742292d9d3f3e29d9fe6c2`
before this increment. The physical-upload gap now has a bounded implementation:
workspace deletion and demo reset queue currently referenced document/photo/logo
files in the same database transaction as record deletion. The durable outbox
survives the workspace and retries on startup and every minute. The worker
preserves live references from any tenant, refuses nonlocal paths, handles a crash
between unlink and acknowledgement, and backs off failures. Upload metadata
commits serialise with the workspace snapshot; a stream finishing after deletion
is refused and cleaned up. Failed rejected-upload removal is also queued.

Settings describes asynchronous active-storage removal and separate backup
retention. Real Fastify uploads plus tRPC deletion tests inspect actual bytes,
cover all three file kinds, failed unlink/retry, transaction rollback, surviving
foreign files/shared references, invalid paths and upload/delete interleavings.
Scheduler checks cover startup, no overlapping drains, retry and stop. Exact-head
CI evidence is recorded on the PR; no production deletion or deployment occurred.

Remaining erasure work: historical orphan inventory, crash-during-stream cleanup,
backup retention and post-restore erasure reconciliation, operator alert delivery
and a measured deletion SLA. This does not close comprehensive erasure acceptance.
Next customer-workflow priority remains reviewed field-observation handoff into
project tasks/appraisal inputs; all provider/professional acceptance gates remain.

## Reviewed field follow-ups — 11 October 2026

PR #57 was green and merged at `e61c27975c5ea8a21d85d1205125ebb80d59006f`
before this increment. The selected Field Companion project now reads its saved
inspection observations and existing Field inspection tasks. A user selects an
observation, reviews/edits the suggested title and explicitly creates a task.
The existing tenant-scoped task service assigns it to the current member with
its seven-day default due date; completion/reopening is shared with the calendar.
The panel states that only the reviewed title is copied. Full evidence remains
in the current inspection; this is not a frozen/version-linked evidence record
and never automatically applies a change to financial inputs.

The mobile browser journey covers saved versus unsaved observations, title review,
refused save with retained text and retry, local duplicate-title prevention,
unsaved-draft navigation protection, actual API task data, calendar completion
returning to the field, reopening, two-project separation and failed-read/retry
states. The existing seven project/conflict/photo/offline journeys also pass.
388 web guards/tests and typechecking pass. The panel loads on demand when a
project opens to preserve the field route's bundle budget. Exact-head CI evidence
belongs to the PR. No provider activation or production deployment occurred.

Next: version-linked observation evidence and assignment/due-date editing for
field follow-ups, followed by explicit reviewed observation-to-appraisal proposals.
Duplicate-title prevention here is a UI safeguard, not server-side idempotency;
offline task submission and automatic appraisal updates are not implemented.
The erasure, provider and professional-acceptance limitations above remain open.
