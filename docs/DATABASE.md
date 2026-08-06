# Database — schema changes, migrations, and the dev/prod split

## The shape of it

| | local dev | CI | production |
|---|---|---|---|
| engine | SQLite (`file:./dev.db`) | PostgreSQL 16 | PostgreSQL (Fly) |
| datasource in `schema.prisma` | `sqlite` (committed) | rewritten by `sed` | rewritten by `sed` |
| how the schema is applied | `prisma db push` | `prisma migrate deploy` | `prisma migrate deploy` |

`schema.prisma` stays pinned to `sqlite` so the repo runs with zero infrastructure.
CI (`.github/workflows/ci.yml`) and the API image (`infra/api.Dockerfile`) rewrite the
datasource to postgres with two byte-identical `sed` lines. If you change one, change
the other — they are the same two lines on purpose.

## Why production uses `migrate deploy` and not `db push`

`db push` diffs the live database against the models and reshapes it to match. That
includes **dropping a column that no longer appears in the schema**, with no history and
no way back. On a database holding client valuations that is a data-loss primitive, not
a deploy step. It also never proves the committed SQL can build the schema from nothing,
because it never starts from nothing.

`migrate deploy` applies committed SQL forward, refuses to guess, and fails loudly. The
API entrypoint (`infra/entrypoint.sh`) treats it as a **gate**: if migrations fail, the
API does not start. A server running against a half-migrated database is worse than one
that is plainly down, because it corrupts quietly while every health check stays green.

## Changing the schema

1. Edit `apps/api/prisma/schema.prisma`.
2. Sync your local SQLite database: `cd apps/api && npx prisma db push`
   (dev only — the committed migrations are Postgres-locked and will not run on SQLite).
3. Generate the migration SQL against **postgres**, not against your dev database:

   ```bash
   cd apps/api
   cp prisma/schema.prisma /tmp/pg.prisma
   sed -i '' 's/provider = "sqlite"/provider = "postgresql"/' /tmp/pg.prisma
   sed -i '' 's|url      = "file:./dev.db"|url      = env("DATABASE_URL")|' /tmp/pg.prisma
   mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_your_change_name
   npx prisma migrate diff \
     --from-migrations prisma/migrations \
     --to-schema-datamodel /tmp/pg.prisma \
     --shadow-database-url "$SHADOW_DATABASE_URL" \
     --script > prisma/migrations/<the dir you just made>/migration.sql
   ```

4. **Read the SQL.** Prisma will happily write `DROP COLUMN`. If the change renames
   something, hand-edit it into an `ALTER TABLE ... RENAME COLUMN` so the data moves
   instead of dying.
5. Commit the migration with the schema change. CI fails the build if `schema.prisma`
   has drifted ahead of the migrations — that check is the whole point of this file.

## The baseline

`00000000000000_baseline` is the schema as it stood on 6 August 2026, when the product
moved off `db push`. It was generated with `migrate diff --from-empty` and verified
against the live db-push schema before being committed: **307 columns, 43 indexes and 46
constraints, identical on both sides.**

Production predates that migration, so its tables exist with no `_prisma_migrations` row
to match. `infra/entrypoint.sh` handles the crossing once, and narrowly: only when
`migrate status` reports the migration unapplied *and* `migrate diff --exit-code` reports
the live schema already identical to the models — the signature of a db-push database. It
records one bookkeeping row and reads no data.

That block was temporary and is **gone** — production reports "Database schema is up to
date!", so the code path could never fire again, and dead code that writes to
`_prisma_migrations` is not the kind to leave lying around. A database restored from a
backup taken *before* 6 August 2026 would need the baseline recorded by hand:
`npx prisma migrate resolve --applied 00000000000000_baseline`.

## Raw SQL

There is none in this codebase, and it should stay that way. If it ever arrives it must
run on both SQLite and PostgreSQL: `CURRENT_TIMESTAMP` not `NOW()`, no `SERIAL`, no `::`
casts.

## Versions

Production runs **PostgreSQL 18** (`flyio/postgres-flex`). Local dev and CI run
`postgres:18-alpine` to match. They must not drift: until 6 August 2026 both ran
PG 16 against a PG 18 production — two major versions of skew, meaning every test
and every migration was validated on a database that was not the one customers
use. The restore drill is what exposed it (PG 17+ catalogues NOT NULL constraints
in `pg_constraint`, so the structural fingerprints differed by 249 objects).

Note for PG18: its image expects the volume at `/var/lib/postgresql`, not
`/var/lib/postgresql/data` — it places the cluster in a subdirectory so
`pg_upgrade --link` works across the mount boundary. Mounting the old path makes
the container refuse to start.

## Backups

**What exists.** Fly takes daily block-level snapshots of the database volume,
retained **5 days**. Verified present — five snapshots, ~288 MiB stored.

**What that is not.** Snapshots are block-level and provider-locked: they cannot
restore a single table, cannot be read without attaching a volume, cannot leave
Fly, and 5 days means corruption noticed on the sixth day is unrecoverable. For a
product holding client valuations under professional indemnity, that is thin.

**The drill.** `scripts/restore-drill.sh` takes a logical dump, restores it into a
scratch database beside the live one, and compares exact per-table row counts and
the full column/index/constraint fingerprint. It reports PASS only if every one
matches, drops the scratch database on every exit path, and never writes to the
source. Run it on the database host so no client data leaves it:

```bash
fly ssh console -a apex-appraise-db -C "sh -c 'PGPASSWORD=\$OPERATOR_PASSWORD PGUSER=postgres SOURCE_DB=apex_appraise_api DUMP_DIR=/data sh /tmp/drill.sh'"
```

Last run against production, 6 August 2026: **PASS** — 24 tables, 2,124 rows, 646
structural objects identical. That is the first time this product's backup has
been proven to come back rather than assumed to.

**Still open, and it is a decision, not a task:** off-site logical backups need a
destination — object storage, a retention period, and a call on where UK client
valuation data is allowed to live. That is an owner's decision with cost and
compliance in it, so it is not made here.
