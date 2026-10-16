# Product completion audit

Updated 13 October 2026. Owner request: complete the product audit, tests and
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

## Field follow-up assignment and dates — 11 October 2026

PR #58 was green and merged at `bd73dc2fe88437614b811bffe46aa4f60dbdc74c`
before this increment. Follow-up review now offers the actual workspace members
and an optional due date. Blank dates preserve the existing seven-day default.
Saved tasks show the resolved colleague name and due date; unavailable or ambiguous
member details are identified rather than silently mapped to the wrong person.
A member-read failure blocks creation, retains the draft and exposes retry.

Because the current task schema stores initials, duplicate initials inside a
workspace cannot identify one colleague. The UI disables those choices and the
API now refuses the ambiguous assignment without creating a task. Another firm's
matching initials do not cause a refusal. Existing tasks are not rewritten.
A future move to stable member IDs remains the complete identity solution.

Nine focused field journeys passed locally. A real seeded colleague was selected,
the task's assignee/date were verified through the API and after reload, and only
the synthetic task was removed afterwards; no invitation or external email was
sent. Both follow-up journeys also passed in America/Los_Angeles, including UK
clock-change dates. Member-read failure/retry preserves inputs. Assignment,
tenant-isolation and viewer checks passed (22 tests), as did 388 web checks,
API/web typechecks, build and bundle budget. Exact-head CI belongs to the PR.

Remaining: stable member-ID assignment and editing existing follow-ups,
version-linked observation evidence, then explicit reviewed appraisal proposals.
No automatic financial changes, provider activation or deployment occurred.

## Follow-up deadline integrity — 11 October 2026

The preceding improvements through #59 were merged and deployed on main
`818ed258af0b1bddb531894045bd1e0d573b9175`, with successful exact-main CI
38179627406. API machine version 58 and web version 75 serve that release.
Fresh volume snapshots, unchanged aggregate record counts, successful migration,
live serving/login/project reads and a real portfolio PDF are recorded in #59.
This supersedes the earlier increments' no-deployment status, not their remaining
customer-launch limitations.

The next field-workflow check found `tasks.create` accepted arbitrary date strings:
31 February silently became a March deadline, ambiguous slash dates were accepted,
and invalid strings could surface as database/internal errors. It now accepts
only valid YYYY-MM-DD days, or the existing omitted/blank seven-day default.
Existing tasks and financial calculations are unchanged.

Seven failing API regression cases reproduced the defect before correction.
Seventeen task cases now pass, including leap day, both UK clock-change days,
no-write rejection and both default forms; viewer and tenant sweeps pass too.
The HTTP/browser journey also failed against the previous local API process,
then passed after restart on the corrected code. Both field-to-calendar and
colleague-assignment journeys pass in America/Los_Angeles. API typechecking and
diff review pass. Exact-commit CI evidence belongs to this increment's PR.
This date correction has not been deployed.

Next: editing existing follow-ups with conflict protection, stable member-ID
assignment, then version-linked observation evidence and reviewed appraisal
proposals. External provider, professional and customer-launch gates remain.

## Editing field follow-ups — 12 October 2026

PR #60 was green and merged at `3e6925aa9514795c7c78149156dc3e5d604708d7`
before this increment. The deployed release remains `818ed258`; subsequent
changes require their own release evidence and deployment.

Existing field follow-ups now have an edit action for the reviewed title,
workspace colleague and due day. Clearing the date explicitly removes the
deadline; leaving it unchanged preserves its original stored timestamp.
Completion status, project and inspection/appraisal records are not edited.
The calendar and field panel read the same saved task.

The editor captures title, assignee, deadline and completion state when opened.
An atomic conditional write compares that snapshot with the stored fields, so
refreshing a list beneath an unsaved draft does not authorize overwriting a
changed task. A conflict keeps the draft and directs the user to review the
latest task, cancel and reopen. This is comparison of current field values,
not a monotonically versioned task history or automatic conflict merging.
Edits and before/after audit evidence commit together; a failed audit rolls
back the edit. Tenant, viewer and unique internal-assignee checks apply.

Ten focused API cases cover updates, date preservation/removal, conflicts for
each compared field, competing saves, foreign/read-only refusals, invalid inputs
and audit rollback. Removing the conditional snapshot caused five cases to fail;
restoring it passed. Isolation/provenance/reachability/viewer sweeps passed (39
combined cases), as did 388 web checks, API/web typechecks and build/bundle guards.
The mobile browser flow in America/Los_Angeles exercises failed-save retry,
reassignment, a competing saved revision, refresh with retained draft, refused
stale overwrite, cancel/reopen, clearing the date and calendar/reload persistence.
Both follow-up browser journeys pass and the mobile conflict form was inspected.
Exact-head CI evidence belongs to this increment's PR. No deployment occurred.

Next: stable member-ID assignment and version-linked observation evidence,
then explicit reviewed observation-to-appraisal proposals. Offline task submission,
server-side create idempotency and external launch acceptance remain outstanding.

