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
- `pnpm --filter @apex/appraisal-engine test` — engine tests (319; golden Bournemouth fixture
  locked to the penny — GDV £4,278,000, residual £406,711.36, PoC 25%).
- `cd apps/api && npx vitest run` — API tests (1250). See the container gotcha below before
  trusting a green run.
- `cd apps/web && npx vitest run` — web unit tests (371): the pure decision modules in
  `src/lib` (words, report-dates, valuation-confidence, situation, oneEngine, exportXlsx,
  firm-day, read-only, drawn-basis, photo-queue, photo-drain, sso-recovery, comp-proximity, approval-check, pack-pagination, pack-relayout, load-failure, valuer, client-contact, landing-claims, upload-failure, auto-defaults, working-deal, starting-income, region, uk-regions, focus-trap, outline, section-name) plus the `no-raw-hex`, `asset-classes`, `hooks-order`, `route-reachable`,
  `accessible-names`, `icon-tables`, `page-title`, `dialogs`, `destructive`, `unsaved`, `announcements`, `symbol-buttons`, `headings`, `screen-heading` and `write-controls` sweeps. The suite runs under `TZ=America/New_York` on purpose (`vite.config.ts` says
  why): in UTC or London a test asserting "30 June" passes whether or not the code pins a
  zone, so the guard would be decoration.
  A judgement worth testing at its boundaries gets lifted out of the component that cannot be.
- `cd apps/web && npx playwright test` — e2e (221, incl. a both-theme WCAG contrast sweep; needs web 5273 + api 4100 running).
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
  fails the build if a page contacts anyone else. This is also why the maps are GOOGLE STATIC
  MAPS and not Google's JavaScript API: the interactive API has to load in the page, phones
  home on its own and may not be proxied, so adopting it would hand Google the IP address of
  every valuer and the coordinates of every site they open. The Static Maps API answers one
  image to one GET, so `apps/api/src/staticmap.ts` fetches it exactly as `tiles.ts` fetches a
  tile — signed with an HMAC over the request path, using a secret decoded from base64url to
  BYTES (signing with the printable form yields a plausible signature Google answers 403 to,
  and a test that only checked a signature was PRESENT passed that mutation). The key and the
  secret never reach a browser; nothing is passed through from the caller's query string,
  because a signed relay is worse than an unsigned one — it looks like ours. With no
  `GOOGLE_MAPS_API_KEY` the route answers 404, `org.mapConfig` advertises `staticMapUrl: null`
  and `SiteMap` falls back to the tile map: that fallback is the DEFAULT path, not the unhappy
  one, since the public demo has no Google account and CI has no key.
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

Release checks are part of the contract too: CI runs the web unit suite, including
its component sweeps. The manual Deploy workflow requires a successful `ci.yml`
push run on main for the exact release commit (`.github/scripts/require-ci.cjs`;
tested with `node --test .github/scripts/require-ci.test.cjs`). An older green
commit or an unfinished run cannot authorise a release. Hand deployments must
check that evidence themselves. The root `.dockerignore` excludes local secrets,
databases and uploads from remote build contexts; never remove those exclusions
to fix a build. Email logs record delivery failures only, never message contents,
recipients or raw SMTP errors (`apps/api/test/email-logging.test.ts`); demo admins
read undelivered messages through the scoped mailbox in Settings.

Subscription access also reconciles from signed Stripe subscription/invoice
webhooks, not only from Settings (`subscription-webhook.test.ts`). Match the
stored customer to exactly one workspace; metadata is not a tenant selector.
Read current Stripe state rather than replaying an event's plan, and return a
failure if reconciliation fails so Stripe retries. The plan update compares the
stored billing fields with the pre-fetch snapshot and writes its audit event in
the same transaction; an overlapping stale response must not replace a newer
plan. Empty workspaces still get an organisation-level audit event. Existing
Stripe endpoints must enable the additional event types listed in `infra/DEPLOY.md`.

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
- **A list of rows this server hands out is ORDERED** (`list-order.test.ts`). Postgres guarantees
  no row order without `ORDER BY`, and under MVCC an UPDATE writes a new tuple — so the row
  somebody just edited physically MOVES. SQLite returns rowid order, which is insertion order and
  stable, so every local run of every suite agreed and nothing noticed. Found by CI, not by
  reading: `cost.list` had no `orderBy`, and `e2e/cost-contractor.spec.ts` — which picks a
  contractor on the first package, reloads and asserts the same select holds it — passed locally
  for months and failed in CI with `Expected: "cmuunz1uu004i…" Received: "cmuunz1ur004c…"`, a
  different package's dropdown, because the one just written had moved. What the test met as a
  selector, a valuer meets as a cost table whose rows jump after every save, on the screen a lender
  pack is built from. Nine more sites had the same shape and TWO of them chose rows rather than
  merely ordering them: `documentBlocks` takes `docs.slice(0, 4)` and `draftRisk` takes
  `rows.slice(0, 3)` of the scenarios — so which three scenarios the AI risk commentary discussed
  was arbitrary, and `unsupportedRecommendation` holds that prose to the option the engine ranks
  best out of exactly those three. Ordered now: comparables (three reads, including the one the
  narrative drafter uses and the one that writes the supported £/ft² onto every unit cap),
  scenarios (two), cost packages, the deal rollup, a deal's investors, the buyer's shared
  documents, and the extraction's document blocks. `id: 'asc'` where there is no better key, which
  is not arbitrary: a Prisma `cuid()` is timestamp-prefixed, so ascending IS insertion order — the
  order SQLite was already showing, so the fix moves nothing on the demo while making Postgres
  deterministic. The rule CANNOT be "every findMany orders", because most build a Map, a sum or a
  count where order is unobservable; so the bar is a written decision, as `provenance-sweep` and
  `lost-update-sweep` use, keyed by `file:model` rather than by line because a line number goes
  stale and an exemption that silently stops matching is worse than none. The call's extent is
  matched by PARENTHESES, not a character window — `upload-failure`'s own first version is the
  standing reminder — with a case pinning that a nested `ids.map(…)` does not end it early.
- **An upload that fails says so** (`web/src/lib/upload-failure.test.ts`). tRPC mutations get this
  free — the link chain toasts a rejection into the live regions `announcements` mounted — but the
  four places this app POSTs a FILE are raw `fetch` calls outside that chain. Three reported a
  failure; the cost monitor's site-photo upload was `if (res.ok) { … }` with no else, so the
  spinner stopped, the caption stayed in the box, no photograph appeared and nothing said why — a
  surveyor on a phone with a dropped connection could not tell a refused upload from a slow one,
  on the log that route's own comment calls "what a disputed valuation of works-in-progress is
  argued from". Three siblings getting it right is what makes the fourth an omission, the same
  argument `destructive` makes about its four unguarded controls. The window is 600 characters of
  CONTENT after the fetch, not of raw text: comments are blanked rather than removed so line
  numbers stay true, and the first version measured those blanks — the paragraph explaining the fix
  sat between the fetch and its `if (!res.ok)` and pushed the check out of range, so the sweep
  reported the very site it was written for. `provenance-sweep`'s helper window was the same
  mistake with a different number; a fixed character count is a guess about how far away the thing
  you are looking for is. NOT PROVEN and said in the test: that the message reaches anybody — a
  `throw` into a swallowing `catch` passes it. The audible channel is `announcements`' business.
- **A panel that reports an analysis has done the analysis** (`web/src/lib/comp-proximity.test.ts`
  + `packages/appraisal-engine/test/geo.test.ts` + a case in `seed-depth.test.ts`). The
  Comparables screen's "Evidence quality" panel — the panel a valuer reads to decide whether the
  evidence supports the rate they are about to sign — printed the row "Comps within 0.8 mi" as
  `{comps.length} / {comps.length}`. Every comparable, always, on every deal. Nothing in this
  repository computed a DISTANCE at all, so a file of evidence twenty miles from the subject read
  as entirely local. It is not a cosmetic figure: proximity is the first thing comparable evidence
  is argued on, the adjustment grid carries a Location column precisely because distance has to be
  priced, and the row sat two inches under a map that already knew which comparables were located
  and said "3 of 5 geolocated" — the screen held the facts, drew them, and asserted something else
  beside them. `distanceMiles` (`engine/geo.ts`) is the engine's for the reason
  `one-engine-sweep` keeps; haversine rather than the law of cosines, which is the same arithmetic
  rearranged and loses precision at exactly the range this is used over, where two comparables on
  the same street must not come back zero. THE JUDGEMENT WITH BOUNDARIES, and why it is a module
  rather than a line in the route: **unknown is not far.** The obvious fix counts the comps inside
  the radius and divides by the total, and that is wrong in the two states where a distance cannot
  be had — a subject with no usable postcode, and a comparable nobody has geocoded. Both come out
  as "0 of 5 within 0.8 mi", which a reader takes as "none of your evidence is local" and which is
  the original defect's mirror image: a confident claim about data that does not exist. Each of
  those states says what it does not know, and a PARTIAL measurement counts over the located
  comparables and NAMES the ones it left out, because dividing by the full count scores an
  ungeocoded comp as distant and dividing by the located ones silently answers about a subset of
  the file. The panel also prints the FURTHEST, which is the figure a valuer is actually looking
  for and the one a ratio hides. Deliberately NOT done: folding any of this into the confidence
  badge beside it — the grid already has `adjLocation`, where the valuer prices location
  themselves, and a product that asks for that judgement and then silently re-scores it has taken
  the same fact into account twice, once without saying so. The DEMO was the same defect one layer
  down: every seeded comparable wrote a distance into its own text ("Sold Apr 2026 · 0.6 mi ·")
  and stored no coordinates, so the honest panel would have read "none of the 4 comparables are
  geolocated" beside a meta claiming a distance, on the one workspace anyone can try. They are
  placed now, from ONE `miles` feeding both the offset and the sentence, through one `offsetFrom`
  that `demo-seed.ts` imports rather than restating (Northgate keeps its hand-written evidence and
  predates the depth seed, which is exactly how two copies of the trigonometry would have got in),
  and `seed-depth.test.ts` measures every one of them back with the engine against the deal's
  cached geocode. That guard found a real one in the writing: a 0.25-mile step puts a comparable
  at 0.55 mi whose text rounds to "0.6", so the step is 0.3 — every distance exact to the decimal
  the meta prints, and the last two outside the radius, so the demo reads "2 / 4" and exercises
  the counting instead of showing another hundred per cent. NOT reachable statically, and said in
  the test: whether a comparable's stored coordinate is the RIGHT building. A distance is checkable
  because it is arithmetic over two points; that the points are the ones the addresses name is a
  geocoding question, and `lat`/`lng` are nullable on purpose because that lookup can fail.
