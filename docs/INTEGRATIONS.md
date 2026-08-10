# Integrations

## Xero (accounting)

Why this one matters more than the others: every figure the lender work rests on
— drawdown against works, covenant tests, the funding pack — comes from
`CostPackage.committed`. Until this existed, a human typed it in. A monitoring
pack built on hand-keyed numbers is one a lender is right to distrust.

### What it does

Pulls supplier bills (ACCPAY, excluding drafts, voided and deleted) and
attributes them to schemes through a Xero **tracking category** the firm nominates.
Attribution is per LINE, because one contractor invoice routinely covers several
sites and counting its total against whichever option appeared first would move
money between schemes.

Spend lands in its own cost package per deal, marked `source: 'xero'`. It never
touches a manual package: a quantity surveyor's budget, progress and retention are
their professional judgement. The budget on a Xero package is set once by a human
and preserved across every sync — the ledger knows what has been spent, not what
was allowed.

Anything it cannot attribute is REPORTED, not guessed: untracked lines are
totalled, and tracking options nobody has mapped come back as `unmapped`.

### What you must do

1. Register an app at https://developer.xero.com (free). Set the redirect URI to
   `https://<your-host>/integrations/xero/callback`.
2. Set `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` on the API. Until then the
   product says so plainly rather than pretending to offer a connection.
3. Connect from Settings, choose the tracking category that names your schemes,
   and map each tracking option to a deal.

Scopes requested are read-only (`accounting.transactions.read`,
`accounting.settings.read`). Apex reports on the ledger and has no business
writing to it.

### The thing that breaks Xero integrations

Refresh tokens **rotate**: every refresh returns a new one and kills the one used.
Lose that write — a crash between the HTTP call and the database, or two requests
refreshing at once — and the connection is dead permanently, with no error until
the next sync. So the rotated token is persisted before it is used for anything,
and a refresh already in flight is shared rather than raced.

That sharing is per-process. Running several API instances wants a database lock
instead; this is a known limit rather than a solved problem, and it is written
here rather than implied by silence.

### Disconnecting

Removes the tokens and the deal mappings. Packages already pulled are LEFT — they
are the firm's cost record now, and deleting a month of monitoring because someone
unlinked an account would be the integration doing damage on its way out.
