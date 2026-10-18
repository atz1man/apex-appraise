# Customer SaaS release

A release is complete when a customer can join, appraise, receive reports, pay,
recover access, take their data away and leave, and the operator can restore the
service. A green build alone does not prove the external services are configured.

## Engineering evidence

The `codex/saas-completion` branch builds on PR #26 and preserves the pending
`codex/market-readiness` changes without changing that checkout.

| Journey | Implementation and evidence |
| --- | --- |
| Signup | Workspace, administrator and connector catalogue commit in one transaction. `signup-atomic.test.ts` drives simultaneous signup and checks no orphan remains. |
| Activation and appraisal | `saas-customer-lifecycle.spec.ts` registers its own empty workspace, creates a deal through the drawer, enters a scheme manually, saves it, opens the report and fetches a generated PDF. The renderer cache is discarded after Chromium disconnects, so a crash does not leave all future reports failing. It uses no seeded valuation. |
| Provenance | Manual, AI and what-if runs preserve their origin when saved. The lifecycle export checks the manual source. Comparable evidence and unit correctness are covered in PR #26. |
| Checkout | Existing and delinquent subscriptions are checked on the server. An open checkout is reused; customer and checkout creation carry Stripe idempotency keys. A checkout already opened on a different plan is refused until completed or expired. |
| Subscription changes | Current Stripe state is reconciled from signed lifecycle events. Access and audit records commit together; a slower response cannot overwrite a newer plan. |
| Failed renewal | `past_due` retains access while Stripe retries. `unpaid`, `incomplete` and `paused` grant no paid access, retain the subscription identity and expose payment attention in Settings. Configure Stripe's terminal retry action; leaving subscriptions past-due indefinitely leaves access indefinitely. |
| Payment recovery | Administrators can open Stripe payment details and invoice history for their own customer, including after trial expiry. Configure the Stripe Customer Portal before testing it. |
| Cancellation | Cancellation takes effect at the paid period end. Keeping the same plan also withdraws a pending cancellation. |
| Leaving | Export precedes erasure. Erasure expires open subscription checkouts and deletes the Stripe customer before deleting tenant records. Stripe closes subscriptions and prevents new ones against that customer. An external failure preserves the workspace for retry. Deletion stops billing immediately; it is distinct from cancellation at period end. |
| Email | Reset links and temporary passwords are absent from delivery logs. Actual delivery must be proved with the configured mail provider. |
| Deployment | Manual releases require successful CI for the exact main commit. Deployment uses app-scoped tokens. Docker context excludes local secrets and dependencies. |