- **A figure the marketing page says this product computes, something computes**
  (`web/src/lib/landing-claims.test.ts`). `Landing.tsx` listed "CIL, S106, SDLT & VAT computed,
  not guessed". Three are true — `cilCharge`, `sdltCommercial`, and S106 as a figure stated in the
  planning agreement and carried into the residual — and nothing anywhere computes VAT; there is
  no VAT in the engine at all. Worse, the appraisal's own tax table said `['VAT', 'Opted —
  neutral']` beside figures the engine HAD computed, which is not a missing figure but a
  substantive professional assertion: it says the scheme has opted to tax and VAT is therefore
  cash-neutral, and for new-build residential — zero-rated, and not capable of being opted — that
  is usually wrong. The row now reads "Not modelled — figures are net of VAT", which is more
  useful than either the claim or silence: it tells the valuer the figures are net and the
  treatment is theirs. NOT modelled on purpose, and the reason is in the code: doing it properly
  means zero-rated new residential, standard-rated commercial, the option to tax, partial
  exemption and the capital goods scheme, and a VAT figure computed wrongly under a signature is
  worse than none. The guard ties each name in that sentence to the engine export that keeps it,
  in both directions — the exports exist, and the sentence names nothing the table covers — so
  putting VAT back needs either a function or a written reason there is none. NOT a general prose
  check and it could not be: no matcher reads a marketing sentence and decides whether the product
  keeps its promise; what it does is make adding a name a two-line change. Its "finds what it is
  meant to find" case runs the same parse over the old sentence and names VAT.
- **A document the extraction cannot read is NAMED, not dropped**
  (`extraction-documents.test.ts`). The data room's upload control said "PDF, DWG, XLSX · up to
  100 MB. Documents feed the AI extraction", and `documentBlocks` handled pdf, png, jpg and jpeg
  — everything else fell through a bare `continue`. A valuer who selected their elemental cost
  plan, the example that control's own placeholder uses ("Elemental cost plan v4.xlsx"), got an
  extraction that had never seen it and nothing saying so; a DWG the same; and a PARTIAL skip read
  as a complete success, because the procedure returned only `documentsRead` and the screen said
  "Generated by AI from 1 document". Two halves. Spreadsheets are READ now, as the text of their
  cells (`exceljs`, dynamically imported so it stays out of the API's startup path — the same rule
  the browser follows), bounded at the first worksheet's first 400 rows and 40 columns, which is a
  DECISION and not a guard: a cost plan's figures are at the top left, and the bound is reported
  when it bites. And every skip carries a reason the caller shows — a DWG says "CAD with no text
  to read — export the sheet as PDF and upload that", because DWG never will be readable and a
  model handed the bytes would invent; a row with no file, a file gone from storage, a workbook
  that will not open and the 20 MB budget each say what happened. The upload copy no longer
  promises DWG feeds extraction (it is still stored and shared). NOT drivable from the browser
  suite, and said in the test: `extract` refuses a document read without `ANTHROPIC_API_KEY`, and
  CI has none — so the API test calls `documentBlocks` directly, which needs no key, and builds
  its fixture workbook with the same library the server reads it back with. Five mutants recorded,
  the silent `continue` among them.
- **A capital call is a demand until somebody says the money arrived**
  (`capital-call-funding.test.ts`). A call was a `Cashflow` row with a due date and nothing
  recorded whether it had been MET, so the investor portal decided by comparing that date to
  today: `openCall` was `date > now` and the statement was `date <= now`, under a comment calling
  that list "money that has moved". On the day a drawdown notice fell due it stopped being an open
  demand and appeared in the LP's own statement as a payment they had made — whether or not they
  had paid a penny. A capital call is a legal demand for cash under the LPA; the firm had nowhere
  to see which were outstanding, and the investor was shown a receipt. `Cashflow.fundedAt` is the
  fact, `investors.fundCashflow` records it BOTH ways (a call marked funded in error is a receipt
  for money that never arrived, and the only alternative was deleting the notice, which loses the
  demand with the mistake), and the date is the SERVER's for the reason `photos.add` gives about
  `takenAt`. The statement dates a funded call by its FUNDING, not its demand: when the cash moved
  is the fact a statement is about, and those are different days whenever an LP pays late. The
  portal shows EVERY outstanding notice, soonest first, each saying due or OVERDUE — it was
  `.find()`, so an LP behind on two tranches was shown one. Two existing tests encoded the old
  rule and one was actively wrong: "drops a notice once its due date has passed, rather than
  showing it overdue for ever" read sensibly against the HARDCODED notice it was written for,
  whose fixed date went stale, and against real data it means an unpaid demand becomes a payment.
  The demo seed marks its two historic drawdowns funded a few days after each fell due; without
  that the demo's paid calls would read as months overdue and drop out of the LP's statement
  altogether. Five mutants recorded, including both halves of the date rule.