## Stable task member identity — 12 October 2026

PR #61 was green and merged at `bff7e7876bd4d976af9647b300dfc5fef338c303`
before this increment. Live remains `818ed258`; none of the later increments
are implied to be deployed.

Tasks now store a nullable stable `assigneeId` alongside the existing initials
snapshot. New field, calendar, appraisal and cost-monitoring pickers submit
member IDs; duplicate initials no longer make two colleagues indistinguishable.
Server lookups require the current workspace and an internal member, with no
fallback from an invalid ID to a matching label. Default assignment uses the
current user's ID. Initials-only callers can still create for a unique current
member. The edit snapshot includes the ID, so switching between colleagues with
the same initials invalidates an old draft. An older editor without that ID
refuses an ID-linked task rather than bypassing conflict protection.

Migration `20261012002000_task_member_identity` adds only the nullable column.
It deliberately does not backfill historical ownership from initials. Legacy
rows stay under Whole team, with an unresolved-assignment label; a field edit
requires explicitly selecting a colleague. Renaming a member does not change
ownership; removing one leaves the historical ID unavailable, not reassigned to
someone reusing the initials. The ID has no foreign-key cascade that could erase
the task on member removal. Workspace task erasure remains unchanged.

47 task/edit/tenant/viewer cases pass, covering same-initial colleagues,
same-initial reassignment conflicts, rename/removal, foreign/portal IDs and
explicit legacy resolution. Three local browser journeys pass, including
same-initial assignment and separate calendar filters, field edit/conflict/date
recovery, and the appraisal member picker. 388 web checks, API/web typechecks and
build/bundle guards pass; exact-head CI evidence belongs to this increment's PR.
The development database received the additive schema update. No live database,
credentials or deployment were changed.

Next: version-linked observation evidence and reviewed observation-to-appraisal
proposals. General-task legacy reassignment UI, offline task submission,
server-side create idempotency and external launch acceptance remain outstanding.

## Captured field-observation evidence — 12 October 2026

PR #62 was green and merged at `bba749767ef1ca0885f29188bc58c548a5291fd5`
before this increment. Live remains `818ed258`; later merges do not imply release.
The hourly product-improvement automation remains active.

A field follow-up now submits the selected inspection ID, saved timestamp and
original room index. The server checks workspace/project ownership and that the
source timestamp still matches, then copies the saved name, note and condition
into the task. User-supplied snapshot contents cannot replace the server source.
The original room index is retained before filtering empty observations, so a
hidden empty room cannot shift the selection onto a different observation.

The task's immutable JSON snapshot records its inspection ID, source timestamp,
room index and capture time. Task edits and subsequent inspection edits leave it
unchanged. The expandable evidence card displays the captured note/rating and
source time in London, and distinguishes a changed current inspection. A stale
source refuses task creation, preserves the draft and requires explicit review
and reselection. Legacy/ordinary tasks have no invented snapshot.

This captures text and condition only: it is not a frozen photograph archive,
appraisal-version approval, signed professional receipt or financial proposal.
The source timestamp identifies the saved inspection observed by the server;
this is not a complete immutable history of every inspection edit. The additive
`20261012004500_task_inspection_evidence` migration adds a nullable Task column.
Existing task/workspace deletion behavior still applies to the captured notes.

40 focused API/evidence/edit/tenant/viewer/provenance tests passed, including
cross-project/firm refusals, stale-source no-write, forged input, empty/index
validation and preserved evidence after both source and task edits. Both mobile
follow-up journeys passed with real HTTP writes, including an empty preceding
room, stale-source recovery and changed-source warning; the evidence card was
visually inspected. 388 web checks, API/web typechecks and build/bundle guards
passed. Exact-head CI evidence belongs to the PR. No production deployment or
provider activation occurred.

Next: explicit reviewed observation-to-appraisal proposals, with source context,
human-selected input changes and deterministic recalculation. Photo retention,
general-task legacy reassignment, offline task submission, create idempotency
and external launch acceptance remain separate work.

## Safe field-follow-up creation retries — 12 October 2026

PR #63 passed exact-head CI and was merged at
`bb6d39c955a2a70e0339c600dcf957b0e60e45fa` before this increment. Live remains
`818ed258`; this work does not deploy a release.

A successful task write can lose its HTTP response. Previously a retry could
create a second task, particularly before a refreshed list exposed the first.
Field follow-ups now generate an optional request UUID at first submission and
retain the exact submitted payload for explicit retries. Inputs stay fixed until
confirmation or cancellation. A refreshed list containing that same submission
no longer blocks its retry as a duplicate title.

The server stores the parsed request and actor on the task, and a unique
workspace/request constraint arbitrates simultaneous creates. Replays return
the original task, including subsequent edits, without resetting its deadline or
captured inspection evidence. Changed payloads or another actor using the same
workspace identity are refused. Project ownership is checked before replay;
separate workspaces can independently use the same UUID. Mutable source/member
validation occurs only when there is no committed task to replay.

