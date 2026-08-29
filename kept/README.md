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
npm test           # 275 unit tests over the decision logic
npm run typecheck  # strict, noUnusedLocals
npm run build      # both entries
```

The browser checks need a built preview server:

```bash
npm run build && npx vite preview --port 5183 &
npm run smoke      # 36 end-to-end checks, including a midnight rollover
npm run contrast   # WCAG AA sweep over every rendered text node
npm run a11y       # axe-core audit of every screen
npm run layout     # 320px and 402px, adversarial content, empty states
npm run agreement  # the same fact, on more than one screen, has to match
npm run perf       # diagnostic, not a gate: how it behaves as the list grows
npm run freshness  # starts and stops its OWN server — see below, no preview needed
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

`.github/workflows/kept.yml` runs on changes under `kept/` only, and Apex's
`ci.yml` carries the matching `paths-ignore` so it never runs for these — the
same separation the directory layout already makes. Both halves of that were
written down here long before the second one was true: `ci.yml` had no path
filter at all, so every commit to kept also ran a full pnpm install, a Prisma
generate, a Postgres service and a Playwright browser job, green every time,
on a diff that could not reach any of it.

A path filter does less than it looks like it does, though, and this is worth
knowing before reading a CI run and concluding the filter is broken: on
`pull_request` GitHub evaluates it against the pull request's *whole diff*,
not the commit just pushed. A pull request that touches a single file outside
`kept/` runs Apex's suite on every later commit, whatever those commits touch
— which is what the pull request introducing this arrangement does, since it
edits both workflows, the root `.gitignore` and the root README. The saving is
on pushes to main and on pull requests confined to `kept/`.

Two jobs: a fast one (typecheck, 357 unit tests, build) and a browser one that
serves the built app and runs five sweeps against it, plus `freshness`, which
starts and stops a server of its own. Each of those found real defects the day
it was written, which is why they are gates rather than a ritual someone
remembers to perform.

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
  legal.ts        Consumer Rights Act + distance-selling rights, cumulative
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
- **The two statutory rights are cumulative, and were modelled as
  alternatives.** A `legalDays: 14 | 30` field made the screen pick one, and
  it is a property of how the thing was bought, not a number of days. The
  30-day right to reject faulty goods for a full refund (Consumer Rights Act
  2015, s.22) applies to every purchase. The 14-day right to cancel for any
  reason (Consumer Contracts Regulations 2013) applies *on top of it*, and only
  to a distance or off-premises purchase — not to something bought over a
  counter. So the app was wrong in both directions, and wrong for money: a
  receipt showing the cooling-off period never mentioned the 30-day refund it
  also had, and the add screen hardcoded 14 on everything, telling a shop
  purchase it could be cancelled for any reason within a fortnight. Someone
  acting on that is turned away at the counter; someone on day 20 of a faulty
  online order was told they had only a repair coming, when a full refund was
  still theirs. A receipt now records `distance`, both screens ask for it in
  one shared control so they cannot word it differently, and the detail screen
  states every right the purchase carries. Backups written before the split
  still import — `legalDays: 14` was only ever set where the app was treating
  the purchase as distance, so that is what it migrates to.
- **The countdown ring shows time remaining**, so it empties as the window
  closes.
- **Every control is a real `<button>`.** The design drew them as `<div
  onClick>`, which looks the same and is unreachable by keyboard or screen
  reader. Swipe-to-return keeps its gesture; *Got my money back* on the detail
  screen is the same action for anyone not using a pointer.
- **The paste parser read the estimated delivery date as the purchase date.**
  It picked "the most recent date that is not in the future", and an order
  confirmation is full of dates: the order, the dispatch, the estimated
  delivery, the return-by, a promotional footer. On an ordinary Currys email
  that rule landed on the delivery estimate six days after the order, and the
  app then promised six days the shop would not honour — the dangerous
  direction, on the one number it exists to get right. `pickAmount` had
  already been built to prefer a *labelled* total for exactly this reason;
  `pickDate` now does the same, with delivery, dispatch and return-by wording
  demoted beneath anything else, as a preference rather than a filter.
- **The paste parser named shops that were not there.** `pickStore` matched a
  bare substring, so "next day delivery" was a Next order, "walking boots" a
  Boots one, and "pineapple print tea towel" an Apple purchase. Four were live
  at once, and the first is on a large fraction of order emails ever sent. The
  cost is not cosmetic: a named shop brings its window and the policy sentence
  someone repeats at a counter, so a £12 tea towel from Etsy carried Apple's
  14 days. Matching is on word boundaries now, and a name that is also an
  ordinary word (`commonWord` in `stores.ts` — Apple, Boots, Next) has to sit
  beside something that makes it the shop: the possessive an order email uses
  about itself, or the shop's own domain. Failing that the parser names
  nothing, which the add screen shows as "Not recognised" against a window it
  says is assumed — an assumption someone can see and correct beats a
  confident lie.