- **The field app takes photographs** (`e2e/field-photos.spec.ts`). Its shutter did `photos + 1`: the viewfinder was a static
  gradient (`placeholderGradients.street`) with framing marks drawn over it and a chip reading
  "CAPTURING · KITCHEN", the thumbnails were three more gradients drawn `Math.min(photos, 3)`
  times, and the inspection reached the workbench reporting "12 photos" of a property nobody had
  photographed — on the record `audit.ts` names a lender's credit committee and an RICS review as
  the readers of. `Inspection.rooms`' own schema comment has said `{name, condition, photos[],
  notes}` since the model was written, so the data model always meant the LIST; the app degraded
  it to a tally. The upload route it needed already existed, tenant-checked and audited
  (`POST /uploads/photo` → `SitePhoto`), and the field app was the one surface in the product
  that never called it. `getUserMedia` for the in-app viewfinder with `<input capture>` as the
  fallback, which is not a consolation prize: it is what works when permission is refused, when
  there is no camera and in an embedded web view, it opens the phone's own camera app, and it is
  the path Playwright drives with a real JPEG through the real multipart route. Making `photos` a
  list is only half the fix — a list the server does not CHECK is a nicer-looking tally — so
  `inspections.save` verifies every id against `SitePhoto` on this deal AND this org (two
  independent inputs, `auth/owned.ts`) and refuses the whole save rather than dropping the
  unknown ids, because filing eight of the twelve photographs a surveyor took is the quietest
  possible way to lose evidence. `lib/inspection-photos.ts` held the judgement worth testing at
  its boundaries: a photograph exists for this inspection only once the SERVER holds it, so a
  shot in flight blocks the send (it is seconds away) and a FAILED one does not (a phone with no
  signal must not be able to trap a day's work on the device) — the record then says how many
  photographs it has rather than how many were taken. That file is GONE, folded into
  `lib/photo-queue.ts` by the queue below: with the blob on the device a failure is not a
  dilemma, and what was left of `canSend` once the `failed` state went was `!== 'uploading'`
  against an array nothing could put anything in. Its reasoning survives, in `canSend` and in
  `queueSentence`'s first branch; what went is a module that read as coverage. Old rows carrying `photos: 12` read as an
  empty list and that loses nothing: the count was of photographs never taken. Durable across a
  reload since the queue below; that commit's own caveat ("the blob is in memory, so an unuploaded
  shot is lost if the tab closes") no longer holds.
  The demo seed wrote a count too (`1 + ((r + i) % 3)`) and now files none, which is the truth.
  Two things this turned up: `accessible-names`' comment-stripper read `accept="image/*"` as a
  block-comment opener and blanked everything to the next comment close — it reported a LABELLED
  control, and could have hidden an unlabelled one in the same span; it blanks quoted strings
  first now. And the two new browser specs matched their deal with `.first()` on a name prefix,
  which worked once and then opened a deal left behind by the previous run (measured: three
  photographs on screen, zero `SitePhoto` rows on the deal under test) — they open it by its
  exact unique name.
- **A photograph taken out of signal survives the tab closing** (`photo-queue.test.ts` +
  `photo-drain.test.ts` + `e2e/field-offline.spec.ts`). The camera above held its blob in an
  object URL in React state, and that commit said so rather than papering over it — so a surveyor
  who lost signal in a basement, finished the inspection and closed the tab lost every photograph
  they had taken, silently, on the evidence `audit.ts` names a lender's credit committee and an
  RICS review as the readers of. IndexedDB is the only browser store that holds a Blob
  (`localStorage` takes strings, base64 is a third larger against a 5 MB shared budget, and a
  camera photograph is 2–4 MB), with the in-memory store as the FALLBACK rather than the plan: a
  private window or a full quota loses durability, not the camera. Two things make the queue
  honest rather than merely present, and each is a test file. IT NEVER GIVES UP — no attempt limit
  and no expiry, because a queue that drops a photograph after five tries recreates the defect it
  was built to end, quietly, at the moment the surveyor has stopped watching; it backs off instead
  (0s, 5s, 15s, 1m, 5m, capped at 15m, since a phone retrying every second for an afternoon is a
  flat battery, which loses the photographs by another route), and `backoffFor` is asserted finite
  at every attempt count. And UPLOADED IS NOT FILED — a record stays in the store carrying its
  `photoId` until the inspection NAMES it, because deleting on upload loses the attribution and
  leaves a photograph in the deal's site log with nothing saying which room it is of. `drainOnce`
  runs for EVERY deal (a surveyor who regains signal in the car must not have to open three deals
  to flush them) and the room is written separately, while that inspection is in hand, BY NAME:
  the stored index is positional and the room list is rebuilt from the inspection on every open,
  so an index alone can file a kitchen as a basement, and a room that has gone leaves the
  photograph unattributed rather than attached to whatever now sits at that index.
  `forgetAttributed` is called with the ids the SERVER returned, never with what the screen held,
  because `inspections.save` verifies every id and refuses the whole save if one is unknown.
  The send is held ONLY by an upload in flight, which is seconds and is the one case that
  matters: the server is about to hold the photograph, so a save taken now names an inspection
  short of it and the attribution would wait for a next save the surveyor, being finished, may
  never make. A merely QUEUED photograph does not hold it, and that is the reasoning that
  changed — it used to be "a phone with no signal must not trap a day's work on the device",
  true but a choice between two losses, because the blob was in memory. The in-flight set lives
  in the component and is cleared in a `finally`, since a throw in the uploader would otherwise
  hold the send for the rest of the session on a photograph nothing is doing.
  `bringForward` spends the backoff on the `online` event — the backoff was waiting for exactly
  that, and one that outlives its reason is just a wait — while leaving the attempt COUNT alone,
  so a connection that turns out not to reach this server does not go back to a one-second retry.
  It sets `queuedAt` to `now - backoffFor(attempts)` rather than to 0, which is the correction the
  test made: `queuedAt: 0` is "due now" only because a real clock is thirteen digits. There is no
  Retry button, deliberately — the blob is on the device and the drain is on a timer, so a control
  whose only effect is to ask sooner is furniture. Two defects this turned up: the area checklist
  rendered `{r.photos} ph`, and `photos` is a LIST now, so React concatenated the ids and the row
  read "cmx1…cmx2… ph" — a type cannot see it, since JSX children accept an array of strings; and
  the reassurance that the photograph is safe was only on the VALUATION screen, two taps from the
  dimmed tile it explains; and a WAITING thumbnail was a grey square where the old failed-shot
  tile had shown the photograph, which is how a blurred shot of the floor gets caught. The object
  URLs for those previews are minted and revoked OUTSIDE any `setState` updater — React
  double-invokes those under StrictMode, which leaks one URL per shot or revokes one still on
  screen, and the built app CI drives has no StrictMode to show it — and the chip over the image
  is an OPAQUE band rather than a scrim, because a translucent label's contrast depends on the
  photograph under it, which `e2e/contrast.spec.ts` cannot measure and a surveyor cannot control.
  `photo-store.ts`'s `patch` reads and writes in ONE transaction: a get in its own transaction
  followed by a put in another is a read-modify-write with a gap, and the two writes that land in
  it are `photoId` from a success and `attempts` from a failure. NOT closed and said rather than
  implied: two TABS share the store and could both upload the same record, filing the photograph
  twice — the drain guard is per-tab and a claim needs a lease with an expiry, since a tab that
  dies holding one must not park the photograph for ever. A visible duplicate in the site log is
  the right way round for that to fail. NOT PROVEN by the browser half, and said in the spec: dropping
  `bringForward` passes it (the 20s timer drains the queue anyway, in 24.3s against 6.6s — a
  deadline below the interval would discriminate it only probabilistically), and attributing by
  the stored index passes it too, because the spec's room list has not changed since the
  photograph was taken and so index and name agree. Both are `lib/`'s to prove and both are
  proven there. STILL OPEN: the drain writes an uploaded id into local `rooms` state, so a
  photograph that lands after the inspection was last saved reaches the server on the NEXT save —
  there is no background re-save of an inspection nobody is looking at.
- **A client-facing screen shows no contact detail that is not in the record**
  (`web/src/lib/client-contact.test.ts`). The buyer portal's contact card was typed into the
  page: "Sarah Reeve · Sales progressor — your point of contact through to completion",
  initials SR, `mailto:sales@apexappraise.co.uk`, `tel:+441202555555`. Nobody of that name
  exists; the address is the SOFTWARE VENDOR's rather than the developer's; and 555555 is the
  UK fictional-number range — so a buyer who had reserved a plot and paid a deposit was handed
  a made-up person, an inbox at the wrong company and a number that does not ring, and a
  question about their own house purchase either reached a software firm with no account to
  look up or went nowhere. The INVESTOR portal beside it already did this properly
  (`investors.myContact` — "the real administrator at the managing firm"), so the convention
  existed and this one screen was left with the design mock in it, which is what made it worth
  a rule rather than a fix. `buyer.myUnit` answers the deal's owner, the firm's first
  administrator where a deal has none (`ownerId` is nullable — a real state), and NULL rather
  than a substitute, with the screen saying "contact the developer directly" instead of naming
  somebody. No telephone link at all: nothing in the schema stores a number, and inventing a
  second one is how the first got there. The rule reads `CLIENT_FACING` out of `page-title.ts`
  — the same set that decides which tabs carry no product suffix, for the same reason — so a
  fourth client-facing screen is covered the day it is added, and it keys on `tel:`/`mailto:`
  followed by a LITERAL rather than a `${`, because an address out of the record is the fix and
  not the defect. `Landing.tsx` keeps its own address and should: the marketing page is the
  VENDOR's surface and a firm's client never reads it. NOT reachable statically, and said in
  the test: an invented NAME. "Sarah Reeve" is a string like any other and no matcher separates
  a fabricated person from a label; a contact DETAIL is matchable because its shape is a
  protocol, and in practice the invented person and the invented mailto arrived together.
  The first draft imported `declaredScreens`/`lazyFiles` from `screen-heading.test.ts` and
  re-ran that file's seven tests inside this one; this is the FOURTH local reader of `App.tsx`'s
  route table and that is the convention — what must not be copied is the answer, not the regex.
- **A figure nobody supplied is named as a sample, or it is refused**
  (`invented-figures.test.ts`). `integrations.sync` FABRICATED: with no credentials it wrote a
  comparable at `basePsf: 212` — address "PriceHubble AVM estimate", meta "Automated valuation
  cross-check · 80% confidence band" — onto a valuer's evidence file, in production, with
  nothing in the row marking it invented and nothing in the product distinguishing it from a
  sold price. A comparable's £/ft² is what the supported rate is built from, so that number
  could reach a signed Red Book opinion under somebody's name. `demo-mode.ts` was written for
  exactly this hazard and says so about a sample EXTRACTION; the one place writing a fabricated
  COMPARABLE never called it, and the absence of a credential is not consent — a firm that has
  deployed and not yet pasted an API key is in that state on day one. The rule keys on a
  money-shaped field assigned a LITERAL, excluding `0` (a cost package opening at `spent: 0`
  invents nothing: a scheme that has not started has spent nothing, and without the exclusion
  the two cost procedures are permanent false positives, which is how a sweep's list stops
  being read). Two sanctions, both earned: behind `demoFallbacksAllowed()`, which is a DECISION
  the deployment took, or written into rows that say SAMPLE in their own text — `org.loadSampleDeal`
  is the second, a button that says sample writing a deal called "Sample — Kingfisher Wharf".
  The Land Registry fallback is gated now and marked in the ADDRESS as well as the meta, because
  the address is the column a comparables table leads with and "· demo" at the end of a meta
  string is not a mark anything checks. EPC's branch is GONE rather than gated: it created a
  Document row for a certificate PDF with `sizeBytes: 180_000n` and no file behind it, which is
  "a portal never offers a document it cannot open" one layer up, and the records are live on
  the site pack anyway.
- **A green dot is a claim about a capability, so `integrations.connect` refuses what this
  server cannot contact.** It was an upsert setting `status: 'CONNECTED'` and
  `lastSync: new Date()` for ANY of the ten provider names, with no credential and no handshake
  — so the Integrations screen, whose whole purpose is to tell a paying customer what works,
  read "Connected · Synced just now" for four providers nothing in this codebase can talk to,
  and the demo seed marked Ordnance Survey CONNECTED on the one workspace anyone can try.
  `@apex/types`'s `INTEGRATION_CONNECTORS` is the one table, read by the server and the screen:
  `connects` with the auth kind and what it FEEDS, or `instead` naming what does the job — and
  `instead` is not consolation copy, because a dead end with no alternative is worse than the
  false claim it replaces and in every case this product already does the job (its own
  comparables for an AVM, Benchmarking's completed-scheme medians for BCIS, `engagement.sign`
  for DocuSign, this server's own tile proxy for OS). Five providers are real and were already
  built, just never wired to a card: PPD (`fetchSoldPrices`), EPC (`fetchEpc`),
  Companies House, planning.data.gov.uk (`fetchConstraints`) and the Environment Agency's
  flood-monitoring (`fetchFloodWarnings`). The "Planning Portal" CARD is renamed to Planning
  data and its description corrected — it promised application history and decision notices,
  which is the commercial submission service, while the connector answers designations and
  constraints; the DB value keeps its old spelling because rows carry it. A card with no
  connector renders NO button, whatever a leftover row says, because a control that exists to
  be rejected is worse than no control. `e2e/integration-honesty.spec.ts` is the half that
  counts what is rendered, in both directions on the same screen. Two existing cases in
  `query-side-effects.test.ts` drove `connect('Ordnance Survey')` and `connect('BCIS')`; their
  premise is the missing ROW, not the provider, so they drive a connectable one now.
- **A plan switch billed the firm twice, and there was no way to leave.** "Switch plan" called
  `billing.checkout`, which opens a Stripe Checkout session in `mode: subscription` — so Stripe
  did exactly what it was asked and created ANOTHER subscription against the same customer,
  cancelling nothing. A firm moving STARTER → GROWTH paid for both every month, this product
  showed one CURRENT chip, and `billing.sync` ran the workspace at `data.find(s => s.status ===
  'active')` — whichever one Stripe happened to list first. The only sign of it was a card
  statement. `billing.changePlan` updates the existing subscription ITEM's price instead, which
  is also the only way to get proration right (Stripe credits the unused part of the old plan;
  two subscriptions bill in full), and withdraws a scheduled cancellation because choosing a
  plan is a statement of intent to keep paying. And there was no CANCEL at all, while the Terms
  a customer accepts say the subscription can be cancelled at any time: leaving meant asking us
  to do it in the Stripe dashboard, and `org.deleteWorkspace` — the GDPR erasure — was the only
  thing in the app that stopped the billing, by destroying the firm's records to do it.
  `billing.cancelPlan` cancels at the END of the paid period (the period is paid for; cutting
  the features off on the spot takes away what the firm has bought and leaves the refund
  question to be answered by hand) and `billing.resumePlan` withdraws it, because until the
  date arrives nothing has happened. TWO procedures rather than one taking a boolean, and the
  reason is the web sweep: `destructive` reads a verb out of the procedure NAME, so a single
  `cancelPlan({ cancel })` made the undo button read as a cancellation that asked nobody — a
  name carrying the direction needs no matcher cleverness to read an argument, and
  `benchmarks.optIn`/`optOut` is the same shape already. `cancel` joined `remove|delete` in
  `DESTRUCTIVE_BINDING` at the same time, because the sharpest thing this product can be asked
  to end destroys no row at all. The sync body is now `reconcileSubscription`
  (`apps/api/src/billing.ts`), shared by all four procedures for the reason `trpc.ts` gives
  about a rule written in several places, and it leaves the plan ALONE on SEVERAL live
  subscriptions exactly as it already did on one it cannot identify — recording
  "subscription needs attention" in the trail, which is the one outcome where nothing changes
  BECAUSE something is wrong and a reader has nowhere else to find out. The Stripe stub in
  `plan-change.test.ts` ROUTES BY PATH on purpose: a stub answering everything alike passes
  whether a switch updates a subscription or opens a second one, which is the whole claim.
  `provenance-sweep`'s helper window had to grow with this — it read 1500 characters from the
  declaration, and `reconcileSubscription`'s `activityEvent.create` sits past that, so it
  reported a helper that records perfectly well as not recording. It reads to the next
  top-level declaration now.
- **A row this server parks on its own, a person can unpark** (`webhook-resume.test.ts`).
  `drainWebhooks` sets `active: false` on a webhook endpoint after `FAILURE_LIMIT` = 20
  consecutive failures, and only live endpoints are dispatched to. Nothing set it back:
  `active: true` appeared exactly once in this server, as the column default. The only way out
  was Remove and Add again, and that mints a NEW signing secret — a receiver down for an
  afternoon needed a deployment before it could verify a signature again, and a customer whose
  server came back up had no way to say so. `org.resumeWebhook` clears the failure count WITH
  the flag (resuming on twenty parks it again on the first delivery, which is a button that
  appears to work and does nothing) and re-checks the URL through `assertPublicHttpsUrl`,
  because `outbound.ts`'s rule is that DNS moves and a resume is the act of pointing this
  server at that address again. Two things the same defect hid: the PANEL showed neither
  `active` nor `lastAttemptAt` though `org.webhooks` had always selected both, so a parked
  endpoint was indistinguishable from a working one on the only screen about it; and the
  parking never fired for the commonest failure, because the HTTP path stamped the endpoint row
  and the `catch` path (refused connection, DNS gone, timeout — "the likelier failure of the
  two", says the file's own comment) updated the delivery and left the endpoint untouched, so a
  receiver that answered badly was parked and one whose host had vanished was posted to for
  ever with `failureCount` at zero. Both paths go through `recordAttempt` now, which keeps the
  atomic increment because two processes drain at once. The sweep is NARROW on purpose and the
  narrowness is the rule: a flag a PERSON sets is not its business — `revokedAt` is one-way by
  design and `enforced` is a one-way door guarded on its own terms — what needs an undo is a
  flag flipped AGAINST a customer without being asked. Each matcher is verified over planted
  source, including the two shapes that give a confident wrong answer: a comment spelling the
  parking rule out, and a second model in the same file (a write takes its nearest binding, as
  `destructive` learned). No e2e: parking needs twenty failures or a direct row write, neither
  of which a browser can do, so the API test is where the claim lives.
- **Enforcing single sign-on is a one-way door, so it cannot be opened onto a connection
  nobody has walked through.** `enforced` makes `auth.login` refuse EVERY password in the
  workspace, and `requestPasswordReset` deliberately issues no token to a firm that does not
  use passwords — so turning it back off needs `org.saveSso` or `org.deleteSso`, both
  `adminProcedure`, reachable only by an admin who can sign IN, which by then means only
  through the identity provider. A wrong issuer, a wrong client id or an IdP that is simply
  down locked a firm out of its own workspace PERMANENTLY, and nothing stopped an
  administrator arriving there in one save on a configuration nobody had tested. `a9cbb50`
  found the lockout and answered it with the optimistic stamp, which stops a SECOND admin
  restoring the switch — not a first admin setting it. The precondition is `lastLoginAt`,
  stamped by the SSO callback the moment a sign-in resolves to a user: exactly "has this ever
  worked", already stored, already shown in the panel, so no new state. The control is not
  widened — the door still refuses every password once locked; you cannot lock it until it has
  been opened once with the new key. Only the TRANSITION is guarded, because refusing a domain
  edit on an already-enforced connection would refuse it for a condition the firm is already
  living in. The panel disables the switch and says why, rather than letting the save be
  rejected. That is PREVENTION, and it was never going to be the whole answer — see the
  recovery path below.
- **A firm locked out by its own identity provider can get back in**
  (`sso-recovery.test.ts` + `web/src/lib/sso-recovery.test.ts` + `e2e/sso-recovery.spec.ts`).
  The precondition above stops a firm ARRIVING at a lockout on a configuration nobody has
  tested. Three causes it cannot touch, because each happens AFTER the save: the issuer or
  client id is edited on an already-enforced connection; the signing certificate expires; the
  provider is simply down. No precondition can help with any of them — an IdP that worked this
  morning passes every check there is, and an issuer edit is indistinguishable from a
  legitimate migration — so the answer is a RECOVERY path, and until this landed the answer
  was the platform operator editing `enforced` in the database, which is not a product but a
  phone number. Enforcing SSO now mints ten single-use break-glass codes, returned ONCE in the
  save's own response and stored only as SHA-256 digests; `auth.recoveryLogin` spends one to
  sign an admin in without the identity provider. The shape is the one every identity product
  settles on and each reason is load-bearing: it depends on nothing of the provider's (a
  digest in this server's own table, no network call); it is WRITTEN DOWN, which is why codes
  are short and typable and why they live outside the workspace they unlock rather than in it;
  and spending one grants a SESSION and nothing more — clearing `enforced` automatically would
  make one leaked code a silent way to switch a security control off. Three conditions on the
  door, all three asserted: only a workspace that ENFORCES SSO (where passwords work there is
  nothing to recover from, and a code that signed in anyway would be a second credential path
  for every firm in the product), only an ADMIN (the point of getting in is `org.saveSso` or
  `org.deleteSso`, so a code that signs in an analyst fixes nothing and widens what one leaked
  sheet is worth), and single use, spent in the SAME statement that authenticates —
  `updateMany` with `usedAt: null` in the WHERE, which is the compare-and-set two concurrent
  requests need. ONE refusal message for all four failures (unknown address, unenforced
  workspace, wrong role, wrong code), or this is an oracle for which firms enforce SSO and who
  their administrators are. The spent row is KEPT with `usedAt`/`usedById`, because "an admin
  signed in with a break-glass code on the 4th" is what a security review asks about and a
  deleted row answers nothing; every admin is MAILED on a success, since a break-glass sign-in
  nobody is told about is a backdoor, and only on success, or the endpoint is a way to mail a
  firm's administrators as fast as the limiter allows. `normaliseRecoveryCode` is the judgement
  with boundaries and the reason it matters is WHEN it runs: the moment a firm is locked out,
  where a correct code refused for a transcription error is indistinguishable from a code that
  does not work — so case, the group dash, spaces and stray punctuation are all undone, and
  O→0 and I/L→1 are mapped, which is safe only BECAUSE the alphabet excludes those letters.
  `regenerate` joined `remove|delete|cancel` in `DESTRUCTIVE_BINDING` at the same time, one
  step further out than `cancel` went: what it ends is not a row anybody can see but a
  CREDENTIAL that has already left the building, and a mis-click makes every copy of a printed
  sheet worthless with no sign until a sign-in fails weeks later. EIGHT mutants recorded, and
  TWO of them survived at first — both security conditions, both because the TEST was not
  discriminating rather than the guard being fine, which is this repo's own standing warning
  met twice in one sitting. Dropping the `enforced` check passed 28 tests because the case
  meant to cover it passed a made-up literal code, so the refusal came from the wrong code;
  and dropping the `orgId` scope passed because the cross-tenant case left the other firm
  unenforced, so that refusal came from the wrong guard too. A valid code and two ENFORCED
  workspaces are what put each under test. A third, the non-atomic spend, survived because a
  second SEQUENTIAL attempt is refused by `matchRecoveryCode` anyway — the spent row is no
  longer in the list it searches — so the race needed a concurrent case. NOT drivable from the
  browser suite, and said in the spec: reaching the enforced state needs a real handshake with
  a real provider or a direct row write, and a browser can do neither, so the e2e proves
  everything up to the door (codes shown once, never again after a reload, the destructive
  confirm) plus the one thing about the door that IS reachable — that an unenforced workspace
  offers no code field at all. It registers its OWN organisation, and that is not tidiness:
  enforcing SSO on the shared demo workspace would fail every concurrent spec at sign-in,
  including its own cleanup. STILL OPEN: prevention on an EDIT. A changed issuer is still a
  way to break a live connection; what has changed is that it is no longer a lockout. Making
  the edit safe needs verify-before-promote — a pending connection, a test sign-in through it,
  then promotion — which is a larger piece and sidesteps the migration problem rather than
  solving it.
- `comparable-integrity.spec.ts` — the evidence grid's total and range use the
  workspace's rate unit. Missing evidence is not high confidence or a zero value.
  Blur saves are serialized, and Apply waits for them and any remaining edits
  before the API reads the evidence. A failed save leaves edits visible and does
  not apply old figures; editing, adding or removing evidence resets the applied
  confirmation. The browser guard delays and refuses saves without changing the
  shared demo appraisal; its batched mock runs operations concurrently like tRPC.
  Add comp opens a blank evidence form rather than inventing a £220/ft² sale;
  the address, entered rate and source are saved only on submission. Rates convert
  from the workspace unit through the shared unit helper. Unsaved evidence warns
  before navigation. `comparable-entry.test.ts` rejects blank addresses and
  non-positive or non-finite rates at the API, including patches.
- `outbound.ts` (not a sweep, but the same shape of rule) — the ONLY two URLs a customer
  chooses and this server then fetches are a webhook endpoint and an SSO issuer. Both go
  through `assertPublicHttpsUrl`, at the moment they are saved AND at every fetch, because
  DNS moves and an endpoint added before the guard existed was never checked. It refuses
  addresses it can prove are private, over BYTES not text (`::ffff:127.0.0.1`,
  `::ffff:7f00:1` and `2002:7f00:1::` are all loopback). It ALLOWS a name that does not
  resolve — a name with no answer reaches nothing, and refusing here would make the guard
  depend on the machine running it having DNS, which is green on a laptop and red in CI.
  Both fetches also set `redirect: 'manual'`: a checked address stops being the address
  reached the moment a 302 is honoured. `publicHttpsFetch` also uses an undici
  dispatcher whose socket lookup validates the exact addresses it returns, closing
  DNS rebinding without changing Host, TLS SNI or certificate verification. DNS
  failure at connection time fails closed. `outbound-connection.test.ts` drives a
  public preflight followed by private socket resolution through real fetch.
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
  IS per-site, and an unmarked one degrades to the link, not to a hole — but see
  `write-controls` below for what "degrades" looked like from the member's side.
- `write-controls` (WEB suite, `lib/write-controls.test.ts`) — every control that fires a
  mutation a viewer may not run is marked, so it is greyed out with the reason BEFORE it is
  pressed. Measured by walking every route signed in as a VIEWER: no screen failed, the "View
  only" chip was on every one, and 42 of the 110 controls that reach a mutation a viewer may not run were live —
  every destructive one among them. "Advance stage →" on all ten pipeline cards and on the
  overview, every "Remove" on comparables and scenarios, every "Complete task" and "Delete
  task" on the calendar, the appraisal's own Save and the terms' Save. Pressed, "Delete task"
  asked the viewer to confirm and then refused: the confirm was the product's word that the
  action was theirs. Not one of the destructive ones was a `Button` — they are raw icon
  `<button>`s with their own chrome, which the `writes` prop cannot reach, so "per-site
  marking" had no site to go to; `writeAttrs()` (`components/ui.tsx`) is the spread that
  reaches a raw element, placed AFTER its own `disabled` so `isPending` keeps its meaning.
  Exempt by RULE, not by list: a control is left alone when every procedure it fires is in
  `VIEWER_MAY_RUN` (the same file the tRPC link reads) or on a router no member of the firm
  can be a principal for (`buyer`), so the sign-in, reset and own-password forms and the
  client's signature are not reported, and if `auth.changePassword` leaves the allowlist its
  form is reported that day. Two things the matcher had to learn, both recorded in it: a
  control writes if its own attributes call `.mutate(` OR name a handler declared in the same
  file whose body does — "Add comp" calls `addComp`, three lines above `upsert.mutate` — and
  the handler's indent is captured as spaces and tabs, not `\s*`, because under the multiline
  flag `\s*` swallows the blank line above a declaration, the body scan ends on the
  declaration's own line, and the real "Add comp" and "Log week" read as clean while the
  viewer walk still listed them live. A `<form>` is judged by its `type="submit"` control,
  since the handler sits on the form and the person presses the button. Run against the tree
  before the fix it names 29 unaided (42 once the indent was right); `e2e/viewer.spec.ts` is
  the browser half — a member invited through `org.invite` signs in with the temporary
  password, and any dialog fails the test, because a disabled control opens none. NOT reached,
  on purpose: a control that OPENS a form (New deal, Edit details, Upload) stays live, because
  the form's own Save is marked and greying the door as well is a choice, not a rule; and the
  appraisal's inputs stay editable for a viewer, because the engine runs in the browser and
  exploring the figures is exactly what "view" is for — only the Save that would make them the
  firm's position is greyed.
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
- `headings` (web suite) — a screen's heading levels have no gaps, so its outline can be
  navigated. A screen reader's "next heading" and heading list are the main way around an
  unfamiliar page, and an `h1` followed by `h3`s with no `h2` reads as a section missing its
  parent. Measured over the route tree: four screens skipped a level, and the two that matter
  most were CLIENT-facing — the buyer portal and the investor portal each had one `h1` and
  then every section marked `h3`, with no `h2` in the file. Those are the screens read by
  people who do not work at the firm, with nobody to ask how the page is laid out. Every one
  of those headings carried an explicit Tailwind size, so the fix changed tags and could not
  move a pixel. The rule keys on the SET of levels, not their order: `Benchmarking.tsx`
  declares a JSX variable carrying a section heading two hundred lines above the `h1` it
  renders below, and an order-sensitive rule would report that forever. A `<Drawer>` is
  stripped before the page's outline is measured — that is the sweep being wrong and the
  markup right, found when it reported `Investors.tsx`: both its `h4`s sit in a drawer whose
  title the PRIMITIVE renders as `h3`, so the outline a reader traverses inside the
  `aria-modal` dialog is h3 → h4 and the step from the page's `h1` is never taken. NOT PROVEN,
  and found by mutation: putting ONE heading back to `h3` survives, because the file still has
  `h2`s and the levels stay contiguous. The rule catches a MISSING level, not a mis-levelled
  section, and no static rule can catch the second — an `h3` under an `h2` is correct and
  beside one is not, and only the rendered nesting says which. And it CANNOT see the level a
  `Panel` renders: the tag lives in `components/ui.tsx`, at the `level` the caller passes
  (`2 | 3 | 4`, default 3), so a screen built from panels that all pass `level={2}` has no
  literal `<h2` in its file and this sweep's per-file view of it is unchanged. Measured once
  the frame's `h1` was in place: eight screens rendered h1 → h3 with no h2 — Settings fourteen
  times over, the appraisal on every tab, costs, sales, engagement, site pack, workbench,
  investors — every `h3` a panel directly under the page. Those were promoted; the cost
  monitor's "Actions" panel stays 3 because it renders under a real `h2`. Which level is right
  is decided by where the panel SITS in the rendered tree, never by grep, and
  `e2e/headings.spec.ts` proves the order in the browser: every route, each heading at most
  one level below the one before (`lib/outline.ts` holds the predicate). Run before the
  callers were touched it named all eight screens.
- `section-name` (web suite + `e2e/headings.spec.ts`) — a card that shows its name shows it
  to everyone. Every screen here is built from cards and a card's header row carries the
  section's name; whether that name is a HEADING decides whether a screen reader can find
  the section at all. Measured in the browser over every route, once the outline above had
  its levels: THIRTEEN sections showed a name that no heading carried — five on the deal
  overview (the screen a deal opens on), four on Comparables, and one each on the Pipeline
  board, Scenarios, Benchmarking and the appraisal's result panel. On three of those screens
  that was the whole outline below the `h1`, so jumping by heading found the page title and
  then nothing. Every one of them read as a title to a sighted user: `<span
  className="text-[13px] font-semibold">`. `Panel`'s half is the COMPILER's now — `title` is
  typed `string` and the primitive renders the heading at its `level`, so a node title is a
  build error naming the prop, which beats a sweep because it lands before the code runs.
  `titleClassName` is what makes a string enough, and it is not a convenience: those names
  were spans only to carry a size, and putting the same classes ON the heading renders
  identically, while WRAPPING the span in a class-less `h2` does not — the heading takes the
  inherited 14px/21px line box instead of the span's 13px/19.5px, which grew eight header
  rows by a pixel and pushed their screens down. Measured both ways, 64 header boxes
  compared, and the committed version moves none. What no type can see is a card written out
  by hand in a route rather than from the primitive, which three of the thirteen were; that
  is what the browser half is for, and it finds a card's header row by the layout `Panel`
  and the hand-built cards share rather than by "the first text in the card", which would
  report every card whose body opens with a sentence. The one shape that is NOT a missing
  heading is an editable header — the appraisal's phase panels are titled by the field that
  renames the phase, and a heading around a text box names nothing — so `header` is the
  primitive's way out for a row that is not a name, used by that field and by the three rows
  pairing a name with a sentence or a figure, where wrapping everything would fold it all
  into the heading's accessible name. Run against the tree before the fix it names all
  thirteen across six routes unaided.
- `screen-heading` (web suite) — every SCREEN renders an `h1`, its own or the frame's, and
  never both. Measured in the browser, signed in, over every reachable route: 12 of 25
  rendered no `h1` at all — the Pipeline board had no heading of any level, and the Red Book
  valuation (seven sheets) and the client-signed engagement document rendered none either.
  `headings` could not see it and says why: it checks a file's LEVELS have no gap, and a file
  with no headings has no gap; and it deliberately does not demand an `h1` per file, since a
  panel nested in a page is not a page. The missing rule is per SCREEN, so this one reads the
  route table (route → component → file, unwrapping `<Protected …props>`) and checks both
  directions against `FRAME_HEADING` in `page-title.ts`: a screen whose file renders no
  heading must be listed so `PageFrame` supplies one (visually hidden, the tab's name, zero
  pixels); a listed screen must not also render its own. Documents title themselves —
  `PageHead heading` on sheet one, the Red Book's cover subject, `TermsDocument` — because the
  empty funding pack must NOT name itself (a spec pins it). NOT PROVEN statically, and shown
  by a surviving mutant: a presence check cannot see render branches, and `FundingPack.tsx`
  carried an `<h1` in its EMPTY state while the populated pack rendered none. Removing the
  pack's `heading` prop passes this sweep and fails `e2e/headings.spec.ts` on
  `/portfolio/pack` with "Expected 1, Received 0" — the browser walk is the other half, and
  it is the half that counts what is rendered.
- `symbol-buttons` (web suite) — a control whose only label is a symbol has no name.
  `accessible-names` covers what a person TYPES into (`input`, `select`, `textarea`) and says
  nothing about buttons, which had the same defect in disguise: "×" is a text node, so every
  "does this control have text?" check passes it, and a screen reader reads "multiplication
  sign". Three were found BY HAND, one at a time — the drawer's close button (reached from six
  screens), the payment dialog's, and the toast's — which is this repo's threshold for writing
  the rule down. It took two corrections and both are recorded in it, because both produce a
  confident wrong answer rather than an error. The opening tag ends at a brace-depth-zero `>`,
  not the first one: `onClick={() => …}` contains a `>`, and the naive version cut the tag
  through the arrow function, found two of the three known offenders and silently missed the
  toast — the one with an arrow in its handler. And a button whose content interpolates
  anything is skipped, because stripping the expressions leaves the SEPARATOR: a filter chip
  rendering `{f.label} · {count}` reported as a symbol-only name, when the dot was never the
  name but what sat between two of them. Comments become blank LINES rather than vanishing,
  or every offender is named at a line that drifted up by however much prose sat above it.
  Verified against the tree as it stood before the fixes, where it names all three unaided,
  each at its own opening tag.
- `announcements` (web suite) — when this app says something went wrong, it is audible.
  Measured across the whole browser tree: `role="alert"`, `aria-invalid` and
  `aria-describedby` appeared in ZERO files, against seventeen places rendering a refusal in
  red beside the control that caused it. The sharper half is that NINETEEN mutations declare
  `meta: { inlineError: true }`, which suppresses the toast on the explicit grounds that "the
  screen shows the error where it happened" — it showed it in a colour, so for those nineteen
  the red line was not a second channel but the only one. They go through `FormError` now
  (`components/ui.tsx`), and the sweep matches a red `<div>` whose content is an EXPRESSION:
  a message that appeared because something happened. Literal red text is left alone — a
  "Danger zone" heading and an overdue condition in a table are labels, and announcing them
  on render is the noise that teaches people to ignore the channel. The toasts are the other
  half and were subtler: each carried `role="status"`, which LOOKS right and is the
  documented way NOT to be announced, because a live region has to be in the document before
  the message arrives. Two regions are now mounted empty from startup — assertive for errors,
  polite for the rest — since `aria-live` is a property of the REGION, not of the card.
  Comments are stripped before matching, found the same way `route-reachable` found it: the
  assertion that no per-toast `role="status"` remains matched the comment explaining why it
  had been removed.
- `unsaved` (web suite) — a screen that KNOWS its work is unsaved says so before the tab
  closes. Measured before it existed: `beforeunload` appeared nowhere in the source and
  neither did any navigation blocker, while THREE screens track a `dirty` flag and each
  PRINTS it — a button reading "Save appraisal" rather than "Saved". The information was on
  screen and no use was made of it when the work was about to be thrown away: every financial
  input behind a residual, the Market Value opinion that goes on to the Red Book, and the
  terms a client will sign. The rule keys on a TRACKED flag (`const [dirty, setDirty] =
  useState`), which is a distinction and not an exemption — Settings derives a `dirty` by
  comparing one field to the saved organisation name, which is not work, and computes it
  below that panel's loading return where a hook could not go anyway. What `useUnsavedWarning`
  does NOT cover is the commoner case, clicking a link inside the app: `beforeunload` does not
  fire for that, so it is blocked by a document-level click interceptor instead — React
  Router's `useBlocker` needs a data router and this app mounts `<BrowserRouter>`. The
  interceptor was deferred once, on the grounds that Playwright DISMISSES a dialog by default
  and no spec in this suite registers a handler, so any spec that edited one of these screens
  and then clicked away would silently stay put. The audit that claim owed has been run and
  the answer is ZERO: every spec leaves those three screens with `page.goto`, which is a real
  navigation and not a click. The caution was right and the number was cheap — the scan that
  produced it is in the commit, verified against a planted case, and its three over-broad hits
  were all state carried across test boundaries. `shouldInterceptNavigation` holds the
  decision as a pure predicate: everything it refuses is a click that does NOT take the person
  off the screen — a middle click, a ⌘-click, an external URL, a download, the skip link's
  `#page`, a link to the page they are already on — because a product that prompts for nothing
  teaches people to dismiss prompts unread, which disarms it on the one occasion it matters.
  And the tempting alternative — keep the draft, restore it later — is worse
  rather than merely bigger: silently putting a valuer's abandoned inputs back into an
  appraisal means a figure nobody chose to enter can end up under a signature.
- `destructive` (web suite) — nothing this product destroys goes on one click. Measured over
  every `remove`/`delete` mutation the browser calls: 14 controls, FOUR of which fired
  immediately — a customer's webhook endpoint, the firm's single sign-on configuration (and
  `enforced` may mean there is no password to fall back on), an investor's holding in a deal,
  and a capital call or distribution, which is a financial record. What makes those four
  omissions rather than a choice is that the other ten already ask, in three ways the product
  had settled on: `confirm` at row level, arm-then-confirm at panel level (the control appears
  only after another arms it, with a Cancel beside it), and typing the workspace name back,
  used once for the control that ends everything. The matcher recognises all three, and that
  is the whole reason it is trustworthy: a first pass looking only for `confirm(` reported
  eight offenders of which FOUR were properly guarded, and a matcher that finds what it was
  written to look for and calls the rest defects is worse than none, because somebody acts on
  its list. Two more things it had to learn — `confirm` is tested BEFORE the one-line-`if`
  rule, since six row-level sites write `if (confirm(…)) x.mutate(…)` on one line and were
  being reported as typed-name gates; and a call takes the NEAREST binding above it, because
  `settings-integrations.tsx` binds `remove` twice and a name→procedure map reported a webhook
  endpoint as an SSO configuration — the right count under the wrong name, which is the worse
  failure, because somebody reads the name.
- `dialogs` (web suite) — every overlay declares `role="dialog"` and `aria-modal`. Measured
  across the five this app renders: ONE, the marketing page's product tour, did. The
  primitive the PRODUCT uses — `Drawer`, opened from six screens — declared none of it and
  managed no focus at all: opening it left focus on the button now behind the backdrop, the
  first Tab walked out into a page greyed out and unusable, and Escape left focus on `<body>`
  so the next Tab restarted at the top of the document. The payment dialog had no Escape
  either — a card form a keyboard user could not abandon. `useDialog` (in `components/ui.tsx`)
  is the fix for all four at once, and `lib/focus-trap.ts` holds the one decision worth
  testing at its boundaries: which element Tab reaches at the two ends of the ring, and that
  focus OUTSIDE the ring is pulled back in, which is the case a person is actually in when
  they cannot see where their cursor went. The sweep matches a full-viewport fixed element
  with a backdrop, not every `fixed inset-0` — the field app's full-bleed camera view is not
  a dialog, and both directions have a fixture, because an exemption list is how a rule stops
  meaning anything. `e2e/dialogs.spec.ts` is the half that presses Tab.
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
- `e2e/target-size.spec.ts` — every screen fits a phone and every control on it can be hit
  with a thumb: at 390px, no route scrolls sideways, and every control is 24×24 CSS px or
  earns WCAG 2.5.8's own exceptions (a 24px circle centred on it touches no other control;
  a link in running text). Measured before it existed, signed in over every route: SEVEN
  routes scrolled sideways and 134 controls were under 24px — 42 once the exceptions were
  applied, which is the number worth acting on, since a rule that flags spaced checkboxes
  and footer links is a rule people learn to ignore. The 42 were three sites: every task
  chip on the calendar at 21px tall, "Advance stage" on every pipeline card at 15px, and
  the data room's share checkboxes, 16px boxes with a picker hard against them (given
  clearance rather than redrawn, because `nontext-contrast` reads the box's OWN border and a
  redraw would blind that guard). The overflows were three shapes: the automatic-minimum
  gotcha one level UP from where it is usually seen — Calendar and Benchmarking name their
  page-grid columns only from `lg:`, so below it the single implicit column was `auto` and
  each two-column item took its min-content width; the four printed documents, whose A4
  sheet widened the page instead of scrolling inside its frame; and Settings, the subtle
  one — the members table scrolled inside its wrapper as intended, but the sr-only "Remove"
  label inside it is absolutely positioned, and a scroll container that is not itself
  positioned does not contain those, so one 1px span at x=594 widened the page by 204px
  while the table it belonged to scrolled correctly. Found by walking ancestors for a
  scrolling container, not by looking at what was wide. The spec carries a fixture of two
  crowded 20px buttons, one spaced one and an inline link, so an empty walk cannot pass it.
