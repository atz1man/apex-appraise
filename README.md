# Apex Appraise

A connected operating system for UK residential & mixed-use property development —
sourcing → AI/manual appraisal → comparables → scenarios → development modelling →
construction cost monitoring → sales & lettings → buyer/investor portals →
benchmarking. Built from the design handoff in `design_handoff_apex_appraise/`.

## Quick start

```bash
pnpm install
pnpm db:push        # create SQLite dev DB (apps/api/prisma/dev.db)
pnpm seed           # demo dataset (11 deals, Bournemouth scheme, CRM, investors…)
pnpm dev            # API on :4100 + web on :5273
```

Open http://localhost:5273 and sign in:

| Surface | Email | Password |
|---|---|---|
| Internal team (admin) | `arthur@apexappraise.co.uk` | `demo` |
| Investor portal | `investor@demo.co.uk` | `demo` |
| Buyer portal | `buyer@demo.co.uk` | `demo` |

## Monorepo

```
apps/web              React 18 + Vite + Tailwind (design tokens) + tRPC client
apps/api              Fastify + tRPC v11 + Prisma (SQLite dev / Postgres prod)
packages/appraisal-engine   PURE TS — the single calculation engine (unit-tested)
packages/types        Zod schemas + domain unions (incl. LLM extraction contract)
packages/ui-tokens    Design tokens (TS + Tailwind preset) from DESIGN_SYSTEM.md
```

## The calculation engine

`packages/appraisal-engine` is the single source of truth for all money maths:
`computeAppraisal` (residual/profit modes, monthly drawdown with rolled-up compounding
interest), `buildSpendProfile`, `irr` (bisection, null on no root), `sdltCommercial`,
`cilCharge`, `jvWaterfall` (4-tier), `sensitivityGrid`, `autoAppraise` (indicative),
`weightedComparables`, sales/lettings/portfolio roll-ups, and en-GB formatters.

Run the tests: `pnpm --filter @apex/appraisal-engine test`
(313 tests; the golden fixture is the Bournemouth trade-counter reference case from
`CALCULATIONS.md §12`, asserted to the penny / basis point against the prototype's
own `compute()` output. Its every numeric output is also hashed against
`ENGINE_VERSION`, so changing any arithmetic fails the build until somebody bumps
the version — the moment to say "figures approved under the old version may differ".)

**Non-negotiable:** the LLM never computes financials. Auto-Appraisal extraction
returns *inputs only* (validated by `zExtraction`); the engine computes outputs.
Without `ANTHROPIC_API_KEY` the API uses a deterministic demo extraction.

## Giving someone a demo

`infra/DEMO.md` stands up a demo instance (the production stack with `SEED_DEMO=1`,
`DEMO_MODE=1` and a live AI key); `docs/DEMO-WALKTHROUGH.md` is the end-to-end test
script to hand the person testing it — every user journey, with what to expect at each
step and which integrations are standing in.

## Production deployment (Docker + PostgreSQL)

```bash
JWT_SECRET=$(openssl rand -hex 32) \
POSTGRES_PASSWORD=$(openssl rand -hex 32) \
docker compose up --build
# web on :8080 — the only port published to the outside. The API (4100) and
# Postgres (55432) bind to the loopback address: nginx is the front door, and
# the security headers, tile proxy and download routes are enforced there.
# (nosniff, Referrer-Policy, X-Frame-Options and HSTS enforce; the CSP is served
#  Report-Only until it has been observed clean on a real deployment — the only
#  clause a wrong policy breaks is Stripe's injected card form, which no spec
#  opens. infra/security-headers.conf says so at length.)
```

The committed Prisma schema pins `sqlite` for zero-infra local dev;
`infra/api.Dockerfile` rewrites the datasource to Postgres at build time (two `sed`
lines) so dev and prod never drift by hand-editing. `JWT_SECRET` is mandatory when
`NODE_ENV=production` — the API refuses to boot without it.

## Security & storage

- Passwords are **scrypt-hashed** with per-user salts; login is throttled with a
  **5-failure / 15-minute lockout** per email (in-memory — move to Redis for multi-instance).
- **Audit trail**: every financial mutation (appraisal save, stage transition, cost
  package change), document upload and integration sync writes an `ActivityEvent`,
  surfaced in the data-room activity feed.
- **Real file uploads**: the data room dropzone and site photo log accept real files
  via multipart (`/uploads/document`, `/uploads/photo`), stored on local disk in dev
  (`apps/api/uploads/`, gitignored) and served at `/uploads/files/*` — swap the write
  for S3 presigned uploads in prod, the URL contract stays the same.

## Reports

