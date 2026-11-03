import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/start.ts"],
  outDir: "dist",
  // Load Node-compatible workspace exports and keep a single Yjs module instance.
  format: ["cjs"],
  dts: false,
  clean: true,
  sourcemap: false,
});
