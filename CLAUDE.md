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
- `pnpm --filter @apex/appraisal-engine test` — engine tests (277; golden Bournemouth fixture
  locked to the penny — GDV £4,278,000, residual £406,711.36, PoC 25%).
- `cd apps/api && npx vitest run` — API tests (755). See the container gotcha below before
  trusting a green run.
- `cd apps/web && npx vitest run` — web unit tests (97): the pure decision modules in
  `src/lib` (words, report-dates, valuation-confidence, situation, oneEngine, exportXlsx,
  firm-day, read-only, drawn-basis). The suite runs under `TZ=America/New_York` on purpose (`vite.config.ts` says
  why): in UTC or London a test asserting "30 June" passes whether or not the code pins a
  zone, so the guard would be decoration.
  A judgement worth testing at its boundaries gets lifted out of the component that cannot be.
- `cd apps/web && npx playwright test` — e2e (141, incl. a both-theme WCAG contrast sweep; needs web 5273 + api 4100 running).
- `cd apps/web && npx tsc --noEmit` — web typecheck (strict, noUnusedLocals).
- `JWT_SECRET=x POSTGRES_PASSWORD=x docker compose up -d --build` — production stack: nginx :8080 →
  api → Postgres 18. Only :8080 is published outside; api and db bind to loopback.

Logins (seed): `arthur@apexappraise.co.uk` / `demo`; also investor@demo.co.uk, buyer@demo.co.uk.

## Non-negotiables (from the handoff spec)

- The LLM NEVER computes financials — it extracts inputs only; the deterministic engine computes.
- One shared calculation engine for every surface (screen, export, report, portal).
- UK conventions: £, RICS, SDLT, CIL, GIA/NIA, en-GB dates.
- Money stored as integer pence in the DB.
- Design tokens only — no raw hex in components (tokens come from `@apex/ui-tokens`) — with one
  deliberate exception: the PRINTED documents (`AppraisalReport`, `RedBookReport`, `TermsDocument`,
  `FundingPack`, `paper.tsx`) hardcode light-paper inks and surfaces on purpose. A signed valuation
  must not change colour because the valuer had dark mode on, so those styles are theme-invariant
  by design and pair a raw ink with its own raw background so they stay legible on any canvas.
  Measured: with the renderer forced to `colorScheme: 'dark'` the app does go dark, and `.a4-page`
  still computes to `rgb(255,255,255)`, with `@media print` forcing the body white too. Do NOT
  "tokenise" these — `e2e/contrast.spec.ts` sweeps the report, Red Book and terms routes in BOTH
  themes and is what proves the exception is safe. Everywhere else the rule is absolute.
- Typefaces are SELF-HOSTED (`apps/web/public/fonts`, `@font-face` in `src/index.css`) — never
  re-add a Google Fonts `<link>`. A signed valuation is printed server-side, the field app has to
  render offline, and the privacy notice says "Nobody else"; `e2e/typography.spec.ts` enforces it.
- NOTHING is loaded from a third party by the browser — typefaces, icons, scripts and map
  tiles are all served by this app; open data and tiles are fetched server-side. The only
  exception is Stripe's payment form, which must see a card number. `e2e/third-party.spec.ts`
  fails the build if a page contacts anyone else.
- Provenance on every figure (extraction citations, audit events).

## Mechanical guards (whole-codebase sweeps)

Each of these walks the REAL router or schema rather than a hand-kept list, because each
was written after the same defect was found and fixed by hand several times over. Adding a
procedure or a model without satisfying them fails CI with a message naming yours — that is
the point, so read the failure rather than adding an exemption.

