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
(48 tests; the golden fixture is the Bournemouth trade-counter reference case from
`CALCULATIONS.md §12`, asserted to the penny / basis point against the prototype's
own `compute()` output.)

**Non-negotiable:** the LLM never computes financials. Auto-Appraisal extraction
returns *inputs only* (validated by `zExtraction`); the engine computes outputs.
Without `ANTHROPIC_API_KEY` the API uses a deterministic demo extraction.

## Production deployment (Docker + PostgreSQL)

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up --build
# web on :8080, API on :4100, Postgres 16 with a persistent volume
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

- Engine: `pnpm --filter @apex/appraisal-engine test` (48 golden tests).
- e2e: `pnpm --filter @apex/web test:e2e` (16 Playwright tests — golden path, portal
  isolation, and a happy-path per screen; needs the dev stack running and
  `npx playwright install chromium` once).

## Documented deviations from the handoff spec

- **SQLite in dev** (spec: Postgres 15) — see the Docker section for the prod path.
  Enum-like fields are `String` + TS unions, JSON columns are JSON-encoded `String`
  (SQLite/Prisma limitation) — parsed in `apps/api/src/mappers.ts`.
- **Money over the wire is £ (number)**; the DB stores integer pence (BigInt) per the
  spec. Conversion happens once in the API mappers (`P`/`toPence`).
- **Auth** is credential + JWT (scrypt, lockout). Swap for Auth.js/Clerk for SSO/MFA.
- The field app ships as an installable PWA route (`/field`, manifest included);
  a native Expo build is a packaging exercise on the same API.
- Integrations run in demo/mock mode without credentials (Land Registry → PPD
  comparables, EPC → linked certificate, AVM → cross-check comp), behind the same
  interface a production connector would implement.

## Env vars (apps/api)

- `PORT` (default 4100), `JWT_SECRET` (required in production), `ANTHROPIC_API_KEY`
  (optional — enables real LLM extraction for Auto-Appraisal), `DATABASE_URL`
  (Postgres, via Docker).
