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
- `packages/mcp-server` — the engine as MCP tools, over stdio. Ten calculation tools that
  need no workspace and three read-only ones that go through `/api/v1` with an org-scoped
  key. Runs from source under `tsx`, as the API does in production; `README.md` there holds
  the client config. NOTHING in it writes, which is why it has no answer to the audit-trail
  question every mutation in this product must answer — a write tool writes an audit event
  or it does not ship.

## Commands

- `pnpm install && pnpm db:push && pnpm seed && pnpm dev` — full local start.
- `pnpm --filter @apex/appraisal-engine test` — engine tests (289; golden Bournemouth fixture
  locked to the penny — GDV £4,278,000, residual £406,711.36, PoC 25%).
- `cd apps/api && npx vitest run` — API tests (900). See the container gotcha below before
  trusting a green run.
- `cd apps/web && npx vitest run` — web unit tests (200): the pure decision modules in
  `src/lib` (words, report-dates, valuation-confidence, situation, oneEngine, exportXlsx,
  firm-day, read-only, drawn-basis, approval-check, pack-pagination, valuer, auto-defaults, working-deal, starting-income, region, uk-regions) plus the `no-raw-hex`, `asset-classes`, `hooks-order`, `route-reachable`,
  `accessible-names`, `icon-tables` and `page-title` sweeps. The suite runs under `TZ=America/New_York` on purpose (`vite.config.ts` says
  why): in UTC or London a test asserting "30 June" passes whether or not the code pins a
  zone, so the guard would be decoration.
  A judgement worth testing at its boundaries gets lifted out of the component that cannot be.
- `cd apps/web && npx playwright test` — e2e (167, incl. a both-theme WCAG contrast sweep; needs web 5273 + api 4100 running).
- `pnpm --filter @apex/mcp-server test` — MCP server tests (17), driven over a real
  in-memory transport with a real client rather than by calling the handlers: what can be
  wrong is the WIRING — a schema that will not accept what a model would sensibly send, a
  result the SDK refuses. One case appraises the golden Bournemouth fixture through the
  server and asserts every headline figure against calling the engine directly, which is
  the claim the whole package rests on.
- `cd apps/web && npx tsc --noEmit` — web typecheck (strict, noUnusedLocals).
- `JWT_SECRET=x POSTGRES_PASSWORD=x docker compose up -d --build` — production stack: nginx :8080 →
  api → Postgres 18. Only :8080 is published outside; api and db bind to loopback.

Logins (seed): `arthur@apexappraise.co.uk` / `demo`; also investor@demo.co.uk, buyer@demo.co.uk.

## Non-negotiables (from the handoff spec)

- The LLM NEVER computes financials — it extracts inputs only; the deterministic engine
  computes. This is also what `packages/mcp-server` is FOR rather than a caveat on it: the
  easy MCP server hands a model figures and lets it do the arithmetic, so that one exposes
  the engine's own entry points and says so in its server instructions, which the tests pin.
