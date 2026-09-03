# Apex Appraise over MCP

The deterministic appraisal engine, as tools an AI assistant can call.

The point is what it *refuses* to be. The easy version of this is a server that
fetches figures and lets the model do the arithmetic on them — which is exactly
the thing this product's first rule forbids. Here the model states a scheme and
gets back what `computeAppraisal` produced: the same function, in the same
package, that the appraisal screen, the .xlsx export, the Red Book certificate
and a customer's own `/api/v1` integration all call. Every figure it hands back
is one a valuer could sign, because it is the figure the report would carry.

## Running it

Nothing is built or published — it runs from source under `tsx`, the way the
API does in production.

```bash
pnpm install
node --import tsx packages/mcp-server/src/index.ts   # or: pnpm --filter @apex/mcp-server start
```

### Claude Desktop / Claude Code

Add to your MCP client's config, with an absolute path to your clone:

```json
{
  "mcpServers": {
    "apex-appraise": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/apex-appraise/packages/mcp-server/src/index.ts"],
      "env": {
        "APEX_API_KEY": "apex_live_…",
        "APEX_API_URL": "https://apex.yourfirm.co.uk"
      }
    }
  }
}
```

Both variables are **optional**. Without them the ten calculation tools work
exactly as they are — modelling a scheme needs no key, no network and no
account. The three tools that read a workspace say what is missing if you call
one.

## What it exposes

**Calculation — no workspace, no key, no network.**

| Tool | |
|---|---|
| `apex_conventions` | the engine version, the asset classes, and what each jurisdiction calls things |
| `apex_appraise` | the full residual appraisal: GDV, cost, residual land value or profit, returns, peak debt, cashflow |
| `apex_appraise_quick` | the same arithmetic from one blended build rate — what fits on a planning notice |
| `apex_sensitivity` | the grid, re-running the whole appraisal per cell rather than scaling the base case |
| `apex_compare_schemes` | option A/B/C on four levers, ranked by residual land value |
| `apex_capitalise_income` | a rent roll capitalised — the value of an operated asset |
| `apex_dcf` | the growth-explicit cross-check, and the equated yield the two methods agree at |
| `apex_land_tax` | SDLT on the slice bands, England & Northern Ireland |
| `apex_infrastructure_levy` | CIL, per square metre, on an area given in square feet |
| `apex_compare_appraisals` | what moved between two versions, and what it did to the figures |

**Workspace — needs `APEX_API_KEY`.**

| Tool | |
|---|---|
| `apex_deals_list` | the pipeline, cursor-paginated |
| `apex_deal_get` | one deal, its appraisal computed at the moment you ask |
| `apex_portfolio_exposure` | positions, concentration and covenant breaches |

## Three things it deliberately does not do

**It does not write.** Every workspace route it calls is a GET. That is why this
server has no answer to the audit-trail question every mutation in this product
must answer — it never has to. A write tool writes an audit event or it does not
ship.

**It does not talk to the database.** `/api/v1` already exists, is already
authenticated by an org-scoped key, and already refuses another firm's ids with
the same 404 it gives for one that never existed. A second path to the same rows
is a second place to get that wrong.

**It does not have an opinion.** `apex_appraise_quick` returns no verdict, even
though the screens print one, because a verdict is a judgement against the
firm's own thresholds — which live on their workspace, not in this engine. A
verdict invented here would read as the product's view of a scheme while being
nobody's.

## A note on the land tax

`apex_land_tax` is **England and Northern Ireland** SDLT. Scotland levies LBTT
and Wales LTT, on different bands, and neither is this. `apex_conventions`
reports `landTaxModelled: false` for every region outside GB for the same
reason: the duty is real everywhere and this engine models one country's, so a
figure presented under a local name would be a wrong number wearing the right
label.
