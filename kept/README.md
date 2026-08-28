# kept.

A local-first UK return-deadline tracker. It remembers every receipt, knows
each shop's real return window and the statutory clock running alongside it,
and says which one closes first.

Built from the `Kept Mobile v7` / `Kept Landing v2` design handoff.

**This project is unrelated to the Apex Appraise codebase it sits beside.** It
shares no dependencies, no build and no CI with it — `kept/` is deliberately
outside the root `pnpm-workspace.yaml` globs so the two products cannot become
entangled. It lifts out into its own repository with a single `git mv`.

## Running it

```bash
cd kept
npm install
npm run dev        # landing page at /, app at /app/
npm test           # 235 unit tests over the decision logic
npm run typecheck  # strict, noUnusedLocals
npm run build      # both entries
```

The browser checks need a built preview server:

```bash
npm run build && npx vite preview --port 5183 &
npm run smoke      # 25 end-to-end checks, including offline with the network cut
npm run contrast   # WCAG AA sweep over every rendered text node
npm run a11y       # axe-core audit of every screen
npm run layout     # 320px and 402px, adversarial content, empty states
```

In a sandbox whose Chromium is not the build Playwright expects, point it at
the installed binary: `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npm run smoke`.

## Stack, and why

React 18 + TypeScript + Vite, shipped as an installable PWA.

The handoff suggested SwiftUI or React Native. A web app was chosen because
nothing about this product needs the native shell — no camera yet, no push
that a web push cannot do, no data that leaves the device — and because it is
the only target that can be built, run, screenshotted and tested in one place,
so the design was verified against a real render rather than shipped on trust.
The service worker is what makes the deadline checkable with no signal.

## CI

`.github/workflows/kept.yml` runs on changes under `kept/` only — Apex's own
workflow never runs for these and this one never runs for Apex, which is the
same separation the directory layout already makes. Two jobs: a fast one
(typecheck, 235 unit tests, build) and a browser one that serves the built app
and runs all four sweeps against it. Each of those sweeps found real defects
the day it was written, which is why they are gates rather than a ritual
someone remembers to perform.

## Layout

```
src/lib/          the decision logic — pure, tested, no React
  dates.ts        whole-day arithmetic in the user's timezone
  money.ts        integer pence
  receipts.ts     days left, deadlines, bucketing, the 30-day timeline
  urgency.ts      the red / yellow / neutral ladder
  alerts.ts       which deadlines are worth interrupting someone about
  contrast.ts     WCAG luminance and ratio, used to hold the palette to AA
  share.ts        reading an order email shared in from another app
  policy-feed.ts  downloading policy changes, and what they mean for you
  quota.ts        what the free tier counts, and when it is full
  legal.ts        Consumer Rights Act + distance-selling wording
  parse.ts        the paste parser (on-device, rule-based)
  stores.ts       the verified UK retailer policy table
  storage.ts      localStorage persistence + backup export
src/app/          the eight screens and their chrome
src/landing/      the marketing page
src/tokens.ts     every colour, shadow and typeface in one place
```

## What the prototype said, and what this does instead

The design was frozen in time; a shipped app is not. Each of these is a
deliberate departure, not an oversight:

- **Dates, not day counts.** The prototype stored `offset: 2` — "two days
  left", correct for exactly one day. Receipts store `purchasedOn` and the
  window; everything on screen is derived at read time.
- **Expired receipts have a state.** Frozen offsets could never reach zero.
  Real ones do, so there is a `window closed` rung on the urgency ladder, and
  an expired receipt stays at the top of *Go now or lose it* rather than
  quietly vanishing — the statutory rights may still be live.
- **The 14-day legal wording was inverted.** The prototype rendered a
  cooling-off period that was still running as "ended". Telling someone a
  right they still hold has expired is the one thing this screen must not do,
  and it has a test of its own.
- **The countdown ring shows time remaining**, so it empties as the window
  closes.
- **Every control is a real `<button>`.** The design drew them as `<div
  onClick>`, which looks the same and is unreachable by keyboard or screen
  reader. Swipe-to-return keeps its gesture; *Got my money back* on the detail
  screen is the same action for anyone not using a pointer.
- **The policy badge is derived, not stored.** A "POLICY CHANGED" flag on the
  row and a banner counting affected shops were two sources for one fact. Both
  now read the same derivation, so they cannot disagree.
- **Amounts are integer pence.** Floats drift by a penny once you sum a list,
  on a screen whose whole promise is telling people what they are owed.
- **Typefaces are self-hosted.** The app has to render with no signal, and the
  privacy notice says nobody else sees your receipts — a font request on every
  launch is a request that says when you opened it. The smoke test fails the
  build if the page contacts any third party at all.
- **Notification rows are switches.** The design drew them as static rows
  ending in a chevron; a setting you can read but not change is a setting in
  name only.
- **The onboarding and landing photo slots are drawn**, in the brand's own
  line-work, rather than shipped as empty "drop a photo" boxes. Replace
  `StepArt` and `ProblemArt` when the photography exists.
