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

The existing Fly service is not changed or declared customer-ready by these code
changes. As of 9 October 2026, the web machine reports its last update on 4
September 2026. A fresh release and the acceptance above are needed; restarting a
machine does not ship this branch.

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