Seven API regressions cover simultaneous requests, default deadline stability,
changed evidence and task edits, changed payloads, workspace isolation, actor
identity, refused requests and legacy callers. The focused API/evidence/edit/
tenant/viewer/provenance run passed 47 tests. Both mobile journeys passed; the
lost-response case actually commits via HTTP before substituting a 503, refreshes
the task list and retries, asserting the same single task. 388 web checks,
API/web typechecks, build and bundle guards passed. Exact-head CI belongs to the
PR. The isolation sweep documents why a client retry UUID is not a foreign row
identifier; dedicated tests prove its workspace scoping.

This is retry protection for an existing task, not a permanent receipt ledger.
Deleting the task deletes its retry record; cancelling, reloading or leaving the
field editor discards its in-memory submission. Other task creation screens and
legacy callers do not yet send retry identities. Offline durable submission and
idempotent completion toggles remain separate work. No financial arithmetic,
provider activation, live configuration or production deployment changed.

Next: reviewed observation-to-appraisal proposals, keeping source context and
explicit human-selected financial inputs; extend safe retries to other task
entry points and offline recovery as separate bounded increments.

## Stable completion retries across task screens — 12 October 2026

PR #64 passed exact-head CI and was merged at `f56a823` before this increment.
Live remains `818ed258`; no deployment is included.

A successful Complete response could be lost. Retrying the old toggle request
would then reopen the task; the same defect reversed a retried Reopen. Every
current task control now sends the intended boolean status: both calendar
presentations, the field companion, development appraisal and cost monitoring.
The server assigns that target rather than negating the current value. The
existing tenant and internal-writer gates apply before either write form.
Bare-ID requests retain their legacy toggle behavior for older clients.

Four API cases cover repeated and concurrent Complete/Reopen requests, unchanged
other task fields, foreign/missing task refusal, viewer/portal refusal and legacy
compatibility. All 51 focused status/create/evidence/edit/isolation/provenance/
viewer checks passed. Both browser journeys passed; the calendar completion and
field reopening each commit the real HTTP write, replace its response with 503,
then retry the unchanged visible action and assert the intended persisted state.
388 web checks, API/web typechecks, build and bundle guards passed. Exact-head CI
is recorded on the PR. No schema, source evidence or financial arithmetic changed.

This is stable target assignment, not an ordered status-command ledger: an old
Complete request arriving after a separate Reopen can still win the later write.
Legacy bare-ID callers also retain their prior retry risk. Offline command
ordering and durable recovery remain separate work. Next: reviewed
observation-to-appraisal proposals with explicit human-selected input changes.

## Visible recovery for uncertain task status — 12 October 2026

PR #65 passed exact-head CI and merged at
`99e6ee84c1858ddf51f6b3b4daa10365514ec021`. Live remains `818ed258`.

Calendar, development appraisal and cost-monitoring task status failures had no
inline feedback; the field companion only advised refreshing. All four now show
a shared alert with refresh, explicit retry and dismissal controls. Retry uses
the failed mutation's original variables. It never derives the opposite of a
newly refreshed checkbox, which would undo a successful write whose response was
lost. Dismissal clears the warning without writing or claiming success.

Both mobile journeys passed. The calendar Complete and field Reopen cases each
commit the actual write and substitute a 503, assert the alert, refresh until the
new saved state is visible, then retry through the recovery control and verify
that the persisted target remains unchanged and the warning clears. 388 web
checks, strict typechecking, build and bundle guards passed. No API or schema
change; full exact-head CI evidence belongs to the PR.

This completes the visible recovery path for the previous status-retry increment.
It does not provide offline persistence, ordered conflicting commands or live
release acceptance. Next: reviewed observation-to-appraisal proposals with
explicit source context and human-selected input changes. No deployment.

## Field evidence visible during appraisal — 12 October 2026

PR #66 passed exact-head CI and was merged at `a0bea3e` before this increment.
Live remains `818ed258`; this increment is not deployed.

The development appraisal now has a project-scoped field-evidence review panel,
linked directly from field follow-ups. It shows open/total follow-up counts,
captured room notes and condition, the source save time, and whether the current
inspection differs or cannot be checked. Completed follow-ups stay visible with
an explicit reminder that their appraisal impact still needs review. Tasks with
no captured source remain labelled as such. A link returns to the same project's
field companion; refresh reads both tasks and the current inspection.

Failed task reads report unknown review status and do not show an empty or zero
result. An empty project explicitly does not imply a completed inspection. The
panel is read-only: observations do not change financial inputs or acknowledge
an appraisal. It states that this evidence is not yet pinned to an appraisal
version, its source input acknowledgement or its report.

Both real browser journeys passed, including field → appraisal → same field
project, immutable captured notes after source changes, completed-task context,
failed read/retry, a second project with no leaked evidence, and no appraisal
created by reading. The mobile evidence card was visually inspected; no horizontal
overflow. 388 web checks, strict typechecking, build and bundle guards passed.
No API, schema or engine change. Exact-head CI evidence belongs to the PR.

