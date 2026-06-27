# syntax=docker/dockerfile:1

# Stage 1: build Angular SPA and NestJS API bundle
FROM node:24 AS builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec nx run-many -t build --projects=web,api
# Generate a minimal package.json + pnpm-lock.yaml with only production deps
RUN pnpm exec nx run api:prune

# Stage 2: install production deps (compiles native modules like better-sqlite3)
FROM node:24 AS deps
RUN corepack enable
WORKDIR /app
# Root package.json gives corepack the pnpm version to use
COPY package.json ./
COPY --from=builder /app/dist/apps/api/package.json dist/apps/api/package.json
COPY --from=builder /app/dist/apps/api/pnpm-lock.yaml dist/apps/api/pnpm-lock.yaml
WORKDIR /app/dist/apps/api
RUN pnpm install --frozen-lockfile

# Stage 3: slim runtime image
FROM node:24-slim AS runner
WORKDIR /app
COPY --from=deps /app/dist/apps/api/node_modules dist/apps/api/node_modules
COPY --from=builder /app/dist/apps/api/main.js dist/apps/api/main.js
COPY --from=builder /app/dist/apps/api/seed.js dist/apps/api/seed.js
# SPA — API expects it at ../web/browser relative to __dirname (dist/apps/api)
COPY --from=builder /app/dist/apps/web/browser dist/apps/web/browser
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "dist/apps/api/main.js"]
