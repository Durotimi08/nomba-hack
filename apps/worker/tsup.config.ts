import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/worker.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  target: "node22",
});
