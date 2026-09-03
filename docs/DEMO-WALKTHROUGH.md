# Apex Appraise — end-to-end walkthrough

A test script for a demo instance. It covers every user journey the product has, in the
order a real firm meets them, and says what "right" looks like at each step so a wrong
answer is obvious rather than a matter of taste.

Roughly 90 minutes at a steady pace. The firm journeys build on each other — do them in
order the first time through. The portal, public and cross-cutting sections stand alone.

---

## Before you start

**Three accounts, password `demo` for all three.** The sign-in page offers them; you can
also click Sign in with the fields empty and it takes the first.

| Who | Email | Sees |
|---|---|---|
| Arthur O. — the firm's admin | `arthur@apexappraise.co.uk` | Everything the firm does |
| Lena Fischer — an investor | `investor@demo.co.uk` | Her own position, and nothing else |
| A. & R. Coombes — a buyer | `buyer@demo.co.uk` | Their plot, and nothing else |

**One rule worth knowing before you judge anything.** The AI never computes a figure. It
reads documents and drafts prose; every number is produced by a deterministic engine from
inputs a valuer accepted, and a draft that misstates one of those numbers is discarded
before you see it. If you find AI-shaped text asserting a figure the engine did not
produce, that is a genuine bug and the most valuable thing you could find.

**What is real on this instance, and what is standing in.**

| Real | Standing in |
|---|---|
| Every figure, every appraisal, every report | Card payments — a buyer's payment settles instantly, labelled demo mode |
| AI document extraction and drafted narrative | Email — invites and reset links print to the server log rather than sending |
| PDF generation, downloads, signed file links | EPC / Companies House / Xero / bank feed — connect screens work, live sync needs a key |
| Postgres, audit trail, permissions | |

If a sign-in is refused after you have switched accounts several times in a minute, that
is the brute-force limiter, not a fault. Wait a minute.

---

# Part 1 — The firm

Sign in as **arthur@apexappraise.co.uk**.

## 1. Home, and the shape of the business

1. Land on the home screen after sign-in.
2. Expect **Deal tools**, a **Pipeline GDV** figure, and a row of stat cards.
3. Expect the heading **"Everything on …"** naming a live scheme — the deal the firm
   worked most recently, never a completed one.

*Check:* the tiles under it all point at that same deal.

## 2. Pipeline board

1. **Pipeline board** from the home screen.
2. Expect seven stage columns, Sourcing through Completed, and eleven deals.
3. Drag a card to another stage. Expect it to stay after a refresh.
4. **New deal from documents** → give it a name and address → **Create & appraise from
   documents**. Expect to land in Auto-Appraisal on the new deal.

*Check:* the new deal's form is seeded from the deal you just created — its name and
address — and not from the sample scheme.

## 3. Auto-Appraisal — the AI journey

This is the one integration running live on this instance.

1. On your new deal, use **Manual entry** first: it starts from the deal's own record
   with house assumptions, and no units. Add a unit — a count, an area, a £/ft² — and
   run it. Expect an appraisal.
2. Now the AI path: upload a planning or cost document and let it read the scheme out.
3. Expect extracted inputs **with citations** — each figure says which document and where
   it came from.
4. Expect a disclosure that AI was used, naming what it did.

*Check:* change an extracted input by hand and the totals move. The model proposed the
inputs; the engine computed everything downstream.

*If you have no document to hand:* the built-in worked example is offered and labelled as
a sample. It is deliberately impossible to save a sample as if it were your scheme.

## 4. Development appraisal

1. Open **Appraisal** on Northgate Trade & Industrial Park.
2. Expect a **Unit schedule**, a **Return on cost**, and a viability verdict reading
   *Viable · RoC …*.
3. Work through the tabs: **Costs**, **Finance**, **Returns**.
4. On **Returns**, expect the equity waterfall — four tiers, LP and GP.
5. Change a rate or an area. Expect the page to mark itself unsaved, then save, then come
   back the same after a reload.

*Check:* the residual land value, the profit and the return on cost move together and
consistently when you change one input.

## 5. Comparables

1. **Comparables** on the same deal.
2. Expect an adjustment grid — size, condition, location, date — resolving to a supported
   £/ft².
3. Adjust one comparable. Expect only that adjustment to be sent and the supported rate to
   move.
4. Apply the evidence to the appraisal and expect the appraisal's values to follow.

## 6. Scenarios

1. **Scenarios**.
2. Expect scheme options side by side, each independently priced.
3. Expect a risk commentary comparing them (AI-drafted on this instance).