- `e2e/load-failure.spec.ts` — no screen claims the firm has nothing when the truth is it could
  not look. "No comparable evidence yet" and "Nobody is on the register yet" are claims about
  the RECORD, and a screen whose query just failed knows neither. Measured signed in with every
  query answered 500: SIXTEEN empty states across eleven screens asserted it anyway, among them
  "No cost plan on this deal yet" and "No deals at this stage" on all seven pipeline columns —
  a valuer reading any of them goes looking for work that is sitting there unreachable. The
  toast beside them is transient and gone by the time anyone reads the panel, and
  `lib/load-failure.ts` had been written for exactly this conflation: it was wired into three
  screens and nothing else. The failure now lives in `EmptyState` itself rather than in a
  component of its own, because the empty state and the failure answer the same question in the
  same place — and a site that must pass `error` to say "nothing yet" cannot say it without
  having looked. Benchmarking was the other half and was worse: `loading || !M` is true of a
  FAILURE as well as of a load, so the screen span forever — the exact conflation
  `load-failure.ts`'s own comment names about the funding pack, still standing two screens over.
  What the spec had to learn, and the reason it is trusted: the query client retries once
  (`App.tsx`), so for about a second after navigation a refused screen still shows skeletons,
  and the first version's fixed 1200ms sleep landed INSIDE that window — two planted mutants
  both survived. It waits for the failure to become visible instead, and a route where it never
  does is REPORTED rather than passed over, because a walk that cannot see the failure has not
  checked what it claims to. That assertion is what found Benchmarking. Both directions run the
  same matcher on the same screen: a deal of the spec's own making genuinely has no
  comparables, so the claim must be found there, and must be gone the moment the query is
  refused — with Try again, which recovers it once the server answers.
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
- **A stage is correctable, and a scheme that is no longer complete stops contributing.**
  `deals.setStage` has always accepted any stage; both controls in the product computed
  `stageIdx + 1` and clamped at the last, so in practice a stage only ever went FORWARD. A
  mis-click was permanent: the stage stuck, `figureStatus` hardened with it (estimate →
  committed → actual), and arriving at COMPLETED contributed the scheme's certified build
  £/ft² into a pool whose medians other firms read as market evidence. Nothing on the server
  needed changing — there was no way to ask. The overview offers "← Back a stage" now, and
  because that made the state reachable it also made a second defect reachable:
  `retractOutturn` withdraws the out-turn point when a deal leaves COMPLETED, since a
  final-account figure standing for a scheme that has not finished is a wrong number in
  another firm's appraisal and they have no way of knowing. Only the OUT-TURN goes — an
  approved appraisal's three ratios are a statement about a signed valuation, filed at
  approval rather than completion, and a stage correction unsigns nothing. Re-advancing
  re-contributes (`replacePoints` writes rather than appends), so this is a correction and
  not a withdrawal of consent; `benchmarks.optOut` is still what withdraws everything.
  Two things the tests corrected in the writing: CONSTRUCTION hardens to ACTUAL rather than
  COMMITTED, and consent has to be granted BEFORE approval or `feedApproved` files nothing
  and the ratios read as missing.
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
- `seed-depth` (API suite) — every DEMO deal carries what its stage implies. Measured on
  4 September, signed in and walking every deal and every tab with a browser: the demo
  workspace rendered 197 empty states, and 8 of its 11 deals were shells — a name, a stage
  and a headline GDV with no appraisal behind the figure, no comparables, no scenarios, no
  terms, no documents; the scheme marked COMPLETED had never had a cost plan. The marketing
  page promises every one of those and the only workspace anyone can try showed each on ONE
  deal. `demo-seed-depth.ts` fills the eleven in BY STAGE (an appraisal from APPRAISAL,
  units and a cost plan from CONSTRUCTION, a closed-out final account past it), and the
  sweep seeds the throwaway database exactly as `prisma/seed.ts` does and asks each deal for
  its rows, so a twelfth deal added to `SPECS` as a shell fails naming the deal and the
  table. After the fill the same walk rendered 96, every one either stage-appropriate, the
  extraction screen's idle state, or a live open-data panel the host cannot reach. Its
  second rule is the one the seed's own comment first got WRONG: a closed-out cost plan's
  budgets sum to the appraisal's construction cost TO THE PENNY, checked by running the
  engine on the stored row. The first version priced packages over NET area where the
  engine prices over GROSS (net ÷ efficiency), and the cost monitor read a 12% saving nobody
  had earned — 285,840,000 pence against 324,818,182 — under a comment saying "to the
  pound". Three mutants are recorded in it: net-area pricing, the closed-out loop removed,
  and one deal's comparables skipped; each is named. What filling the demo in FOUND, and the
  reason a demo full of shells is a testing defect and not a cosmetic one: a calendar label
  at 3.26:1 in dark mode that only rendered once a task was due this week; a data room
  control at 1.19:1 that only rendered once a deal had plots to share a document with; and
  four e2e specs whose premise was "this seeded deal is a shell", which now make their own
  with `createDeal` — a spec that depends on a seeded deal being empty is a spec that stops
  the demo being filled in.