The Stripe protocol choices follow the provider's [idempotency contract](https://docs.stripe.com/api/idempotent_requests),
[subscription statuses](https://docs.stripe.com/billing/subscriptions/overview),
[Customer Portal API](https://docs.stripe.com/api/customer_portal/sessions/create)
and [customer deletion semantics](https://docs.stripe.com/api/customers/delete).

## Configuration check

Run `pnpm release:check` with the intended production environment supplied
securely. It also loads the normal local `.env` if present, without overwriting
injected variables. It prints missing names and requirements, never secret values.
It refuses demo/reset settings, SQLite, insecure public URLs, missing delivery or
billing configuration, test-mode customer billing, malformed encryption keys and
an unconfirmed published operator identity.

Passing this check does not prove credentials work, mail arrives, historical demo
users are absent, DNS resolves, a backup restores or a qualified valuer accepts a
report. Complete the evidence below and the operational instructions in
[infra/DEPLOY.md](../infra/DEPLOY.md).

## External acceptance required before customer launch

Record the date, release commit, operator and result for each item. Unknown is
incomplete; sample/test transactions are labelled as such.

| Acceptance | Required evidence | Current state |
| --- | --- | --- |
| Operator identity | Owner supplies and confirms the real company details, support/privacy inboxes, published terms and commercial policy. Update `apps/web/src/legal/entity.ts`. | Awaiting owner details; `confirmed` remains false. |
| Domain | Owner chooses customer domain; HTTPS, email links, PDF renderer and integration callbacks use it. | Awaiting domain decision. |
| Plans | Owner confirms catalogue prices, VAT/tax treatment and cancellation/refund policy. | Existing catalogue retained; awaiting commercial confirmation. |
| Payments | Intended Stripe account configured; Customer Portal enabled; signed webhook receives checkout, renewal, failure, recovery, plan-change and cancellation events. Exercise erasure on a disposable subscribed tenant. | Fly configuration inspections on 9 and 10 October 2026 showed test-mode Stripe and no webhook secret. Live payment acceptance not performed. |
| Email | SMTP configured; welcome, invite and reset delivered to controlled inboxes; SPF/DKIM configured with provider; no secrets in logs. | Fly inspections on 9 and 10 October 2026 showed SMTP absent. Real delivery not performed. |
| Customer data | Dedicated customer database; no published demo accounts, reset endpoint or sample integration claims; separate demo infrastructure. | Requires deployment/data inventory. Disabling seed flags does not remove existing demo accounts. |
| Independent secrets | Explicit signing and encryption keys stored securely with recovery/rotation procedure. | Fly inspections on 9 and 10 October 2026 showed explicit encryption key absent; current service derives it from the signing key. See `infra/DEPLOY.md` before rotation. |
| Valuation acceptance | Qualified intended users work a real scheme from evidence through appraisal, review and exported PDFs. Save feedback and approval of the release commit. | Automated journey passes; professional acceptance still required. |
| Recovery | Encrypted/offsite backups; actual restore into a separate database and uploaded-file restore; record recovery duration and checks. | Scripts exist; actual production restore drill not performed in this work. |
| Operations | External `/ready` monitoring, named incident owner, support response procedure and a tested rollback. | Operator configuration/evidence required. |
| Enabled integrations | Each sold integration uses real credentials and passes a real transaction; mapping provider licensed for intended usage. | Test each enabled provider; do not advertise unconfigured ones as connected. |

The last verified deployment is web `96f8043e1edb40c6f03418d18ba0ce37c2960dd5`
and API `8199465192bb4e4ff4e9b0ba2e220fddae030bdf`, recorded on PR #79
with exact-main CI and read-only serving checks. Those releases do not establish
paying-customer readiness. The 13 October field allowance increment requires
its own exact-commit CI and deployment evidence; the external acceptance above
remains open.

Mapping acceptance: configure `TILE_URL`, `TILE_ATTRIBUTION` and `TILE_USER_AGENT` for a production service with agreed capacity and appropriate proxy/cache/export rights. `release:check` rejects the best-effort public OSM tile default. See [product and source readiness](PRODUCT-READINESS.md) for the evidence coverage and commercial provider decisions.


## Workfile hardening and customer actions — 10 October 2026

Upload records and audit events now commit atomically. UUID/exclusive storage
prevents concurrent filenames overwriting another tenant's bytes. Failed or
oversized writes clean up their files; private delivery headers survive the
static-file handler. Downloadable documents have attachment/sandbox/nosniff
protection, while raster images remain displayable. Portal file links recheck
current sharing and buyer/investor assignments, so access withdrawal takes
effect even on previously minted links.

Internal report URLs honour password-reset session revocation. PDF rendering
has a per-process concurrency bound and an overall deadline, with explicit
busy/timeout responses. Public share jobs can occupy only one of the two slots;
closed timed-out contexts release capacity even if application work stalls. All internal report kinds have the same progress,
download, error and retry action; the portfolio pack now exposes its PDF route
in the UI. Print remains an alternative. Fresh-workspace onboarding points to
the next unfinished action and keeps dismissal separate for each user.

The strengthened customer lifecycle verifies an actual UI-generated PDF,
workspace export and erasure using customer-owned test data. These checks do
not establish live payment delivery, mail delivery or operational recovery.

A read-only production runtime inspection on 10 October confirmed production
mode with test-mode Stripe, no SMTP, no Stripe webhook secret, no explicit
encryption key and no configured production mapping service. Demo/reset flags
were disabled; that does not prove historical demo users were removed. No live
configuration, payments or deployment was changed during this work.

Runtime dependencies were audited and updated to patched versions, including
Fastify/static serving, multipart parsing, mail, routing and MCP transport.
Compatible transitive security overrides are recorded in the root manifest;
CI refuses high or critical production dependency advisories. The registry
audit is a snapshot, not proof that a dependency has no undiscovered defects.

The patched router increases the initial JavaScript closure from about 306KB
to 322KB uncompressed (the older checked-in baseline was 293KB). Only the
entry baseline is updated; route growth tolerances and the 250KB route budget
are unchanged. ExcelJS/Leaflet remain outside initial/route static closures.
The heaviest route measures 121KB in this build.

## New-customer entry audit — 10 October 2026

This pass exercises first-time registration, invalid and duplicate submissions,
initial workspace isolation, first appraisal/report, team invitation/removal,
trial and seat controls, password recovery, export and account closure. It is
an engineering audit with synthetic customers; it is not observed customer
conversion data or a production load test.

Fixed findings:

- The signup API accepted whitespace-only organisation/person names even though
  the browser rejected them. The server now trims identity fields before
  validation, enforces bounded input lengths and normalizes email case. Sign-in,
  SSO discovery and password recovery accept surrounding email whitespace too.
  The login screen also trims before SSO discovery so pasted whitespace cannot
  hide the required sign-in route.
- Two simultaneous password resets could both read a valid token and overwrite
  each other's password. Consumption now compares the token and expiry in the
  database write. A forced concurrent-read regression test proves only one wins.
- Changing a password left older reset links usable. It now clears outstanding
  reset credentials as well as revoking old sessions.
- Signup now explains the 14-day trial, links the public terms/privacy notices,
  focuses the first invalid field, keeps entered details after a rejection,
  gives duplicate-account recovery links and shows a pending creation state.
  The notices are links, not a claim of recorded contractual acceptance.

Verification: `new-user-recovery.test.ts`, `signup-atomic.test.ts`, existing
session/SSO/throttling/tenant/role/entitlement checks and the new
`new-user-entry.spec.ts`. The customer lifecycle uses its own new workspace and
runs through a real appraisal and PDF before export and erasure. Provider-backed
billing and email delivery still require the live acceptance evidence above.

Open launch work: registration currently issues a session without proving email
ownership. Before unrestricted public signup, implement verified-email activation
with expiring, single-use confirmation and resend throttling, and decide which
trial actions require verification. This depends on working transactional email
for customer acceptance. The public operator identity and any versioned terms
acceptance policy still need owner confirmation. Multi-instance abuse limits,
capacity/load testing and restore exercises are separate release evidence;
passing the application tests does not establish them.


## 11 October 2026 release and HTTPS routing correction

Owner-authorized release integration #44 put the reviewed stack on main at
`9eefc0e1cc5bc4d1097997afdb65866393e960a6`. CI run 38125404919 passed
2,038 unit/API tests, 226 browser tests and the migration/renderer checks.
Fresh Fly snapshots were confirmed before migration: database
`vs_KlVAk3Lv5q66sZLZ3m8AA`, uploads `vs_ebJnby82Vz5fQXjA03ew` (five-day
retention; snapshots are not a restore-drill claim). The API deployment applied
38 migrations with no failed migration; counts remained 2 organisations,
7 users, 12 deals and 14 documents.

The first web rollout exposed an HTTPS-only routing defect: a rewrite-module
`if` in the repeated security-header snippet disabled `try_files` in its implicit
location. The plain-HTTP CI stack did not enter that branch. Public `/login`
returned 404 although loopback HTTP returned 200. The previous web image was
restored, and public `/login` returned 200. The correction computes HSTS using an
http-scope `map`, leaving the repeated header snippet declarative. A built-stack
browser regression sends the HTTPS forwarding header and checks SPA routes,
assets, missing assets and HSTS; plain HTTP must still omit HSTS. Final deployment
and exact-commit CI evidence are recorded in the release PR.

Live inspection confirms test Stripe, absent SMTP/AI, and an existing reset token
(the reset workflow is manual-only). Credentials were not changed and no reset
was invoked. Earlier records saying all reset configuration was disabled are
superseded by this inspection. This code release does not complete customer-launch
acceptance or commercial provider activation.


## Release serving checks — 11 October 2026

The HTTPS correction was deployed as web Fly release 74 from main `95589d8`;
API release 57 runs `9eefc0e` (the correction did not change API application code).
Both public login/readiness checks and authenticated live login, appraisal screens
and a real PDF download passed. The release evidence is recorded in #44/#45.

The deployment workflow now uses a shared read-only serving check: verify the
login application HTML, fetch and validate its same-origin module and stylesheet entry assets,
and require explicit `apex-api` and database readiness in JSON. It refuses redirects,
HTML fallbacks, wrong/empty asset bodies, unhealthy readiness and responses beyond
its byte/time limits. Twelve local HTTP regression cases plus the eleven existing
exact-commit release-gate checks pass. CI also runs the shared checker against
the built application stack. The same checker passed against the live
site without signing in or invoking any provider. This improves rollout detection;
it does not prove release identity, authenticated journeys, asset execution, rollback automation,
mail, billing, professional acceptance or customer readiness. GitHub deployment
credentials and the existing customer-launch acceptance gates remain outstanding.


## Backup completeness — 11 October 2026

The compose backup script previously continued to retention pruning after an
uploaded-file snapshot failed or the API container was absent. With an older
uploads archive present, it could exit successfully despite missing the new
supporting documents. It now exits unsuccessfully before any pruning when
uploads are incomplete. A verified database dump remains available and is sent
offsite when configured. Invalid or zero retention settings fail before writes.

Fifteen isolated command-level regressions execute the actual shell script with
fake container/database boundaries and real tar archives, covering missing,
failed and corrupt uploads, successful paired publication/pruning, offsite
failure, database/configuration failures, managed database partial runs and unsafe
retention inputs. Retention now preserves matching archive pairs instead of letting
newer partial dumps displace older complete recovery material. These checks use synthetic files and do
not establish production backup contents or restorability. No live backups,
credentials or databases were changed. The deployment serving checks originated
in PR #46. Next operational priority is an isolated restore drill
covering both database and uploaded documents; customer-launch owner/provider
acceptance gates remain open.


## Synthetic recovery exercise — 11 October 2026

The follow-up to #47 runs the actual backup and restore-check commands against
CI's disposable PostgreSQL 18 stack after the customer browser journeys. It
checks restored table/organisation/deal counts, byte-for-byte recovery of a
synthetic uploaded file, rejection of a corrupt database archive and scratch
database cleanup after both success and failure. Original row counts and fixture
bytes must remain unchanged. It uses no live credentials or customer data.

The initial CI exercise caught dump verification failing when compose used
PostgreSQL 18 but the script selected the host restore tool. Compose backups now
verify with the database container toolchain; managed connections use the local
toolchain that produces their dump. A regression makes the host verifier fail
and confirms compose backup verification still succeeds.

This covers the operator command path beyond mocked command regressions. It
does not verify a real production backup, offsite retrieval, all document
references, recovery duration at production scale or concurrent-write snapshot
consistency. The next recovery acceptance remains an isolated production
restore drill with those checks and an identified operator.


## Consolidated verification and recovery candidate — 11 October 2026

PR #48 now combines the serving checks from #46, backup completeness from #47
and the real CI recovery exercise, preserving their commit histories. Integration
resolved competing insertions in the browser workflow and release record: both
the serving check and recovery drill run after browser journeys, followed by the
renderer signal checks. The serving-check unit tests remain in the release-test
glob. No application, schema, financial calculation or live configuration changed
in this integration.

The separate prior CI runs remain evidence for their individual commits. The
combined head requires its own full CI result, recorded on #48; individual green
runs are not substituted for it. Production restore acceptance, deployment
credentials and the customer-launch gates remain open. The next delivery step is
review of this combined candidate, followed by exact-main CI before any authorized
release. No production deployment is included in this consolidation.


The combined local run exposed a stalled-body timeout regression in the serving
checker: its timeout test hit the five-second test limit. The checker now races
an explicit request deadline independently of transport abort, clears its timer
and aborts the transport on completion. A never-settling transport regression
covers that deadline in addition to the real HTTP stalled-body test. This is a
release-check reliability fix; it does not change application request handling.

The serving-check workflow steps also have a three-minute process limit, since
an abandoned transport handle could keep a CLI process alive after its request
promise rejects. The synthetic restore step has a five-minute limit. CI checks
serving again after the recovery drill, so passing the pre-drill check cannot
hide a service damaged during the exercise. The never-settling transport test
also passed in isolation; it does not depend on earlier tests initializing fetch.

## Restore-check scratch database lifecycle — 18 October 2026

The database recovery check previously printed PASS and swallowed a failed
scratch-database drop. It also dropped a PID-derived database name before
creating it, so a name collision could delete another drill's data. The command
now uses a randomized name, refuses CREATE collisions, and only drops a database
after its own CREATE succeeds. Cleanup is required before PASS. Failed restore
and handled termination paths attempt cleanup; a failed drop exits unsuccessfully
and names the scratch database for operator recovery without printing credentials.
An uncatchable process kill or lost CREATE acknowledgement still needs operator
inventory; this is not a claim of guaranteed cleanup across process/server loss.

Command-level regressions execute both managed and compose paths for success,
name collision, restore failure, cleanup failure, combined failures and TERM.
Eight assertions failed against the previous script. The bounded suite plus
backup regressions passes 28 checks; API typecheck and shell syntax are checked.
CI additionally runs the existing disposable PostgreSQL backup/restore journey.
No production database, backup, credential or retention policy was changed.
An actual isolated production restore with uploaded-file reconciliation and an
identified operator remains a launch acceptance requirement.

Review of the same recovery candidate found another false-PASS path: invalid
`MIN_ROWS` comparisons could skip the refusal branch, and removing all whitespace
could turn multiple count lines into a different number. The command now requires
a positive bounded minimum before database operations and validates each restored
count as one bounded nonnegative integer. Invalid or missing output fails with
scratch cleanup rather than claiming verified contents. Twelve regression cases
failed on the previous revision; the updated restore/backup suite passes 44
checks, plus API typecheck and shell syntax. Exact-head CI must be rerun after
this change; earlier green evidence is not evidence for the amended candidate.