- **Receipts are editable.** Neither the prototype nor the first build had a
  way to correct one, so anything saved from a paste was called "From pasted
  email" forever — the parser can read a shop and a total, but nothing in an
  order email says what the thing *was*. The add flow now asks, and every
  field is editable afterwards from the receipt itself. Changing the shop
  brings the new shop's verified policy with it and drops the old one's
  dispatch clock, so a corrected receipt cannot keep quoting the wrong terms.
- **The alert switch does something.** "Deadline alerts" was a stored
  preference nothing read. Alerts now fire, and the rule is restraint: each
  receipt raises each rung of the ladder at most once ever, and a phone left
  in a drawer through several rungs yields one alert — the most urgent — with
  the rungs it skipped recorded silently. An app that says the same thing
  every morning gets muted, and then it cannot say the one thing that
  mattered. Turning the switch on asks the browser first, so it cannot read
  "on" while the browser is refusing to show anything.
- **A return can be undone.** Returned receipts were rendered as inert list
  items, and the detail screen's returned state — which existed in the code —
  could not be reached from anywhere. So a receipt marked returned by a stray
  swipe was permanent: not openable, not correctable, not even deletable. The
  swipe is a one-finger gesture on a row you might have meant to open, so it
  *will* fire by accident. Those rows open now, and offer "Not actually
  returned".
- **The marketing demo cannot touch your data.** The landing page embeds this
  same build at this same origin, so the "live demo" was reading and writing
  the real app's `localStorage` — swipe a receipt in the shop window and you
  had changed what the installed app shows. It runs entirely in memory now:
  fully working, resetting to the designed state on every page load, writing
  nothing.
- **The free tier is enforced, and counts what you are still tracking.** The
  10-receipt cap is claimed on the pricing page, in the Settings meter and on
  the Add screen, and nothing stopped an eleventh — the upsell was theatre.
  Save now refuses, and says the way out. One judgement worth flagging:
  `quota.ts` counts *active* receipts, not every receipt ever added. Counting
  all of them would consume a slot permanently for a return the person already
  made, so someone using the app exactly as intended — tracking things, and
  getting their money back — would hit the wall in a month and find it
  refusing the one thing it is for. If the business wants the stricter
  reading, `countedAgainstQuota` is the only line that changes.
- **Policy updates arrive, and "re-calculates itself" was the wrong promise.**
  The Watch feed was frozen into the bundle; it is now fetched from the app's
  own origin, validated entry by entry, and merged by a stable id that names
  the *change* rather than its date, so a correction replaces an entry instead
  of appearing twice. The bundled copy stays as the offline fallback under the
  same ids. But the claim beside it — that every deadline re-calculates itself
  — was one the app should not keep: the terms a purchase was made under are
  the terms that govern it, and silently rewriting a receipt's window because
  a shop edited its page could tell someone they have less time than they
  actually do. What it does instead is what the design's own Zara card already
  said: *checks*. Each held receipt is compared against the change and told
  plainly — "deadline unchanged, already checked", or "new purchases get 16
  days less; yours keeps the 30 days it was bought under". The landing copy
  was corrected to match.
- **A warranty is a clock, not a sentence.** The landing page promises
  "warranty clocks added to your receipts automatically", and a warranty was a
  free-text string that could not answer the question that promise implies —
  is the repair still free today? It is now `{ months, note }`, and the detail
  screen shows when cover ends and how much is left, said the way a person
  would say it: "10 years", then "5 months", then "9 days" as the unit starts
  to matter. It runs from the purchase date, not the retailer's dispatch
  clock — a manufacturer's cover starts when the thing was bought, whatever
  the shop counts its own window from. Month arithmetic clamps to the end of
  short months, because the naive `setMonth` turns 31 January into 3 March and
  hands someone two days of cover they do not have. Backups written before the
  change still restore: the old string is kept as the note, with no clock
  invented from prose.
- **Dates carry a year when they need one.** IKEA's 365-day window put "bought
  14 Feb" and "return by 14 Feb" on the same card, twelve months apart.
- **The share sheet works.** The Add screen taught a three-step flow — open
  the order, tap share, pick kept — and nothing was listening. Kept is now a
  PWA share target: an order email shared from a mail app arrives already
  read, on the Add screen, with the shop, total, date and deadline filled in.
  A GET target was chosen over POST so no service worker sits in the path and
  a cold start still works. The payload is stripped from the address bar as
  soon as it is in hand — a reload must not silently re-add the same receipt,
  and an order email has no business sitting in browser history.
- **The palette was darkened to meet WCAG AA.** A sweep over every rendered
  text node found ten failing colour pairings across 43 elements: the
  handoff's amber measured 3.0:1 on cream and 2.7:1 on the secondary surface
  and carries almost every small label in the product; muted body text fell to
  4.14:1; the tagline on the ink card sat at 3.13:1. Amber, muted and the
  on-ink faint tone all moved, and footnotes that were using a tone only
  legible on ink now use one legible on cream. The brand's energy is in the
  yellow *fills*, which are untouched — this is the ink that has to be read.
  The one exemption is the one WCAG itself grants: the wordmark's yellow full
  stop is a logotype (SC 1.4.3), and it claims that in the DOM via
  `data-logotype` rather than through an allowlist in the checker that would
  rot. Guarded twice — `npm test` holds the tokens to their ratios in a
  millisecond, `npm run contrast` proves the real screens still match.
