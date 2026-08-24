#!/usr/bin/env bash
# Watch the app from outside it, and say something when it stops working.
#
#   ./infra/watchdog.sh https://app.yourdomain.co.uk
#
# Cron every five minutes. Non-zero exit means DOWN, so cron's MAILTO reaches you
# even if you never configure a webhook:
#   */5 * * * * cd /opt/apex-appraise && ./infra/watchdog.sh https://app.yourdomain.co.uk >> /var/log/apex-watchdog.log 2>&1
#
# It checks /ready, not /health. /health only says the process is running, which
# is also true of a process that cannot reach its database and is failing every
# request. See apps/api/src/health.ts.
#
# Run it somewhere OTHER than the server it watches. A watchdog on the same box
# goes down with the box, and a monitor that is silent because it is dead looks
# exactly like a monitor that is silent because everything is fine.
#
# Environment:
#   ALERT_WEBHOOK   POSTed {"text": "..."} on a state CHANGE — Slack and Discord
#                   both accept that shape directly.
#   STATE_FILE      where the last known state lives (default /tmp/apex-watchdog.state)
#   TIMEOUT         seconds to wait (default 10)
set -euo pipefail

URL="${1:-}"
[ -n "$URL" ] || { echo "usage: $0 <base-url>" >&2; exit 2; }
STATE_FILE="${STATE_FILE:-/tmp/apex-watchdog.state}"
TIMEOUT="${TIMEOUT:-10}"
now() { date -u +%FT%TZ; }

BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT

# NOT `curl -f`. With -f curl exits non-zero on a 503, so an `|| echo 000`
# fallback CONCATENATES onto the code curl already printed ("503000"), and -f
# throws away the response body — which is the half that says WHY it is not
# ready. We want the status code whatever it is, and the body with it.
CODE="$(curl -sS -o "$BODY_FILE" -w '%{http_code}' --max-time "$TIMEOUT" "${URL%/}/ready" 2>/dev/null)" || true
CODE="${CODE:-000}"
BODY="$(tr -d '\n' < "$BODY_FILE" 2>/dev/null | head -c 400 || true)"

if [ "$CODE" = "200" ] && ! grep -q '"service":"apex-api"' <<<"$BODY"; then
  # A 200 that is not the API answering. The usual cause is a proxy serving the
  # SPA's index.html for /ready — which is what nginx did before /ready had a
  # location block, and it makes this watchdog report "up" forever with the API
  # and the database both dead. Checking the body means a misroute reads as an
  # outage rather than as good news.
  STATE=down
  DETAIL="200 but not the API — something is answering /ready instead of it (proxy misroute?)"
elif [ "$CODE" = "200" ]; then
  STATE=up
  DETAIL="ready"
elif [ "$CODE" = "000" ]; then
  # No answer at all: DNS, TLS, the process, or the box. Distinguished from a 503
  # because they need different people doing different things.
  STATE=down
  DETAIL="unreachable (no HTTP response within ${TIMEOUT}s)"
else
  STATE=down
  DETAIL="HTTP $CODE — $BODY"
fi

PREV="$(cat "$STATE_FILE" 2>/dev/null || echo unknown)"
echo "$STATE" > "$STATE_FILE"
echo "$(now) $STATE — $DETAIL"

# Alert on the EDGE, not on every tick. A monitor that pages every five minutes
# for the same outage trains you to ignore it, and the recovery is worth knowing
# about too.
if [ -n "${ALERT_WEBHOOK:-}" ] && [ "$STATE" != "$PREV" ] && [ "$PREV" != "unknown" ]; then
  if [ "$STATE" = "down" ]; then
    TEXT="🔴 Apex Appraise is DOWN — $DETAIL ($URL)"
  else
    TEXT="🟢 Apex Appraise is back — $URL"
  fi
  curl -fsS -m 10 -X POST -H 'content-type: application/json' \
    -d "$(printf '{"text":%s}' "$(printf '%s' "$TEXT" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')")" \
    "$ALERT_WEBHOOK" >/dev/null 2>&1 || echo "$(now) WARNING: could not reach ALERT_WEBHOOK" >&2
fi

[ "$STATE" = "up" ]