- One shared calculation engine for every surface (screen, export, report, portal).
- UK conventions: £, RICS, SDLT, CIL, GIA/NIA, en-GB dates. A firm outside the UK can change
  the WORDS and the UNIT — nothing else. `@apex/types/regions` holds a profile per region
  (GB/US/AU): yield ↔ cap rate, GDV ↔ gross sellout ↔ GRV, net rent ↔ NOI, SDLT ↔ transfer tax
  ↔ stamp duty, CIL ↔ impact fees ↔ developer contributions, and ft² ↔ m². It is stored on
  `OrgPolicy.region` and read through `web/src/lib/region.ts` (`useUnits()`); the conversion
  itself is the engine's (`areaIn`/`ratePerAreaIn`/`formatArea`/`formatRatePerArea` in
  `format.ts`, over the one `SQFT_PER_SQM` the CIL charge uses). Money NEVER changes — every
  figure is in pounds in every region — and neither does any arithmetic. Two things a region
  cannot claim, and both are asserted: `landTaxModelled` is true only for GB, because
  `sdltCommercial` is England & NI statute and a UK-band figure must not print under a local
  name; and `redBook` is true only for GB. In square feet every conversion is the identity
  with no rounding, so a British firm's stored figures and printed strings are untouched.
  NOT localised, deliberately: the marketing site (`Landing.tsx`), the sample planning notice
  in `AutoAppraisal.tsx`, and the server-drafted narrative — that text is written by the model
  under a UK prompt, and localising it is a change to `drafter`, not to a label.
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
  ENFORCED by `web/src/lib/no-raw-hex.test.ts`, which walks every component and route and
  fails naming each raw literal; the five printed documents are its only exemption, and it
  asserts each still carries hex so the list cannot go stale. Measured before it existed:
  205 literals in 29 files, and dark mode is LIVE (`main.tsx` applies the OS preference), so
  the brand green stroked into icons was drawn at 1.84:1 on dark surfaces. Ink on a themed
  surface is `brandInk`/`neutral.*` (theme-aware); a fill carrying white is the fixed `brand`
  ramp with `onFill` on it; a surface that does not theme (a marketing mock, the phone frame,
  Stripe's form, a Leaflet popup) takes its pair from `fixed`.
- Typefaces are SELF-HOSTED (`apps/web/public/fonts`, `@font-face` in `src/index.css`) — never
  re-add a Google Fonts `<link>`. A signed valuation is printed server-side, the field app has to
  render offline, and the privacy notice says "Nobody else"; `e2e/typography.spec.ts` enforces it.
- NOTHING is loaded from a third party by the browser — typefaces, icons, scripts and map
  tiles are all served by this app; open data and tiles are fetched server-side. The only
  exception is Stripe's payment form, which must see a card number. `e2e/third-party.spec.ts`
  fails the build if a page contacts anyone else.
- Provenance on every figure (extraction citations, audit events).
- A report names a valuer ONLY from saved terms of engagement (`web/src/lib/valuer.ts`).
  `engagement.get` answers an unsaved draft prefilled with the signed-in user and the firm's
  house registration text, and reading the valuer off that named a different valuer for each
  person who opened the page. Measured: 8 of 12 deals on the demo workspace.
- The benchmark pool files evidence by REGION, and a figure filed under the wrong one is a
  wrong number in another firm's appraisal — the medians are shared. `@apex/types/uk-regions`
  is the one table (name, UKHPI slug, postcode areas) and every function in it answers null
  rather than guessing, which is the rule `postcodeArea()` in the engine has always followed.
  A deal that cannot be placed contributes NOTHING and the skip is written to the audit
  trail. Straddling postcode areas (KT, EN, PE, SY, CH, HP…) are left out of the table on
  purpose: a fuller table bought by assigning them a side would file real schemes wrongly.
- A portal never offers a document it cannot open: sharing is a flag on the DOCUMENT
  (`buyerVisible` per plot, `investorVisible` per deal), and every portal link is the data
  room's file URL signed for the viewer. `Investor.documents` (a JSON list of names with no
  file behind any of them) is gone.

## Mechanical guards (whole-codebase sweeps)

Each of these walks the REAL router or schema rather than a hand-kept list, because each
was written after the same defect was found and fixed by hand several times over. Adding a
procedure or a model without satisfying them fails CI with a message naming yours — that is
the point, so read the failure rather than adding an exemption.

