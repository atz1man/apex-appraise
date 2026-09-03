#!/usr/bin/env bash
#
# Bring up a PRIVATE demo instance on this machine — the production stack, seeded,
# for one named tester to walk through docs/DEMO-WALKTHROUGH.md.
#
# Why this exists: the six manual steps in infra/DEMO.md are each easy and the
# combination is easy to get half-right. The two failures this removes are a
# .env written by hand with a missing secret (the stack refuses to start and the
# message names only the first missing one), and declaring the demo ready before
# the database is — the API answers /health while Postgres is still starting, so
# "it's up" and "a tester can sign in" are not the same moment.
#
# It is deliberately NOT a deployment script. It publishes nothing, opens no
# port on your router, and leaves the tunnel to you.
#
#   ./scripts/demo-local.sh              bring the stack up, print how to reach it
#   ./scripts/demo-local.sh --tunnel     …then run a Cloudflare tunnel in the foreground
#   ./scripts/demo-local.sh --down       stop it, keeping the data
#   ./scripts/demo-local.sh --reset      destroy the data and reseed from scratch
#
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=.env
WANT_TUNNEL=0

case "${1:-}" in
  --tunnel) WANT_TUNNEL=1 ;;
  --down)   docker compose down; echo "Stopped. Data kept — run again to bring it back."; exit 0 ;;
  --reset)  docker compose down -v; echo "Data destroyed. Run again to reseed."; exit 0 ;;
  "")       ;;
  *)        echo "unknown option: $1 (try --tunnel, --down, --reset)" >&2; exit 2 ;;
esac

# ---- 1. Docker, and enough of it -------------------------------------------
if ! docker info >/dev/null 2>&1; then
  echo "Docker isn't running. Start Docker Desktop and try again." >&2
  exit 1
fi

# The BUILD is the memory spike, not the runtime: pnpm install plus the Vite
# build inside the web image want ~2GB on their own, and a 2GB allowance dies
# mid-build with an exit code that looks like a code fault.
mem_bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
if [ "$mem_bytes" -gt 0 ] && [ "$mem_bytes" -lt 3500000000 ]; then
  echo "WARNING: Docker has $((mem_bytes / 1000000000))GB. The build wants ~4GB."
  echo "         Docker Desktop → Settings → Resources → Memory, then retry."
  echo
fi

# ---- 2. .env, without touching what is already there ------------------------
# Existing values are never rewritten — this file holds real keys, and a script
# that "helpfully" regenerates JWT_SECRET would invalidate every sealed
# credential in the database (see ENCRYPTION_KEY in infra/DEPLOY.md).
touch "$ENV_FILE"
add_if_missing() {
  # $1 = key, $2 = value, $3 = comment shown only when the line is added
  if ! grep -qE "^[[:space:]]*$1[[:space:]]*=" "$ENV_FILE"; then
    { [ -n "${3:-}" ] && printf '# %s\n' "$3"; printf '%s=%s\n' "$1" "$2"; } >> "$ENV_FILE"
    echo "  + $1"
  fi
}

echo "Checking $ENV_FILE (existing values are left alone)…"
add_if_missing JWT_SECRET "$(openssl rand -hex 32)" "signs sessions"
add_if_missing POSTGRES_PASSWORD "$(openssl rand -hex 32)" "database password"
add_if_missing ENCRYPTION_KEY "$(openssl rand -hex 32)" "seals integration credentials at rest"
add_if_missing SEED_DEMO 1 "seed the sample workspace and the three demo logins"
add_if_missing DEMO_MODE 1 "permit the demo fallbacks — see src/demo-mode.ts"
add_if_missing APP_URL "http://localhost:8080" "used in emailed links; set to the tunnel URL if you share one"
# A tester switching between the firm, investor and buyer accounts can trip the
# honest production limit of 10 sign-ins/min, and a refused login reads as a bug.
add_if_missing AUTH_RATE_LIMIT_PER_MIN 100 "demo only — never raise this in a real deployment"
echo

if ! grep -qE '^[[:space:]]*ANTHROPIC_API_KEY[[:space:]]*=[[:space:]]*[^[:space:]]' "$ENV_FILE"; then
  cat <<'NOTE'
No ANTHROPIC_API_KEY set, so AI document extraction will refuse and the
narrative falls back to deterministic templates. Every other journey works.
To turn it on, add a SPEND-CAPPED key to .env and re-run:

    ANTHROPIC_API_KEY=sk-ant-...

Only do that while this instance is private. infra/DEMO.md says why.

NOTE
fi

# ---- 3. Up -----------------------------------------------------------------
echo "Building and starting (first run takes a few minutes)…"
docker compose up -d --build

# ---- 4. Ready, not merely alive --------------------------------------------
# /ready checks the database; /health answers 200 while Postgres is still
# starting. Waiting on the wrong one is how you hand over a URL that 500s.
printf 'Waiting for the database and API'
ready=0
for _ in $(seq 1 90); do
  if curl -fsS http://localhost:8080/ready >/dev/null 2>&1; then ready=1; break; fi
  printf '.'; sleep 2
done
echo

if [ "$ready" -ne 1 ]; then
  echo "Not ready after 3 minutes. What the API says:" >&2
  docker compose logs --tail 40 api >&2
  exit 1
fi

cat <<'READY'

Ready — http://localhost:8080

  Firm (admin)      arthur@apexappraise.co.uk    demo
  Investor portal   investor@demo.co.uk          demo
  Buyer portal      buyer@demo.co.uk             demo

Walk it yourself once before handing it over: sign in, open a deal's appraisal,
download a report PDF. Ten minutes, and it means your tester doesn't find a
dead stack.

Give the tester docs/DEMO-WALKTHROUGH.md along with the link.

READY

# ---- 5. Reaching it from elsewhere -----------------------------------------
if [ "$WANT_TUNNEL" -eq 1 ]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflared isn't installed:  brew install cloudflared" >&2
    exit 1
  fi
  cat <<'SLEEP'
Two things before you share the URL:

  * This machine must not sleep, or the tunnel dies mid-session and looks like
    a bug in the app. In another terminal:  caffeinate -dimsu
  * Ctrl-C here closes the tunnel. The stack keeps running.

SLEEP
  exec cloudflared tunnel --url http://localhost:8080
fi

cat <<'NEXT'
To let someone else reach it, without opening a port on your router:

    ./scripts/demo-local.sh --tunnel

That needs cloudflared (brew install cloudflared) and prints an HTTPS URL. If
you have a domain on Cloudflare, prefer a named tunnel with Cloudflare Access
in front — then only the addresses you list can get in at all.

NEXT
