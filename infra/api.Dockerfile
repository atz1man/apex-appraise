# Apex Appraise API — production image (PostgreSQL).
# The committed Prisma schema pins sqlite for zero-infra local dev; this image
# rewrites the datasource to postgres before generating the client (same pattern
# as CI), so the two never drift apart by hand-editing.
FROM node:22-alpine AS base
# openssl is required for Prisma's engine detection at generate time AND at runtime;
# without it Prisma defaults to the openssl-1.1.x engine, which cannot load on alpine ≥3.19
RUN apk add --no-cache openssl && corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/appraisal-engine/package.json packages/appraisal-engine/
COPY packages/types/package.json packages/types/
COPY packages/ui-tokens/package.json packages/ui-tokens/
RUN pnpm install --frozen-lockfile=false

COPY packages ./packages
COPY apps/api ./apps/api

# sqlite (dev) → postgres (prod) datasource rewrite
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' apps/api/prisma/schema.prisma \
 && sed -i 's|url      = "file:./dev.db"|url      = env("DATABASE_URL")|' apps/api/prisma/schema.prisma \
 && cd apps/api && npx prisma generate

EXPOSE 4100
WORKDIR /app/apps/api
# push schema on boot (swap for `prisma migrate deploy` once a migration baseline exists)
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx tsx prisma/seed.ts || true && npx tsx src/main.ts"]