Next: explicit observation-to-input proposals and appraisal-version source
pinning; the current panel supplies review context only. Professional acceptance,
provider activation, offline recovery and the release gates remain outstanding.

## Appraisal editor snapshot integrity — 12 October 2026

PR #67 passed exact-head CI and merged at `139c54b` before this increment.
Live remains `818ed258`; no release is deployed here.

Tracing field evidence into appraisal edits exposed a higher-priority data-loss
risk: every background getCurrent refresh advanced the editor's expectedUpdatedAt
without loading the corresponding inputs. An older local draft could therefore
pass the server concurrency check and overwrite a colleague's newer appraisal.
The editor now takes the query stamp only when it hydrates those inputs. Its own
successful save/new-version responses still advance the stamp directly.

A real browser regression creates a fresh workspace/appraisal, loads a local
draft, writes different labels and unit counts through another API caller, then
triggers an actual stale-query focus refresh. The old behavior returned HTTP 200
for the stale save. The fix returns 409, preserves the colleague's stored values
and retains the local draft. Explicit reload loads the current snapshot and two
successive saves succeed. Reintroducing the original stamp update makes the
same final regression fail (expected 409, received 200); the fix was restored.

The new journey and both field journeys passed locally. 388 web checks,
strict typechecking, build and bundle guards passed. Exact-head CI belongs to
the PR. No engine, API or schema change; this restores the protection already
provided by the server rather than adding a second calculation path.

Next: explicit observation-to-input proposals and version-pinned field evidence.
Version-restore hydration and edits made during an in-flight save merit separate
review; this increment proves background-refetch snapshot integrity, not every
possible editor race. Professional and production release gates remain open.

## Appraisal edits during pending saves — 12 October 2026

PR #68 merged and deployed at `842c8d77291dce4184705e7337f79fb623e136a4`;
main CI run 38218410459 passed. Its PR contains the release, backup, migration,
read-only live browser and real PDF evidence. This increment is not deployed.

A real browser regression reproduced a second editor data-loss risk: after a
request was submitted, further typing stayed on screen but the older request's
success cleared the dirty flag. The button said Saved and navigation protection
was removed even though those later edits had never reached the database.
Both ordinary and named-version saves now compare their submitted input object
with the current immutable input object before clearing the dirty state. The
successful response still advances the concurrency stamp for the next save.

The regression holds the actual server response after its write, types more,
then releases it. Both save paths retain the newer draft and enabled save button,
warn on navigation, preserve edits when navigation is cancelled, and persist
them on the next save. The test failed on the original implementation. The
existing background-refresh conflict and sequential-save checks remain covered.
Three related browser journeys, 388 web checks, strict web typechecking, build
and bundle guards passed locally. Exact-head CI evidence is recorded on the PR.
No API, schema or financial engine changes.

Next: audit restore hydration and overlapping editor actions before expanding
version-linked field evidence. This fix does not add offline draft persistence
or establish professional acceptance, provider activation or production readiness.

## Restore the exact appraisal snapshot — 12 October 2026

PR #69 passed exact-head CI 38221034105 and merged at `86fc322` before this
increment. Live remains `842c8d7`; this increment is not deployed.

The next browser regression proved that restoring a version could report success
while leaving the replaced version's inputs in the editor. Setting loaded=false
let the hydration effect consume the old cached current query before its refetch
arrived. The restore API now additionally returns the restored row's converted
inputs and updatedAt stamp. The editor hydrates from that exact mutation response,
not the query cache. Deploy the API before the web bundle for this contract change.

Restoring over unsaved edits asks the user first. Cancelling does not write. If
they continue typing while restoration is pending, those newer edits remain dirty
with an explicit message; a subsequent save uses the restored stamp. Ordinary
save, named-version save and restore controls block overlapping pending mutations,
including the named-version Enter shortcut. Restored approval status and financial
calculations retain their existing behavior.

The stale-cache browser regression failed before the fix. Four browser journeys
passed locally, covering cache/refetch failure, restore cancellation, edits during
a delayed real restore, blocked overlapping saves and successful subsequent saves,
plus existing editor and field workflows. Six restore API tests verify the response
matches the stored row and retain draft/approval/headline/concurrency coverage.
388 web checks, API/web typechecks, build and bundle guards passed. Exact-head CI
results are recorded on the PR.

Next: first-load typing/hydration and honest export source context when background
reads fail; then version-linked field evidence. No schema changes or live writes.
Professional acceptance, provider activation and production release gates remain.

## Recover an initial appraisal read failure — 12 October 2026

PR #70 passed exact-head CI 38226862324 and merged at `2668483` before this
increment. Live remains `842c8d7`; no deployment is performed here.

