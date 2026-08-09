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

echo "[boot] applying migrations"
npx prisma migrate deploy

# Seeding is idempotent and demo-only, so it may fail without taking the API with
# it — but it must not fail SILENTLY, which is what `|| true` used to do.
# Seeds a FRESH database and refuses a populated one — the script itself holds
# that guard, because `pnpm seed` run by hand against production would otherwise
# do the same damage this boot step nearly did.
echo "[boot] seeding demo data if this database is empty"
npx tsx prisma/seed.ts || echo "[boot] WARNING: seed failed — continuing, demo data may be stale"

echo "[boot] starting api"
exec npx tsx src/main.ts
