# Concurrent workspace HTTP baseline

`apps/web/performance/workspace-load.spec.ts` runs through real HTTP/tRPC and
persistence. It creates three synthetic trial workspaces, each with one deal,
then runs one and three closed-loop workers for 50 rounds each. Every round
lists the worker's own portfolio, saves a distinct appraisal version, reloads
and compares the financial result with the deterministic engine, and attempts
a foreign workspace read which must return NOT_FOUND. All workers settle before
cleanup; each created workspace is erased, including after an assertion failure.

Run against a local disposable stack (the harness refuses non-loopback hosts):

```sh
E2E_BASE_URL=http://localhost:8080 pnpm --filter @apex/web exec playwright test --config playwright.performance.config.ts
```

CI runs this separately after the browser suite against the built nginx/API/
PostgreSQL stack. Its `workspace-load-baseline` artifact retains the JSON results
for 14 days, including per-request status and duration, per-route nearest-rank
p50/p95/max, phase throughput, verification and cleanup outcomes. Tokens, emails,
passwords and response bodies are excluded. The Actions run identifies the exact
commit and runner. Request deadlines are 10 seconds; these are hang guards, not
customer latency promises. Failed attempts remain in the artifact, with status
zero when no response was received. Setup and cleanup are outside measurements.

On 11 October 2026 the full profile passed locally against the development stack:
800 measured requests, 200 saved/reloaded appraisals, 200 expected foreign-read
refusals, all three synthetic workspaces removed. Local SQLite timings must not
be used as PostgreSQL or production performance evidence. CI measurements belong
to the exact commit's Actions artifact, not a hand-copied capacity estimate.

## Limits and remaining acceptance

This small baseline catches HTTP/persistence/isolation regressions under a bounded
burst. It has no warm-up, think time or sustained arrival rate; observed throughput
is not maximum capacity. CI uses elevated rate limits for shared-runner testing.
It does not test concurrent writers to the same appraisal, large portfolios,
scanned files, uploads, PDF rendering, AI calls, paid-provider budgets, production
network conditions, resource consumption or saturation. It does not establish
an uptime SLO or a per-customer cost.

Next extend the profile with representative portfolio/document sizes and a
separate renderer/upload workload, record CPU/memory and environment sizing,
then agree latency/error targets and measure sustained load on an authorised
staging environment. Provider-funded extraction and actual infrastructure costs
remain separate owner-dependent evidence. Never run this fixture against a
customer workspace or substitute its timings for professional acceptance.