The editor already hides inputs until hydration completes. The evidenced gap was
initial read failure: after retries were exhausted, loaded remained false and the
loading skeleton stayed indefinitely. A global transient toast did not provide a
local recovery action. The screen now announces that the appraisal could not be
loaded and offers Retry loading appraisal. Inputs and save controls remain absent
until a successful read hydrates the saved figures. Already-loaded dirty drafts
are unaffected by this initial-load-only branch.

The browser regression blocks the actual batched appraisal request, verifies the
failure state without editable defaults, restores network access, retries, checks
that the persisted timestamp did not change, and successfully saves a later edit.
It failed against the original implementation. All three editor browser journeys,
388 web checks, strict typecheck, build and bundle guards passed locally. A local
run immediately after swapping the implementation for red/green verification
failed the existing draft test; a stable rerun passed all three. Full exact-head
CI evidence is recorded on the PR. No API, schema or engine changes.

Next: export source context after failed background refreshes, then version-linked
field evidence. These checks do not establish professional acceptance or activate
external data/AI providers.

## Bind exported source claims to the editor snapshot — 12 October 2026

PR #71 passed exact-head CI 38232910970 and merged at `74cbfbf` before this
increment. Live remains `842c8d7`; no deployment is performed here.

A downloaded-workbook regression proved a false claim: after editing and saving
reviewed inputs while the current-appraisal refetch was blocked, the workbook
still said its exported inputs matched the recorded input review. The export
combined the editor's new figures with the query cache's previous source review.

The editor now tracks both the held appraisal ID and update stamp through load,
save, named-version save and restore. Failed reads or a mismatch with cached
source-review data produce an explicit unverified state on screen and in the
workbook. Cached matching-input claims and source metadata are withheld in that
state; it never asserts that no review exists. Refresh source review retries the
read without hydrating over the draft. Matching data restores the existing review
and changed-input warnings. Financial inputs and calculations are unchanged.

The browser regression reads real downloaded XLSX Source evidence cells: matching
review before edits, unverified after a save with failed refetch, and INPUTS CHANGED
after recovery. Against the original implementation it failed on the false
matching-input claim. Four editor browser journeys, 389 web checks, strict
web typechecking, build and bundle guards passed locally. Exact-head CI evidence
is recorded on the PR. No API, schema or engine changes.

Limit: this guards known read failure and snapshot mismatch; it does not recheck
source-file bytes or force a fresh network read for every export. Next: reconcile
these editor fixes into a verified release, then version-linked field evidence.
Professional acceptance and provider activation remain separate release gates.

## Isolate unreadable field snapshots — 12 October 2026

Reconciled the deployed release `456dea96a0faa350636ff18a7bca560d05f34448`,
exact-main CI 38237141145 and the live verification/rollback record on PR #72.
No open PR or competing local edits were present. No release is deployed here.

Before adding version-linked field review, inspection of tasks.list exposed a
prerequisite reliability defect: parsing any malformed historical inspection
snapshot threw and failed the complete project or workspace/calendar task list.
Five corrupted snapshot cases reproduced failures against the original code.
The read path now isolates parsing per row, returns absent/recorded/unreadable
state, and preserves the stored bytes. Healthy tasks and the affected task remain
usable. Field and appraisal evidence panels explicitly warn when captured evidence
could not be read, rather than calling it absent or silently inventing a source.

25 targeted API checks passed: malformed JSON, empty and invalid shape/version
records, healthy neighbouring evidence, unchanged stored bytes, task completion,
workspace-wide reads and tenant isolation. Both field browser journeys passed;
the API suite creates real malformed records, while the browser injects the API's
normalized unreadable state to verify warnings in both panels, working controls,
and recovery after refresh. 389 web checks, API/web typechecks, production build
and bundle guards passed locally. Exact-head CI evidence is recorded on the PR.
No schema, financial engine or live-data changes.

Next remains explicit field-evidence review pinned to appraisal versions. This
increment hardens that input path; it does not implement version pinning, financial
adjustment proposals, professional acceptance or provider activation.

## Field snapshots attached to named appraisal versions — 12 October 2026

PR #73 passed exact-head CI 38240749870 and merged at `4300279` before this
increment. Live remains `456dea9`; no release is deployed here.

Versions now offers an opt-in to capture the project's displayed field follow-ups
with a named appraisal version. The server reads tenant/project-scoped tasks and
checks per-task fingerprints against the preview, rejects duplicates, changed or
unavailable tasks and unreadable evidence, and stores its own task titles/status
and captured inspection observations. The client cannot supply observation text.
A nullable Appraisal.fieldSnapshot JSON column and additive migration preserve
existing appraisals without fabricated history. API/migration must deploy before web.

The fixed snapshot shows separately from the live follow-up list, with capturing
member identity/time and task state at capture. Ordinary appraisal edits retain it;
a new branch starts without it unless explicitly captured; restoring a historical
version retains its historical snapshot/date. Invalid stored snapshots show an
unreadable state. This is historical context, not approval, source input acceptance
or a financial adjustment. Photos and PDF/XLSX report exports are not included.