- **The add screen had no way to name a shop.** It followed from the fix
  above: a parser that refuses to guess leaves the shop blank more often, and
  the only remedy was to save a receipt called "Unknown store" and edit it
  afterwards. When nothing is recognised the screen asks, and a shop Kept does
  know brings its real window and wording with it — 40 pounds of walking boots
  from Vinted stays on the assumed 28 days, the same paste with "Boots" typed
  in becomes a verified 35. The preview and what actually lands read one
  value, because two of them disagreeing is a bug this codebase has had.
- **Three retailers quoted a clock the app does not keep.** Apple, Amazon and
  ASOS all say "from delivery" in their own policy wording while the app
  counts from the order date, because it knows when nothing arrived. The
  direction is safe — an earlier deadline than the real one — but silence
  about it is how a receipt comes to look expired on a day it is not. Each now
  carries a gotcha saying the date shown is the earliest it can be, and
  `test/stores.test.ts` sweeps the real table for any other policy sentence
  that names a start the app does not keep.
- **A duplicated receipt id doubled the money.** The row reader validates one
  row at a time, so it cannot see a second row wearing the same id — and
  nothing else looked. One duplicate turns £89 still returnable into £178,
  which is the single thing this app must not do, and collides the React keys
  in three lists on the way. The restore path was already safe (the merge
  matches by id); the app's own store was not, and it is the store that
  produced the corrupt row  exists to survive.
- **Settings were the one thing read off disk unchecked.** Receipts and policy
  updates have been validated on the way in since a single bad row blanked the
  app; the preferences beside them were spread straight over the defaults. An
  `urgentDays` that is a word, or a negative, makes every comparison against
  it false — so a receipt five days from its deadline renders *relaxed*, grey
  and unremarkable, and the week-ahead alert never fires for anything, ever.
  The app's whole job, switched off by a value nothing was looking at. Read
  field by field now, so one unreadable preference does not discard the three
  beside it that were fine.
- **Restoring a backup undid a refund taken since.** The merge kept every
  local row the file did not mention — that part was deliberate — but let the
  incoming copy win outright for a row on both sides. Export Monday, take the
  headphones back Tuesday, restore Monday's file Wednesday to recover a
  receipt deleted by mistake: the headphones silently revert to active, the
  refund date disappears, the money leaves the total, and the app starts
  telling you to return something you already returned. The backup supplies a
  row's *details* now and the device keeps its *state*, because `returned`
  records something that happened in the world and `active` only records that
  it has not happened yet — so a file written earlier cannot be evidence
  against it. The same asymmetry protects the mirror case: a stray swipe
  corrected with *Not actually returned* is not undone by a restore either. A
  row absent locally still comes in whole, state included; that is the case a
  restore exists for.
- **A render error blanked the whole app.** Measured before the fix: a throw
  on one screen unmounted the tree and left a page with no text and not one
  button, while the receipts sat intact in localStorage with no server holding
  a copy. A reload recovers only when the fault is on a screen you had to
  navigate to; a fault on the first screen, or one a particular stored receipt
  causes, lands back in the blank state on every launch — which is the exact
  shape of a bug this app has already had once and fixed at the data layer.
  `Recovery` is the same fix at the render layer, and its rescue deliberately
  does not run through the app's state, its loader or its receipt reader,
  since any of those may be what threw: it reads the store, copies it, and
  offers a file, keeping even the row that broke everything because that row
  is the one most worth having.
- **The policy badge is derived, not stored.** A "POLICY CHANGED" flag on the
  row and a banner counting affected shops were two sources for one fact. Both
  now read the same derivation, so they cannot disagree.
- **Amounts are integer pence.** Floats drift by a penny once you sum a list,
  on a screen whose whole promise is telling people what they are owed.
- **Typefaces are self-hosted.** The app has to render with no signal, and the
  privacy notice says nobody else sees your receipts — a font request on every
  launch is a request that says when you opened it. The smoke test fails the
  build if any page contacts a third party at all — every page, in every
  context it opens, having watched only the app until a Google Fonts link added
  to the landing page loaded and the check still passed.
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
- **Undo could have duplicated a receipt.** Introduced by the fix below: if
  another tab writes state that still contains the receipt you just deleted,
  the undo would add a second copy — two rows, and the money counted twice,
  which is the one thing this app must not do. In practice the other tab
  usually adopts the deletion first, so it takes a late or lost event to
  reach; the guard costs one comparison and the reducer is now unit-tested
  directly, which it was not before.