- `reachable` — every declared procedure/scope/feature/webhook has something that can reach it.
- `cascade` — every model appears in the GDPR delete list and the seed wipe list.
- `isolation-sweep` — every procedure refuses another firm's ids.
- `outbound.ts` (not a sweep, but the same shape of rule) — the ONLY two URLs a customer
  chooses and this server then fetches are a webhook endpoint and an SSO issuer. Both go
  through `assertPublicHttpsUrl`, at the moment they are saved AND at every fetch, because
  DNS moves and an endpoint added before the guard existed was never checked. It refuses
  addresses it can prove are private, over BYTES not text (`::ffff:127.0.0.1`,
  `::ffff:7f00:1` and `2002:7f00:1::` are all loopback). It ALLOWS a name that does not
  resolve — a name with no answer reaches nothing, and refusing here would make the guard
  depend on the machine running it having DNS, which is green on a laptop and red in CI.
  Both fetches also set `redirect: 'manual'`: a checked address stops being the address
  reached the moment a 302 is honoured. NOT closed: DNS rebinding, which needs the
  connection pinned to the checked address and so needs undici as a real dependency.
- `security.ts` batch rule — the rate limiter counts REQUESTS and tRPC batching puts many
  operations in one, so the 10/min `auth` budget was 10 BATCHES/min. Measured: one request
  carrying 60 logins was accepted whole and counted once; at maxParamLength 5000 a single
  request holds ~454. The per-email lockout does NOT cover this — it stops five guesses at
  one account, and this is one password against thousands of accounts, where no lock trips.
  A sensitive procedure may not share a batch. The check sits at `preParsing` ON PURPOSE:
  the limiter answers at onRequest and short-circuits, so a later phase runs only on
  requests it already counted — registration order does not achieve this, an onRequest hook
  added after the limiter (or via `after()`) still runs first.
- `viewer-readonly` — every INTERNAL mutation refuses a VIEWER. The team screen has
  always printed "View" for that role and nothing enforced it: 47 of 87 mutations were
  reachable, including `appraisal.save`, `sales.deleteUnit` and
  `integrations.saveCredentials`. The rule lives in `auth/roles.ts`, called from
  `internalProcedure` AND `internalWriter()` — the upload routes are the third rule to
  need that, so the test drives `internalWriter` directly with a signed token rather
  than testing the predicate it happens to call. The sweep decides each procedure's tier
  by CALLING it as anonymous and as a buyer, never by a list, so procedure 88 is covered;
  and it classifies BEFORE asking the viewer, because the obvious order passes
  vacuously the moment the fix lands (measured: internal=0, leaked=0, green).
  The browser has its own copy of the rule — `web/src/lib/read-only.ts`, wired into the
  tRPC link chain so all 98 mutations refuse locally without 98 edits — and that copy is
  NOT trusted: the same test reads it and asserts its allowlist equals what the real
  router lets a viewer through. `Button writes` greys a control out beforehand; that part
  IS per-site (62 marked), and an unmarked one degrades to the link, not to a hole.
- `provenance-sweep` — every mutation writes an audit event, statically and behaviourally.
- `approved-immutable` — no procedure edits an approved appraisal in place.
- `lost-update-sweep` — every procedure that updates a held row either takes a stamp
  (`assertUnchanged`) or writes only the keys it was given.
- `secrets-at-rest` — after the real procedures have run, the raw tables are searched for
  the plaintext, so the FIFTH credential column cannot land unsealed.
- `mail-limiter-sweep` — every procedure a stranger can make send an email is in
  `SENSITIVE` (the strict rate-limit bucket), and no authenticated one is.
- `ai-disclosure-provenance` — both halves: every declared AI touchpoint has a procedure
  writing its event, AND every call to the Anthropic API sits inside a function some
  touchpoint names (`drafter`), so a new model call cannot be used undisclosed.
- `one-current-read-sweep` — "the current appraisal" is asked once, in
  `current-appraisal.ts`; no other file spells the query out, and a rollup lands on
  the same row a single deal's report does.
- `token-purpose-sweep` — a token minted for a named purpose cannot sign in. It walks the
  real `DownloadKind` union out of the source, so a sixth kind is covered the day it is
  added, and pins the three PDF routes to a render token of their own.
