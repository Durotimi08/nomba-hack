import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/*.int.test.ts", "node_modules", "dist"],
  },
  resolve: {
    // Resolve internal packages to source so tests run without a build step.
    alias: {
      "@kobo/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
});
