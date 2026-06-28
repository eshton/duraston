/**
 * Bundle the TS sources into a single ESM module for jco componentize.
 *
 * componentize-js consumes one JS module, so we pre-bundle with esbuild (the
 * same approach Golem's TS templates use). `platform: "neutral"` keeps Node
 * built-ins from being assumed present -- surfacing any accidental Node
 * dependency at build time rather than as a runtime trap inside the sandbox.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/component.ts"],
  outfile: "dist/component.js",
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  mainFields: ["module", "main"],
  conditions: ["import", "default"],
  logLevel: "info",
});

console.log("bundled -> dist/component.js");
