#!/usr/bin/env bash
# Prove the newest backup actually restores — into a throwaway database, with the
# rows counted afterwards.
#
#   ./infra/restore-check.sh [backup-dir]
#
# A backup nobody has restored is a belief, not a backup. pg_dump exiting 0 means
# it wrote a file; it does not mean that file will rebuild your schema, and the
# night you find out is the worst possible night to find out.
#
# Run this once when you set backups up, and on a schedule after that — monthly
# is enough, and it costs a few seconds:
#   0 4 1 * * cd /opt/apex-appraise && ./infra/restore-check.sh /var/backups/apex >> /var/log/apex-restore-check.log 2>&1
#
# It NEVER touches the live database. It creates apex_restore_check_<pid>,
# restores into that, counts, and drops it — including if it fails part-way.
#
# Environment:
#   BACKUP_DB_URL   a superuser-capable connection to the SERVER (managed
#                   Postgres). Unset: use the compose `db` service.
#   MIN_ROWS        fail if the restored Organisation count is below this
#                   (default 1). A dump that restores cleanly and is EMPTY is a
#                   backup of nothing, and it passes every check but this one.
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
MIN_ROWS="${MIN_ROWS:-1}"
CHECK_DB="apex_restore_check_$$"
now() { date -u +%FT%TZ; }

LATEST="$(ls -1t "$BACKUP_DIR"/apex-*.dump 2>/dev/null | head -1 || true)"
if [ -z "$LATEST" ]; then
  echo "$(now) FAILED: no backups found in $BACKUP_DIR — there is nothing to restore" >&2
  exit 1
fi

AGE_HOURS=$(( ( $(date +%s) - $(stat -c %Y "$LATEST") ) / 3600 ))
echo "$(now) newest backup: $(basename "$LATEST") (${AGE_HOURS}h old)"
if [ "$AGE_HOURS" -gt 48 ]; then
  echo "$(now) WARNING: newest backup is over 48h old — is the cron job running?" >&2
fi

# Route every psql/pg_restore call the same way, so the docker and managed cases
# differ in one place rather than six.
if [ -n "${BACKUP_DB_URL:-}" ]; then
  SERVER_URL="${BACKUP_DB_URL%/*}"
  psql_srv() { psql -v ON_ERROR_STOP=1 -d "$SERVER_URL/postgres" "$@"; }
  restore_into() { pg_restore --no-owner --no-acl --exit-on-error -d "$SERVER_URL/$CHECK_DB" "$LATEST"; }
  psql_chk() { psql -v ON_ERROR_STOP=1 -d "$SERVER_URL/$CHECK_DB" "$@"; }
else
  psql_srv() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -U apex -d postgres "$@"; }
  restore_into() { docker compose exec -T db pg_restore --no-owner --no-acl --exit-on-error -U apex -d "$CHECK_DB" < "$LATEST"; }
  psql_chk() { docker compose exec -T db psql -v ON_ERROR_STOP=1 -U apex -d "$CHECK_DB" "$@"; }
fi

cleanup() {
  psql_srv -c "DROP DATABASE IF EXISTS $CHECK_DB;" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "$(now) restoring into $CHECK_DB"
psql_srv -c "DROP DATABASE IF EXISTS $CHECK_DB;" >/dev/null
psql_srv -c "CREATE DATABASE $CHECK_DB;" >/dev/null

if ! restore_into; then
  echo "$(now) FAILED: $(basename "$LATEST") did not restore. This backup would not have saved you." >&2
  exit 1
fi

# Restoring cleanly is not the same as restoring your data. Count something a
# real workspace must have.
ORGS="$(psql_chk -tAc 'SELECT count(*) FROM "Organisation";' | tr -d '[:space:]')"
DEALS="$(psql_chk -tAc 'SELECT count(*) FROM "Deal";' | tr -d '[:space:]')"
TABLES="$(psql_chk -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d '[:space:]')"

echo "$(now) restored: $TABLES tables, $ORGS organisation(s), $DEALS deal(s)"

if [ "${ORGS:-0}" -lt "$MIN_ROWS" ]; then
  echo "$(now) FAILED: restored database holds $ORGS organisation(s), expected at least $MIN_ROWS." >&2
  echo "$(now) The archive was valid and the restore was clean — it is the CONTENTS that are missing." >&2
  exit 1
fi

echo "$(now) PASS — $(basename "$LATEST") restores and contains data"