- **A second tab silently destroyed the first tab's receipts.** Two tabs of a
  local-first app both hold the whole library in memory and both write all of
  it, so whichever had older state overwrote the other — and a *setting toggle*
  in the stale tab was enough to do it. Verified: tab A added a receipt, tab B
  flipped an unrelated switch, and the receipt was gone. Tabs now adopt each
  other's writes through the `storage` event, which only fires in other
  documents so it cannot hear itself. If the receipt you are reading is deleted
  in another tab, this one falls back to the list rather than to a blank
  detail screen.
- **The offline cache could never be evicted.** The service worker's cache name
  was a fixed `kept-v1`, and `activate` deletes every cache *except* the
  current one — so with a name that never changed, it deleted nothing. Each
  deploy's hashed bundles accumulated forever, competing for the same storage
  quota the app keeps receipts in, which is the quota whose exhaustion raises
  the banner above. The name is stamped at build time from a hash of the
  emitted assets: it changes when they do and stays put when they do not, so an
  identical rebuild does not make anyone re-download a byte-identical app. The
  build fails loudly if the placeholder ever goes missing, because a worker
  that silently stops evicting looks exactly like one that works.
- **A failed save was completely silent.** `save()` caught the quota error and
  returned, on the reasoning that not throwing inside a render beats throwing.
  The first half of that is right and the second half was missing: with no
  server behind the app, a write that does not land means the data is gone at
  the next launch *while the screen still shows it*. Verified by making writes
  fail: the receipt appeared, nothing warned, and it was gone after a reload.
  A failed write now raises a standing banner that says what happened and
  offers the one action that preserves the data — an export — rather than an
  apology.
- **The app did not notice midnight.** `today` was computed once per session,
  and phones resume a PWA from the background rather than reloading it — so a
  deadline tracker left open overnight went on reporting yesterday's counts.
  Verified by walking a fake clock forward without reloading: it said "2 days
  left" three hours after midnight, and still said it two days later, on a
  receipt whose window had shut. It now re-checks when the app returns to the
  foreground and on a slow interval, and sets state only when the calendar day
  actually turns over.
- **One bad row on disk blanked the entire app.** The backup importer
  validates every row it reads, on the reasoning that a file off a disk is not
  trustworthy. The app's own storage got a single `Array.isArray` — and
  `localStorage` is no more trustworthy than that file: a truncated write, an
  interrupted save, a future migration, a hand-edit. A receipt with no purchase
  date threw inside date parsing during render, producing a blank screen on
  *every* launch thereafter, with no way out but clearing site data by hand.
  Loading now runs each row through the same reader the importer uses and drops
  what it cannot read. That loses one receipt instead of all of them plus the
  app, and the row was already unreadable.
- **Two screens disagreed about the same deadline.** The edit screen previewed
  it by counting from the purchase date; the receipt counted from dispatch. On
  the seeded Zara coat that is two days, on the one subject the app exists to
  be right about. Both now read `effectiveWindowStart`, which also encodes the
  rule that a dispatch date belongs to the shop that dispatched it — so
  changing the shop drops it, in the preview and in what gets saved, and a
  test pins the two together.
- **Your data can actually be taken back.** On a product whose whole promise
  is that the data is yours and lives here, there was no way to remove it.
  Uninstalling clears a native app; a web app's storage outlives a closed tab,
  and clearing it by hand means digging through browser settings. Settings now
  has an erase, behind a two-step confirm that names how many receipts will go
  and points at the backup first — not the eight-second undo, which is right
  for one receipt taken back by mistake and wrong for everything at once.
- **There is a way to find a receipt.** The list is grouped by urgency, which
  is right for "what must go back this week" and useless for "where did I put
  the headphones". A search box appears once the library outgrows a screenful
  — below that it is furniture in the way of the thing it would search — and
  filters *within* the urgency buckets, because that grouping is still the
  answer to the more important question. Substring matching over the shop and
  the item, every term required, no fuzzy matching: a near-miss in a list
  about money and deadlines invites acting on the wrong row.
- **The policy feed was unreachable by keyboard.** Every other screen holds
  buttons or inputs, so tabbing through them scrolls the region as a side
  effect. Watch holds nothing focusable, so its feed could not be scrolled by
  keyboard at all.
