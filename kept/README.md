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
npm test           # 177 unit tests over the decision logic
npm run typecheck  # strict, noUnusedLocals
npm run build      # both entries
```

The browser checks need a built preview server:

```bash
npm run build && npx vite preview --port 5183 &
npm run smoke      # 15 end-to-end checks across every screen
npm run contrast   # WCAG AA sweep over every rendered text node
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
- **Policy delivery.** `seedUpdates` ships a static feed. Production wants a
  signed feed fetched on a schedule — and, to keep the privacy claim true,
  the download must be of *all* policy changes, never a query naming the
  shops a particular user holds.

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
