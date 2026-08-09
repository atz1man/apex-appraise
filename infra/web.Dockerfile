# Apex Appraise web — static build served by nginx, proxying /trpc + /uploads to the API.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
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
COPY apps ./apps
# the web typecheck infers tRPC types through the API, which needs the Prisma client
RUN cd apps/api && npx prisma generate
RUN cd apps/web && pnpm build

FROM nginx:alpine
COPY infra/nginx.conf.template /etc/nginx/templates/default.conf.template
# not a template: included verbatim by every proxied location
COPY infra/client-ip.conf /etc/nginx/client-ip.conf
ENV API_UPSTREAM=api:4100
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
