# Bandwagon: one image serves the API and the React app on the same origin.
FROM node:22-alpine AS base
RUN npm install -g pnpm@11.2.2
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm -F @bw/web build && pnpm -F @bw/api build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @bw/api...

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/apps/web/dist
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
COPY --from=build /app/apps/web/dist ./apps/web/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=60s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
WORKDIR /app/apps/api
CMD ["node", "dist/src/server.js"]
