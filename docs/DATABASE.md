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

**That block is temporary.** Once production is baselined it is dead code, and dead code
that writes to `_prisma_migrations` is not the kind to leave lying around. Remove it.

## Raw SQL

There is none in this codebase, and it should stay that way. If it ever arrives it must
run on both SQLite and PostgreSQL: `CURRENT_TIMESTAMP` not `NOW()`, no `SERIAL`, no `::`
casts.
