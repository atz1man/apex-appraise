# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Apex Appraise — UK property-development platform (appraisals, comparables, cost monitoring,
sales, investor/buyer portals, benchmarking). Multi-tenant SaaS + PWA. Built from the design
handoff at `~/Desktop/design_handoff_apex_appraise` (CLAUDE.md brief, DATA_MODEL.md,
CALCULATIONS.md, API.md, DESIGN_SYSTEM.md + `.dc.html` prototypes) — consult it for spec
questions. **This is a separate product from Velora/railroster** — never mix code, keys,
memory, or commits between the two.

## Layout (pnpm monorepo)

- `apps/web` — React 18 + Vite + Tailwind (dev port 5273). Routes in `src/routes/`, shared
  primitives in `src/components/ui.tsx` (TopBar, Button CTA system, DealNav, Skeleton…).
- `apps/api` — Fastify + tRPC v11 + Prisma (dev port 4100). Routers in `src/routers/`,
  open-data connectors in `src/opendata.ts`, LLM extraction in `src/extract.ts`.
- `packages/appraisal-engine` — pure TS calculation engine. ALL money maths lives here.
- `packages/types` — zod schemas shared across web/api.
- `packages/ui-tokens` — design tokens + Tailwind preset.

## Commands

- `pnpm install && pnpm db:push && pnpm seed && pnpm dev` — full local start.
- `pnpm --filter @apex/appraisal-engine test` — engine tests (199; golden Bournemouth fixture
  locked to the penny — GDV £4,278,000, residual £406,711.36, PoC 25%).
- `cd apps/web && npx playwright test` — e2e (103, incl. a both-theme WCAG contrast sweep; needs web 5273 + api 4100 running).
- `cd apps/web && npx tsc --noEmit` — web typecheck (strict, noUnusedLocals).
- `JWT_SECRET=x docker compose up -d --build` — production stack: nginx :8080 → api → Postgres 16.

Logins (seed): `arthur@apexappraise.co.uk` / `demo`; also investor@demo.co.uk, buyer@demo.co.uk.

## Non-negotiables (from the handoff spec)

- The LLM NEVER computes financials — it extracts inputs only; the deterministic engine computes.
- One shared calculation engine for every surface (screen, export, report, portal).
- UK conventions: £, RICS, SDLT, CIL, GIA/NIA, en-GB dates.
- Money stored as integer pence in the DB.
- Design tokens only — no raw hex in components (tokens come from `@apex/ui-tokens`).
- Typefaces are SELF-HOSTED (`apps/web/public/fonts`, `@font-face` in `src/index.css`) — never
  re-add a Google Fonts `<link>`. A signed valuation is printed server-side, the field app has to
  render offline, and the privacy notice says "Nobody else"; `e2e/typography.spec.ts` enforces it.
- Provenance on every figure (extraction citations, audit events).

## Gotchas (hard-won — do not re-learn)

- Rebuild containers before verifying new API procedures (`docker compose up -d --build`) —
  stale images make zod silently strip unknown mutation keys and "succeed" confusingly.
- Run the API suite in the container, not just on the host — `docker compose run --rm --no-deps
  --entrypoint sh api -c 'sed -i "s/postgresql/sqlite/" prisma/schema.prisma && npx prisma generate
  && npx vitest run'`. The image is Node 22 and this Mac is Node 25: `10 ** -4` differs between
  them, which once let the Red Book narrative guard accept a transposed Market Value in
  production while its test was green locally.
- Playwright: prefer `getByRole(..., {name, exact})`; toasts echoing labels cause strict-mode
  collisions. First e2e run right after a rebuild can race the stack — rerun before diagnosing.
- New Prisma model ⇒ add it to the seed wipe list, or stale rows accumulate across reseeds.
- `.env` (repo root, gitignored) holds the Anthropic + Stripe sandbox keys and JWT_SECRET —
  never print or commit them; docker compose reads it automatically. Preserve existing keys
  when editing.
- SQLite dev / Postgres prod: JSON columns are String (JSON.stringify/parse via mappers);
  no native enums.
- Heavy deps (exceljs, leaflet) must stay lazy-loaded (dynamic import) — never in the main bundle.
- Prisma on alpine needs `apk add openssl` before generate; web image needs tsconfig.base.json
  copied and `prisma generate` run.
- Docker CLI in sandboxed shells: `export PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin"`.
- Overpass API requires a User-Agent header (406 without).
- Flex children default `min-width:auto` — clusters need `min-w-0` (+ internal `overflow-x-auto`)
  or they widen the page on phones; e2e guards zero horizontal scroll at 390px.
- Live-LLM e2e needs `test.setTimeout(120_000)`.
- Repo is PUBLIC (github.com/atz1man/apex-appraise) so GitHub Actions runs free.

## Session memory

Long-running project state (roadmap, iteration journal, mistake log) lives in this project's
Claude memory: `~/.claude/projects/-Users-ahmedosman-Desktop-apex-appraise/memory/` —
read `loop-log.md` before starting improvement work.
