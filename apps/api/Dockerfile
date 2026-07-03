# ──────────────────────────────────────────────────────────────────────────
# @kobo/api — Fastify HTTP service (listens on $API_PORT, default 3001).
#
# Multi-stage rationale:
#   deps    — restore the full workspace install once, cached on the lockfile so
#             unchanged deps don't reinstall on every source edit.
#   build   — compile @kobo/api and its workspace deps to dist/ via tsup.
#   prune   — `pnpm deploy` flattens an isolated, production-only node_modules for
#             just this app (workspace deps inlined), so the runtime image carries
#             no dev deps, no source, and no other workspace packages.
#   runtime — minimal node:22-alpine, non-root, prod artifacts only.
# Build context is the repo root.
# ──────────────────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# ── deps ──────────────────────────────────────────────────────────────────
# Copy only manifests so this layer is cached unless dependency graph changes.
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
RUN pnpm --filter @kobo/api... build

# ── prune ─────────────────────────────────────────────────────────────────
# `pnpm deploy` resolves the @kobo/api closure into /app with prod deps only.
FROM build AS prune
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @kobo/api deploy --prod /app

# ── runtime ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Non-root user.
RUN addgroup -S app && adduser -S app -G app

COPY --from=prune --chown=app:app /app/node_modules ./node_modules
COPY --from=prune --chown=app:app /app/package.json ./package.json
COPY --from=build  --chown=app:app /repo/apps/api/dist ./apps/api/dist

COPY --from=build  --chown=app:app /repo/packages/db/migrations ./node_modules/@kobo/db/migrations

USER app
EXPOSE 3001
# Node fetch over 127.0.0.1 — BusyBox wget resolves localhost to IPv6 (::1) but
# the server listens on IPv4, so wget would falsely report unhealthy.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
