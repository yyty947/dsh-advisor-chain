import { defineConfig } from "tsdown";

// Host half: ESM, runs in the DSH Host (Node). Peer dependencies stay as
// externals so the plugin resolves them from the DSH installation/profile.
// Client half: a plain IIFE script that calls window.__ModuleLoader__.load;
// react comes from the browser module table through the loader's require
// shim, so nothing is bundled for it.
export default defineConfig([
  {
    entry: ["src/index.ts"],
    outDir: "lib",
    format: "esm",
    platform: "node",
    // No .d.mts: the Config schema's inferred type references schemastery's
    // internal cosmokit types, which are not portable across package stores,
    // and the runtime never consumes our type declarations.
    dts: false,
    outExtensions: () => ({ js: ".mjs" }),
    target: "node22",
  },
  {
    entry: ["src/client.ts"],
    outDir: "lib",
    format: "iife",
    platform: "browser",
    outExtensions: () => ({ js: ".js" }),
    target: "chrome110",
    minify: false,
  },
]);
