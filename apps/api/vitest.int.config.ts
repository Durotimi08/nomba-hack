import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** API integration tests: real Postgres + Redis via Testcontainers. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: {
    alias: {
      "@kobo/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
      "@kobo/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      "@kobo/nomba": fileURLToPath(new URL("../../packages/nomba/src/index.ts", import.meta.url)),
      "@kobo/db": fileURLToPath(new URL("../../packages/db/src/index.ts", import.meta.url)),
    },
  },
});
