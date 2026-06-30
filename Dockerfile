# syntax=docker/dockerfile:1

# Stage 1: build the Angular SPA and fetch the pinned TrailBase binary. NestJS is
# no longer the server — TrailBase serves the built SPA + API on one origin
# (ADR-0008, ADR-0032). apps/api stays in the tree until the cutover slice.
FROM node:24 AS builder
RUN corepack enable \
 && apt-get update && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec nx build web --configuration=production
# scripts/trailbase.mjs owns the pinned version + per-platform asset; this fetches
# the binary into .trailbase/<version>/trail.
RUN node scripts/trailbase.mjs --version

# Stage 2: runtime — the TrailBase binary, the built SPA, and the config. No Node:
# seeding (`trail user add`) and serving are both the binary's own commands. Base
# is ubuntu:24.04 — the exact glibc the pinned binary is proven against in CI.
FROM ubuntu:24.04 AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/.trailbase/*/trail /usr/local/bin/trail
COPY --from=builder /app/dist/apps/web/browser ./web
COPY --from=builder /app/traildepot/config.textproto ./config.textproto
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/trail /usr/local/bin/docker-entrypoint.sh
ENV PORT=3000 DATA_DIR=/data
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