- `agent-docs` (API suite) — **`AGENTS.md` keeps its promises.** Codex CLI, Copilot and
  Cursor read `AGENTS.md` at the repo root by convention, the way Claude Code reads this
  file, so the moment it exists a second agent's first act here is to believe it — and an
  onboarding document naming a command that does not run, or a guard that no longer
  exists, is worse than none, because the reader stops looking. Same argument
  `security-headers` records about two files claiming a protection nothing enforced.
  `AGENTS.md` deliberately does NOT restate the rules: this file is the one table, and two
  agent documents paraphrasing the same non-negotiables is `trpc.ts`'s own complaint about
  a rule written in several places, in documentation form. What it adds is an INDEX — "if
  you are adding a tRPC procedure, these are the sweeps that will fail you" — plus the
  branch-and-PR protocol for working beside another agent, and the MCP config, because an
  agent that reasons its way to a GDV has broken the LLM-never-computes rule exactly as a
  procedure would. The sweep checks the three CHECKABLE kinds of claim, each of which rots
  differently: a COMMAND (a renamed package script), a GUARD NAME in the index (renamed or
  folded into another file — and the index is precisely where that is invisible, since a
  stale row still reads as authoritative), and a PATH. Writing it found three faults in its
  own prose, which is the point: `e2e/reachable.spec.ts` is not openable from the repo root,
  and the index's right-hand column carried `ENGINE_VERSION` and `data-decorative` — an
  identifier and an attribute, not guards — so that column means one thing now. It also
  found a real defect in `packages/mcp-server/README.md`: the documented root command
  `node --import tsx packages/…` fails with `ERR_MODULE_NOT_FOUND`, because `tsx` is that
  package's own dev dependency and not the workspace root's. Both the filtered form and the
  `npx -y tsx` form an MCP client uses are now driven through a real `initialize` +
  `tools/list` handshake, 13 tools, the npx one from outside the repo. NOT PROVEN, and said
  in the test: that `AGENTS.md` does not DUPLICATE what it points at. No matcher reads two
  documents and decides whether one restates the other; the length check is a proxy that
  would catch a wholesale copy and miss a paraphrased paragraph. Four mutants recorded, one
  per parser.
