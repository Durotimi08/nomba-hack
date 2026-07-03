import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/worker.ts", "src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node22",
});
