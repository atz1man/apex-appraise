# Deploying Apex Appraise

**Production runs on Fly.io** — two apps in `lhr`, `apex-appraise-web` (public) and
`apex-appraise-api` (flycast-only), serving at https://apex-appraise-web.fly.dev. See
[`DOMAIN.md`](DOMAIN.md) for the app layout and how to put a custom domain in front of it,
and **Option B** below for the deploy commands.

The same build also runs as a self-contained three-container stack: **nginx web** (static
React app, proxies `/trpc`, `/uploads`, `/reports`, `/webhooks`) → **API** (Fastify + tRPC) →
**PostgreSQL 18**. That is what `docker-compose.yml` brings up, and it is what the demo
instance and CI use.

There is no CD, and a release is still a decision — but it is now a BUTTON rather than a
command that only one computer can run. `ci.yml` runs the tests and stops; `deploy.yml`
ships main to Fly on `workflow_dispatch`, from the Actions tab or a phone.

Run it from **Actions → Deploy → Run workflow**, choosing `both`, `api` or `web`. It deploys
the API before the web app (nginx proxies `/trpc`, so the reverse order breaks every data
screen for the length of the second deploy), then proves the site is actually serving by
asking the public host for `/login` and `/ready` — the second is proxied to the API and
checks the database, which a front-end-only smoke test would miss.

It needs one repository secret, `FLY_API_TOKEN`:

```bash
fly tokens create deploy -a apex-appraise-api
```

**Why this exists.** A green CI run and a merged PR mean the code is CORRECT, never that it
is RUNNING. On 4 September the live API was found to be serving an image built on 10 August
— three and a half weeks of merged work was not live, and nothing said so, because nothing
was watching the deployment rather than the code. Setting a secret does not ship code
either: `fly secrets set` restarts the machine with a new environment, which is why a
correctly-set Google Maps key changed nothing until the build that had a `/staticmap` route
in it was deployed.

Deploying by hand still works and is unchanged — **Option B** below for Fly, **Option A**
for a self-hosted stack:

## Option A — any Docker VPS (self-hosting, or a second instance)

Tested end-to-end on this stack. On a fresh Ubuntu/Debian VPS (Hetzner, DigitalOcean, Lightsail…):

```bash
# 1. install docker (once)
curl -fsSL https://get.docker.com | sh

# 2. clone and configure
git clone https://github.com/atz1man/apex-appraise.git && cd apex-appraise
# Secrets go in a .env file in the repo root, NOT in your shell. compose reads
# it automatically, and so does every later `docker compose exec` — including
# the ones the backup and restore-check cron jobs make, which run with almost
# no environment and cannot see your exports. .env is gitignored.
cat >> .env <<'ENV'
JWT_SECRET=REPLACE_ME          # openssl rand -hex 32 — keep it safe
POSTGRES_PASSWORD=REPLACE_ME   # openssl rand -hex 32 — the database password
ENCRYPTION_KEY=REPLACE_ME      # openssl rand -hex 32 — seals credentials at rest
ENV
$EDITOR .env   # paste real values in; the first two are REQUIRED and the stack will not start without them
### About `ENCRYPTION_KEY`

Xero and open-banking refresh tokens, the API keys a workspace pastes in for the
EPC register and Companies House, and each webhook endpoint's signing secret are
encrypted in the database (AES-256-GCM). A Xero refresh token is a standing key
to the customer's whole accounting ledger and a TrueLayer one reads their bank
feed, so a copy of the database — a stolen dump, a misconfigured replica, or one
of the backups `infra/backup.sh` makes on purpose — must not hand over both.

It is **optional**, and the only variable here that is optional for a reason
worth reading. Left unset, the key is derived from `JWT_SECRET` by HKDF, so an
existing deployment is protected on its next deploy rather than refusing to boot
until somebody reads a changelog. The cost of leaving it unset is that
**rotating `JWT_SECRET` then makes every sealed field unreadable**, and every
integration has to be reconnected by hand. Set it and the two rotate
independently.

Rotating `ENCRYPTION_KEY` itself has the same consequence today: sealed values
carry the id of the key that sealed them and refuse to open under a different
one, with an error saying so rather than returning rubbish. Reconnecting Xero,
the bank feed and the self-serve providers is the recovery, and re-adding
webhook endpoints. Pick the key once.

# Optional integrations — same file, same reason. Each degrades gracefully to a
# clearly-labelled demo mode when unset, which is exactly why they belong here
# and not in a shell: a later rebuild without them does not fail, it quietly
# turns live AI extraction and real payments back off.
cat >> .env <<'ENV'
ANTHROPIC_API_KEY=                       # live AI extraction in Auto-Appraisal
SMTP_URL=smtp://user:pass@host:587       # invite + welcome email delivery
EMAIL_FROM=Apex Appraise <no-reply@yourdomain.co.uk>
APP_URL=https://app.yourdomain.co.uk     # used in email links
STRIPE_SECRET_KEY=                       # live buyer card payments
DEMO_MODE=                               # set to 1 ONLY on a demo instance — see below
STRIPE_WEBHOOK_SECRET=                   # POST /webhooks/stripe
TILE_URL=                                # map tiles — READ THE NOTE BELOW
TILE_ATTRIBUTION=                        # the credit line that provider requires
TILE_USER_AGENT=YourFirm/1.0 (ops@yourfirm.co.uk)   # who to contact about our traffic
ENV

# 3. run
docker compose up -d --build
```

