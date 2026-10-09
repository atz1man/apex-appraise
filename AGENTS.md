# AGENTS.md

For any coding agent working in this repository — Codex CLI, Copilot, Cursor,
anything that reads this file by convention. Claude Code reads `CLAUDE.md`.

## Read CLAUDE.md first. It is the contract, not a style guide.

`CLAUDE.md` at this root is the single source of truth: the layout, the
commands, the non-negotiables from the design handoff, and every mechanical
guard. **This file deliberately does not repeat any of it.** `apps/api/src/trpc.ts`
says why about permission checks — "a rule that exists in several places is one
edit away from meaning different things in each" — and two agent files
restating the same rules in their own words is that defect in documentation
form. The rules live there; what lives here is how to work alongside another
agent without either of you breaking the other's work.

## What makes this repository unusual, and what it means for you

This is a UK property-development **appraisal** platform. Figures it prints go
under a chartered valuer's signature and into a lender's credit paper, so the
standard here is not "the tests pass" but "a number on screen is one somebody
could sign". Two consequences you will meet immediately:

**The guards are mechanical and they walk the real code.** They do not check a
hand-kept list — they read the actual tRPC router, the actual route table, the
actual token union — so a procedure or screen you add is swept the day you add
it, and CI fails with a message naming *yours*. That is the design. **Read the
failure rather than adding an exemption.** An exemption needs a written reason
in the test itself, which is the convention every existing one follows.

**A figure nobody computed must not appear.** The sharpest recurring defect in
this codebase's history is a surface asserting an analysis nothing performed: a
sensitivity grid showing one number in all twenty-five cells, an evidence panel
reporting "4 / 4 comparables within 0.8 mi" with no distance computed anywhere,
a marketing page claiming VAT was computed when no VAT exists in the engine, a
green "Connected" dot for a provider the server cannot contact. If you cannot
compute it, say what is not known. `CLAUDE.md` has each of these with the guard
that now prevents it.

## The commands you will actually need

Verified against `package.json` — nothing here is aspirational.

```bash
pnpm install && pnpm db:push && pnpm seed && pnpm dev   # full local start
pnpm --filter @apex/appraisal-engine test                # engine (pure maths)
pnpm --filter @apex/appraisal-engine lint                # engine typecheck
cd apps/api  && npx vitest run                           # API + every router sweep
cd apps/web  && npx vitest run                           # web unit + every tree sweep
cd apps/web  && npx tsc --noEmit                         # web typecheck (strict)
cd apps/web  && npx playwright test                      # e2e (needs web 5273 + api 4100 up)
pnpm --filter @apex/mcp-server test                      # MCP wiring
```

Before you trust a green run, read **Gotchas** in `CLAUDE.md`. Several of them
cost a wrong diagnosis rather than a red build — the e2e rate limiter, dev-database
drift, `tsx watch` dying silently on a mid-edit save, and a sandbox Playwright
browser that mismatches the pinned one.

## The guards, as an index

Not a second copy of the rules — a map from the thing you are about to do to the
test that will stop you. Each entry's reasoning is in `CLAUDE.md` under the same
name.

| If you are… | …this fails you |
|---|---|
| adding a tRPC procedure | `reachable`, `provenance-sweep`, `isolation-sweep`, `viewer-readonly`, `no-query-writes` |
| adding a screen or route | `route-reachable`, `page-title`, `screen-heading`, `reachable` |
| writing any component markup | `no-raw-hex`, `accessible-names`, `symbol-buttons`, `headings`, `section-name`, `dialogs` |
| adding a control that writes | `write-controls`, `destructive`, `unsaved`, `announcements` |
| adding a Prisma model | `cascade`, the seed wipe list, `prisma db push` **and** a migration |
| touching engine arithmetic | `engine` — the ENGINE_VERSION fingerprint; **bump the version, never just the hash** |
| deriving a figure outside the engine | `one-engine-sweep`, `nullable-figure-sweep` |
| adding an empty state | `load-failure` — a screen that could not look must not claim the firm has nothing |
| adding a chart | `graphics-contrast` — every data mark ≥ 3:1; a structural mark declares data-decorative **on the mark itself** |
| reading an env var | `env-coverage` — it must reach both deployment files |
| adding a raw Fastify route | `raw-route-sweep`, `proxy-coverage` |
| seeding demo data | `seed-depth` — a demo deal carries what its stage implies, and invents nothing |
| editing **this file** | `agent-docs` — every command, guard name and path here must resolve |

Any **new** sweep you write needs a "finds what it is meant to find" case. A
sweep over an empty file list passes in silence, reporting success for a
question it never asked.

## Working alongside another agent

Claude Code sessions in this repo develop on their own `claude/*` branch and
open a draft PR. To avoid both of you rewriting each other's history:

- **Take your own branch.** `codex/<topic>` off the current `main`. Never commit
  to another agent's branch, and never force-push one — a merge commit keeps the
  other side's checkout valid.
- **Let CI be the referee.** It runs the engine typecheck, the full API and web
  suites with every sweep, the Postgres schema check and the browser suite. Neither
  agent's opinion of a change outranks it.
- **Rebase, do not re-litigate.** If `main` moved under you, merge it in and
  resolve; regenerate lockfiles and generated files with the repo's tooling
  rather than by hand.
- **One claim per commit message, with the evidence.** The history here reads as
  a record of defects found and what proved each fix — match it. State what was
  wrong, why it mattered to a valuer or a lender, and the mutants you killed.

## The engine is available over MCP — use it rather than doing the arithmetic

`packages/mcp-server` exposes the deterministic engine's own entry points as MCP
tools: the full residual appraisal, the sensitivity grid, SDLT, CIL, DCF, income
capitalisation and scheme comparison. **Prefer it to computing a figure
yourself.** That is not a convenience, it is this product's first rule — the
model extracts inputs, the engine computes — and a figure you produce by
reasoning is exactly the thing the whole architecture exists to prevent.

Codex CLI reads `~/.codex/config.toml`:

```toml
[mcp_servers.apex-appraise]
command = "npx"
args = ["-y", "tsx", "/absolute/path/to/apex-appraise/packages/mcp-server/src/index.ts"]
```

The ten calculation tools need no key, no network and no account. `packages/mcp-server/README.md`
has the three workspace-reading tools and what they need.

## Three things that will cost somebody real money

- **`.env` at the root is gitignored and holds live keys.** Never print it,
  never commit it, and preserve existing values when editing.
- **This repository is public, and the demo workspace's logins are published in
  it.** A `SEED_DEMO=1` deployment must hold no billable key. `infra/DEMO.md` has
  the table.
- **Commit with a masked noreply address.** A real address in commit metadata is
  one unauthenticated API call away.