Both reports render in-app as print-ready A4 pages, and the API also renders them
**server-side to real PDFs** (headless chromium prints the same React routes — one
source of truth for layout): `GET /reports/:dealId/appraisal.pdf?t=<jwt>` and
`GET /reports/:dealId/redbook.pdf?t=<jwt>`, wired to the "Download PDF" buttons.

## Tests

Five suites, ~1,760 tests plus 197 browser specs. All of them run in CI on every PR.

| Suite | Command | Count |
|---|---|---|
| Engine | `pnpm --filter @apex/appraisal-engine test` | 313 |
| API | `cd apps/api && npx vitest run` | 1084 |
| Web unit | `cd apps/web && npx vitest run` | 360 |
| MCP server | `pnpm --filter @apex/mcp-server test` | 17 |
| Browser (e2e) | `cd apps/web && npx playwright test` | 197 |
| Web typecheck | `cd apps/web && npx tsc --noEmit` | strict |

Much of that count is MECHANICAL GUARDS rather than per-feature tests: whole-codebase
sweeps that walk the real router or route table and fail naming the offender, each one
written after the same defect had been found and fixed by hand more than once. `CLAUDE.md`
lists them and, for each, what it measured and what it deliberately does not reach.

The browser suite needs the dev stack up, started with the CI rate limits —
`RATE_LIMIT_PER_MIN=5000 AUTH_RATE_LIMIT_PER_MIN=1000 pnpm dev` — because the suite signs
in on every test from one IP and the production defaults (600/10) fail ~39 specs on the
limiter, which reads as a pile of real regressions. Do NOT run `playwright install`: the
browser is provisioned with the image, and see the sandbox note in `CLAUDE.md` if the
pinned build and the installed one disagree.

## Documented deviations from the handoff spec

- **SQLite in dev** (spec: Postgres 15) — see the Docker section for the prod path.
  Enum-like fields are `String` + TS unions, JSON columns are JSON-encoded `String`
  (SQLite/Prisma limitation) — parsed in `apps/api/src/mappers.ts`.
- **Money over the wire is £ (number)**; the DB stores integer pence (BigInt) per the
  spec. Conversion happens once in the API mappers (`P`/`toPence`).
- **Auth** is credential + JWT (scrypt, per-account lockout), with OIDC single sign-on
  built in: home-realm discovery by email domain, PKCE, and an `enforced` mode that
  refuses every password in the workspace. Because that mode has one failure
  mode — a provider that stops letting anyone in — enforcing it issues single-use
  break-glass codes that sign an admin in without the identity provider. No MFA of
  our own; it belongs to the provider.
- The field app ships as an installable PWA route (`/field`, manifest included);
  a native Expo build is a packaging exercise on the same API. A photograph taken
  with no signal is held in IndexedDB and uploaded when the connection returns, so
  closing the tab does not lose it.
- Integrations that have a real connector are listed with what they feed, and the
  rest say what does the job instead — a green dot is a claim about a capability.
  Sample figures are written only where the deployment has opted in
  (`demoFallbacksAllowed()`) and only into rows that say so in their own text.

## Env vars (apps/api)

All optional vars degrade gracefully to a clearly-labelled demo mode when unset.

- `PORT` (default 4100), `JWT_SECRET` (**required in production**), `POSTGRES_PASSWORD` (**required**; the compose stack builds `DATABASE_URL` from it)
- `ENCRYPTION_KEY` — 32 bytes (hex or base64) sealing integration credentials at rest. Optional: derived from `JWT_SECRET` when unset, so nothing breaks on upgrade — but then rotating `JWT_SECRET` makes every sealed field unreadable. See `infra/DEPLOY.md`
- `RATE_LIMIT_PER_MIN` (default 600) and `AUTH_RATE_LIMIT_PER_MIN` (default 10) — raise them only for a test run, never in the deployed file
- `ANTHROPIC_API_KEY` — live LLM extraction for Auto-Appraisal
- `SMTP_URL` + `EMAIL_FROM` + `APP_URL` — invite/welcome email delivery (logged to console otherwise)
- `STRIPE_SECRET_KEY` — live buyer card payments (PaymentIntents); demo mode settles instantly
- `STRIPE_WEBHOOK_SECRET` — signature verification for `POST /webhooks/stripe`

See `infra/DEPLOY.md` for the full production runbook. **Production runs on Fly.io**
(two apps in `lhr`); the Docker Compose stack above is the self-hosted path and the one
this README's quick start describes. `.github/workflows/deploy.yml` ships `main` to Fly on
a button press rather than on merge — deliberately, because this product prints valuations
somebody signs, so which build is live stays a decision. That workflow exists because the
live API was once found running an image built three and a half weeks earlier: CI proves
the code is correct, never that it is running.
