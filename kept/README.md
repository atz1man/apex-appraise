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
npm test           # 519 unit tests over the decision logic
npm run typecheck  # strict, noUnusedLocals
npm run build      # both entries
```

The browser checks need a built preview server:

```bash
npm run build && npx vite preview --port 5183 &
npm run smoke      # 59 end-to-end checks, including a midnight rollover
npm run contrast   # WCAG AA sweep over every rendered text node, and the same page on a dark device
npm run a11y       # axe-core audit of every screen, plus focus management and the focus ring
npm run layout     # 320px and 402px, adversarial content, empty states, covered buttons, crushed names,
                   #   every screen again with the webfont blocked, and again with a browser
                   #   minimum font size applied
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

Two jobs: a fast one (typecheck, unit tests, build) and a browser one that
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
- **The hero lowercased brand names.** "2 days left to return your jbl tune
  770nc headphones" — a `toLowerCase()` that is right for "Wool-blend
  overcoat" and wrong for every product name carrying a brand or a model
  number, which is the part the person has to recognise. `midSentence` folds
  only a first word that is plainly capitalised and otherwise lower case, so
  "JBL", "iPhone", "No7" and "kMix" are left as written. Found by taking a
  screenshot and reading it, which no sweep here does.
- **A receipt's window and the sentence quoting it drifted apart.** Edit a
  Boots receipt from 35 days to 20 and the detail screen showed RETURN BY
  counting 20, above a STORE POLICY card still reading "Boots · 35 days".
  Fifteen days apart on one screen — and the card is the wording someone
  repeats at a counter, so the number they would act on was the one that makes
  them late. The sentence is re-derived when the shop or the window changes,
  through one `policyFor` the add and edit screens share so they cannot phrase
  the same situation differently. Deliberately *not* on every save: a
  receipt's policy text is the terms it was bought under, and adopting the
  table's current wording because someone opened the edit screen would be the
  same silent rewriting `policy-feed.ts` refuses to do to a deadline.
- **Editing a shop's name to "boots" hid every Boots policy change.** A
  receipt's `store` is not only a label: `assess` matches an update's
  `affectsStores` against it exactly. `findStore` is case-insensitive, so such
  a receipt cheerfully carried Boots' verified 35-day policy while no change
  Boots published ever reached it — no banner, no flag on the Watch tab. The
  add screen already resolved the typed name to the shop's own; the edit
  screen did not, so the two ways into one field disagreed. Both use
  `canonicalStoreName` now, and so does the deadline preview, because a
  preview comparing raw text against a save comparing canonical names is the
  exact disagreement `effectiveWindowStart` exists to prevent. `readReceipt`
  resolves it too — one door for the app's own store and an imported backup
  alike — so a row saved before any of that agreed is repaired on the next
  launch rather than staying quietly unwatched forever.
- **A duplicated receipt id doubled the money.** The row reader validates one
  row at a time, so it cannot see a second row wearing the same id — and
  nothing else looked. One duplicate turns £89 still returnable into £178,
  which is the single thing this app must not do, and collides the React keys
  in three lists on the way. The restore path was already safe (the merge
  matches by id); the app's own store was not, and it is the store that
  produced the corrupt row `hydrate` exists to survive.
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
- **The add screen would save an arrival date from before the purchase.** The
  field it was added to has a rule on the edit screen and had none here: the
  browser marked the input invalid and the app read the value and saved it
  anyway, 19 days before the order in the case that found it. Both statutory
  clocks start on that date, so an arrival before the purchase reports a live
  right as expired — the direction this app exists not to get wrong, in the
  field added to stop exactly that. One `arrivalProblem` now, called by both
  screens, for the same reason `effectiveWindowStart` and `canonicalStoreName`
  exist. The narrow `min` came off the input while fixing it: Chromium fills
  in the invariant parts of a range that spans one month, so an *empty*
  optional field rendered as "08/dd/2026" whenever the purchase was recent —
  which is most of the time on that screen — and a rule with a reason is
  better feedback than a picker that silently refuses.
- **"Copied — paste it anywhere ✓" was shown when the copy had failed.** The
  reasoning written beside it was that a control which appears dead is worse
  than one that lies — half right, and the same half this codebase already got
  wrong once, when `save` swallowed a failed write for the identical reason.
  `writeText` fails on an insecure origin, which is every deployment of this
  over plain HTTP, and wherever the permission is refused; the person found
  out by pasting nothing into a message to a friend. It says which of the two
  happened now, and a failed copy puts the sentence on screen to be selected.
  The smoke check was asserting the lie — "is the button saying Copied" passed
  because it always did — so it drives both outcomes, in contexts that control
  the clipboard, because that is the only way to test what a screen says
  about it.
- **The statutory clocks are exact now, not a floor.** They legally start the
  day the goods reach you, which for a delivered order is not the day you
  paid — so without that date the app could only compute from the order and
  say "at least until". `Receipt.arrivedOn` is optional and asked for only on
  a delivered order, and the difference it makes is the app's central failure
  mode: the seeded Zara coat read "the 14-day cooling-off has run out" from
  its order date, and with the arrival date it reads "3 days left". Telling
  someone they are out of time when they are not is the one thing this app
  must never do. A counter purchase is not asked, because it arrives when it
  is bought — and changing a receipt to a shop purchase drops the date rather
  than leaving one that would then be wrong.
