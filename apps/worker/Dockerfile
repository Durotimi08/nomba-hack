# ──────────────────────────────────────────────────────────────────────────
# @kobo/worker — BullMQ background worker. No HTTP port.
#
# Same multi-stage pattern as apps/api/Dockerfile:
#   deps -> build -> prune (pnpm deploy, prod-only) -> minimal non-root runtime.
# Build context is the repo root.
# ──────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ── deps ──────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/nomba/package.json packages/nomba/
COPY packages/core/package.json packages/core/
COPY packages/school/package.json packages/school/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build ─────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN pnpm --filter @kobo/worker... build

# ── prune ─────────────────────────────────────────────────────────────────
FROM build AS prune
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @kobo/worker deploy --prod /app

# ── runtime ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=prune --chown=app:app /app/node_modules ./node_modules
COPY --from=prune --chown=app:app /app/package.json ./package.json
COPY --from=build  --chown=app:app /repo/apps/worker/dist ./apps/worker/dist

USER app

# No HTTP endpoint to probe — a liveness check just confirms the node process is
# running. Queue depth / job-level health is observed via metrics, not Docker.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD pgrep -f "apps/worker/dist/worker.js" > /dev/null || exit 1

CMD ["node", "apps/worker/dist/worker.js"]