- `security-headers` (API suite) — the headers the docs said the front door enforced. It
  enforced none: the ONLY `add_header` directives in `nginx.conf.template` were five
  `Cache-Control` lines, with no CSP, no HSTS, no `X-Frame-Options`, no `nosniff` and no
  `Referrer-Policy`, and no helmet equivalent in the API either — while `docker-compose.yml`
  and `README.md` both said "nginx is the front door, and the security headers … are enforced
  there". Two files asserting a protection that does not exist is worse than its absence:
  somebody reading either stops looking. THE RULE is not presence but the nginx footgun that
  makes a careful one-liner useless — `add_header` inside a location REPLACES the inherited
  set rather than adding to it, so a server-level block is dropped by every location that
  sets a header of its own, and the five that do here are `/assets/` (the JS bundle),
  `/fonts/`, the image regex, `/ready` and `location /`, which serves index.html. A block at
  the top alone would have protected every path except the document and its script. So the
  headers live in `infra/security-headers.conf` and every such location re-includes it, the
  way they already re-include `client-ip.conf`; the sweep fails naming any that forgets, and
  removing the include from `location /` names that location unaided. It also demands
  `always` on every line, or the one response served bare is the error page. HSTS is a
  VARIABLE, set only when `X-Forwarded-Proto` is https: compose publishes :8080 over plain
  HTTP and HSTS applies to the host while ignoring the port, so a literal would pin a
  self-hoster's host — or `localhost` — to HTTPS and lock them out of a stack serving none.
  The CSP is served `-Report-Only` ON PURPOSE and the file says why: there is no nginx binary
  and no docker daemon in this environment, so the template is only read as text, and the one
  clause a wrong policy would break is Stripe's injected card form (`loadStripe` pulls a
  script from js.stripe.com at runtime), which no spec opens because a card number should
  reach Stripe and never us. Enforcing a policy whose only untested clause is the one handling
  money is the wrong way round; dropping `-Report-Only` is the whole of the change once a real
  deployment reports nothing. NOT PROVEN, and said in the test: that nginx parses the result,
  or that the policy is right.
