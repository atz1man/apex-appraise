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

## Documented deviations from the handoff spec

- **SQLite in dev** (spec: Postgres 15). `.env`-free local boot; the schema avoids
  Postgres-only features. Enum-like fields are `String` + TS unions, JSON columns are
  JSON-encoded `String` (SQLite/Prisma limitation) — parsed in `apps/api/src/mappers.ts`.
  Production should switch the datasource to Postgres and restore native enums/Json.
- **Money over the wire is £ (number)**; the DB stores integer pence (BigInt) per the
  spec. Conversion happens once in the API mappers (`P`/`toPence`).
- **Auth** is a minimal JWT credential login (demo). Swap for Auth.js/Clerk for prod.
- Site photos / documents are metadata-only (no S3 yet); photo cards render as
  gradient placeholders per the prototype's image-slot pattern.
- Field app (Phase 10), PDF report rendering (Phase 11) and live integrations
  (Phase 12) are not built yet; the Integrations screen is a working catalogue over
  seeded connection state.

## Env vars (apps/api)

- `PORT` (default 4100), `JWT_SECRET` (dev default), `ANTHROPIC_API_KEY` (optional —
  enables real LLM extraction for Auto-Appraisal).
