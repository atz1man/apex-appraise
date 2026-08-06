#!/bin/sh
# API boot: apply migrations, then serve.
#
# `prisma migrate deploy` and NOT `db push`. db push diffs the live database
# against the schema and reshapes it to match — including dropping a column that
# no longer appears in the schema, with no history and no way back. On a database
# holding customer valuations that is a data-loss primitive, not a deploy step.
#
# The migration is the gate: if it fails, the API does NOT start. A server running
# against a half-migrated database is worse than a server that is plainly down,
# because it corrupts quietly while every health check stays green.
set -e

# ---------------------------------------------------------------------------
# One-time baseline of a database that predates the migration history.
#
# Production was built by `db push`, so its tables exist with no
# _prisma_migrations table to match them, and `migrate deploy` refuses to touch a
# non-empty schema (P3005) — correctly, since it cannot tell "already migrated"
# from "someone else's database". Recording the baseline as applied is Prisma's
# documented procedure for exactly this: it writes ONE bookkeeping row and does
# not read or alter a single byte of data.
#
# Deliberately narrow: it fires only on the P3005 condition and only for the
# baseline. A fresh database reports no migrations, skips this, and has its
# schema created by the deploy below. REMOVE THIS BLOCK once production is
# baselined — it exists to cross one line in the product's history, not forever.
# ---------------------------------------------------------------------------
# Two questions, because neither answers this alone. `migrate status` only reads
# the bookkeeping table, so it reports "not yet applied" for a FRESH database and
# for a db-push one identically. What separates them is whether the schema is
# already physically there: `migrate diff --exit-code` returns 0 when the live
# database already matches the models exactly — which is the db-push case, and
# was verified column-for-column against this baseline before it was committed.
STATUS="$(npx prisma migrate status 2>&1 || true)"
case "$STATUS" in
  *"have not yet been applied"*)
    if npx prisma migrate diff \
         --from-url "$DATABASE_URL" \
         --to-schema-datamodel prisma/schema.prisma \
         --exit-code >/dev/null 2>&1; then
      echo "[boot] schema already present but unrecorded — recording the baseline as applied"
      npx prisma migrate resolve --applied 00000000000000_baseline
    else
      echo "[boot] empty or partial database — migrations will build it"
    fi
    ;;
esac

echo "[boot] applying migrations"
npx prisma migrate deploy

# Seeding is idempotent and demo-only, so it may fail without taking the API with
# it — but it must not fail SILENTLY, which is what `|| true` used to do.
echo "[boot] seeding demo data"
npx tsx prisma/seed.ts || echo "[boot] WARNING: seed failed — continuing, demo data may be stale"

echo "[boot] starting api"
exec npx tsx src/main.ts