20 targeted API checks and six editor/field browser journeys passed locally. New
coverage verifies immutable capture through task changes, save/branch/restore,
server-owned observations, stale/foreign/other-project/duplicate/unreadable task
refusal without a new version, and honest corrupt-snapshot reads. The mobile
snapshot was visually inspected and has no horizontal overflow. 389 web checks,
API/web typechecks, build and bundle guards passed. Exact-head CI is on the PR.

Next: explicit observation-to-input proposals and deliberate report inclusion.
Version snapshots are now captured; professional acceptance, provider activation
and production release evidence remain separate requirements.

## Historical field evidence in Excel — 12 October 2026

PR #74 passed exact-head CI 38242816962 and merged at `356c5a5`. This increment
carries its immutable field snapshot into a dedicated Excel Field evidence sheet:
appraisal identity, capturing member/time, task identity/status at capture, and
inspection identity/source date/room/observation. Later live task edits do not
rewrite exported historical evidence. Unknown and unreadable reads are explicit;
unsaved inputs carry a warning. Missing snapshots do not imply no observations.
Zero condition remains “not rated”. Text is wrapped without truncation and stays
literal spreadsheet content. Photos and PDF field evidence are still excluded;
this is not professional acceptance or input approval. No finance/API/schema change.

The workbook module now loads on export: the bundle guard caught page growth and
the lazy boundary reduced the appraisal route closure to 114K without raising its
baseline. Local workbook tests cover actual serialized Excel bytes, long Unicode
notes, formula-like text, capture metadata, unknown/unreadable/absent states and
dirty inputs. Browser tests download the real workbook after changing the live
follow-up and verify the older captured observation/status survives; failed editor
refresh exports unverified field evidence. Full local web suite: 390 tests; six
focused browser journeys, typecheck, build and bundle guard. Exact-head CI is
recorded on the PR. Live remains `456dea9`; this increment is not deployed.

Next: deliberate PDF field-evidence inclusion and explicit observation-to-input
proposals. Provider activation, professional acceptance and production recovery
proof remain external release requirements. The CLAUDE.md memory loop-log path
was absent; this repository audit remains the available delivery record.

## Historical field appendix in appraisal PDFs — 12 October 2026

PR #75 passed exact-head CI 38247470881 and merged at `0d68499`. Captured field
context now follows source evidence in the appraisal report/PDF with correct page
numbering. It uses the same immutable snapshot and warnings as Excel; no live task
lookup or financial changes. Absent snapshots add no appendix; unreadable snapshots
print an explicit warning. Long content wraps and paginates, capped at 12 field
pages with an explicit omitted-line count and direction to the complete Excel
Field evidence sheet. Red Book reports and photos remain outside this increment.

391 web tests, web typecheck, build and bundle guard passed. Three real browser
journeys passed, including both existing source-evidence exports and the new field
PDF download after live task changes. Browser coverage also checks long-note
pagination, no overflow, unreadable and absent states. The downloaded 10-page PDF
was text-checked for historical evidence and visually rendered/inspected: appendix
and Page 10 of 10 were legible without clipping. Initial local downloads failed
because the API renderer targeted unused port 5273; correcting only the local
WEB_URL process setting to 5276 made both PDF journeys pass. Exact-head CI is on
the PR. No API/schema change and no deployment; live remains `456dea9`.

Next: explicit observation-to-input proposals with review before financial changes.
Professional acceptance, provider activation and production recovery proof remain
separate release requirements.

## Recoverable Excel exports — 12 October 2026

PR #76 passed exact-head CI 38253871097 and merged at `0837bc5`. Before moving
from evidence exports to financial proposals, review found that Excel failures
had no visible recovery and repeated clicks could start duplicate builds. The
appraisal export now shows preparation state, suppresses concurrent starts and
shows an inline failure with retry while retaining editor inputs. Navigation
cancels a late download; generated object URLs are released even if the browser
refuses the click. Workbook code remains lazy-loaded. No financial/API/schema change.

Six real editor/field browser journeys passed, including an injected browser
object-URL failure followed by a successful downloaded workbook and unchanged
editor input. Unit coverage checks cancelled downloads and URL cleanup when the
browser refuses the download, alongside the full workbook evidence suite. Local
web suite: 393 tests; typecheck, build and bundle guard passed. Exact-head CI is
recorded on the PR. No deployment; live remains `456dea9`.

Next remains explicit observation-to-input proposals with review before financial
changes. External professional acceptance, provider activation and production
recovery evidence are not implied by these checks.

## Phone-accessible evidence exports — 12 October 2026

PR #77 passed exact-head CI 38260864586 and merged at `40250ea`. The workbook
control was still hidden below tablet width, excluding field users from the
completed evidence-export workflow. It is now available at phone widths with a
44px touch target, placed in the appraisal content area so the action and retry
message have room. Simply revealing it in the header reproduced an overlapping
Saved button that intercepted taps; the final layout removes that obstruction.

