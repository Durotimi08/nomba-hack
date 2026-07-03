import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** School integration tests: real Postgres via Testcontainers. */
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
      "@kobo/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
      "@kobo/db": fileURLToPath(new URL("../db/src/index.ts", import.meta.url)),
    },
  },
});
