# Apex Appraise API — production image (PostgreSQL).
# The committed Prisma schema pins sqlite for zero-infra local dev; this image
# rewrites the datasource to postgres before generating the client (same pattern
# as CI), so the two never drift apart by hand-editing.
FROM node:22-alpine AS base
# openssl is required for Prisma's engine detection at generate time AND at runtime;
# without it Prisma defaults to the openssl-1.1.x engine, which cannot load on alpine ≥3.19.
# chromium + fonts power the server-rendered PDF reports (Playwright uses the system
# browser via CHROMIUM_PATH — no Playwright browser download needed in the image).
RUN apk add --no-cache openssl chromium nss freetype harfbuzz ca-certificates ttf-freefont \
 && corepack enable
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/appraisal-engine/package.json packages/appraisal-engine/
COPY packages/types/package.json packages/types/
COPY packages/ui-tokens/package.json packages/ui-tokens/
# frozen lockfile: the image resolves exactly what runs locally and in CI
# Registry downloads fail occasionally — a node/undici parser assertion inside
# pnpm's fetch, not anything about this repo. Retries turn a transient network
# fault into a slower build instead of a red pipeline and a blocked deploy.
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_maxtimeout=120000
RUN pnpm install --frozen-lockfile || (echo "install failed — retrying once" && sleep 5 && pnpm install --frozen-lockfile)

COPY packages ./packages
COPY apps/api ./apps/api

# sqlite (dev) → postgres (prod) datasource rewrite
RUN sed -i 's/provider = "sqlite"/provider = "postgresql"/' apps/api/prisma/schema.prisma \
 && sed -i 's|url      = "file:./dev.db"|url      = env("DATABASE_URL")|' apps/api/prisma/schema.prisma \
 && cd apps/api && npx prisma generate

EXPOSE 4100
WORKDIR /app/apps/api
COPY infra/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh
CMD ["/app/entrypoint.sh"]