- **On the last day the countdown ring drew nothing.** `daysLeft` is 0 on the
  final day a thing can still go back, and the arc was `daysLeft / windowDays`
  — so the detail screen read *"0 days left · RETURN BY 29 Aug"* beside an
  empty grey track with no red anywhere on it, on the one day the ring matters
  most. There IS a day left on the last day: the arc counts inclusive of today
  now, and the number is coloured like the count on the home hero, which had
  always done that. A receipt whose window has actually gone still draws
  nothing, rather than sweeping backwards.
- **"Every return made it back in time" was said whether or not it had.** The
  screen shown once everything is returned made a claim about timing that
  nothing checked — and a return can be made after the shop's window shuts, by
  goodwill or the faulty-goods route, which is the harder one. The same fault
  as the celebrate card, one screen along; found by rendering the all-returned
  state, which nothing had. It is said only where the record supports it, and
  a return with no date recorded counts against the boast rather than for it.
  The money is true either way and is still said.

  The same screen also lost the `sample ·` marker: the money-back rows are
  hand-built rather than a `ReceiptRow`, so a demo receipt stopped saying what
  it was the moment it was ticked off — on the list where "which of these were
  mine" is the question being asked.
- **The Watch tab claimed a fetch that was switched off.** Its footer said
  "fetched each time you open the app" regardless — a sentence that became
  false the moment the Settings switch started actually stopping the fetch.
  It follows the switch now.
- **The hero contradicted itself twice on a library with a backlog.** `bucket`
  keeps an expired-but-unreturned receipt at the very top, deliberately: the
  money may still be recoverable under the statutory rights, and demoting the
  row would hide the one a person most needs to see. So on any list with one,
  the hero shows it — and the headline knew. It said *"Gone — the window
  closed on your Towels"* under a label reading NEXT WINDOW TO CLOSE, above a
  line reading *"£193.25 back if it goes back by 21 Mar"*, a date five months
  past. Three statements on one card, two of them false. The label and the
  line follow the state now.

  The rows had the same fault one level up: expired receipts sat inside
  `urgent`, under the heading "GO NOW OR LOSE IT" — the one thing that cannot
  be done about something already lost, leading a screen of rows all reading
  "window closed". They have their own section, in the same position, named
  for what they are and what is left to try.
- **Nothing said which palette the app is.** `color-scheme` was undeclared, so
  the native controls this app leans on — the date pickers, the scrollbars,
  the area a rubber-band scroll reveals — followed the operating system.
  Chromium happened to render them light; that was luck rather than a
  decision, and it is exactly the sort of thing that differs by engine. And
  nothing painted the canvas: the cream comes from an element inside the root,
  so `body` computed to *transparent* and an overscroll past the top of a phone
  showed the UA's white rather than the app's paper. Both belong in the
  stylesheet rather than a component, because both are about the surface under
  every component. `npm run contrast` now loads the app on a dark-mode device
  and requires the same page — measured, not declared.
- **The focus ring was invisible on the paper the app is made of.** Yellow
  alone, measuring 1.72:1 against cream — WCAG 2.1 SC 1.4.11 asks 3:1 of a
  focus indicator, axe does not check it, and on a keyboard that ring is the
  only thing saying where you are. It is two colours now, because one cannot
  work everywhere: ink carries the light grounds at 15–18:1 and yellow carries
  the ink surfaces at 10:1, and `tokens.test.ts` checks every ground the app
  paints on — including that *neither* colour would do alone, since if one
  were enough the ring should be that colour.

  The browser then found what the tokens could not. The ink half is a
  `box-shadow`, and the CTAs carry the signature 3px hard offset as an INLINE
  `boxShadow`, which beats a stylesheet rule — so the ring was absent on
  exactly the buttons that matter most. `npm run a11y` now tabs through a
  screen and asks the browser what it actually computed for each focused
  element; with the `!important` removed it names "Got my money back". Tabbed
  rather than `.focus()`, because `:focus-visible` does not match a
  programmatic focus, so the rule never applies and the probe reports the
  element's own shadow — which reads exactly like the defect.
- **A link's hover colour was the shade the palette rejected.** `color.amber`
  was darkened from the handoff's `#B98A00` to `#896600` because the original
  measured 3.00:1 on cream — below AA wherever it was used. The stylesheet
  went on using `#B98A00` for `a:hover`, and the contrast sweep cannot see it:
  that state only exists under a pointer. Fixed, and `tokens.test.ts` now
  refuses any colour the palette does not contain, across the components *and*
  `styles.css` — which cannot import the tokens, which is exactly why it
  drifts. The rule is on the RGB, not the string: a dozen `rgba()` literals
  are one-off opacities of ink, danger and cream, and naming every step would
  be a token per shadow, but a colour nobody chose is refused. It strips
  comments first, so a rule can be explained by naming what it rejected.
- **Nothing used the typeface tokens, and the fallback was three different
  fonts.** `font` was exported from `tokens.ts` and used by no component:
  forty-eight `font-family` literals were spelled out across fourteen files
  instead, in three different stacks for Space Grotesk alone — 38 falling back
  to `monospace`, 9 to `sans-serif`, and the unused token to a third thing.
  That is not cosmetic on this app. The faces are self-hosted precisely so a
  screen renders with no signal, which makes the FALLBACK a state it actually
  ships in — and in it the same face fell back to a monospace in one element
  and a proportional sans in the next, on one screen. Nobody had looked,
  because nothing named it. Three roles now, one stack each, and `figures` is
  a real distinction rather than a synonym: money and day counts want digits
  that hold their column when the webfont is missing, and a heading does not.
  `tokens.test.ts` refuses a typeface named outside the tokens and a stack
  that does not end in a generic family; `npm run layout` sweeps every screen
  with the webfont blocked, which is wider than Space Grotesk and therefore
  the state where a row's chips stop fitting beside its shop name.
