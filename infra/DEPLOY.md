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
export JWT_SECRET="$(openssl rand -hex 32)"     # REQUIRED — keep it safe
# optional integrations (all degrade gracefully to demo mode when unset):
export ANTHROPIC_API_KEY=...                    # live AI extraction in Auto-Appraisal
export SMTP_URL="smtp://user:pass@host:587"     # invite + welcome email delivery
export EMAIL_FROM="Apex Appraise <no-reply@yourdomain.co.uk>"
export APP_URL="https://app.yourdomain.co.uk"   # used in email links
export STRIPE_SECRET_KEY=sk_live_...            # live buyer card payments
export STRIPE_WEBHOOK_SECRET=whsec_...          # POST /webhooks/stripe
export TILE_URL="https://.../{z}/{x}/{y}.png?key=..."   # map tiles — READ THE NOTE BELOW
export TILE_ATTRIBUTION="&copy; Your provider"  # the credit line that provider requires
export TILE_USER_AGENT="YourFirm/1.0 (ops@yourfirm.co.uk)"  # who to contact about our traffic

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
(`pgdata`, `uploads`) — snapshot those for backups. The API pushes the schema and seeds the
demo org on first boot; **change the demo passwords or delete the demo users before going
live** (`Settings → Members`, or reseed with your own data).

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

## Ops notes

- Health check: `GET /health` on the API (`:4100` inside the network).
- Financial mutations and document access are audit-logged (`ActivityEvent`).
- Login throttling is in-memory per instance — put a rate limiter (or Redis-backed store)
  in front if you scale the API horizontally.
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