- `env-coverage` (API suite) — every variable the server READS can be supplied by the stacks
  that run it. Measured over every `process.env.*` in `apps/api/src`: EIGHT reached neither
  deployment file — `COMPANIES_HOUSE_KEY`, both Xero credentials, all four TrueLayer ones and
  `RESET_TOKEN`. `xero.ts` and `open-banking.ts` read ONLY the environment (no per-org
  credential path as EPC and Companies House have), so `xero.status` and `bank.status`
  answered "not configured on this server" on every deployment however carefully an operator
  had followed `infra/DEPLOY.md`, and the Integrations screen offered two connections that
  could not be made to work by any means. `docker-compose.yml` already recorded this exact
  defect for the TILE_* trio — "setting them did nothing at all" — found by hand and left
  free to happen eight more times; four more (`ENCRYPTION_KEY`, the TILE_* trio) reached
  compose but never the LIVE Fly deployment, where the file's comment is the whole of what an
  operator is told. Same shape as `proxy-coverage` below: a variable and the stack meant to
  supply it are two files nobody diffs. What "accounted for" MEANS differs per stack and is
  written down — compose must carry the key in the api service's `environment:` block, which
  is all that reaches the container; `fly.api.toml` need only name it, since secrets are set
  with `flyctl secrets set` and what the file carries is their documentation, so a variable
  recorded there as deliberately absent (`DEMO_MODE`, whose absence makes production refuse
  to fabricate) counts. The defect is one nobody CONSIDERED, not one somebody decided
  against, so the rule asks for a decision to be written down and cannot judge it.
  `CHROMIUM_PATH` is exempt because the image sets it, verified against `api.Dockerfile`.
  Two bugs this turned up, both caught by guards rather than by hand: compose passes these as
  `${VAR:-}`, which arrives as an EMPTY STRING, so `??` never fires and
  `TRUELAYER_AUTH_BASE ?? 'https://…'` would have called the empty string for TrueLayer's
  hosts — `deployment.test.ts` already held that rule and failed the moment they were
  plumbed; and that guard's own matcher excluded an empty-string fallback with a lookahead
  after `\s*`, which backtracked past itself and reported three already-correct sites (the
  same shape `benchmark-feed-sweep` records). It captures the fallback and judges it now.
- `proxy-coverage` (API suite) — every raw route is reachable THROUGH THE FRONT DOOR: an
  nginx `location` in production and a vite `proxy` entry in development, checked by first
  path segment against the routes collected the way `raw-route-sweep` collects them. Measured
  on 4 September: `/staticmap` was on neither list. Static Maps had merged that morning with a
  route, a signed proxy and tests for the signing and the fallback — and a browser asking the
  public host for `/staticmap?…` got `index.html` as the image. With the key set, the secret
  set and the code deployed, the map could not work, and CI could not see it because CI has
  no key and only walks the tile fallback, which never asks for that path. The Google path
  had never been driven end-to-end anywhere. `location /` is not coverage — it is the SPA
  fallback that answered a 200 over a dead route — and the matcher says so with a fixture.
  It also found vite lacked `/health`, `/ready`, `/webhooks` and `/admin`, all of which nginx
  proxies; the fix was parity, not exemptions.
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
- **The cost plan is DERIVED, and the derivation is the engine's.** `tradeBudgets`
  (`cost-report.ts`) splits the appraisal's build cost across its trades, last package taking
  the rounding residual so the budgets sum to the appraised cost TO THE PENNY rather than
  near it — a plan pennies short reports an overrun nobody earned, on the screen a lender
  pack is built from. It splits the engine's own `build` figure rather than re-multiplying
  rate by area, because `build` already carries the build-cost multiplier and a phased
  scheme's phase builds. Measured before it existed: the arithmetic lived ONLY in
  `demo-seed-depth.ts`, so the demo had a cost plan and a real firm could not produce one —
  `cost.upsertPackage` is the browser's only writer and its single call site is the contractor
  dropdown, which sends no figures, while creating demands a name, a budget and a forecast.
  Outside the seed the only other writer is the Xero sync, so a firm with no accounting
  integration was stopped dead, and the empty state told them to go to the appraisal, which
  creates nothing. Same defect, same file, as `cost.createContractor`. `cost.createPlanFromAppraisal`
  is the way in, the seed goes through the same function so there is one implementation, and
  `e2e/cost-plan.spec.ts` presses the button — because what was missing was a CONTROL, and a
  procedure nobody can reach is a capability the firm does not have. Forecast opens EQUAL to
  budget: a scheme not yet let is forecast at what it was appraised at, so the variance starts
  at zero instead of reading as the whole build saved.
- **A sensitivity grid says something, or it says why it cannot**
  (`sensitivity-structure.test.ts`). Measured in the browser on the demo workspace: the
  appraisal's "Sensitivity — GDV × build" panel showed **23% in all twenty-five cells**, and the
  printed investment report carried a whole page of the same under the heading "Sensitivity —
  profit on cost". The arithmetic was right and the panel was a lie by omission — a valuer reads
  a 5×5 grid of one number as "insensitive to a ten per cent swing in values and costs", which is
  the opposite of what it means. The report was worse than the screen, because its closing
  sentence READ THE SAME TWO NUMBERS: "a +10% build-cost overrun combined with a −10% fall in GDV
  moves the return on cost from 23% to 23%" — a signed document telling a lender that a cost
  overrun and a revenue fall have no effect, with no toggle to escape it as the screen had.
  The cause is structural, not a bug in `sensitivityGrid`. In RESIDUAL mode — the mode every
  appraisal starts in — profit is `gdv × t` and the land takes the remainder, so
  `totalCost = gdv − profit` and RoC ≡ `t / (1 − t)`: the target restated, unmovable by any shock.
  Profit moves with GDV alone, since build cost never enters `gdv × t`. PROFIT mode pins the other
  end — `residualNet` IS `landFixed`, so a grid of it echoes an input back. `sensitivityStructure`
  (the ENGINE, because it is a fact about the engine's own arithmetic: change how a mode solves
  and this must change with it) declares `varies | gdvOnly | pinned` per metric plus the metric to
  open on, and the test checks the declaration against the REAL grid in both directions — a metric
  declared pinned must be constant to the penny, one declared `varies` must move on BOTH axes, and
  one declared `gdvOnly` must move along the columns and not the rows. The identity is asserted
  as algebra at three target rates rather than observed once. The panel now opens on the metric
  the mode can move, follows a mode change until the valuer chooses for themselves, and renders a
  pinned metric as its ONE value with the reason and a way out rather than twenty-five copies.
  Three mutants recorded: the default back to RoC, `gdvOnly` mislabelled `varies`, and the
  histogram off-by-one below. NOT caught by anything that existed: `one-engine-sweep` watches for
  a figure re-derived outside the engine, and this was the engine's own figure displayed in a
  context that made it meaningless. A first version asserted `varies` means 25 distinct values and
  failed on priced-land RoC at 24 — two cells coincide to the penny, which is a coincidence of one
  fixture and not the property being claimed; it asserts both AXES move.