### Demo fallbacks are off in production

Without `STRIPE_SECRET_KEY` the buyer portal has nothing to charge a card with.
On a demo instance it settles the payment instantly so the flow can be shown;
in production it refuses and tells the buyer to contact you. It will not mark a
deposit PAID when no money moved — that figure feeds your sales ledger and your
exposure numbers, and a deposit you have not received is worse than one the
portal declined to take.

The same switch governs Auto-Appraisal. Without `ANTHROPIC_API_KEY` it returns
a built-in worked example rather than a reading of your documents — complete
with unit values and citations like "Drawing A-102" for a drawing your deal has
never had, which can then be saved into a real appraisal. In production it
refuses and points you at manual entry instead.

Set `DEMO_MODE=1` only if this deployment IS the demo.

### Maps: Google imagery if configured, tiles otherwise — and one decision left

Nothing about the map is fetched by the visitor's browser. Whichever source is in use, the
API fetches it and re-serves it, so no mapping provider learns who your valuers are or which
sites they opened. That part is settled, and `e2e/third-party.spec.ts` keeps it settled.

**With a Google key set**, every map in the product — Site Pack, Comparables and the Red
Book — is a Google Static Map with aerial imagery:

```bash
GOOGLE_MAPS_API_KEY=...          # restrict to the Maps Static API, and by IP (this server)
GOOGLE_MAPS_SIGNING_SECRET=...   # optional; raises the unsigned request limit
```

Restrict that key **by IP address, not by HTTP referrer** — nothing referring to it is a
browser. Neither value ever reaches a page; the API signs each request with an HMAC and
fetches the image itself. Google's interactive JavaScript API is deliberately not used: it
must load in the page and may not be proxied, which would put every valuer's IP address and
every site's coordinates in front of Google. See `apps/api/src/staticmap.ts`.

Two things to confirm before this carries paying customers: that Google's current terms
permit the bounded in-memory cache the proxy keeps (same shape as the tile cache), and what
Static Maps costs at your volume.

**Without a key** — the public demo, CI, and any workspace with no Google account — the app
falls back to the Leaflet tile map. That fallback is the default path rather than the unhappy
one, and it is the path the whole browser suite exercises.

Which leaves the tile question still open, for the fallback. What is **not** settled is where
the tiles come from. Unset, `TILE_URL` points at
OpenStreetMap's public tile servers, which are donation-funded and whose usage policy
forbids heavy use by a distributed application without prior permission from the Operations
Working Group. That default is right for local development and a demo; it is **not** a
licence to run a commercial product off it. Before you take paying customers, either:

  - point `TILE_URL` at a provider you pay (MapTiler, Mapbox, Ordnance Survey — OS Maps is
    the natural fit for a UK product), and set `TILE_ATTRIBUTION` to the credit line their
    terms require; or
  - ask the OSM Operations Working Group for permission, and abide by whatever they say.

Set `TILE_USER_AGENT` either way. The policy asks for a User-Agent that identifies the
application so somebody can contact you about a problem; the default names this repository,
which is no use to anyone once you are running your own deployment.

The app is served on port **8080** (put Caddy/Traefik or a cloud load balancer with TLS in
front and point it at `:8080`). Postgres data and uploaded files live in named Docker volumes
(`pgdata`, `uploads`) — snapshot those for backups. The API applies migrations on first boot.

**It does not create any accounts.** A production build (`NODE_ENV=production`, which is what
this compose file sets) seeds demo data only when `SEED_DEMO=1` is set — so a real deployment
comes up with an empty database and you register the first workspace through the app at
`/register`. That used to run the other way: the demo org was seeded on day one of going live,
putting `arthur@apexappraise.co.uk`, `investor@demo.co.uk` and `buyer@demo.co.uk` on the
internet with the password `demo`, and this runbook asked you to remember to remove them.

