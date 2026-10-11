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

## Report/upload contention profile

The same command also runs `report-upload.spec.ts` and retains `report-upload.json`.
It creates two synthetic workspaces and concurrently uploads six byte-distinct,
small PDFs with the same filename. Downloads must match the original SHA-256,
storage URLs must be unique, and the other workspace must receive 404. Six PDF
report requests then compete for the existing two renderer slots: successful
responses must have PDF headers, the expected filename and a complete PDF marker;
busy responses must be 503 with Retry-After 5 and actionable retry text. After all
burst jobs settle, a sequential report request from each workspace must succeed.

Both profiles passed locally on 11 October 2026. CI evidence belongs to the exact
PR commit and artifact. This adds real renderer saturation/recovery and file-byte
checks; it does not compare PDF text/layout, model large scans or establish cost,
sustained throughput or customer capacity. No paid provider requests are made.

### File lifecycle finding

The audit found that `org.deleteWorkspace` deletes database records through
`orgCascadeDeletes` but does not remove referenced files from upload storage.
The contention fixture removes its workspace records; disposable CI volume
teardown removes residual fixture bytes. This is **not evidence of physical file
erasure by the product**. The next priority is durable, retryable cleanup of the
workspace's uploaded documents/photos/logos, with tests for failures, shared
references, concurrent uploads and preservation of other tenants' data. Backups
and published retention policy require separate operator evidence.