- **A fourth onboarding slide would have been unreachable.** The reducer
  finished the flow at `obStep >= 2` — the last index, typed as a literal —
  while `ONBOARDING_STEPS` sat exported from the file that owns the slides and
  used by nothing. Add a slide and it would have been written, rendered, and
  counted in "Step 4 of 4", and the flow would still have ended on the third.
  The count is derived now, and the test walks whatever number of slides there
  are: adding a fourth makes the old literal fail and the derived count pass.
- **Three icons nobody drew.** A clock, a padlock and an Apple logo, exported
  from `Icons.tsx` and referenced nowhere — shipped in the bundle of an app
  that has to work offline on a phone, one of them a trademark nothing had
  asked to render. `icons.test.ts` requires every icon the set exports to be
  drawn somewhere, because an icon set is written ahead of the screens that
  use it and that is where dead code collects.
- **The policy-watch switch switched nothing.** `settings.policyWatch` was a
  stored boolean read by the Settings row that draws it and by nothing else.
  The row said "Policy watch · Every launch · on", turning it off changed the
  word to "Off", and the feed downloaded on every launch regardless. On an app
  whose privacy card promises nothing is uploaded, and whose only outbound
  request this is, that is the worst switch to get wrong — the same defect the
  "Deadline alerts" row had, in the row directly beneath it. The smoke check
  counts the request at the network rather than reading the label.
- **A returned receipt never said when.** `returnedOn` was written on every
  return, persisted, and validated on import — and shown nowhere. "£89.00
  recovered ✓" reads the same whether the refund landed last week or last
  year, and it is the only fact a returned receipt carries that is not already
  on the row. It goes through `fmtDatesTogether` with the other two dates on
  that screen, so the three cannot end up a year apart in the same sentence.
- **Three shops said in prose what the field denied.** Apple, Amazon and ASOS
  each carried a `gotcha` explaining that they count their window from the day
  the parcel arrives and that Kept counted from the order, while `clockStart`
  on those same entries said `'purchase'`. Now that the arrival date is read
  from the paste and askable on the edit form, the app can do what the prose
  said it could not. `clockStart` gained a third value and `windowStartFor` is
  the one rule the add screen, `applyDraft` and the edit preview all ask —
  because those three disagreeing is the failure this file keeps having. Where
  the arrival is unknown it still falls back to the order, which is earlier
  than the truth and therefore cautious, and the detail screen says the date
  is a floor. A shop that counts from the till records the arrival without
  starting its window on it: the statutory clocks run from there and the
  retailer's does not, and conflating those two is the mistake `types.ts`
  warns about at length. `stores.test.ts` now holds the field and the prose
  together in both directions — an entry that says "from delivery" must count
  from delivery, and one that counts from delivery or dispatch must say so,
  because a clock the app runs and the wording never mentions is a deadline
  nobody can check at a counter. Proved four ways, including a vacuity guard
  that fails when the table stops containing an entry of any of the three
  kinds.
- **`clockStart` was declared on all twenty shops and read by nothing.** The
  gotcha the marketing leads with — *"Zara's clock starts at dispatch"* — was
  data on one seeded receipt and nothing else. Add a Zara receipt yourself and
  the app counted its 30 days from the order. That is the safe direction, since
  dispatch is later than the order and the earlier deadline is the cautious
  one, but it is not the right one: it can say "window closed" on a day Zara
  would still take the coat back, which is the failure `legal.ts` calls the one
  this app must not have. Dispatch confirmations state the date, so
  `pickDispatch` reads it under the same three conditions as the delivery date
  — labelled, already happened, not before the order — and takes the
  *earliest* where an arrival takes the latest, because a second dispatch is a
  second parcel and the clock the shop is running started when the first one
  left. Set only for a shop whose entry says it counts from dispatch: an Argos
  receipt carrying Zara's clock would be worse than one carrying none, and the
  smoke check adds both to say so.

  And when the paste does not say — most order confirmations are sent before
  the parcel leaves — the deadline is a floor and is now shown as one: *"Zara
  counts from dispatch, not from your order — and this receipt does not say
  when that was, so the date above is the earliest it can be, never the
  latest."* The same hedge the statutory clocks make about an unknown arrival,
  pointing the other way. Which clock a shop runs is read from the table
  rather than the receipt, deliberately: unlike the window, it is not a term
  that changes under a purchase — a shop either counts from dispatch or it
  does not.

  And then a way to say it, because a screen that tells you what it does not
  know and offers no way to tell it is an instruction to do the impossible.
  The edit form asks for the dispatch date, on a shop that counts from
  dispatch and nowhere else. The date now comes from the DRAFT rather than
  being carried forward from the receipt, which also settles the earlier
  five-day bug at its root: correcting the purchase date past the dispatch
  date is a stated error on the one screen showing both, rather than a silent
  drop; retyping the shop as one that counts from the till discards it
  silently, because there the field is not even shown.
- **"No server" was the loose word in the privacy claim.** Settings and the
  landing page both said "No account, no server, no one reading your
  purchases" — on an app that is served from a server and downloads the
  policy feed from it on every launch, which the Watch tab says out loud two
  taps away. "Nothing uploaded" is accurate and the stronger claim, and it is
  what the onboarding already said; the landing card now also names the one
  call and its direction, which is a better privacy claim than denying that a
  call happens. `e2e`'s third-party check proves the rest: no request leaves
  this origin at all.
