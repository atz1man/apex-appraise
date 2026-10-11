#!/usr/bin/env bash
# CI fixture only. Never point this at a customer stack: it writes a synthetic
# upload to the disposable compose API. Production recovery needs its own drill.
set -euo pipefail
if [ "${GITHUB_ACTIONS:-}" != true ] || [ "${CI:-}" != true ] || [ "${SEED_DEMO:-}" != 1 ]; then
  echo 'This drill requires the disposable GitHub Actions demo stack.' >&2
  exit 1
fi
unset BACKUP_DB_URL BACKUP_UPLOAD_CMD
BACKUP_KEEP=2
export BACKUP_KEEP
WORK="$(mktemp -d)"
FIXTURE="recovery-drill-${WORK##*/}.txt"
FIXTURE_CREATED=0
cleanup() {
  if [ "$FIXTURE_CREATED" -eq 1 ]; then docker compose exec -T api rm -f "uploads/$FIXTURE" || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
query() { docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U apex -d apex -tAc "$1"; }
counts() {
  query 'SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\'') || '\'' tables, '\'' || (SELECT count(*) FROM "Organisation") || '\'' organisation(s), '\'' || (SELECT count(*) FROM "Deal") || '\'' deal(s)'\'';'
}
scratch() { query "SELECT datname FROM pg_database WHERE datname LIKE 'apex_restore_check_%' ORDER BY datname"; }
BEFORE="$(counts)"
SCRATCH_BEFORE="$(scratch)"
printf 'synthetic appraisal evidence for recovery drill\n' > "$WORK/expected.txt"
docker compose exec -T api sh -c 'set -eu; set -C; mkdir -p uploads; cat > "uploads/$1"' _ "$FIXTURE" < "$WORK/expected.txt"
FIXTURE_CREATED=1

# Run the actual operator commands, not a mock or a second implementation.
bash infra/backup.sh "$WORK/backups"
bash infra/restore-check.sh "$WORK/backups" | tee "$WORK/restore.log"
grep -F "restored: $BEFORE" "$WORK/restore.log"
[ "$(scratch)" = "$SCRATCH_BEFORE" ] || { echo 'Scratch database leaked after successful restore' >&2; exit 1; }

# Extract only our synthetic file to stdout, never arbitrary archive paths onto
# the runner filesystem. Compare bytes with both the original and restored copy.
archives=("$WORK"/backups/uploads-*.tar.gz)
[ "${#archives[@]}" -eq 1 ]
tar -xOzf "${archives[0]}" "uploads/$FIXTURE" > "$WORK/restored.txt"
cmp "$WORK/expected.txt" "$WORK/restored.txt"
docker compose exec -T api cat "uploads/$FIXTURE" > "$WORK/original.txt"
cmp "$WORK/expected.txt" "$WORK/original.txt"

# A corrupt database archive must fail and still drop its scratch database.
mkdir "$WORK/corrupt"
printf 'not a PostgreSQL archive\n' > "$WORK/corrupt/apex-invalid.dump"
if bash infra/restore-check.sh "$WORK/corrupt" > "$WORK/corrupt.log" 2>&1; then
  echo 'Corrupt archive was accepted' >&2
  exit 1
fi
grep -F 'did not restore' "$WORK/corrupt.log"
[ "$(scratch)" = "$SCRATCH_BEFORE" ] || { echo 'Scratch database leaked after failed restore' >&2; exit 1; }
[ "$(counts)" = "$BEFORE" ] || { echo 'Original database row counts changed during the drill' >&2; exit 1; }
echo 'PASS: database row counts restored, upload bytes recovered, corrupt archive refused, scratch databases cleaned up'