The real 390px field journey now injects a download failure, sees readable recovery,
checks no page overflow and downloads the evidence workbook on retry without
switching to desktop. Capture identity/content/status assertions remain intact.
Six editor/field browser journeys and 393 web tests passed; typecheck, production
build and bundle guard passed. The mobile recovery screenshot was visually checked.
Exact-head CI is recorded on the PR. No finance/API/schema changes and no deployment;
live remains `456dea9`.

Next: reviewed observation-to-input proposals. Professional acceptance, activated
providers and production recovery remain external release evidence requirements.

## Mobile manual cost review — 12 October 2026

Live release is now `8199465`, deployed after exact-main CI 38275120337 passed;
PR #78 records running image revisions, snapshots, migration/count checks and
live read-only mobile export/PDF evidence. PRs #73–78 are live. No open competing
PR or dirty checkout was present before this increment.

Before adding financial proposals, a real field-to-appraisal test found that
Other Costs widened the phone page beyond 390px when entering an allowance and
its spending timing. Cost rows now wrap, give the label a full mobile row, and
provide 44px input/button heights at phone widths. Desktop inputs retain their
existing compact sizing. No calculation, validation, persistence or source
acceptance semantics changed.

The regression failed on the original layout, then passed after the fix. It
enters a manually reviewed allowance, sets start month 2/duration 1, saves,
reloads and checks all values while retaining the captured field snapshot. The
same phone then downloads the evidence workbook. Six editor/field journeys and
393 web tests passed, plus typecheck, build and bundle guard. The 390px cost
layout was visually checked. Exact-head CI is on the PR. This change is not yet
deployed; live remains `8199465`.

Next: reviewed observation-to-input proposals with durable source links. The
manual allowance tested here is not an automatically extracted or professionally
accepted adjustment. External release acceptance requirements remain open.


## Reviewed field allowances — 13 October 2026

After reconciling main and finding no open competing PR, completed the next
field-to-appraisal step. A saved field snapshot can now supply the source for a
manually entered allowance, rationale and explicit acknowledgement. The engine
previews the proposal and the server permits only the appended cost on an
unchanged saved basis. Saving creates a new draft version, preserving appraisal
origin, historical task content, source version and authenticated reviewer.
An additive nullable migration retains existing appraisals unchanged.

Ordinary edits and restores retain the historical record. Changed amount,
label, cost position or custom timing no longer matches the recorded review;
the screen and PDF/Excel exports say reassessment is required. Unsaved inputs
cannot claim the saved cost still matches. Unreadable/unverified history stays
unknown. It is not professional approval, current inspection verification,
a supplier quotation or an automatically inferred cost.

Local evidence: full API suite 1,433 passed before the additional race test;
final targeted suite 3 passed including transaction-race rejection, committed
request retry, foreign sources, missing consent and server-owned attribution.
Six relevant browser journeys passed across editor ownership and the 390px
field journey, including failed-save recovery, linked-version reload, changed
cost status, Excel content, PDF report content and actual PDF download. Web
suite, typechecks, build and bundle evidence and exact-commit CI are recorded
on the PR. No production customer writes were used for verification.

Next engineering priorities: representative import/reconciliation and richer
reviewed field impact proposals (programme and quantity as well as allowances),
followed by the acceptance findings. The broader completion register remains
open: real accounts/domain/operator identity, production restore and intended
professional-user acceptance cannot be closed with synthetic tests. The hourly
automation remains paused at the owner's request.


## PlotMerit product rebrand — 13 October 2026

Renamed customer-facing app chrome, authentication, titles, public/legal product
copy, install metadata, email templates and default report/workbook branding to
PlotMerit. Added a P monogram, reproducible social/touch assets and a public
change notice. Custom firm branding remains authoritative on client documents.
The service-worker cache version changes to refresh the shell; account/storage
keys, offline photo queues, saved records, package names and deployment URLs
remain compatible. No schema, engine arithmetic or historical-data migration.

This is a product name, not a newly incorporated entity. Unconfirmed operator
information stays explicitly unconfirmed; no PlotMerit Ltd assertion or domain
ownership claim. Existing email addresses/configured senders are retained.
The proposed domain has not been purchased or configured; the existing Fly URL
continues to serve the product. The improvement automation remains paused.

Local evidence: 1,434 API, 394 web and 17 MCP tests passed, web typecheck/build
and bundle limits passed, eight navigation/customer lifecycle browser journeys
and five public branding, firm-document, workbook/portal, contrast and legal
journeys and four offline recovery regressions passed. Exact-head CI/release
evidence is recorded on the PR before release. Public assets were visually inspected.
The commercial/operator/provider and professional acceptance blockers remain
open; a rebrand does not establish production readiness.

## Scheme assumption review before appraisal acceptance — 16 October 2026