- **The celebration congratulated you for something that had not happened.**
  Two unconditional claims on one screen. "Recovered from Currys before the
  window closed" was printed whether or not it had — the button that leads
  there is offered on any active receipt, and a refund won *after* the window,
  by goodwill or the faulty-goods route, is the harder one and the one most
  worth celebrating. And the shareable line read "kept. reminded me before the
  window shut" whether or not kept had said anything at all: a receipt marked
  returned the day it was added, or with alerts switched off, produced a claim
  about the product for the person to send to their friends. The return now
  records `inTime` and `warned` at the moment it happens, and each sentence is
  earned. Same reasoning as the clipboard fix above — a control that reports
  success whatever happened is not reporting anything.
- **The hero misspelled a brand.** Item names are placed mid-sentence — "9
  days left to return your …" — so the first word was lower-cased when it
  looked ordinary, leaving "JBL", "No7", "iPhone" and "kMix" alone because a
  word that is not simply Capitalised is carrying information in its case.
  Read on the screen, the hero said *"9 days left to return your kenwood kMix
  stand mixer"*. "Kenwood" is simply Capitalised and is also a brand, and no
  version of that rule can tell those apart: "Sony headphones", "Nike
  trainers" and "Wool-blend overcoat" are structurally identical. The
  transformation is gone, because the two mistakes are not the same size —
  a capital left standing mid-sentence is at worst inelegant and is the
  person's own text read back to them, while a lower-cased proper noun is
  wrong, on the one word the reader has to recognise. The old test asserted
  `'kenwood kMix stand mixer'`, which is how the defect was pinned rather
  than caught.
- **A notification is not a demonstration.** The sample receipts are labelled
  on the list and cost nothing against the free tier, and this was the last
  place they still behaved as real: grant permission on a fresh install and
  the phone said *"Go now or lose it — Currys · JBL Tune 770NC headphones — 2
  days left. £89.00 back if it goes back"*, on a lock screen, indistinguishable
  from a real alert, about £89 nobody spent. `dueAlerts` skips them. The
  urgency is still demonstrated where it can be seen for what it is — the home
  screen leads with that same receipt and its two days. The smoke check that
  covered this used to assert the sample alert; it now requires silence on a
  fresh install and exactly one alert on a receipt the person added.
- **Fixing a typo took five days off a return window.** The seeded Zara coat
  carries a dispatch date, because Zara counts its 30 days from dispatch
  rather than from the order. Correct "bought on" from the 13th to the 20th
  and `windowStartsOn` stayed at the 15th — a parcel dispatched five days
  before it was ordered, and a deadline still counted from the 15th, so the
  screen said 14 September when the receipt now said 19 September. `applyDraft`
  never set the field at all; the spread carried the stale one straight past
  the preview, which is the same preview-versus-save split that produced the
  two-day disagreement above. One `keptWindowStart` now answers it for both: a
  dispatch date belongs to the shop that dispatched it, and it cannot be
  earlier than the purchase.
- **An expired cooling-off is not always expired, and Scotland is not England.**
  Two things the record supports that the screen was not saying. Regulation 31
  of the 2013 Regulations: where the trader never gave the consumer the
  cancellation information the Regulations require, the period does not simply
  end — supply it late and it runs 14 days from then, never supply it and it
  ends twelve months after it otherwise would have. The app was closing the
  door on a refund the person may still be owed, so the expired case now says
  so, as something to check rather than a conclusion, since whether the shop
  told them is a fact only they have. And the repair line said "for up to six
  years in England and Wales", which gives a Scottish reader no number at all
  on an app sold UK-wide; it names the five-year Scottish period too. Both are
  stated only where they earn the words — the extension on an expired right,
  never on a live one, where it would read as a warning about the wrong thing.
- **The first screen of a new install promised a feature that is not built.**
  Onboarding said "Paste an order email or snap the paper slip" — scanning is
  deferred, the add screen shows it as a visibly disabled SOON button, and the
  landing page says outright that it "lands in a later release". This was the
  one surface promising it. The same screen's second step said "You get pinged
  before either runs out", when alerts are computed on opening kept and a web
  app cannot wake itself, which `notify.ts` and the Settings screen both say.
- **The landing page had no way into the app.** Its call to action was an App
  Store badge with `href="#"` — promising an iOS app that does not exist, and
  pointing at nothing — while the nav button beside it went to the pricing
  section. The page's only mention of `/app/` was the demo iframe's `src`, so
  a visitor who read the whole thing and wanted to use kept had nowhere to
  click. No other check here would notice: nothing overflows, nothing fails
  contrast, and a dead link is a perfectly valid one. Both now open the app,
  which is an installable PWA on the same origin — better than the promise
  they replaced, since there is nothing to download.
- **"Verified" was a process the app does not have, in five places.** The
  worst was the Watch tab's footer: "Policies verified daily by kept · last
  check today 06:00" — nothing verifies daily, nothing records a check time,
  and the hour was invented outright. Beside it, the Add hint said a shop's
  window was "verified", the Edit hint promised a "verified policy", the
  landing page offered "verified windows for 20 major UK retailers", and its
  policy-watch section claimed "verified policy updates" for a feed whose
  missing provenance is written up two sections below as not built. The
  constant behind the count was called `VERIFIED_STORE_COUNT`, which asserted
  it once more. All of it now says what is true and checkable instead: whose
  list it is, and when it is fetched.
