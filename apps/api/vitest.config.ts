import { defineConfig } from "vitest/config";

/** Unit tests only — integration tests (*.int.test.ts) run via vitest.int.config.ts. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.int.test.ts", "node_modules", "dist"],
  },
});