Set `SEED_DEMO=1` only where sample deals are the point — a sales demo, or CI.
For a demo instance specifically — which switches this on deliberately, alongside
`DEMO_MODE=1` — see [`infra/DEMO.md`](DEMO.md), and hand the tester
[`docs/DEMO-WALKTHROUGH.md`](../docs/DEMO-WALKTHROUGH.md).

## Option B — Fly.io (the live deployment)

The apps already exist, and their configuration is committed:
[`fly.api.toml`](fly.api.toml) and [`fly.web.toml`](fly.web.toml). Deploying a release is
two commands:

```bash
fly auth login                       # once per machine
fly deploy -c infra/fly.api.toml
fly deploy -c infra/fly.web.toml
```

The API applies migrations on boot (`infra/entrypoint.sh`), so a schema change lands with
the deploy rather than needing a separate step.

Secrets are set on the app, never committed:

```bash
fly secrets set -a apex-appraise-api JWT_SECRET=... ENCRYPTION_KEY=... ANTHROPIC_API_KEY=...
fly secrets list -a apex-appraise-api
```

For the ORIGINAL creation of the pair — which has already happened and is recorded here so
the layout is reproducible, not as a step to run:

```bash
fly postgres create --name apex-appraise-db --region lhr
fly postgres attach apex-appraise-db -a apex-appraise-api    # sets DATABASE_URL
```

The web app reaches the API over Fly's private network at `apex-appraise-api.internal:4100`;
see `infra/web.Dockerfile` for the nginx upstream. That is why the API app publishes no
public address, and why the `demo-reset` workflow curls the WEB host rather than the API.

## Stripe webhook

In the Stripe dashboard add an endpoint `https://<your-host>/webhooks/stripe` subscribed to
`payment_intent.succeeded`, and set its signing secret as `STRIPE_WEBHOOK_SECRET`. Without
Stripe keys the buyer portal runs in clearly-labelled demo mode (payments settle instantly).

## Ops: backups, restores and monitoring

Three scripts, each of which exits non-zero when it fails, so `cron`'s `MAILTO` reaches you
even before you configure anything cleverer.

```bash
# nightly backup — Postgres + uploaded files, verified before it replaces anything
0 2 * * * cd /opt/apex-appraise && ./infra/backup.sh /var/backups/apex >> /var/log/apex-backup.log 2>&1

# monthly: prove the newest backup actually restores, into a throwaway database
0 4 1 * * cd /opt/apex-appraise && ./infra/restore-check.sh /var/backups/apex >> /var/log/apex-restore-check.log 2>&1

# every 5 minutes, FROM ANOTHER MACHINE — a watchdog on the box dies with the box
*/5 * * * * cd /opt/apex-appraise && ALERT_WEBHOOK=https://hooks.slack.com/... ./infra/watchdog.sh https://app.yourdomain.co.uk >> /var/log/apex-watchdog.log 2>&1
```

These run from cron, which has no shell environment, so both scripts begin by
checking that `docker compose` can read its own configuration — it interpolates
the whole file for `exec`, so a missing `JWT_SECRET` or `POSTGRES_PASSWORD`
would otherwise surface as a confusing failure inside `pg_dump`. That is what
the `.env` file above is for. Set `BACKUP_DB_URL` (backup) or `SERVER_URL`
(restore-check) instead if your database is managed and compose is not involved.

On a managed database (RDS, Fly, Neon) both scripts take the connection instead
of the compose service — `BACKUP_DB_URL` for each. Pass the full URL including
its parameters; the restore check swaps only the database name and keeps the
rest, so an `sslmode=require` or `channel_binding=require` you set is still
there when it connects to the scratch database.

**Run `./infra/restore-check.sh` once, by hand, the day you set backups up.** It restores the
newest dump into a scratch database, counts the rows, and drops it. Until it has passed once,
you have a backup process, not a backup — `pg_dump` exiting 0 only means it wrote a file.

Offsite is one variable, and until you set it the backups live on the disk they are protecting:

```bash
export BACKUP_UPLOAD_CMD='rclone copy "$1" b2:apex-backups/'   # or aws s3 cp "$1" s3://…
```

`BACKUP_DB_URL` makes both scripts talk to a managed Postgres (RDS, Fly Postgres, Neon)
instead of the compose `db` service.

