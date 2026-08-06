#!/bin/sh
# ---------------------------------------------------------------------------
# Restore drill — proves the backup can come BACK.
#
# An untested backup is a belief, not a backup. This takes a logical dump of the
# live database, restores it into a scratch database beside it, and compares the
# two: exact row counts per table, and the full column / index / constraint
# fingerprint. It reports PASS only if every one of those matches.
#
# It never writes to the source database. The scratch database is dropped on
# every exit path, including failure.
#
# Usage (on a host with the postgres client tools and network to the server):
#   PGPASSWORD=… scripts/restore-drill.sh [--keep-dump]
#
# Env: PGHOST (default 127.0.0.1), PGUSER (default postgres), SOURCE_DB (default
# apex), DUMP_DIR (default /tmp).
# ---------------------------------------------------------------------------
set -eu

PGHOST=${PGHOST:-127.0.0.1}
PGUSER=${PGUSER:-postgres}
SOURCE_DB=${SOURCE_DB:-apex}
DUMP_DIR=${DUMP_DIR:-/tmp}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
SCRATCH="drill_${STAMP}"
DUMP="${DUMP_DIR}/${SOURCE_DB}-${STAMP}.dump"
KEEP_DUMP=${1:-}

PSQL="psql -h $PGHOST -U $PGUSER -At -v ON_ERROR_STOP=1"

cleanup() {
  # the scratch database goes on EVERY exit path — a drill that leaves debris
  # behind teaches people to stop running it
  psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS \"$SCRATCH\";" >/dev/null 2>&1 || true
  [ "$KEEP_DUMP" = "--keep-dump" ] || rm -f "$DUMP"
}
trap cleanup EXIT

# Exact counts, not pg_stat_user_tables — n_live_tup is an ESTIMATE, and an
# estimate that happens to match on both sides proves nothing.
COUNT_SQL="SELECT t||':'||c FROM (
  SELECT table_name AS t,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I','public',table_name), false, true, '')))[1]::text::bigint AS c
  FROM information_schema.tables
  WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name <> '_prisma_migrations'
) s ORDER BY t;"

SHAPE_SQL="SELECT table_name||'.'||column_name||' '||data_type||' null='||is_nullable
  FROM information_schema.columns WHERE table_schema='public' AND table_name <> '_prisma_migrations'
  UNION ALL SELECT 'idx '||tablename||' '||indexdef FROM pg_indexes
  WHERE schemaname='public' AND tablename <> '_prisma_migrations'
  UNION ALL SELECT 'con '||conrelid::regclass||' '||conname||' '||pg_get_constraintdef(oid)
  FROM pg_constraint WHERE connamespace='public'::regnamespace
  ORDER BY 1;"

echo "[drill] dumping $SOURCE_DB"
pg_dump -h "$PGHOST" -U "$PGUSER" -Fc -d "$SOURCE_DB" -f "$DUMP"
echo "[drill] dump size: $(ls -lh "$DUMP" | awk '{print $5}')"

echo "[drill] fingerprinting source"
$PSQL -d "$SOURCE_DB" -c "$COUNT_SQL" > "${DUMP}.src.counts"
$PSQL -d "$SOURCE_DB" -c "$SHAPE_SQL" > "${DUMP}.src.shape"

echo "[drill] restoring into $SCRATCH"
psql -h "$PGHOST" -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$SCRATCH\";" >/dev/null
# --exit-on-error: a restore that logs errors and carries on is the failure mode
# this drill exists to catch
pg_restore -h "$PGHOST" -U "$PGUSER" -d "$SCRATCH" --exit-on-error "$DUMP"

echo "[drill] fingerprinting restore"
$PSQL -d "$SCRATCH" -c "$COUNT_SQL" > "${DUMP}.dst.counts"
$PSQL -d "$SCRATCH" -c "$SHAPE_SQL" > "${DUMP}.dst.shape"

FAIL=0
if diff -q "${DUMP}.src.counts" "${DUMP}.dst.counts" >/dev/null; then
  echo "[drill] rows      MATCH  ($(wc -l < "${DUMP}.src.counts") tables, $(awk -F: '{s+=$2} END {print s}' "${DUMP}.src.counts") rows)"
else
  echo "[drill] rows      MISMATCH"; diff "${DUMP}.src.counts" "${DUMP}.dst.counts" | head -20; FAIL=1
fi
if diff -q "${DUMP}.src.shape" "${DUMP}.dst.shape" >/dev/null; then
  echo "[drill] structure MATCH  ($(wc -l < "${DUMP}.src.shape") columns, indexes and constraints)"
else
  echo "[drill] structure MISMATCH"; diff "${DUMP}.src.shape" "${DUMP}.dst.shape" | head -20; FAIL=1
fi
rm -f "${DUMP}".src.* "${DUMP}".dst.*

if [ "$FAIL" = "0" ]; then
  echo "[drill] PASS — this database can be restored from a logical dump"
else
  echo "[drill] FAIL — the backup does not reproduce the database"
  exit 1
fi
