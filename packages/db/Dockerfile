# ──────────────────────────────────────────────────────────────────────────
# @kobo/db — one-shot migration runner used by the compose `migrate` service.
#
# Runs `drizzle-kit migrate` then exits. Drizzle needs its CLI + the migration
# SQL/source, so this image keeps the full workspace install rather than pruning
# to a compiled dist (the runtime cost is paid once at boot, then the container
# exits). Build context is the repo root.
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

# ── migrate ───────────────────────────────────────────────────────────────
FROM deps AS migrate
# Bring in source (drizzle config + migrations/ live under packages/db).
COPY . .
# Build @kobo/db and its workspace deps so the schema is compiled if needed.
RUN pnpm --filter @kobo/db... build

# Non-root.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /repo
USER app

CMD ["pnpm", "--filter", "@kobo/db", "migrate"]