- `raw-route-sweep` — the routes that are NOT procedures. Every other sweep here walks
  `appRouter._def.procedures` and is therefore blind to the eighteen raw Fastify routes
  beside them; this one builds a real Fastify instance from the same registrars `main.ts`
  uses and collects routes through `onRoute`, then asks the mutating ones the provenance
  question. It also checks its own import list against `main.ts`, so a new surface of raw
  routes cannot appear unswept. Note what a grep would have missed: three routes whose path
  sits on the line after a generic type parameter, and two more entirely.
- `one-engine-sweep` (in `packages/appraisal-engine/test`) — nothing outside the engine
  re-derives a quantity the engine owns. Deliberately narrow: it matches the specific
  derived figures that have a house rule and print on more than one surface
  (`reportedMarketValue`, `analysedPsf`, budget-weighted progress), not "money maths" in
  general. The third rule is the first this sweep FOUND rather than confirmed: written
  for the copy in `deals.exposure`, it immediately named a second in `public-api.ts` —
  three implementations of one rule across the cost monitor, the funding pack and a
  customer's own integration. Verified against the source as it stood before the fix,
  where it finds both unaided. Note its matcher reads prose too: a comment writing the
  formula out registers as an offender, so describe the rule in words. Add to its RULES
  when a fourth is found rather than widening the matchers.
- `nullable-figure-sweep` (same directory) — a figure the engine types `number | null`
  is never `??`-defaulted to a number by any consumer. The null IS the engine's answer
  (`rocAtAsking` is null when nobody named an asking price; `projIrr` when the cashflows
  never change sign), and a null must be carried to the point of DISPLAY and shown as
  "N/A" or an em dash, not folded into a figure on its way there. It reads the field list
  out of `types.ts` at run time, so a ninth nullable figure is covered the day it is
  declared — proven by planting one plus a consumer that defaults it. Run against the
  commit before `ad243b2`/`6e164e2` it finds all six lines those two fixed, unaided.
  Narrow on purpose: `<field> ?? <number>` only. It does NOT reach `8b51be4`, where the
  same defect wore a filter (`h.irr > 0` dropping recorded losses), because no static
  matcher separates that from an honest sign test — give a third shape its own rule
  rather than loosening this one.

Several of these carry a "finds what it is meant to be sweeping" case, and any new sweep must:
a sweep over an empty file list passes silently, reporting success for a question it never
asked.

The LLM outputs are guarded the same way, and for the same reason — an instruction in a
prompt is not a guard. `narrative-guard.ts` holds a draft to the figures the engine produced
(`unsupportedFigures`) and to the claims the record supports (`unsupportedClaims`); the
scenario risk commentary is additionally held to the option the ENGINE ranks best
(`unsupportedRecommendation`, in `routers/appraisal.ts` beside the template it falls back
to), since choosing between schemes is a financial conclusion. A
draft failing any of them is discarded for the deterministic template. Note that the test
harness sets no `ANTHROPIC_API_KEY`, so a test calling one of these procedures exercises the
TEMPLATE — the model path has to be driven with a stubbed `fetch`.

## Gotchas (hard-won — do not re-learn)

- Run the e2e suite against a dev stack started with the CI limits:
  `RATE_LIMIT_PER_MIN=5000 AUTH_RATE_LIMIT_PER_MIN=1000 pnpm dev`. Plain `pnpm dev` uses the
  production defaults (600/10) and the suite signs in on every test from one IP, so ~39 specs
  fail on the rate limiter and look like real regressions. CI sets these in the browser job.
- To exercise maps and open-data panels with no route to postcodes.io, seed the geocode straight
  into `OpenDataCache` (key `geocode:BH151JF`, source `postcodes.io`, payload
  `{postcode,latitude,longitude,district,region}`). Leaflet then renders and the Site Pack specs
  pass. Without it those specs fail for the environment, not for the code.
- Rebuild containers before verifying new API procedures (`docker compose up -d --build`) —
  stale images make zod silently strip unknown mutation keys and "succeed" confusingly.
