# Apex Appraise web — static build served by nginx, proxying /trpc + /uploads to the API.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/appraisal-engine/package.json packages/appraisal-engine/
COPY packages/types/package.json packages/types/
COPY packages/ui-tokens/package.json packages/ui-tokens/
RUN pnpm install --frozen-lockfile=false
COPY packages ./packages
COPY apps ./apps
RUN cd apps/web && pnpm build

FROM nginx:alpine
COPY infra/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