- **A backup can come back.** "Export a backup" was a dead end. On a product
  with no account that file is the *only* way anything reaches a new phone, so
  restore reads it back — validating every row, dropping and counting what it
  cannot understand, and merging by id so a receipt added since the backup was
  taken is never silently discarded.

## Not built yet

- **Receipt scanning.** The button is present and visibly disabled with a
  `SOON` chip rather than silently doing nothing. On-device OCR was evaluated
  and deliberately deferred: doing it without a third party means self-hosting
  Tesseract's wasm core and English model, roughly 6 MB of binary committed to
  the repo and downloaded on first scan, and its accuracy on a creased thermal
  receipt cannot be assessed from a synthetic test image. The flow it would
  feed — parse, confirm, edit before saving — already exists and is where a
  scan should land, so adding it later is a contained change rather than a
  redesign.
- **Background notifications.** Deadline alerts are real — `lib/alerts.ts`
  decides which deadlines are worth an interruption and `app/notify.ts`
  delivers them — but a web app cannot wake itself at 9am. Notification
  Triggers never shipped, and Periodic Background Sync is one engine's, for
  installed apps only, granted at the browser's discretion. So alerts are
  computed whenever kept is opened or brought back to the foreground, and
  Settings says exactly that instead of implying a service that does not
  exist. A native shell or a push path replaces `notify.ts` alone; the
  decision engine does not change.
- **Payments.** The pricing tiers set the local plan flag. No billing.
- **Signing the policy feed.** The feed is fetched from the app's own origin,
  validated entry by entry and merged (`lib/policy-feed.ts`), and the download
  is of *all* changes — never a query naming the shops a particular user
  holds, which would be the leak the privacy notice rules out. What is missing
  is provenance: the entries in `public/policy-feed.json` are maintained by
  hand and nothing proves they came from us. Production wants them signed, and
  a pipeline that verifies each retailer's published terms before publishing.

## Accessibility is checked, not claimed

Three passes, because they catch different things:

- `npm test` holds the palette's tokens to their WCAG ratios in a millisecond.
- `npm run contrast` re-measures what is actually rendered, compositing
  through translucent layers, catching a component that reached for the wrong
  token.
- `npm run a11y` runs axe-core over every screen for the questions contrast
  cannot ask — is every control named, is the heading order sane, are there
  landmarks, does anything rely on colour alone.

That last one found four real faults on its first run: the onboarding step
dots carried an `aria-label` on a bare `<div>`, which is prohibited and simply
discarded; there was no `<main>` on any screen, so all content sat outside
every landmark a screen reader navigates between; and Home and Celebrate had
no level-one heading at all. All fixed. axe-core is a devDependency injected
at audit time — the app never imports it and it never reaches a bundle.

## Narrow screens and untidy data

Everything else here is driven at 402px with the seeded demo receipts — the
width the design was drawn at, and the content it was drawn with. Real phones
go down to 320px, and a real receipt can have a long shop name, a long item
name and an amount in the thousands, because the edit form accepts whatever
someone types. `npm run layout` sweeps both widths across every screen, with
adversarial content and with the empty and all-returned states that never
appear in the seed data, and fails on any sideways scroll.

Its first run found the landing page scrolling 48px sideways on a 320px
phone: `minmax(340px, 1fr)` sets a *hard* floor, so the hero's track was wider
than the content box it sat in. Every grid there now uses
`minmax(min(Npx, 100%), 1fr)`, which lets the floor collapse to the space that
exists. It also turned up a receipt row whose untruncated shop name wrapped to
five lines while the item beneath it was still being clipped to one.

## Offline is verified, not asserted

"Works offline" is the app's central claim — a deadline you can check on the
train, in the shop, with no signal — and it is the one claim that cannot be
verified by reading the code. The smoke test cuts the network completely and
then requires the app to launch, render receipts, load its self-hosted fonts
and still navigate. The service worker caches the shell at install and fills
in the hashed bundles, fonts, icons and the policy feed on first run, so the
Watch tab shows the last-known feed offline too.

## Before this ships

`src/landing/placeholder-content.ts` holds the social-proof figures and
reviews from the handoff, which it marks as illustrative. Nothing there is
measured and nobody named is a real customer. While
`SOCIAL_PROOF_IS_PLACEHOLDER` is true the page renders a visible notice saying
so; clearing the flag is the same edit as replacing the figures with ones you
can substantiate.

The retailer windows in `stores.ts` were written from the handoff and public
policy pages. Verify each one against the retailer's current published terms
before launch — the app's core claim is that these are right.
