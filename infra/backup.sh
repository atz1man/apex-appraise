#!/usr/bin/env bash
# Nightly Postgres backup for the Apex Appraise production stack.
#
#   ./infra/backup.sh [backup-dir]
#
# - Dumps the compose `db` service with pg_dump (custom format, compressed)
# - Keeps the newest 14 dumps, prunes the rest
# - Restore: pg_restore -h localhost -U apex -d apex --clean backup.dump
#
# Cron example (2am nightly, from the repo root):
#   0 2 * * * cd /opt/apex-appraise && ./infra/backup.sh /var/backups/apex >> /var/log/apex-backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
KEEP=14
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/apex-$STAMP.dump"

mkdir -p "$BACKUP_DIR"

docker compose exec -T db pg_dump -U apex -d apex --format=custom > "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "$(date -u +%FT%TZ) backup written: $OUT ($SIZE)"

# Prune: keep the newest $KEEP dumps
ls -1t "$BACKUP_DIR"/apex-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "$old"
  echo "$(date -u +%FT%TZ) pruned: $old"
done

# Also snapshot the uploads volume (documents/photos) alongside the DB
if docker compose ps -q api >/dev/null 2>&1; then
  UPLOADS_OUT="$BACKUP_DIR/uploads-$STAMP.tar.gz"
  docker compose exec -T api tar -czf - -C /app/apps/api uploads 2>/dev/null > "$UPLOADS_OUT" || rm -f "$UPLOADS_OUT"
  [ -f "$UPLOADS_OUT" ] && echo "$(date -u +%FT%TZ) uploads snapshot: $UPLOADS_OUT ($(du -h "$UPLOADS_OUT" | cut -f1))"
  ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -I{} rm -f {}
fi