*Check:* the option the commentary calls most resilient is the one the engine ranks best.
The model describes the choice; it does not make it.

## 7. Terms of engagement, signed by the client

1. **Engagement** on a deal.
2. Fill the terms — client, purpose, basis of value, valuation date, the valuer.
3. Issue them. Expect a public signing link, valid for a stated period.
4. Open that link in a private window — you are the client now — and sign.
5. Back in the firm's view, expect the terms to read accepted, with who signed and when.

*Check:* try the link again after signing, and try an invented one. Both refused.

## 8. Review, approve, and what approval pins

1. Submit the appraisal for review, then approve it.
2. Expect the version to become read-only — an approved valuation cannot be edited in
   place.
3. Open the **Appraisal report** and the **Red Book**.
4. Under the signature, expect a line stating the figures were **verified against the
   approved record**.

*Check:* the report names as valuer only whoever the *saved* terms name. On a deal with no
saved terms it says so rather than borrowing your name.

## 9. The two reports

1. **Appraisal report** — print-ready investment pack. Expect the residual column to add
   up as a lender would check it.
2. **Red Book** — expect cover, basis, valuation, assumptions, and the RICS mark only if
   the firm has declared its number (Settings).
3. Download the PDF of each.
4. Expect the dates to be the dates in the record, not today's.

*Check:* on a deal with no comparables, the Red Book does not claim to have adjusted
evidence, and does not claim an inspection it has disclosed did not happen.

## 10. Cost monitoring

1. **Cost monitoring** on Northgate.
2. Expect budget against actual by package, contractor cards, certificates, and a
   photo log.
3. Add a contractor. Expect them offered on every package.
4. Expect **retention** to be what has actually been withheld from certified payments —
   a contractor with no certificates has none held.
5. Expect a build-programme bar weighted by budget, not a simple average.

## 11. Sales and lettings

1. **Sales & lettings** on Harbour Reach.
2. Expect ten plots, a progression tracker, and a **GDV secured** figure.
3. Reserve an available plot and step it through progression.
4. Record arrears against a tenancy, then try to delete that tenancy — expect a refusal
   naming the arrears, and expect clearing them to make it possible.

## 12. Data room

1. **Data room** on a deal.
2. Upload a document. Expect it listed with size, status and who added it.
3. Use **Ask the workfile** — a question answered only from the attached documents, with
   the documents it drew on named. (Live AI on this instance.)
4. Share a document with **Buyer** — expect it to require a plot, not just a deal.
5. Share another with **Investors**.
6. Note the **Access** panel counting who reaches what.

*Check:* ask the workfile something the documents do not cover. Expect it to say so
rather than guess.

## 13. Investors register

1. **Investors** from the home screen.
2. Expect three investors, their holdings and their share of the LP base.
3. Add an investor, give them a holding on a deal, and record a distribution and a
   capital call.
4. Invite them to the portal under **Portal access**. Expect the invite email in the
   server log (`docker compose logs api`).
5. Remove one and expect their portal login removed with them.

## 14. Funding pack

1. **Portfolio funding pack** (`/portfolio/pack`).
2. Expect A4 sheets, page numbering that says *Page n of m*, and every scheme appearing
   exactly once.
3. Expect an **Exceptions** section before the table — covenant breaches and overspending
   schemes.
4. In Settings, set a tight loan-to-GDV covenant (say 20%) and reload. Expect many more
   breach lines, paginating onto further sheets rather than running off the page.

*Check:* nothing overflows a sheet, at any book size.

## 15. Benchmarking

1. **Benchmarking**.
2. Expect your deals against cohort medians by use class and region.
3. Note that the pool grows from **approvals and completions**, not a button — a draft
   never enters a median other firms read as evidence.

## 16. Field inspection and the valuation workbench

Best on a phone, or a narrow browser window.

1. **Field inspection** (`/field`).
2. Walk an inspection room by room, capture condition and photos.
3. Turn the network off mid-inspection. Expect it to say so and hold the work, then send
   it when the signal returns.
4. On the desktop, open the **Workbench** for that deal: reconcile the approaches and
   weight them.

*Check:* the reconciled value is not called a reconciliation unless the weights actually
produce it.

## 17. Team, roles and firm settings

1. **Settings**.
2. Invite a colleague as **VIEWER**. Expect the invite in the server log.
3. Sign in as them in a private window. Expect every write refused — buttons greyed, and
   the server refusing even if you got past the button.