- **Delete can be undone.** It was one tap, immediate, and the only action in
  the app with no recovery — on a screen you reach by tapping a row, beside a
  button you might have been aiming for. A backup is not an undo. Deleting now
  offers the receipt back for eight seconds. A timed offer rather than a
  confirmation dialog: confirmations tax every deliberate delete to catch the
  rare accidental one, and this app's posture is getting out of the way. The
  held receipt is deliberately not persisted — close the app during the window
  and the delete stands, which is the safer reading of walking away.
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

## How it is verified

Five suites, each asking a question the others cannot. Three of them found
real defects the day they were written, which is the argument for having
them at all.

### Accessibility is checked, not claimed

Three passes, because they catch different things:

- `npm test` holds the palette's tokens to their WCAG ratios in a millisecond.
- `npm run contrast` re-measures what is actually rendered, compositing
  through translucent layers, catching a component that reached for the wrong
  token.
- `npm run a11y` also asks where focus goes when the screen changes, which
  axe cannot: nothing about the markup is wrong. Every screen here is a swap
  inside one page, so the control that was clicked — a row, Edit, Skip —
  unmounts as the new screen arrives and the browser has nowhere to put focus
  but the document. Three of four transitions lost it. A keyboard user's next
  Tab then restarts at the top of the document rather than continuing where
  they just arrived, and a screen reader announces nothing at all.

  The rule is not "always move focus to the heading". That would take focus
  off the tab bar, which sits after `</main>`, and make the app's primary
  navigation reachable only by tabbing through a whole screen. Focus is
  *restored* where it was lost and left alone where it was not; a change that
  did not move focus is announced instead, in the same words the focus move
  would have read out. Both halves fail independently when removed.
- `npm run a11y` also asks the one motion question axe does not. The
  stylesheet has honoured `prefers-reduced-motion` since it was written — for
  the three animation *classes* it names. Five of this app's transitions are
  declared inline on the element, an inline style beats any stylesheet rule
  that is not `!important`, and one of them is the swipe row's
  `transform .25s`: with the setting on, the decorative marquee stopped and
  the motion that moves a whole row under someone's finger did not. Measured
  on the real screens, not read off the stylesheet — ten elements were still
  moving. The blanket rule that fixes it sits inside the media query and has
  zero specificity, so the two class rules still win where they apply and the
  ticker stays stopped outright rather than running once; the sweep checks
  that too, and checks that each screen rendered something before reporting a
  clean pass over it.
- `npm run a11y` runs axe-core over every screen for the questions contrast
  cannot ask — is every control named, is the heading order sane, are there
  landmarks, does anything rely on colour alone.

Both sweeps also open the *states* nothing navigates to — the unreadable-paste
error, a returned receipt's detail, the delete-undo offer, and the standing
warning shown when the device will not save. States are where audit coverage
quietly stops: a sweep that only walks screens reports a clean pass on
everything it never rendered. Each was confirmed reachable by making its text
unreadable and watching the sweep name that exact state before restoring it.

That last one found four real faults on its first run: the onboarding step
dots carried an `aria-label` on a bare `<div>`, which is prohibited and simply
discarded; there was no `<main>` on any screen, so all content sat outside
every landmark a screen reader navigates between; and Home and Celebrate had
no level-one heading at all. All fixed. axe-core is a devDependency injected
at audit time — the app never imports it and it never reaches a bundle.

### Narrow screens and untidy data

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

### It does not contradict itself

Unit tests check each calculation. Smoke checks each flow. Neither catches the
failure where two surfaces are each internally consistent and say different
things about the same fact — which is how the edit screen came to preview a
deadline two days from the one on the receipt it was editing. Both halves were
"correct"; they counted from different dates.

`npm run agreement` asks one question repeatedly: a fact that appears twice has
to match. Days left, across the hero, the row's chip, the countdown ring and
the alert that was sent. The deadline date, across the hero, the receipt and
its edit form. Money still returnable and money kept back, against the sum of
the rows. The free-tier meter, against the list it is counting.

It crosses into the landing page too, which for a long time it did not. The
three prices were literals in four places across both entry points, and the
free tier's size was written out as a bare "10" twice in the marketing copy
beside a `FREE_TIER_LIMIT` the app actually enforced: six statements of three
facts, nothing holding any of them together, and half of them on a page this
suite had never opened. A price that says one thing where someone bought and
another inside the product is not a cosmetic drift. `lib/pricing.ts` is the
one source now, and the suite reads both surfaces and requires them to match.