- **Three more on the Settings screen, found the same way.** "Retailer
  policies — 20 verified today", where nothing records or could record a
  verification date and the README's own pre-ship task is to check every
  entry; claiming freshness for the data the product rests on, on the screen
  where someone goes to ask about it, is the worst place to be vague. It reads
  "20 shops" now, with a caption saying the list is Kept's own and not yet
  checked against published terms — the same shape as
  `SOCIAL_PROOF_IS_PLACEHOLDER`, driven by a `TABLE_CHECKED_ON` that is `null`
  until someone does it. "Alerts that arrive while the app is closed need the
  App Store version" implied an App Store version exists; nothing arrives
  while kept is closed, because a web app cannot wake itself, which is what
  `notify.ts` has always said in its own comment. And "Policy watch — Daily"
  was a cadence nothing kept: the feed is fetched once per launch.
- **Two claims in the shipped copy that nothing behind them kept.** The Watch
  tab said "Warranty clocks added automatically" — and nothing sets a
  warranty: not the parser, not the store table, not the add flow. The clock
  itself is real and tracked (that half was fixed early, and `types.ts` still
  carries the note saying so); it was never automatic, and a manufacturer's
  warranty is not knowable from an order email, so the copy is what changed.
  The same card set said "Kept flags if that's you before you buy" about
  ASOS's frequent-returner window, with no purchase-frequency tracking and no
  moment before a purchase to say it in. What Kept actually does is assume the
  shorter window — `stores.ts` has ASOS at 28, not 45 — which is what it says
  now. Both were in three places: the landing page, the bundled seed and
  `public/policy-feed.json`, which is why `test/feed-agreement.test.ts` now
  holds those last two to each other. It caught a drift on its first run: the
  seed's comment claims its ids match the served feed exactly, and the bundle
  was carrying four of the five, so a first launch with no signal showed a
  Watch tab quietly missing one.
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
  plainly — "deadline unchanged · drop off in store to keep it free", or "new
  purchases get 16 days less; yours keeps the 30 days it was bought under".
  The landing copy was corrected to match.

  The first of those two used to stop at "deadline unchanged, already
  checked". Read on the screen, that is the failure the whole tab is for:
  Zara's change was the postal-returns fee, its window stayed at 30 days, so
  the unchanged branch fired and the holder of a Zara coat was told nothing
  had moved while the sentence that would have saved them £1.95 sat unread in
  the same update. Currys the same — the price-match note is the entire point
  of that entry and its window did not move either. The reassurance still
  leads, because "has my deadline moved" is the question being asked; the
  advice now follows it. Where the window *did* move the note is still
  dropped, deliberately: "your window is the shorter one" is written for a
  reader of the news and is false of a receipt already held, which keeps the
  window it was bought under.
- **The scrolling bar quoted the table from memory.** Five hand-typed lines
  in `placeholder-content.ts` — the module whose header says "nothing here is
  measured" — exempted from that warning on the grounds that they "restate
  published retailer policies". That is the reason they did not belong there:
  a restatement is true only while it matches what it restates, and nothing
  held these to `stores.ts`. One was already off. "IKEA: 365 days, still
  unbeaten" singles IKEA out, and Decathlon matches it at 365 in Kept's own
  list. `ticker.ts` computes them now — the longest window whichever shop
  holds it, worded so a tie is still true; ASOS's and Apple's numbers from the
  table; the newest change and its date from the feed; and the Uniqlo gotcha
  with its leading "Uniqlo" stripped, since the bar has already said it.
  `ticker.test.ts` breaks each derivation separately.
- **The shop window quoted the feed from memory.** The landing page's three
  policy-change cards were hand-typed strings beside a `seedUpdates` that
  already carried the same changes and is already held to
  `public/policy-feed.json` entry for entry. They had drifted: the page said
  Zara's "free ONLINE returns ended" where the feed says POSTAL — different
  things, and the difference is whether you can still walk it into a shop for
  nothing. The Zara card also still promised "your deadlines: unchanged,
  already checked", a sentence the app stopped saying when the unchanged case
  started passing on the advice that came with the change. The cards are
  derived now, newest three, with relative dates — the same argument as the
  store windows below, one file further along.
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

### Which tab you are on

The active tab was a pale yellow fill and nothing else. `yellowLight` against
the bar's near-cream measures **1.28:1**, where WCAG 2.1 SC 1.4.11 asks 3:1 of
a state indicator — so the one thing telling you where you are in the app,
in the app's only navigation, had under half the contrast required of it.
Nothing here could have said so: axe does not check non-text contrast, and the
contrast sweep measures TEXT against its background, which on that tab is fine.

It failed worse in a state nothing had rendered. Windows high contrast replaces
backgrounds with the user's own palette and leaves borders alone, so the fill
stopped existing altogether and all four tabs became identical. The Watch tab's
alert dot — the only sign that a policy change touches a receipt you hold —
went with it.

Both are carried by something forced colours cannot erase now: an ink border on
the active tab (17.6:1) and a border on the dot, with the fill kept, because two
signals is the point. The first attempt gave the inactive tabs a TRANSPARENT
border so the geometry would not shift, which is the trap this now guards — a
transparent border is forced like any other, so all four came back outlined and
the state was *less* visible than before it was fixed. The 1.5px is paid back in
padding instead. `npm run a11y` renders the app with `forcedColors: 'active'`
and requires exactly the current tab to be outlined; both mutations, no border
and a transparent one, were confirmed to fail it by name.

Then the same bar failed a second way, in a state nothing had rendered either.
A browser's **minimum font size** is a floor, not a preference: it raises every
px size below it, and the smallest type in this app is the 10px on these
labels. At 20px the bar wants 333px, and it is centred with
`translateX(-50%)`, so on a 320px screen it hung off **both** edges — the R of
"Receipts" cut away at one end and "Settings" at the other. Nothing could see
it. The shell is `overflow: hidden`, so the document reported no sideways
scroll at all; no row overflowed, no text failed contrast, and the layout sweep
passed the whole time.