- `reachable` — every declared procedure/scope/feature/webhook has something that can reach it.
- `route-reachable` (in the WEB suite) — every screen has a door. The API has had
  `reachable` for a while ("an unreachable procedure is not dead code, it is a capability we
  believe we have") and the browser had no equivalent, so the same defect was free to happen
  one layer up — and had. `/portfolio/pack` and `/docs/api` were complete, tested, working
  screens that NOTHING linked to; every one of the funding pack's five e2e specs opens it
  with `page.goto`, which is the tell. Half this app's navigation is TABLE-driven
  (`GLOBAL_NAV`, `TOOLS`, the Hub grid), so the sweep matches path-shaped literals anywhere
  rather than only `to=`/`href=` — a JSX-attribute matcher called nine reachable routes
  orphans. Comments are stripped FIRST, found by mutation: removing the one real link to
  `/docs/api` left the sweep green because the comment explaining the link still spelled the
  path, and a route whose only mention is prose about the route is exactly an unreachable one.
- `accessible-names` (WEB suite) — every control a person types into says what it is for. A
  `placeholder` is NOT a name: it disappears the moment somebody types and fails WCAG 4.1.2
  on its own, so a form that reads perfectly to a sighted user can be a row of unlabelled
  boxes to a screen reader. Eleven were, among them BOTH pickers on Benchmarking, which
  announced as "combo box" twice with nothing to say which was region and which asset class.
  The matcher took three passes and the two it failed are recorded in it: 48 flagged while
  counting a `<select>` in a JSDoc comment and every control inside a plain `<label>`; 29
  while still missing `htmlFor={`…`}` backticks and wrapper COMPONENTS that render the label;
  eleven real. `LABEL_WRAPPERS` is verified rather than trusted — EVERY declaration of each
  must render a `<label>`, because `Field` is declared twice and a tree-wide search left the
  test green on the strength of the other one. Also says what it does NOT prove: removing
  backtick support survives, because `htmlFor` and `id` are always written in the same style
  at a site and so still pair up whatever is captured.
- `crud-completeness` — what a firm can create, a firm can remove. Measured across the whole
  router: FIVE entities had a create-shaped mutation and nothing that removed one —
  comparables, scenarios, photos, tasks and deals — while `sales` and `investors` beside them
  already had `deleteUnit`, `deleteTenancy`, `delete`, `removeHolding` and `deleteCashflow`,
  so deleting properly is this product's own convention and those five were omissions. What
  made them matter is what the only alternative WAS: a comparable could be withdrawn only by
  overwriting it with a different property, while the row went on carrying weight in the
  supported £/ft²; a task could be retired only by ticking it, which claims the work
  happened. `deals` stays exempt ON PURPOSE and the exemption says why — it is the root of
  everything else and one carrying a signed valuation is a professional record, so archive
  vs delete vs refuse-once-approved is the firm's decision, not this sweep's.
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
- `asset-classes` (in the WEB suite, `lib/asset-classes.test.ts`) — the browser keeps no
  second copy of the asset taxonomy. `@apex/types/asset-classes` is the one table: code,
  label, chip text, report label, planning use class, colour family, whether the class is
  income-led, and the rent roll it starts from. Before it existed the four asset types were
  written out in FIVE places that already disagreed ("Mixed use" on one screen, "Mixed-use"
  on three), plus four screens with no table at all that carved a label out of the stored
  code — `assetType.replace('_', '-')`, which reads acceptably for the codes it was written
  against and for nothing else. Adding the operated classes (build-to-rent, student,
  co-living, care homes, hotels) was nine edits; it is now one. The sweep walks the web tree
  AND `packages/ui-tokens/src`, because the chip-colour table lived THERE keyed by asset code
  and is the copy nobody would think to look for. Two rules: no file names more than one
  asset code (one is a default, two is a table), and no file carves a label out of
  `assetType`. A code counts quoted OR as a bare object key — three of the five tables used
  bare keys, so a quoted-string matcher would have passed over most of what it was written to
  find. Run against the commit before this one it names all five tables and all four label
  sites unaided. NOT reached, and said out loud in the test: a label carved out of a
  PARAMETER (`AssetTag`'s `type.replace(...)`) is invisible to a static matcher, because the
  parameter is named `type` and so is every other one — a third such site needs its own rule
  rather than this one loosened into matching `.replace('_'` everywhere, which deal stages
  would trip on every screen.
- `hooks-order` (web suite) — no React hook below an early return. React matches hooks
  between renders BY POSITION, so a component that returns a spinner while its data loads
  and calls a hook two hundred lines below calls a different number of hooks on its second
  render than its first: React throws and the component renders as nothing. Measured —
  `useUnits()` was added to `RedBookReport` beside the value that first uses it, which is
  below the spinner AND below the refusal for a deal with nothing to value; twenty-one e2e
  specs went red at once, every Red Book spec there is. Neither typecheck sees it and
  neither can: `pnpm --filter @apex/web lint` IS `tsc --noEmit`, and hook order is not a
  type. The usual answer is `eslint-plugin-react-hooks`; this repo runs no eslint, and one
  rule is cheaper to keep than a linter is to introduce. Narrow on purpose: hook STATEMENTS
  at the top level of a top-level function only — the first matcher allowed anything
  between the indent and the `use` and read `onClick={() => useOption(s)}` inside JSX as a
  hook call. Run against the commit before the fix it names the line and the guard that
  shadows it.
- `page-title` (web suite) — every route the app declares names itself in the tab. Measured
  before it existed: 37 routes, ONE `<title>`, set in `index.html` and never touched. Every
  tab, every entry in the back-button menu, every bookmark and every screen-reader
  announcement on navigation said "Apex Appraise — UK development appraisals, end to end" —
  WCAG 2.4.2 (Page Titled, Level A) failed on 36 of 37 routes, and a valuer with six tabs
  open could tell them apart only by clicking each. The table lives in `lib/page-title.ts`
  and the sweep reads the REAL route table out of `App.tsx` in both directions: a route with
  no title fails, and a title for a route that has gone fails. It also asserts every FULL
  title is distinct, since a table drifting back towards shared names is the same defect
  wearing a table. Two rules the matcher has to get right, both mutation-proven: an exact
  literal beats a pattern that also fits (`/terms` is the terms of service, `/terms/:token`
  is a client signing an engagement), and a `:param` takes exactly one segment. The screens
  a CLIENT reads — both portals and the signing page — carry NO product suffix: a portal
  already shows the firm's mark rather than ours, and the tab was the one place that rule
  had not reached.
- `icon-tables` (web suite) — a glyph table keeps no `Record<string, string>` annotation,
  so the COMPILER checks its keys. The test does not check icon keys itself; it checks that
  the compiler is still allowed to. With the annotation, `ICONS[anythingAtAll]` types as
  `string`, a key that does not exist passes `tsc --noEmit`, and `Icon` calls `.split('|')`
  on `undefined` — which throws inside render, so React unmounts the tree above it and the
  screen goes blank. Measured: a Hub tile naming `pack` with no `pack` entry took the whole
  home screen down and failed twenty-one e2e specs, every one of them at the sign-in
  assertion and none within sight of an icon. Without the annotation the same tile is a
  build error naming the tile. It keys on the VALUES (a quoted string starting with a move
  command), not on the name `ICONS`, because the copy nobody thinks to look for is the one
  called something else. `Icon` itself also tolerates a missing `d` now: the type stops it
  reaching a build, and this stops a missing 18px glyph ever again costing a screen.
- `e2e/reachable.spec.ts` — the doors, CLICKED. `route-reachable` proves a link literal
  exists in the source, which is a weaker claim than it reads as: the commit that added the
  funding-pack tile passed it, and the tile was the crash above. A link in the source is not
  a route a user can reach; these two specs sign in, click, and land.
- `provenance-sweep` — every mutation writes an audit event, statically and behaviourally.
- `approved-immutable` — no procedure edits an approved appraisal in place.
- `lost-update-sweep` — every procedure that updates a held row either takes a stamp
  (`assertUnchanged`) or writes only the keys it was given. Its default check now looks
  INSIDE a nested `patch` object as well as at the top level: a mutant adding `.default('')`
  to one member of `investors.update`'s patch survived the top-level check, because zod
  materialises the key and the "partial" write carries it after all.
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
- `no-query-writes` — a QUERY may not change a row. Two of the sweeps above filter on
  `_def.type === 'mutation'` (`viewer-readonly`, `provenance-sweep`), and so does the
  browser's own guard, so a write placed inside a procedure declared a query is not
  exempted by anyone's judgement — it is never asked about. Measured: `sitePack.get`
  persisted whatever postcode it was passed, so a VIEWER moved a scheme to another
  postcode with zero audit events; `integrations.list` backfilled placeholder rows, so
  three concurrent reads left two Companies House rows and a VIEWER created rows by
  looking. It reads the resolver's own source, not helpers it calls — `opendata-cache`
  writes on behalf of half these queries and a cache fill is a read remembering its
  answer. Audit-trail writes (`recordAudit`, `activityEvent.create`) are stripped before
  matching, with a case pinning that an audit line cannot hide a real write behind it.
- Two more rules live beside it in `query-side-effects.test.ts`, because they ask the same
  kind of question of the same router rather than earning files of their own:
  **the ADMIN check is written in `adminProcedure` and nowhere else** — `trpc.ts` says why
  ("a permission check that exists in several places is one edit away from meaning
  different things in each") and two hand-rolled copies were still sitting in `ops.ts`,
  making that comment untrue; `uploads.ts` keeps its own because it is a raw Fastify route
  on a different chain, which is why the sweep walks the router rather than grepping files.
  And **money leaves the API in POUNDS, from mutations as well as queries** — every `*Out`
  mapper applies `P()` and `toPence` converts back on the way in, but ten mutations returned
  the Prisma row, so `arrears` was "123400" from the write and 1234 from the read. It walks
  the RESPONSE for bigints, because a bigint reaching a client is the defect however the
  resolver produced it. It is a HAND-PICKED fixture, not a router walk, and that showed:
  a mutant returning the raw Holding row from `investors.setHolding` survived it until the
  register's writes were added. A new money-carrying mutation has to be added to it. Note both `upsertUnit` and `upsertTenancy` return from TWO places:
  a fixture that only creates leaves the update path — the one people actually hit —
  untested, which is how two of these mutations first survived.
- `benchmark-feed-sweep` — every path that makes a figure the firm's committed position
  feeds the benchmark pool. The pool used to grow by a Contribute button, one deal at a
  time, and it contributed the CURRENT appraisal whatever its review state — a draft in a
  median other firms read as market evidence. Now approval (`appraisal.review`) contributes
  a version's ratios, completion (`deals.setStage` → COMPLETED) contributes the out-turn
  build £/ft² from certified spend, and opting in backfills, all through `benchmark-feed.ts`,
  which checks consent on every event. The sweep classifies resolvers by what they WRITE:
  the value assigned to `reviewStatus` INSIDE an `update` call, judged in code. Two shapes a
  token match got wrong: `restore` destructures `reviewStatus: _rs` OUT of a snapshot, and a
  lookahead placed after `\s*` backtracked past itself and matched the very literal it was
  written to exclude. It also reads the transpiled resolver, where every literal is
  double-quoted — a classifier matching `'approved'` saw no approval path at all and would
  have passed vacuously. The "finds what it is meant to find" case plants a rogue approver,
  a rogue completer, a submit, and a destructure.
- `approval-pin-sweep` — every path that approves a version pins it: the engine version
  that signed it, a sha256 of the canonical inputs and the headline figures to the penny,
  written in the SAME statement as the status (`approval-pin.ts`). An approved version used
  to carry no record of which engine produced the figures somebody signed, and the reports
  recompute from the inputs in the browser with whatever engine ships today — `compare`'s own
  comment names it: "a cache records what the engine said on the day it was written".
  `appraisal.verifyApproved` re-derives and reports engine, inputs and figures SEPARATELY,
  because each has a different remedy, and both reports print the answer under the
  signature (`lib/approval-check.ts` holds the wording; a bumped engine that still produces
  the same pennies is a verification, not a warning). Shares its classifier with
  `benchmark-feed-sweep` through `test/classifiers.ts`.
- **`ENGINE_VERSION` is fingerprinted** (`packages/appraisal-engine/test/engine.test.ts`): the
  golden fixture's every numeric output, to the penny, hashed against the version constant.
  Change any arithmetic — a rate rule, an SDLT band, a rounding — and the build fails naming
  the new fingerprint; the fix is to bump `ENGINE_VERSION` in `engine.ts` and record the
  fingerprint beside it. That is the moment somebody has to say "figures approved under the
  old version may now differ", which is the point: without it the version on a signed
  valuation would mean nothing. Do NOT update the fingerprint without bumping the version.
- `raw-route-sweep` — the routes that are NOT procedures. Every other sweep here walks
  `appRouter._def.procedures` and is therefore blind to the eighteen raw Fastify routes
  beside them; this one builds a real Fastify instance from the same registrars `main.ts`
  uses and collects routes through `onRoute`, then asks the mutating ones the provenance
  question. It also checks its own import list against `main.ts`, so a new surface of raw
  routes cannot appear unswept. Note what a grep would have missed: three routes whose path
  sits on the line after a generic type parameter, and two more entirely.
- `one-engine-sweep` (in `packages/appraisal-engine/test`) — nothing outside the engine
  re-derives a quantity the engine owns. Its directory list is now CHECKED against the
  repo (`everySourceTree`), because the list was the part that could quietly stop being
  true: add a package, forget to add it here, and the sweep passes over a smaller tree
  while reporting success. `packages/mcp-server` was exactly that case. Deliberately narrow: it matches the specific
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
- An e2e that passes LOCALLY and fails in CI: suspect dev-database drift before the code. The dev
  DB accumulates whatever every past run left behind, and CI seeds fresh. Two real instances, both
  costing a red build or a wrong diagnosis: (a) `integrations.list` used to backfill a row per
  provider, so this DB held a Companies House row that no fresh seed creates — a fix that depended
  on the row NOT existing passed here and failed there; (b) the funding-pack pagination spec failed
  on 152 positions because the demo workspace had grown to 183 deals from years of e2e runs,
  against 11 seeded. `cd apps/api && SEED_FORCE=1 npx tsx prisma/seed.ts` restores a CI-like state
  (plain `seed` REFUSES when organisations already exist, which is the guard working).
- `tsx watch` exits on a top-level throw and does NOT come back on its own — it restarts on the
  next file change. Save a file mid-edit that references an import you have not added yet and the
  API is simply gone, with `vite` still serving: every browser spec then fails at sign-in, which
  reads as a total regression. `curl -sf localhost:4100/health` before diagnosing.
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
- Repo is PUBLIC (github.com/atz1man/apex-appraise) so GitHub Actions runs free. Two things
  follow, both learned from a real instance: (a) a PUBLIC demo (`SEED_DEMO=1`) must hold NO
  billable key — its logins are published here, in the seed and by the login page, so
  anyone who reaches the host is an ADMIN of an ENTERPRISE workspace with every AI feature,
  at 600 req/min and no usage cap; `src/demo-key-guard.ts` warns at boot, and
  `infra/DEMO.md` has the public-vs-private table. (b) commit with the masked GitHub
  noreply address — a real address in commit metadata is one unauthenticated API call away
  and is how sales scrapers get it.

## Session memory

Long-running project state (roadmap, iteration journal, mistake log) lives in this project's
Claude memory: `~/.claude/projects/-Users-ahmedosman-Desktop-apex-appraise/memory/` —
read `loop-log.md` before starting improvement work.