4. Back as Arthur: set the firm's RICS number, logo, AI policy and house terms.
5. Expect the logo and the RICS mark to reach the reports and the portals.

## 18. Integrations, API and webhooks

1. **Integrations** — expect Land Registry, EPC, AVM, Companies House and others, each
   with its own connect flow.
2. **API docs** (`/docs/api`) — the public read API.
3. In Settings, add a webhook endpoint. Expect an https address to be required, and
   private addresses refused.

## 19. Export and erasure

1. Export the workspace's data. Expect money in pounds, not pence.
2. Read the GDPR erasure path in Settings — but do not run it until you have finished
   testing, because it does exactly what it says.

---

# Part 2 — The investor portal

Sign in as **investor@demo.co.uk** (Lena Fischer), ideally in a private window.

1. Expect a greeting by name and **55% share of the LP base**.
2. Expect committed, called and distributed — each scaled to her share, not the fund's
   100% basis.
3. Expect her holdings, her cashflow statement, and a capital call only while one is
   outstanding.
4. Open a document shared with investors in step 12. Expect it to open — a real file
   behind a signed link.
5. Expect **no** internal controls anywhere: no "viewing as" switcher, no other
   investor's figures, no deal she does not hold.

*Check:* change her share in the firm's register to 40% and reload the portal. Every
pooled figure moves together, and nothing is left stale.

---

# Part 3 — The buyer portal

Sign in as **buyer@demo.co.uk** (A. & R. Coombes — Plot 1, Harbour Reach).

1. Expect their plot: a 2-bed apartment, the agreed price, and where the purchase has
   reached.
2. Expect **Documents to sign** — the reservation pack and the contract of sale, both
   openable. A signature on a document you cannot read is the thing this flow exists to
   prevent, so check you can read it first.
3. Sign one. Expect it recorded with the date, and to survive a reload.
4. Pay the reservation fee. **Demo mode:** it settles instantly and says so — no card is
   taken.
5. Expect the deposit held to equal the receipts they can see.

*Check:* they see Plot 1's documents and no other plot's — the other nine are other
private individuals.

---

# Part 4 — The public surfaces

No sign-in.

1. `/welcome` — the marketing site. Expect the product tour to open, step through and
   close, and the live engine card to compute real figures as you move its sliders.
2. `/pricing` — expect only plans the server can actually bill for, and every gated
   feature named in the words it is refused with.
3. `/whats-new`, `/privacy`, `/terms`.
4. A nonsense URL — expect a branded 404, not a stack trace.
5. **Register a new workspace** from scratch and expect to reach an appraisal in one
   click from the welcome screen. This is the self-serve path a real customer takes; the
   welcome email prints to the server log.

---

# Part 5 — Cross-cutting

Worth a pass over any screen you liked.

| Check | What to expect |
|---|---|
| **Dark mode** | Toggle it. Everything legible, and it survives a reload. The printed documents stay on white paper on purpose — a signed valuation must not change colour because the valuer had dark mode on. |
| **Phone** | Every screen fits at phone width. Nothing scrolls sideways. |
| **Laptop** | Same at 1024–1440px, and the header never hides a screen's own Save or Export. |
| **Offline** | The field app holds work and sends it when the signal returns. |
| **Keyboard** | Tab through a form: focus always visible, and reachable. |
| **Errors** | Provoke one — save something with a required field empty. Expect a sentence, not a JSON blob, and expect it once rather than twice. |

---

## Reporting what you find

The useful shape is: **the screen, what you did, what you expected, what happened** — a
screenshot where it is visual. Two categories are worth separating, because they get
fixed differently:

- **A figure is wrong.** Highest value. Say which figure, on which deal, and what you
  believe it should be. Anything the engine computes is testable to the penny.
- **A document claims something the record does not support** — an inspection that did
  not happen, evidence that was not adjusted, a valuer who did not sign. Equally high
  value, and harder to see, so it is worth reading one report slowly.

Everything else — wording, layout, a control in an odd place, a journey that made you
stop and think — is worth saying too, and does not need to be sorted before you say it.

---

## Known, on this instance

Not faults; these are the standing-in list from the top of the page, repeated here so
they do not get written up as bugs:

- Card payments settle instantly, labelled demo mode. No card is taken.
- No email is delivered. Invites, welcomes and password resets print to the server log.
- EPC, Companies House, Xero and the bank feed report themselves unconfigured until
  someone pastes a key in.
- The three demo logins are public knowledge and the login page offers them. That is a
  property of a demo instance, and one of the reasons this one holds no real data.
