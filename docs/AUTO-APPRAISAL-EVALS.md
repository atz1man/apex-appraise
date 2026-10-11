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

Scoring checks exact numeric inputs and raw nulls before production defaults can
hide missing evidence, requires case-linked sources, refuses unknown fields and
validates each result through Apex's `zExtraction`. Missing core unit fields must
produce no invented units. The model does not compute appraisal money. Existing
appraisal round-trip and engine tests exercise the deterministic calculations.

Run `pnpm --filter @apex/api exec vitest run test/auto-appraisal-eval.test.ts`
for deterministic scorer regressions without using the subscription. Those tests
prove corrupted counts, stale revisions, fabricated prices, missing source
citations, unexpected financial outputs and duplicate cases cannot pass silently.
Only the scorer tests run in ordinary CI; the live model run is opt-in locally.

## Evidence and limits

11 October 2026: the first ChatGPT-authenticated Codex run passed all eight
synthetic cases; 87 existing API regressions passed across extraction documents,
source review, model deadlines, AI disclosure, appraisal round-trips and demo
behaviour. These API tests mock provider responses; they do not prove Claude
quality or paid-provider availability.

This is an initial, repeatable text-evaluation harness, not exhaustive AI testing
or activation of the website's Extract button through Codex. It does not test
PDF/image/drawing interpretation, real customer documents, citation page accuracy,
professional acceptance or production load. Next: add independently labelled
synthetic drawing/PDF fixtures and approved anonymised real packs, then test their
review/save/report journey with honest source provenance. Website provider
integration remains a separate explicit development change.
