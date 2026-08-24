#!/usr/bin/env bash
# Nightly backup for the Apex Appraise production stack: Postgres + uploaded files.
#
#   ./infra/backup.sh [backup-dir]
#
# Cron (2am nightly, from the repo root). Non-zero exit means the backup did NOT
# happen, so cron's MAILTO reaches you:
#   0 2 * * * cd /opt/apex-appraise && ./infra/backup.sh /var/backups/apex >> /var/log/apex-backup.log 2>&1
#
# Prove it works, once, before you trust it:  ./infra/restore-check.sh
#
# Environment:
#   BACKUP_DB_URL      dump this connection directly (managed Postgres — RDS, Fly,
#                      Neon). Unset: dump the compose `db` service.
#   BACKUP_KEEP        how many of each artefact to retain (default 14)
#   BACKUP_UPLOAD_CMD  offsite. Run once per new file with the path as $1, e.g.
#                        BACKUP_UPLOAD_CMD='rclone copy "$1" b2:apex-backups/'
#                      A backup that lives only on the machine it is backing up
#                      is not an offsite backup; it is a second copy of the same
#                      disk failure.
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
KEEP="${BACKUP_KEEP:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
now() { date -u +%FT%TZ; }

mkdir -p "$BACKUP_DIR"

# ---------------------------------------------------------------------------
# Can compose even read its own file?
#
# docker-compose.yml requires JWT_SECRET and POSTGRES_PASSWORD, and compose
# interpolates the WHOLE file for any command — `exec` included. cron runs with
# almost no environment, so the operator's shell `export`s are not there, and
# every call below would fail with an interpolation error a long way from its
# cause. Checked once, up front, with the fix named.
#
# The answer is a .env file in the repo root, which compose reads automatically;
# see infra/DEPLOY.md. Skipped entirely when BACKUP_DB_URL is set, because that
# path never touches compose.
# ---------------------------------------------------------------------------
if [ -z "${BACKUP_DB_URL:-}" ]; then
  if ! COMPOSE_ERR="$(docker compose config --quiet 2>&1)"; then
    echo "$(now) FAILED: docker compose cannot read its configuration." >&2
    echo "  $COMPOSE_ERR" >&2
    echo "  cron has no shell exports. Put JWT_SECRET and POSTGRES_PASSWORD in" >&2
    echo "  a .env file in the repo root (compose reads it automatically), or" >&2
    echo "  set BACKUP_DB_URL to dump a managed database directly." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Dump, verify, THEN publish.
#
# The previous version wrote `pg_dump ... > "$OUT"`, which creates and truncates
# $OUT before pg_dump has produced a byte. A dump that failed — database down,
# disk full, container missing — therefore left a 0-byte .dump sitting in the
# retention window, where it counted as one of the newest 14 and pushed a real
# backup off the end. Fourteen bad nights and every good backup is gone, with
# nothing in the directory listing to say so.
#
# So: write to .part, verify the archive is readable, and only then move it into
# place under its real name. A failure leaves the .part behind for diagnosis and
# touches nothing that already worked.
# ---------------------------------------------------------------------------
DB_OUT="$BACKUP_DIR/apex-$STAMP.dump"
DB_PART="$DB_OUT.part"

dump_db() {
  if [ -n "${BACKUP_DB_URL:-}" ]; then
    pg_dump --format=custom --no-owner --no-acl "$BACKUP_DB_URL"
  else
    docker compose exec -T db pg_dump -U apex -d apex --format=custom --no-owner --no-acl
  fi
}

# Readable archive, with a table of contents that mentions real tables. Cheap,
# and it catches the truncated/empty/HTML-error-page cases that "the file exists
# and is non-zero" does not. It is NOT proof of restorability — that is
# restore-check.sh, which actually restores.
verify_dump() {
  local f="$1" toc
  if command -v pg_restore >/dev/null 2>&1; then
    toc="$(pg_restore --list "$f" 2>/dev/null)" || return 1
  else
    toc="$(docker compose exec -T db pg_restore --list < "$f" 2>/dev/null)" || return 1
  fi
  grep -q 'TABLE DATA' <<<"$toc" || return 1
}

echo "$(now) dumping database"
if ! dump_db > "$DB_PART"; then
  echo "$(now) FAILED: pg_dump did not complete — keeping $DB_PART for diagnosis" >&2
  exit 1
fi
if ! verify_dump "$DB_PART"; then
  echo "$(now) FAILED: dump is not a readable archive with table data — keeping $DB_PART" >&2
  exit 1
fi
mv "$DB_PART" "$DB_OUT"
echo "$(now) database backup verified: $DB_OUT ($(du -h "$DB_OUT" | cut -f1))"

# ---------------------------------------------------------------------------
# Uploaded files. A valuation's supporting documents are as much the customer's
# data as the rows that reference them, and they live in a different volume.
#
# The old guard was `docker compose ps -q api >/dev/null` — which succeeds when
# the api service is stopped, because printing nothing is not an error. So a
# stopped container produced a silent skip that read like a success.
# ---------------------------------------------------------------------------
UP_OUT="$BACKUP_DIR/uploads-$STAMP.tar.gz"
UP_PART="$UP_OUT.part"
if [ -n "$(docker compose ps -q api 2>/dev/null)" ]; then
  if docker compose exec -T api tar -czf - -C /app/apps/api uploads > "$UP_PART" 2>/dev/null && [ -s "$UP_PART" ] && tar -tzf "$UP_PART" >/dev/null 2>&1; then
    mv "$UP_PART" "$UP_OUT"
    echo "$(now) uploads backup verified: $UP_OUT ($(du -h "$UP_OUT" | cut -f1))"
  else
    rm -f "$UP_PART"
    echo "$(now) WARNING: uploads snapshot failed — database backup above is still good" >&2
  fi
else
  echo "$(now) WARNING: api container is not running — uploaded FILES were not backed up" >&2
fi

# Offsite, before pruning: a copy that never left the machine has not survived
# the machine.
if [ -n "${BACKUP_UPLOAD_CMD:-}" ]; then
  for f in "$DB_OUT" "$UP_OUT"; do
    [ -f "$f" ] || continue
    if bash -c "$BACKUP_UPLOAD_CMD" _ "$f"; then
      echo "$(now) offsite: $(basename "$f")"
    else
      echo "$(now) FAILED: offsite copy of $(basename "$f") — local copy kept, nothing pruned" >&2
      exit 1
    fi
  done
fi

# Prune only now, and only ever files we verified on their way in. .part files
# are left alone: they are evidence, not backups.
prune() {
  local glob="$1"
  # shellcheck disable=SC2012
  ls -1t "$BACKUP_DIR"/$glob 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f "$old" && echo "$(now) pruned: $(basename "$old")"
  done
}
prune 'apex-*.dump'
prune 'uploads-*.tar.gz'

echo "$(now) done — $(ls -1 "$BACKUP_DIR"/apex-*.dump 2>/dev/null | wc -l) database backup(s) retained"