- Run the API suite in the container, not just on the host — `docker compose run --rm --no-deps
  --entrypoint sh api -c 'sed -i "s/postgresql/sqlite/" prisma/schema.prisma && npx prisma generate
  && npx vitest run'`. The image is Node 22 and this Mac is Node 25: `10 ** -4` differs between
  them, which once let the Red Book narrative guard accept a transposed Market Value in
  production while its test was green locally.
- A cloud/sandbox container may carry a DIFFERENT Playwright browser build from the one the
  pinned `@playwright/test` wants (seen: `/opt/pw-browsers` has `chromium_headless_shell-1194`,
  Playwright asks for `-1228`). Every browser spec then dies with "Executable doesn't exist"
  before any test body runs, which reads as a total regression. Point the SUITE at the
  installed binary with `use: { launchOptions: { executablePath:
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' } }` — temporary, NEVER committed. That
  does not fix `reports.ts`, which launches its own browser server-side, so the two PDF specs
  (funding pack, shared report link) still fail with a 501 for the environment, not the code.
  Do not run `playwright install`.
- Playwright: prefer `getByRole(..., {name, exact})`; toasts echoing labels cause strict-mode
  collisions. First e2e run right after a rebuild can race the stack — rerun before diagnosing.
- New Prisma model ⇒ add it to the seed wipe list, or stale rows accumulate across reseeds.
- Editing `schema.prisma` and running `prisma generate` is NOT enough for a running dev stack:
  the SQLite file still lacks the column, so the API throws inside `findUnique` and the failure
  surfaces in whatever procedure happened to read that table. Run `cd apps/api && npx prisma
  db push` too. (The migration is separate again — CI applies it to real Postgres from empty
  and then `migrate diff --exit-code`s against the datamodel.)
- Start the stack from the REPO ROOT. `pnpm dev` inside `apps/web` starts only vite, and the
  browser suite then fails everywhere at once, which reads as a code fault. Also: `pkill -f vite`
  can kill the shell's own process group — check `ps aux | grep -cE '[t]sx|[v]ite'` instead.
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
- Postgres SERIALIZABLE aborts on the POSSIBILITY of a cycle, not a proven one, so two
  transactions that never touched the same row abort each other under load (SQLSTATE 40001,
  Prisma P2034). 40001 means RETRY; reading it as "somebody else won the race" tells a user
  they lost a race nobody entered. Only `appraisal.save`'s first-version path uses
  Serializable, and it goes through `retryOnSerialisationFailure`. Retrying is safe ONLY
  because the deciding read is inside the transaction — a retry takes a fresh snapshot and
  still refuses a genuine winner. SQLite never raises P2034, so tests inject it by wrapping
  `prisma.$transaction` and matching `isolationLevel === 'Serializable'`.
- A mutation-test helper that makes the code loop for ever will HANG the run rather than fail
  it if the injected sleep returns instantly — vitest's timeout never fires because the hot
  loop starves the timers. Make injected sleeps yield (`setImmediate`) so an unbounded loop
  fails on the test timeout instead.
- Undoing a mutation with `git checkout -- <file>` restores HEAD, not the pre-mutation state —
  on a file with uncommitted work it deletes the fix you are testing, and the next mutation runs
  against a file with no guard in it, which reads as a cascade of unrelated failures. Copy the
  good file aside first and restore from that.
- A surviving mutation may mean the TEST is not discriminating rather than the guard being fine.
  Ask which direction actually breaks: a substring match found "Option A" inside "Option A2"
  only when the engine's choice was the SHORTER name, and the test used the longer one.
- A static presence check ("the file mentions `ricsFirmNumber`") passes every mutation when the
  claim appears in three places and only one is unconditional. Delete such a test rather than
  keep it beside a real one — it reads as coverage.
- Repo is PUBLIC (github.com/atz1man/apex-appraise) so GitHub Actions runs free.

## Session memory

Long-running project state (roadmap, iteration journal, mistake log) lives in this project's
Claude memory: `~/.claude/projects/-Users-ahmedosman-Desktop-apex-appraise/memory/` —
read `loop-log.md` before starting improvement work.
