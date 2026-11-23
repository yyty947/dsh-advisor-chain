// Verify a peer range with npm's OWN semver resolver — the implementation
// that actually decides whether DSH's plugin manager accepts a version.
// Usage: node verify-peer-range.mjs <package.json>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = process.argv[2] ?? join(here, "..", "package.json");

// Resolve the npm that is actually on PATH (the bundled runtime's node has
// no npm of its own), and load the semver that npm bundles — the very
// implementation that resolves peerDependencies for real.
const npmBin = execFileSync(process.platform === "win32" ? "where" : "which", ["npm"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
const npmCli = join(dirname(npmBin), "node_modules", "npm", "bin", "npm-cli.js");
const semver = createRequire(npmCli)("semver");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const peers = Object.entries(pkg.peerDependencies).filter(([k]) => k.startsWith("@deepseek-ai/dsh-"));
const ranges = new Set(peers.map(([, r]) => r));
const range = [...ranges][0];

console.log("npm semver:", semver.SEMVER_SPEC_VERSION, "| validRange:", semver.validRange(range));
console.log("range:", range);
console.log("uniform across", peers.length, "dsh peers:", ranges.size === 1);
console.log("");

// Expected: every stable and prerelease build of 0.2.1 / 0.2.2 / 0.2.3 is
// allowed; nothing older, and nothing from 0.2.4 onward (untested).
const want = {
  "0.1.9-rc.1": false, "0.2.0": false, "0.2.0-rc.9": false,
  "0.2.1-alpha.1": true, "0.2.1-rc.5": true, "0.2.1": true,
  "0.2.2-alpha.1": true, "0.2.2-rc.5": true, "0.2.2": true,
  "0.2.3-alpha.1": true, "0.2.3-alpha.2": true, "0.2.3-beta.3": true, "0.2.3-rc.1": true, "0.2.3": true,
  "0.2.4-alpha.1": false, "0.2.4-rc.1": false, "0.2.4": false, "0.2.9": false,
  "0.3.0-alpha.1": false, "0.3.0": false, "1.0.0": false,
};

let bad = 0;
for (const [v, expected] of Object.entries(want)) {
  const got = semver.satisfies(v, range);
  if (got !== expected) bad++;
  console.log((got === expected ? "  ok   " : "  FAIL ") + (got ? "allow " : "block ") + v);
}
console.log("");
console.log(bad === 0 ? `ALL ${Object.keys(want).length} CASES CORRECT` : `${bad} MISMATCHES`);
process.exit(bad === 0 ? 0 : 1);