Resumed the hourly improvement loop at the owner's request; reconciled main
and found no competing open PR. The next document-to-appraisal gap was direct
review of scheme assumptions: only unit count/area/value could be corrected.
Auto-Appraisal now exposes build cost, efficiency, asking land price, CIL/S106,
fees, contingency, profit target and finance terms before source acceptance.
Corrections invalidate acceptance, block competing runs/saves and recalculate
through the existing deterministic API. Invalid assumptions and failed requests
retain the draft with an inline error. A successful recalculation requires fresh
acceptance, then saves the corrected inputs under the existing server-attributed,
input-bound source review. Existing unit citations and worked-example disclosure
remain intact. Validators reuse the saved-appraisal bounds and load on demand.
No new provider calls, credentials, arithmetic, schema or data migration.

Local evidence: 414 web tests, strict typecheck, production build and bundle
limits passed. The browser journey covers mixed unit/scheme correction, invalid
programme, failed computation/retry, renewed consent, saved input values and
engine-calculated CIL (stored to pennies), reload and invalidation after a later
edit. Manual-entry and both source-version regressions passed. The review form
was checked at 390px. Exact-commit CI and delivery state are recorded on the PR.

Next: distinguish extracted versus defaulted assumptions at individual-field
level and reconcile them against representative real project documents. This
increment improves review control; it does not establish model extraction
accuracy, measured drawing take-off, provider activation or professional acceptance.

## Assumption origins through review and export — 16 October 2026

Auto-Appraisal now labels each of the 16 scheme assumptions as model-supplied,
application-default, run setting, worked example or user correction. Origins
are captured before schema defaults replace missing/null inputs; supplied zero
and a supplied value matching a default remain model-supplied. Build cost is a
run setting, not a claim that the documents supplied it. Pending corrections
are labelled until recalculation succeeds. Unchanged origins survive correction
and what-if runs; missing legacy metadata stays unknown.

The existing input-bound review stores the bounded origin labels and carries
them into Excel and the report. These are client-submitted review metadata,
not independently verified citations or proof of source accuracy. Later edits
retain the historical record and its existing changed-input warning. No engine
arithmetic, schema migration, live credential or customer record changes.

Local evidence: 1,435 API tests passed with provider credentials removed; the
64 affected extraction/source-review tests passed again after final changes.
417 web tests, API/web typechecks, production build/bundle limits and three
browser journeys passed. The journey verifies correction, persistence, Excel,
report and stale-review invalidation; the 390px form was visually inspected.
An earlier full API run inherited a provider key and was stopped; some tests
may have contacted the provider. The clean rerun is the recorded full result.
Exact-head CI and delivery state are recorded on the PR.

Next: representative project-pack reconciliation and durable server-recorded
extraction receipts. Current origin labels do not prove which document/page
supports a model-supplied scheme assumption. Professional acceptance, provider
activation and the wider commercial/operational release gates remain open.

## PlotMerit address and account activity — 16 October 2026

At the owner's request, the old apex-appraise-web host is stopped with autostart
and restart disabled. The owner then requested the new product name as the
address. https://plotmerit.fly.dev now serves the previously accepted image
1598f45ff99b4239cb9d34ce8f88014e680efbfe, digest
sha256:18bb1d44f19a9aa1773071bb0459017d02193671362a4ce23b854718fa145a61.
That image passed main CI 38885987585; the new host passed serving/API/database
checks. Existing backend and data are retained. APP_URL and WEB_URL now use the
new host. Old-host access must stay disabled; a new public hostname is not an
access ban on a specific person. No custom domain purchase or ownership claim.
Deployment config, checks and operator instructions now target the new host.
Existing app-scoped CI deploy credentials may require owner re-provisioning for
the new app; no credentials were changed in this task.

Workspace administrators can see members' last recorded successful sign-in and
recorded count, with explicit refresh and visible load failures. Aggregation
uses immutable user IDs and the current tenant, excludes failed sign-ins and
is not returned to non-admin members. Existing audit records provide historical
data; absence means no record, not proof of no visit. This is not real-time
presence, anonymous visitor identification or a cross-customer owner dashboard.
Shared demo credentials cannot identify Dan or any other individual. Named
individual accounts are required for identifiable pilot activity. No new IP
tracking, cookies, fingerprinting or tracking-provider calls were introduced.

Local verification: audit regression covers same-ID events in another tenant,
renamed actors, failed sign-ins, absent records and non-admin/anonymous access.
The browser journey verifies real sign-in, displayed history, refresh and a
visible failure state. Web unit suite and strict typechecks passed. Exact-commit
CI and activity-feature delivery evidence will be recorded on the PR.

Delivery reconciliation: PR #84 was subsequently merged and deployed at
21809264703ccf2290c0ea1273395f70dd11ef8b after main CI 38892465776 passed.
Both live images carry that revision; serving and the live member-activity
journey passed. The former host remains stopped with autostart disabled.
PR #83 is being reconciled onto that release; origin labels are not live until
its own exact-commit release evidence is recorded. No competing increment was
found; retain both the new-host controls and the assumption-origin work.