### Health endpoints — the two are not interchangeable

- `GET /health` — **liveness.** Is the process alive? No dependencies, always 200 while it can
  answer. Point a supervisor here: restarting the API because *Postgres* blipped fixes nothing
  and turns an outage into a crash loop.
- `GET /ready` — **readiness.** Can it serve a request? Checks the database with a 3s timeout
  and returns **503 with the reason** when it cannot. Point load balancers, uptime monitors and
  the Fly health check here.

There used to be only `/health`, and it returned `{ok: true}` without touching anything — so it
stayed green while the database was unreachable and every request in the product was failing.
A monitor that cannot go red is worse than no monitor: it is the thing you check first at 3am.

## Other ops notes


- Financial mutations and document access are audit-logged (`ActivityEvent`).
- Login lockouts and reset throttles live in Postgres (`AuthThrottle`), so they hold across
  however many API instances you run. They used to be per-process Maps, which meant five
  password guesses *per instance* and a lockout the other machine had never heard of.
- The HTTP rate limiter (`@fastify/rate-limit`) is still per-instance, and that is a
  deliberate trade rather than an oversight. It is a volumetric backstop, not the auth
  control — the auth control is the table above, and it is shared. If you scale out and want
  volumetric limiting to be shared too, the right layer is nginx, which already sits in front
  of every instance and needs no new infrastructure:

  ```nginx
  # in the http{} block
  limit_req_zone $binary_remote_addr zone=apex:10m rate=30r/s;
  # then inside the location blocks you want protected
  limit_req zone=apex burst=60 nodelay;
  ```

  Not enabled by default: the right rate depends on your traffic, and a limit guessed here
  would throttle a busy firm rather than an attacker.
- CI (GitHub Actions) runs the engine's 48 golden tests, both typechecks, and a full
  Postgres schema/seed validation on every push.

## Going live: the four things only the owner can do

Everything below is already built and exercised in demo/sandbox mode. Each item is
a credential or a decision, and the product states honestly what it cannot do
until each one is supplied — it does not pretend.

### 1. Deploy — done, and this is how each release goes out

Fly is live. Nothing here is blocked; what follows is the release procedure rather than a
first-time setup. `flyctl auth login` once on the machine you deploy from, then:

```bash
fly deploy -c infra/fly.api.toml
fly deploy -c infra/fly.web.toml
```

The API applies migrations on boot (`infra/entrypoint.sh`), so the trial-expiry
migration lands with the deploy. Existing TRIAL workspaces are given a fresh 14
days at that moment rather than being retro-expired.

### 2. Email — nothing reaches a real inbox until this is set

Without `SMTP_URL`, invites, password resets and welcome mail go to an in-memory
demo mailbox. Self-serve signup does not work for a real customer in that state.

```bash
fly secrets set -a apex-appraise-api \
  SMTP_URL='smtp://apikey:SG.xxxx@smtp.sendgrid.net:587' \
  EMAIL_FROM='Apex Appraise <no-reply@apexappraise.co.uk>' \
  APP_URL='https://apex-appraise-web.fly.dev'
```

Then add SPF and DKIM records for the sending domain, or the mail will send and
land in spam — which looks identical to it not sending. The demo mailbox disables
itself the moment `SMTP_URL` is set (`email.ts`), so a production instance cannot
serve messages out of it.

### 3. Stripe — sandbox keys cannot take money

The keys in `.env` are `sk_test`/`pk_test`. Checkout, plan sync and buyer payments
are all proven against them; going live is a key swap plus tax settings.

```bash
fly secrets set -a apex-appraise-api \
  STRIPE_SECRET_KEY='sk_live_...' \
  STRIPE_PUBLISHABLE_KEY='pk_live_...' \
  STRIPE_WEBHOOK_SECRET='whsec_...'
```

In the Stripe dashboard: turn on Tax if charging VAT, and set the customer portal
so subscribers can cancel without emailing support. The billing panel shows a
STRIPE TEST MODE chip whenever the publishable key starts `pk_test`, so a live
instance still running sandbox keys is visible rather than silent.

### 4. Identify the operating company

`apps/web/src/legal/entity.ts` holds the company name, number, registered office,
VAT number and ICO registration, with `confirmed: false`. While it is false, the
privacy notice and terms publish with a banner saying they are not yet in force.
Fill the fields, set `confirmed: true`, and have a solicitor read both pages —
the liability section deliberately states that its limit is still being settled
rather than inventing one.

A UK controller also needs an ICO registration (ico.org.uk, ~£52/yr) before
processing customer data commercially.
