# Deploying Apex Appraise

The production build is a validated three-container stack: **nginx web** (static React app,
proxies `/trpc`, `/uploads`, `/reports`, `/webhooks`) → **API** (Fastify + tRPC) → **PostgreSQL 16**.

## Option A — any Docker VPS (recommended, works today)

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
ENV
$EDITOR .env   # paste real values in; both are REQUIRED and the stack will not start without them
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
STRIPE_WEBHOOK_SECRET=                   # POST /webhooks/stripe
TILE_URL=                                # map tiles — READ THE NOTE BELOW
TILE_ATTRIBUTION=                        # the credit line that provider requires
TILE_USER_AGENT=YourFirm/1.0 (ops@yourfirm.co.uk)   # who to contact about our traffic
ENV

# 3. run
docker compose up -d --build
```

### Map tiles need a decision before you sell this

Tiles are fetched and re-served by the API, never by the visitor's browser, so no mapping
provider learns who your valuers are or which sites they opened. That part is settled.

What is **not** settled is where the tiles come from. Unset, `TILE_URL` points at
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

## Option B — Fly.io (sketch)

```bash
fly auth login
fly postgres create --name apex-db --region lhr
fly launch --dockerfile infra/api.Dockerfile --name apex-api --region lhr --no-deploy
fly postgres attach apex-db -a apex-api          # sets DATABASE_URL
fly secrets set -a apex-api JWT_SECRET=$(openssl rand -hex 32)
fly deploy -a apex-api
# web: build with VITE pointing at the api host, or run the web image with the nginx
# upstream env pointed at apex-api.internal:4100 (see infra/web.Dockerfile).
```

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

### 1. Deploy (blocked today)

`flyctl auth login` on this machine, then:

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