The bar is capped to the viewport now, which makes the shrink land on the
labels instead — and at the bar's ordinary padding it landed hard enough to
leave "Rec…", "W…" and "Set…", three tabs identifiable only by their icons.
Tightening the padding on a narrow screen buys about 20px a tab back. Measured
at 320px with the text at 20px: 87, 87 and 88 per cent of the three words with
it, and 61, 60 and 60 without.

`npm run layout` runs a second browser launched with the setting applied. Its
threshold is three quarters, which is *between* those two measurements rather
than picked from one side, and all three mutations fail it by name: the cap
removed ("the bar is 333px wide and runs from -7 to 327 on a 320px screen"),
the padding removed ("'Settings' shows 60% of its word"), and the setting
itself removed ("the biggest tab label computed to 10px, so the bar was
measured at its ordinary size"). 20 rather than 18 is deliberate: at 18 the bar
is 310px and still fits, so a sweep there would pass with the cap deleted and
pin nothing.

### The filter said nothing

Above six receipts the list gets a search box, and typing in it rewrites the
list under the cursor — nine rows become one. A sighted person watches that
happen. A screen-reader user heard the keystroke and nothing else: no count,
and on a query that matched nothing, not even the "Nothing matches …" the
screen was showing. WCAG 2.1 SC 4.1.3 asks that the result of an action like
this be conveyed without moving focus, and axe cannot tell that a live region
is *missing* — only that a present one is malformed.

A polite region beside the box says it now, after the typing pauses rather
than on every keystroke, since a region rewritten ten times in two seconds is
ten interruptions of the typing it is reporting on. The empty case repeats the
words already on the screen rather than inventing its own, so the two are one
message reaching two people. The sentence itself lives in `src/lib/search.ts`
with the rest of searching, where its boundaries — nothing typed, one match,
many, whitespace around the query — are unit tests rather than a screen.

`npm run a11y` reads whatever live regions the page has, not a selector for
the one this added, because the question is whether *anything* says it. Four
mutations fail it by name: the region deleted, the empty case silenced, the
filter no longer filtering ("the list did not narrow (9 rows before, 9 after),
so nothing was there to announce"), and the box never appearing at all ("was
not on the page, so nothing about searching was audited").

### Narrow screens and untidy data

Everything else here is driven at 402px with the seeded demo receipts — the
width the design was drawn at, and the content it was drawn with. Real phones
go down to 320px, and a real receipt can have a long shop name, a long item
name and an amount in the thousands, because the edit form accepts whatever
someone types. It also asks whether every button is the thing you actually hit when you tap
it. The handoff shipped a Celebrate screen whose "Back to receipts" sat
underneath the floating tab bar — fully visible, completely unclickable, and
invisible to every other check here, because nothing overflows and nothing
fails contrast when a control is merely covered. That was found by eye; this
is the mechanical form of it.

Getting it to mean anything took three goes, all the same mistake. It passed
against the reintroduced defect because none of these screens overflows at the
sweep's own viewport height, so it never put a button near the bar — so it now
shortens the viewport to 560px first, which is a phone with the keyboard up
and the state where a floating bar and the last button in a scroller actually
meet. The vacuity guard that catches that was then satisfied by the Watch
feed's inner region, which always has more content than it shows, so it
measures the screen's own container instead. And the guard was written below
the success path's `process.exit`, where it could never run at all.

`npm run layout` sweeps both widths across every screen, with
adversarial content and with the empty and all-returned states that never
appear in the seed data, and fails on any sideways scroll.

Its first run found the landing page scrolling 48px sideways on a 320px
phone: `minmax(340px, 1fr)` sets a *hard* floor, so the hero's track was wider
than the content box it sat in. Every grid there now uses
`minmax(min(Npx, 100%), 1fr)`, which lets the floor collapse to the space that
exists. It also turned up a receipt row whose untruncated shop name wrapped to
five lines while the item beneath it was still being clipped to one.

### Who reads this?

The question that has found more here than any other, asked by hand every
time. `npm test` asks it mechanically now, for the part of it that can be:
`test/reachable.test.ts` walks the real source with the TypeScript parser and
requires every export to be mentioned somewhere that is not its own
declaration.

The parser rather than a regex, because `export const a = 1, b = 2` and
`export { x as y }` are the forms a regex gets wrong, and a sweep that quietly
misses a form reports success for a question it never asked. All four shapes
were confirmed to fail it — a dead const, a dead function, a dead type, and the
aliased re-export — along with both of its own vacuity guards: a file list that
came back empty, and a namespace import, which would let a dead export hide
behind `import * as`.

The first draft of it asked for every export to be *imported*, and reported
thirty-six things when none was wrong: a type naming the return of an exported
function must itself be exported or a caller cannot write the type down, and a
helper used inside its own module and exported for a test is a shape this
codebase uses on purpose. A check that names thirty-six innocents gets an
exemption list and then gets ignored. The rule it settled on — nothing anywhere
reads it, not even its own file — has no honest exceptions, which is why it
carries none.

And it is worth exactly what it checks. It sees exports. It does not see a dead
*field* (`clockStart` sat on twenty shops unread and is a property), a switch
consulted only by the row that draws it (`settings.policyWatch`), or a constant
duplicated rather than imported (`ONBOARDING_STEPS`). Those still need the
question asked by hand, and the test says so where someone would otherwise
assume otherwise.

### And who reads this *field*?

The sweep above says at its top that it cannot ask the question of a field.
`test/fields-read.test.ts` asks it there, which is where two of the three worst
versions of this defect actually lived.

The trick is that a dead field does not look dead. `clockStart` was written by
hand on all twenty entries of the store table — three of them with prose beside
it explaining the limitation it was there to remove — and read by nothing, so
every Zara receipt anyone added counted its 30 days from the order rather than
from dispatch, which can say "window closed" on a day Zara would still take the
coat back. Grep for the name and you find twenty hits. So the parser
distinguishes: a key in an object literal or the left of an assignment is a
write; a property access or a destructuring is a read. Only reads count.

`returnedOn` needed one distinction further, and slipped through the first
version of this file. Its reads were real — `backup.ts` reads it to copy it
into an export and back out of one — but copying a value through a serialiser
is not looking at it, and a field written, saved, restored and never consulted
by anything that decides or displays is as dead as one with no reads at all. So
the persistence layer is counted separately and a field only it reads is
reported in its own words: *"saved and restored, and nothing decides or
displays anything with it"*.

Neither list has an entry today, and both were confirmed to fill by putting the
original defects back — `clockStart` unread, and `returnedOn` read only by the
saving of it. Three vacuity guards go with them: the models have to have been
found (this one fired immediately, on a model named `StorePolicy` rather than
`Store`), the read/write distinction is checked against source written in the
test rather than trusted, and the pattern naming the persistence layer has to
still match two files — rename `backup.ts` and every field it copies would
quietly start counting as used.

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

It also holds the two entry points to one tagline. That line was three
literals — the landing hero, the landing footer, the line under Settings —
and the words in it, "WORK HARD · PLAY HARD", were the only thing on the page
saying nothing about returns, money or privacy, in the most prominent
typographic slot the hero has. `lib/brand.ts` owns it now, the sweep reads the
export out of the source rather than pinning the wording (a fourth copy would
be the same bug again), and compares by containment, since Settings sets it
mid-sentence and the hero sets it in caps alone.

Four things about it are deliberate. It reads named elements rather than
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

### The same date, twice, a year apart

Read as source, `fmtDateNear` is right: carry the year only when the date is
not in this one. Read as a screen, the IKEA receipt said

    RETURN BY
    15 Feb 2027
    195 of 365 days used · bought 15 Feb

— the same day and month twice, six lines apart, on the screen whose whole job
is dates. The year on one and not the other is what invites reading them as the
same day, and it is not a quirk of the seed: a 365-day window always lands the
deadline on the purchase's day and month, so every receipt from a shop with a
year-long return window read this way.

The fix is `fmtDatesTogether`, which decides for a *group*: if any date in it
falls outside the current year, all of them carry theirs. `dates.test.ts` pins
the rule, and the smoke suite opens the IKEA receipt and requires the two dates
the detail screen prints together to differ and to agree about the year. Both
were proved by putting `fmtDateNear` back and watching each name the defect.

### A price you tap is not a price you paid

Tapping a tier in Settings dispatched `plan: 'pro'` on the spot. No card box,
no confirmation, no word either way — press "£39.99 lifetime" and the paywall
simply vanishes. The only reading available to someone doing that is that they
have just been charged £39.99. Payments are not built (see *Not built yet*),
so nothing was, and an app that displays a price, takes a tap, and then behaves
as though money changed hands is making a claim about somebody's bank account.

A tap now opens a sheet that leads with the thing that costs money to get
wrong — nothing charged, no card taken, nothing to cancel — names the tier
that was pressed, and then offers the unlock, which is real and free. Unlocking
used to remove the plan block and put nothing in its place, so the app went
quiet about it; where the prices were there is now a standing "Unlocked ·
nothing was charged", because someone returning a week later has no other way
to tell whether they are being billed.

Three sweeps grew a case for it, since a modal is reachable only by tapping and
so was invisible to all of them: smoke checks that a tap leaves the plan alone
and that the sheet says so, that "Not now" unlocks nothing, and that the
disclosure survives the unlock; a11y audits the dialog (proved by removing its
accessible name and watching axe name it); contrast sweeps its surface. The
layout sweep needed a change of its own — its covered-button check counted the
scrim over the tab bar as a defect, which is what a modal is *for*, so it now
narrows to the open dialog's own buttons and still fails when those are
covered.

### The date it was already holding

The Add screen asks for the day the parcel landed — both statutory clocks run
from delivery, and without it a receipt can only promise "at least until".
The order email pasted into the box two fields above it says *Delivered 27
August 2026*. The screen was asking someone to read that back out by hand.

`pickArrival` reads it, under conditions strict enough that a wrong answer is
harder to produce than no answer: the date must be introduced by a delivery
word, must already have happened, must not be an estimate ("Estimated delivery
12 August", read a fortnight late, is not a day anything landed), and must not
precede the purchase — the app refuses that pair when it is typed by hand and
must not put it there itself. Where an email names two deliveries the later
wins, because that is the redelivery whose clock is running. It stays a field
the person can clear or correct: pre-filled, not decided.

Every one of those conditions is a separate test, and each was checked by
deleting the condition and watching exactly one of them fail. The smoke check
follows it to disk rather than stopping at the field, since a pre-fill that
never reaches the saved receipt is decoration.

### An example is not a suggestion

The item box offered "Wool-blend overcoat" — which is the seeded Zara receipt,
three taps away on the same install. Greyed text in a form the app has just
filled in for you reads as something the app filled in, and on a fresh install
the person is looking at a placeholder and a receipt with the same name.
`placeholders.test.ts` walks the screens for `placeholder="…"` and refuses any
that borrows the wording of a receipt the seed creates — with a count check
first, because a sweep over an empty file list passes silently.

### Paying for the showroom

A fresh install arrives with five receipts so the first launch is a working
app rather than an empty list. They counted against the free tier. Settings
opened at "5 of 10 free receipts" before the person had done anything, and
the wall — with three prices on it — arrived after five receipts of their own.
Half the allowance went on data they never entered.

`demo: true` on the seeded rows, excluded from `countedAgainstQuota`, and
carried through an exported backup so a restore does not quietly start
charging for the sample set the file was holding (strictly `=== true`, so a
stray value is not a free receipt). Each half was proved by breaking it
separately: the flag ignored in the quota, dropped in the backup, widened to
any truthy value, and absent from the seed — four mutations, four different
failures.

That fix needed a visible half. "0 of 10 free receipts" beside five receipts
reads as a bug unless the receipts say what they are, so the rows carry a
`sample ·` marker — which also gives the agreement suite something to read
them by. Its meter check now adds two real receipts first, because a fresh
install is entirely sample rows and "0 versus 0" passes whatever the meter
renders.

### A name squeezed to nothing

The marker started as a chip beside the store name, and on a row that also
carries POLICY CHANGED the store rendered as "Cu…" and "Z…" — two characters
of the one word that says whose return it is. Every sweep stayed green: a
squeezed name neither overflows the page nor covers a button.

So `npm run layout` now measures it, and the first thing it found was not the
new chip but the old one — at 320px, POLICY CHANGED alone left "Zara" 4px of
the 32 it needs. The name keeps a 64px floor and the chip drops to its own
line when the two will not fit. The marker moved to the item line, and then
to the *front* of it, because that line truncates from the tail and at 320px
every row had been reading "Kenwood kMix stan…" with the marker gone on
exactly the phone with the least room to explain itself.

The check carries the same vacuity guard as its neighbours — remove the
`data-name` attribute it reads and it reports that it measured nothing,
rather than reporting a pass.

### The correction that stopped at one surface

The onboarding used to say "you get pinged before either runs out". It was
fixed, and the reasoning written down: a web app cannot wake itself,
Notification Triggers never shipped, Periodic Background Sync is one engine's
and at its discretion, so alerts are computed when kept is opened or brought
back to the foreground — and `notify.ts` and the Settings screen both say so.

The landing page went on making the claim word for word. Its hero said "pings
you before either clock runs out" and its features grid offered "a heads-up
when something must go back this week" — on the page someone reads *before*
installing, which is the one place the promise is load bearing. The fix had
been applied where it was noticed, not where it was true.

Both now name the trigger, and `alert-claims.test.ts` states the rule for
every screen and both entry points: copy may say the app tells you something,
as long as it says when. It reads the files rather than a list of known
strings, skips comment lines (they quote the banned copy to explain it), and
fails if it cannot read what it means to read.

Which then found the same correction stopping one layer short twice more.
Both `<meta name="description">` lines still said "pings you before either
clock runs out" — the copy a search result and a link preview show, read by
more people than either page. And the manifest, which is what an install
prompt shows, said *"get pinged before either clock runs out"*: the same
promise in the passive, which the active pattern walked straight past. The
guard reads all four files now and both voices, and each was proved by
putting its old sentence back.

The lesson is the one worth keeping: a correction gets applied where it was
noticed rather than where it is true. When a claim changes, grep for it —
every screen, both entry points' HTML, the manifest, and this file.

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

And once more, a layer below that. The sweep stops the server by killing its
process group — and it started that server through `npx`. npm exec puts each
child in a NEW process group: measured, the `npm exec` at pgid 22995, the `sh`
it ran at 23011, and the node actually holding the port at 23012. The
negative-pid kill reached npm and nothing else. The offline half was putting
its questions to a machine that was still online, and every one of them passed.

What said so was the one check written to say so — `the server really is
unreachable` — which exists because nothing else can tell an app that works
offline apart from an app that was never offline. The server is now node
running vite's own entry, so the pid is the process holding the port, and the
stop does not return until the port has stopped answering. When it has not, the
three offline results are recorded as *not asked* rather than passed, because
that is what they are.

### The third statement on the same card

The hero card had been corrected twice for saying two things at once. On a
library with a backlog the most urgent active receipt is an *expired* one —
`bucket` keeps it at the top deliberately, because the money may still be
recoverable and demoting it would hide the row a person most needs to see — and
the card's label and its sentence had both been made to say so.

Its footer was still summing every active receipt. So the card that reads
**WINDOW ALREADY CLOSED**, above a line saying the shop's window shut, ended
with "£412.96 still returnable" — a total that included the £193.25 attached to
that very window. A person reads that as money they can go and get.

`stillReturnablePence` counts the open windows only, and lives in
`receipts.ts` beside `bucket` so the judgement has one home and can be tested
at its edges: the last day of a window counts (`daysLeft === 0` is inside it),
a returned receipt does not, an expired one does not. What is left to try on a
closed window is still said, per receipt, in the section below — in the
language of rights rather than of refunds, which is the honest register for it.

The unit tests pin the rule; `npm run smoke` pins the wiring, since a screen
can always go back to summing the wrong list. It reads the rendered figure and
compares it against the two sums the page itself holds, so the check does not
carry a number that would go stale with the seed — and it requires the expired
receipt to be worth something, because if it were worth nothing the two totals
would be equal and the comparison would pass over a difference that was never
there. Both mutations fail it.

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
- **Payments.** The pricing tiers unlock the local plan flag and say plainly
  that nothing was charged. No card, no billing, nothing to cancel.
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
