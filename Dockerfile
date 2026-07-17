# syntax=docker/dockerfile:1

# Stage 1: build Angular SPA and NestJS API bundle
FROM node:24 AS builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec nx run-many -t build --projects=web,api

# Stage 2: install ONLY the API's runtime deps (native modules like better-sqlite3 compiled here).
# webpack's generatePackageJson emits a pruned package.json + matching lockfile listing just the
# deps main.js requires. The plugin projects are split (ADR-0058) so the framework-free API graph
# never reaches Angular/TipTap, which keeps this node_modules layer ~68 MB instead of ~192 MB.
FROM node:24 AS prod-deps
RUN corepack enable
WORKDIR /app
COPY --from=builder /app/dist/apps/api/package.json ./package.json
COPY --from=builder /app/dist/apps/api/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile --prod --shamefully-hoist

# Stage 3: slim runtime image
FROM node:24-slim AS runner
WORKDIR /app
# node_modules at /app so Node's resolution finds them from dist/apps/api/
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=builder /app/dist/apps/api/main.js dist/apps/api/main.js
COPY --from=builder /app/dist/apps/api/seed.js dist/apps/api/seed.js
# Drizzle reads these at boot via resolve(__dirname) (ADR-0027); without them migrate() throws.
COPY --from=builder /app/dist/apps/api/migrations dist/apps/api/migrations
# SPA — API expects it at ../web/browser relative to __dirname (dist/apps/api)
COPY --from=builder /app/dist/apps/web/browser dist/apps/web/browser
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "dist/apps/api/main.js"]