Three things about it are deliberate. It reads named elements rather than
regexing `textContent`: the first version did the latter and reported three
disagreements that were all its own, because "£89.00" followed by "2 days"
reads as "89.002 days" and a greedy `\d+` takes `002`. And the edit-form check
runs against the *dispatch-clocked* receipt, because on any other one the two
ways of computing the date agree by coincidence — aimed at the first row, it
would have missed the very bug it was written for. And the landing-page scrape
is scoped to the `#pricing` section rather than the whole page: reading every
£ amount in `document.innerText` picked up the £1.95 Zara postal fee quoted in
the policy-watch card, which is the same self-inflicted disagreement again. A
selector that matched nothing would let both halves "agree" over empty
strings, so the suite also requires that it found a pricing section and three
prices in each place.

### A deploy reaches the app, and the app works without one

Two promises pull against each other. "Verified policy updates the day they
change" needs the network to win; "check a deadline on the train, with no
signal" needs the cache to. The service worker is where they meet, and where
either can stop being true without anything appearing on screen — a frozen feed
looks exactly like a quiet week.

Both had stopped being true, in different ways.

A service worker is consulted BEFORE the HTTP cache, so the app's
`fetch(FEED_URL, { cache: 'no-cache' })` was not the defence it read as, and the
worker's cache-first rule — written for hashed bundles, which really are
immutable per URL — swallowed the one file whose entire purpose is to change. An
installed app saw the feed that shipped on the day its worker installed and
never another. The Watch tab, and the product's central claim, quietly dead.

And the offline half was guarded by two checks that could not fail for the
reason they named. `setOffline` governs the PAGE's network; a service worker's
own fetches go on reaching the live server regardless. Measured after the fact:
both passed against a worker that intercepted every request and cached
**nothing at all** — an app that dies the instant it is really on a train. They
proved a worker was installed and read as proof of the app's headline feature.

So `npm run freshness` starts its own preview server on its own port, and then
stops it. That is the only way to cut a worker's network, and a script cannot
stop a server it did not start. With the server genuinely gone, the app has to
launch, render the library in its self-hosted typeface, navigate to a receipt,
and serve the feed from the copy it kept. Each check was confirmed to
discriminate by putting the defect back: cache-first for the feed, network-only
with no fallback, a network-only navigation, and the never-caching worker that
the old checks had passed.

### It stays usable as the library grows

Every other suite runs against a small list — the free tier caps at ten active
receipts and the seed has five. `npm run perf` asks what happens to someone on
the paid tier two years in. On this container:

| receipts | to first row | to filter |
|---:|---:|---:|
| 25 | 644ms | 73ms |
| 60 | 650ms | 74ms |
| 150 | 693ms | 80ms |
| 500 | 851ms | 114ms |

Boot is about 640ms of that regardless; the list costs roughly 0.4ms per
receipt. The shape is linear and nothing needs virtualising. It is deliberately
not a CI gate — wall-clock on a shared runner measures the runner as much as
the app, and a threshold drawn from it would fail for reasons nobody could act
on.

### Offline is verified, not asserted

"Works offline" is the app's central claim — a deadline you can check on the
train, in the shop, with no signal — and it is the one claim that cannot be
verified by reading the code. It is verified by `npm run freshness`, which
stops its own server and then requires the app to launch, render the library
in its self-hosted typeface, navigate to a receipt, and serve the policy feed
from the copy it kept. The service worker caches the shell at install and
fills in the hashed bundles, fonts and icons on first run; the feed is
network-first with that cached copy behind it.

It was verified in the smoke suite before that, under a comment saying the
network was cut completely, and it was not — see the section above for what
that check was actually proving.

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
- **The date a parcel actually arrived.** Both statutory clocks legally start
  the day the goods come into your hands, and for a delivered order that is
  not the day you paid. The app knows the order date, so what it computes for
  a distance purchase is the *earliest* either right could end — the wording
  says exactly that rather than asserting a date it cannot know, and a lapsed
  one points at the arrival date rather than declaring the right gone. Making
  it exact means recording when the parcel landed, which is a third date
  beside the purchase and the retailer's own dispatch clock
  (`Receipt.windowStartsOn`), and a field on two screens. Worth doing; not
  worth guessing at.
- **Payments.** The pricing tiers set the local plan flag. No billing.
- **Signing the policy feed.** The feed is fetched from the app's own origin,
  validated entry by entry and merged (`lib/policy-feed.ts`), and the download
  is of *all* changes — never a query naming the shops a particular user
  holds, which would be the leak the privacy notice rules out. What is missing
  is provenance: the entries in `public/policy-feed.json` are maintained by
  hand and nothing proves they came from us. Production wants them signed, and
  a pipeline that verifies each retailer's published terms before publishing.

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
