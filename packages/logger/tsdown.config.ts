import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/diagnostics-browser.ts", "src/diagnostics-server.ts"],
  outDir: "dist",
  format: ["esm", "cjs"],
  exports: true,
  dts: true,
  clean: true,
  sourcemap: true,
});
