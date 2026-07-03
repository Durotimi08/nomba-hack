# ──────────────────────────────────────────────────────────────────────────
# @kobo/web — Next.js 15 dashboard, built with output: "standalone".
#
#   deps    — restore the workspace install (cached on the lockfile).
#   build   — `next build` emits .next/standalone (a self-contained server with
#             a minimal traced node_modules) plus .next/static and public/.
#   runtime — copy only those three artifacts; run `node server.js` per the
#             Next standalone convention. No pnpm/build toolchain in the image.
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
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN pnpm --filter @kobo/web build

# ── runtime ───────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

# The standalone output already bundles the traced node_modules and a server.js.
# Static assets and public/ are copied alongside per Next.js docs.
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public

USER app
EXPOSE 3000
# Node fetch over 127.0.0.1 — BusyBox wget resolves localhost to IPv6 (::1) but
# the server listens on IPv4, so wget would falsely report unhealthy.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# server.js lives at the standalone root mirroring the workspace path.
CMD ["node", "apps/web/server.js"]