- **The risk panel shows the distribution, not three numbers.** `monteCarlo` ran 400 iterations
  and threw the samples away, and the screen drew P10–P90 as a flat rectangle — which draws every
  distribution identically whatever its tail, and the tail is the question a lender is asking.
  `MonteCarloResult.histogram` is equal-WIDTH bins (equal count would redraw the same rectangle),
  computed in the engine so the screen, the printed report and a customer's integration describe
  one distribution rather than three roundings of it; the samples are not returned, because 400
  figures re-binned at the far end is the same arithmetic twice with two chances to differ. Every
  sample lands in exactly one bin and the counts sum to `iterations`, asserted — a histogram that
  silently drops its own maximum understates the tail, which is the one thing it is read for, so
  the top bin is closed at both ends. A degenerate sample answers ONE bin rather than dividing by
  zero. `ProfitDistribution` (`components/charts.tsx`) is one series, so one hue and no legend;
  the bins wholly at or below zero are a STATUS rather than a second series and carry a sentence
  and a marked zero rule as well as a colour, because a reader who cannot separate the hues must
  still find the losses.
- **The engine is typechecked.** The package where ALL money maths lives was the one package
  nothing ran `tsc` over: `site: { mode: 'fixed' }` sat in its own tests against a `SiteMode` of
  `'residual' | 'profit'`, passing only because an unknown mode falls into the else branch and
  behaves like `'profit'` — so a test named "holds for a fixed land price too" covered a third
  mode that does not exist. `pnpm --filter @apex/appraisal-engine lint` runs in CI before the
  golden tests.
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
- CI drives the BUILT app behind nginx, so `React.StrictMode` is not in play there and a
  defect that only StrictMode's double-invoked mount effect exposes is invisible to a green
  build. One real instance: `PageFrame`'s "is this the first page?" guard was a boolean
  consumed on mount, so in DEV the first invocation spent it and the second focused `#page`
  anyway — putting focus after the skip link on a fresh document and failing WCAG 2.4.1 in
  the half a developer actually uses. Any effect guard that must run once has to survive
  being mounted, torn down and mounted again; key on a VALUE (the pathname it acted for),
  never on a count. Run the browser suite against `pnpm dev` occasionally for exactly this.
- `playwright.config.ts` sets `actionTimeout`/`navigationTimeout` ON PURPOSE. Without them an
  action is bounded only by the TEST's budget, so a timeout names whichever action was in
  flight when the budget expired rather than the one that hung — which is how the funding
  pack's `waitForSelector('.a4-page')` got blamed twice for a spec being slow, and answered
  twice by raising the budget from 90s to 120s. It was not slow (151ms, measured); the pack
  had CRASHED, and React's "Maximum update depth exceeded" reaches a test only as a selector
  that never appears. A `Timeout 20000ms exceeded` now means that action really hung; a
  `Test timeout of Ns exceeded` means the budget went elsewhere. Do not remove them without
  putting something else in the way of that ambiguity.
- A spec that mutates ORG-WIDE state (`org.savePolicy`, and anything else on `OrgPolicy`)
  must undo it in an `afterEach`, not at the end of the test body. Two workers share one
  seeded workspace, so the leak is visible to every spec that follows — and the run that
  leaks is by definition the run that failed, which is the one where trailing statements
  never execute. The covenants spec claimed to be self-cleaning for three such runs.
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
- Do NOT edit an API source file while a browser run is in flight against `pnpm dev`. `tsx
  watch` restarts the API on every save, and a spec whose request lands on the restart reads
  as a product defect: measured, two specs failed in one run — the Red Book printed "No
  appraisal saved yet" on a deal with one, and a shared report link answered 503 — both at
  the minute a mutation test was saving and restoring `demo-seed-depth.ts`. Mutation-test
  API code BEFORE or AFTER the browser suite, never during. The first of those WAS a product
  defect as well as a test artefact: both printed reports read `!appraisal` as "none saved"
  when the query had failed, the conflation `lib/load-failure.ts` was written to end on the
  overview. They go through it now (`data-testid="report-error"`), and `e2e/deal-error.spec.ts`
  refuses `appraisal.getCurrent` on both and asserts the sentence, the kind and the retry.
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
  The same rule bites one level down: importing a VALUE from `@apex/types`'s index pulls the
  index in for real, zod and all, where importing a `type` from it is erased and costs nothing.
  The Integrations screen swapped `type IntegrationProvider` for the connector TABLE and
  `check:bundle` failed naming the route — Integrations grew 60K to 69K, nine-tenths of it
  schemas a settings screen never opens. `plan`, `asset-classes`, `regions`, `uk-regions` and
  now `integrations` are separate entry points for exactly this reason; put a browser-read table
  in its own module rather than raising the baseline.
- Prisma on alpine needs `apk add openssl` before generate; web image needs tsconfig.base.json
  copied and `prisma generate` run.
- Docker CLI in sandboxed shells: `export PATH="$PATH:/Applications/Docker.app/Contents/Resources/bin"`.
- Overpass API requires a User-Agent header (406 without).
- Flex children default `min-width:auto` — clusters need `min-w-0` (+ internal `overflow-x-auto`)
  or they widen the page on phones; e2e guards zero horizontal scroll at 390px.
  The same gotcha one level up: a page grid that names its columns only from `lg:` has a
  single `auto` implicit column below it, and every item takes its min-content width. Give
  it `grid-cols-[minmax(0,1fr)]` at every width. And a scroll wrapper needs `relative` if
  anything inside it is `sr-only`: the hidden label is absolutely positioned and escapes an
  unpositioned scroll container to widen the page, while the table scrolls fine.
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
- After restoring a mutated API file, PROVE the running dev API is on the restored code before
  trusting a browser result. Measured: a create that stored the postcode passed twice, then
  failed three times in a row on a quiet API whose `/health` uptime said it had started at the
  MUTANT edit and never restarted on the restore — `tsx watch`'s watcher had stopped
  restarting altogether, and neither a `touch` nor a real content change brought it back
  (uptime kept climbing through both). The file on disk was right and the process serving it
  was not. Read `uptimeSeconds` before and after any edit that should restart it; if it does
  not reset, kill the `tsx watch` tree and start it again from `apps/api` with the CI limits,
  then drive the behaviour once by hand (a `curl` create, a row read) before re-running the spec.
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

## Customer lifecycle release guards

- Signup is transactional: the organisation, first administrator and connector catalogue
  either all exist or none exist. `signup-atomic.test.ts` drives concurrent requests for
  one email and counts the resulting organisations.
- `billing.checkout` refuses any nonterminal subscription server-side and reuses an open
  checkout rather than opening another. Customer and checkout creation use Stripe
  idempotency keys; price lookup failures must not be interpreted as missing prices.
- Stripe payment status is stored separately from the feature plan. `past_due` retains
  access during Stripe retries; `unpaid`, `incomplete` and `paused` retain the subscription
  for recovery but grant no paid access. The Stripe retry policy must terminate prolonged
  nonpayment. `billing.paymentPortal` is admin-only, tenant-scoped and reachable on expiry.
- Workspace erasure first closes the Stripe customer, which cancels billing and prevents
  new subscriptions; a failed external close preserves local data. Retry accepts a customer
  already deleted by a prior attempt. `billing-customer-lifecycle.test.ts` checks this.
- Manual/AI/what-if runs retain their origin when opened as a full appraisal. The customer
  browser journey checks the exported manual origin as well as signup, report and erasure.
- `pnpm release:check` checks configuration without exposing secrets. The remaining real
  delivery, payment, valuation and recovery evidence belongs in `docs/SAAS-RELEASE.md`;
  neither configuration shape nor green CI proves those external acceptance steps.

## Location evidence contracts

A source outage is not successful empty evidence. Sold-price samples require
all requested postcode batches to succeed, with source-side date ordering.
Postcode centres are not exact properties or title boundaries; planning results
are point screening with incomplete England coverage. Preserve known source
territory and leave unknown country metadata unknown. EPC records require
exact normalized address/postcode identity and one certificate before using an
area to compute a rate. Use the engine's `analysedPsf` and `SQFT_PER_SQM`.
Missing credentials and transient failures must not persist as successful cache
entries; EPC caches are workspace-scoped. Map popup labels are text, never HTML;
static imagery keeps its full frame/attribution and fails visibly into the street
map. The customer release check requires a production tile service, attribution
and contactable user agent. See `docs/PRODUCT-READINESS.md` for provider choices
and the evidence needed before claiming commercial differentiation.


## Workfile upload and report hardening

- File storage uses UUIDs and exclusive creation, never millisecond/name identity.
  Failed streams, excess multipart parts and failed database/audit transactions
  remove only bytes this request created. Upload routes allow one file. Logos
  enforce 2MB while streaming. Invalid photo dates are refused, not rolled over.
- Uploaded documents download as attachments, except displayable raster files.
  Every upload response carries sandbox/nosniff and private/no-store; the static
  file plugin must not overwrite that cache policy. `workfile-upload` exercises
  real HTTP requests, simultaneous tenant writes and injected audit failures.
- Portal file links recheck current sharing flags and the buyer unit/investor
  holding on every request. Withdrawing access revokes already minted links.
- Internal PDF URLs obey the session cutoff. `report-revocation` checks all
  report kinds before the renderer is invoked. Explicit public share links
  retain their own existing expiry/revocation rules.
- All three PDF routes share two active contexts per API process (at most one public-share job) and a 60-second
  render deadline. No unbounded waiting queue. Timeout closes the context; a
  late context is closed without printing. Failed cleanup retires the browser;
  if neither can close, capacity stays occupied until the process is recovered.
  `report-capacity` tests busy, failure, timeout, late creation and broken cleanup.
- Internal PDF actions share `ReportDownloadButton`: progress, duplicate-click
  suppression, bounded fetch, visible failure/retry and a validated PDF response.
  The customer lifecycle downloads the real generated PDF through this UI.

- Production dependencies are audited in CI (`pnpm audit --prod --audit-level high`).
  Root `pnpm.overrides` pin compatible security fixes for transitive packages.
  Audit before changing/removing these overrides; regenerate the lockfile and
  verify the HTTP, report, spreadsheet and MCP surfaces after dependency updates.
