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
PDF parsing, unannotated/scaled drawing measurement, real customer documents, citation page accuracy,
professional acceptance or production load. Next: add independently labelled
multi-page PDF fixtures and approved anonymised real packs, then test their
review/save/report journey with honest source provenance. Website provider
integration remains a separate explicit development change.
