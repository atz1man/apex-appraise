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

# 3. run
docker compose up -d --build
```

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
