# Auto-Appraisal local subscription evaluations

Run `pnpm --filter @apex/api eval:codex` after signing in to Codex CLI with
ChatGPT. Validated with CLI 0.162.0. This opt-in developer command consumes the
signed-in account's Codex allowance; it does not use Anthropic or an OpenAI API
key. It refuses API-key login and CI execution, removes provider-key environment
variables from the child process and ignores user CLI configuration. Credentials
stay in Codex's normal local authentication storage and are never read/copied by
this script. No live account secrets are modified.

OpenAI documents [subscription authentication](https://learn.chatgpt.com/docs/auth)
and [non-interactive structured outputs](https://learn.chatgpt.com/docs/non-interactive-mode).
This uses the official CLI locally; it does not expose a subscription credential
through the public website or change the production extraction provider.

The runner submits eight independent synthetic text fixtures in one structured
Codex request: explicit schedules, missing sales values, empty evidence, embedded
instructions, superseded revisions, asking-price/rate confusion, mixed schedules
and build-cost/sales-value confusion. It gives the model the notes, not the answer
key. A fresh temporary directory holds the raw response and report. The final
console line gives the report path. There is a three-minute process timeout,
read-only sandbox and no API fallback; runs that use tools are rejected.

Scoring checks exact numeric inputs paired with property types and raw nulls before production defaults can
hide missing evidence, requires exact case IDs at the start of sources, refuses unknown fields and
validates each result through Apex's `zExtraction`. Missing core unit fields must
produce no invented units. The model does not compute appraisal money. Existing
appraisal round-trip and engine tests exercise the deterministic calculations.
For these fixtures, labels must retain `flat`/`flats` or `house`/`houses`;
descriptive prefixes and singular/plural forms are accepted. Ambiguous labels
containing both types fail. Sources may be the case ID alone or begin with
`case-id:`; this checks fixture identity, not the truth of a citation's text.

Run `pnpm --filter @apex/api exec vitest run test/auto-appraisal-eval.test.ts`
for deterministic scorer regressions without using the subscription. Those tests
prove corrupted counts, stale revisions, fabricated prices, missing source
citations, unexpected financial outputs and duplicate cases cannot pass silently.
Only the scorer tests and saved-response replay run in ordinary CI; the live model run is opt-in locally.

## Annotated drawing mode

Run `pnpm --filter @apex/api eval:codex --drawings` to submit the checked-in
synthetic PNG sheet through the CLI's image attachment option. Only the pixels,
case IDs and generic extraction instructions reach the model; the SVG source,
gold numbers and transcript are not sent. No customer documents are used.

Three panels exercise stated per-unit areas/sales values, current versus
superseded revisions and build costs with missing sales values. This tests
reading annotations from a raster, not deriving measurements from geometry.
The sheet is deliberately labelled not to scale. The same strict scorer checks
both modes. Each image report includes the SHA-256 of the submitted PNG.

The editable sheet is `apps/api/test/fixtures/auto-appraisal/drawing-sheet.svg`.
Regenerate it from the repository root with
`pnpm --filter @apex/api exec tsx scripts/render-auto-appraisal-fixture.ts`
(requires the repository's Playwright Chromium installation), then visually review
the PNG and its independently transcribed gold answers before another live run.
The saved-run regression pins the exact raster hash: changing it requires a new
recorded evaluation, not reusing an old success claim. The renderer calls no model.

## Evidence and limits

11 October 2026: the first ChatGPT-authenticated Codex run passed all eight
synthetic cases; 87 existing API regressions passed across extraction documents,
source review, model deadlines, AI disclosure, appraisal round-trips and demo
behaviour. These API tests mock provider responses; they do not prove Claude
quality or paid-provider availability.

The follow-up scorer audit reproduced eight false acceptances: swapped property
types, three missing/ambiguous type labels, three substring-only source IDs and
invented top-level financial output. All are rejected after the fix. The scorer
suite now has 17 passing tests, including reordered rows and descriptive labels
that must still pass. Replaying the original saved Codex response passes all
eight fixtures under the stricter scorer, without another provider request.
The prompt now states the label/source formatting contract explicitly; the
replay is evidence about the stored response, not a new run of that prompt.

11 October 2026: a real ChatGPT-authenticated image run passed 3/3 drawing
panels. Its exact synthetic response and image hash are committed in
`apps/api/test/fixtures/auto-appraisal/drawing-run-2026-10-11.json`; CI replays it
without a model call. Six drawing regressions cover the recorded response,
correct transcription, stale revisions, cost/value confusion, total/per-unit
area confusion and wrong suite identity. The text suite still has 17 tests.

This is an initial, repeatable text/annotated-image evaluation harness, not exhaustive AI testing
or activation of the website's Extract button through Codex. It does not test
general PDF handling, unannotated/scaled drawing measurement, real customer documents, full citation accuracy,
professional acceptance or production load. The multi-page PDF extension below covers a fixed synthetic pack. The next
workflow is review/save/report with honest source provenance, followed by approved
anonymised real packs. Website provider
integration remains a separate explicit development change.

## Multi-page PDF mode — 11 October 2026

Run `pnpm --filter @apex/api eval:codex --pdf`. This mode requires local Poppler
`pdfinfo` and `pdftoppm` commands. It renders the fixed synthetic two-page
`revision-pack.pdf` at 100 DPI, verifies the page count and both PNG outputs,
and attaches the pages in numeric order. Each Poppler process has a 30-second
limit. Missing tools, an unexpected page count or failed rendering stops before
any model request. The CLI receives page images, not native PDF input or an
extracted text transcript. This is not the hosted provider's PDF handling path.

The pack contains a superseded flat schedule on page 1, its current replacement
on page 2, and a separate house schedule with no sales value and a later-page
build-cost note. The scorer checks exact current values and a `case-id: page 2:
locator` source for the flat schedule. It rejects page 1, page 20 and missing
locators. This checks the expected page and nonempty locator, not the semantic
accuracy of arbitrary citation text.

The real subscription run passed both cases (2/2). The synthetic response, PDF
hash and rendered-page hashes are saved in `pdf-run-2026-10-11.json` beside the
fixture. Seventeen PDF tests cover that replay, stale revisions, wrong page
references, cost/value confusion, page-count mismatch, unavailable/failed
renderers, missing page output and numeric attachment ordering. Ordinary CI
replays saved evidence and tests the conversion orchestration with stubs; it
makes no model call and does not require Poppler. Real local conversion was
executed and both rendered pages were visually reviewed before the model run.

Rebuild the fixture with `python3 apps/api/test/fixtures/auto-appraisal/create-revision-pdf.py`
(requires ReportLab). Its invariant PDF output avoids timestamp drift. Review
both pages and the independent gold answers after edits. A changed PDF requires
new evidence; the saved-response test pins its SHA-256.

Next: an approved review/save/report journey using these extracted inputs and
source provenance, then anonymised real packs. Real-world scans, encrypted or
malformed PDFs, lengthy packs, geometric measurement, native provider behaviour,
production integration and professional acceptance remain unverified.
