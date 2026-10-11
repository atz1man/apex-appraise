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

1. Finish review/delivery of PR #49 and retain its precise boundary: local AI
   evaluations plus browser replay, not customer-facing subscription integration.
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
