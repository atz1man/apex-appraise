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

## Single sign-on (Microsoft Entra, Google Workspace)

One OIDC implementation covers both. That is not tidiness: every provider-specific
path is another place a verification step can quietly go missing, and the
verification is the entire security of the thing.

### What you must do

1. Register an application with your identity provider. Redirect URI:
   `https://<your-host>/sso/callback`. Scopes: `openid email profile`.
2. In Settings → Single sign-on, give the issuer (for Entra,
   `https://login.microsoftonline.com/<tenant-id>/v2.0`), the client id and
   secret, and the email domains your firm owns.
3. Optionally enforce it, which refuses password sign-in for your workspace —
   including for accounts that had a password before.

### What is checked, and why

An ID token is a signed assertion that a person is who they say. Each check below
has an attack behind it, and each is tested by actually attempting the forgery:

- **Signature**, against the provider's published keys. Without it an identity is
  JSON somebody typed.
- **Algorithm**, pinned to RS256. Accepting `none`, or letting an attacker sign
  with HS256 using the provider's *public* key as the shared secret, are both
  classic forgeries — and that key is published by definition.
- **Issuer and audience.** A genuine token, for a different application, signed by
  a provider we trust, is still not a login here.
- **Nonce.** Otherwise a captured token can be replayed into another session.
- **`email_verified`.** An unverified address is a claim, not an identity.
- **The domain.** Verifying a token proves who signed it, not that its holder is
  entitled to your workspace. A provider may assert any address; only domains the
  firm claims are accepted — and an address already registered to another
  workspace is refused outright.

### Accounts

A first sign-in creates the account with the role you nominate. It carries no
password at all: a placeholder hash would be a credential nobody chose and nobody
rotates, and an empty one never authenticates.

The login screen answers home-realm discovery identically for a known and an
unknown address. Anything else turns it into a way to ask which firms use this
product and who works there.
