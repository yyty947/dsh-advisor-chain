// Verify the DSH compatibility range with npm's OWN semver resolver, under
// BOTH modes DSH and other tools use:
//   - plain npm semver (pnpm, CI, market-index validators);
//   - `includePrerelease: true`, which DSH's app-boot passes when it evaluates
//     `engines.dsh`.
// The range must admit every 0.2.x release from 0.2.2-rc.4 upward (including
// the 0.2.3 prereleases the maintainer tests on) and nothing from 0.3.0 on —
// in both modes, which is why the range carries the `|| >=0.2.3-0` clause.
// Usage: node verify-peer-range.mjs <package.json>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = process.argv[2] ?? join(here, "..", "package.json");

// Resolve the npm that is actually on PATH, and load the semver npm bundles.
const npmBin = execFileSync(process.platform === "win32" ? "where" : "which", ["npm"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
const npmCli = join(dirname(npmBin), "node_modules", "npm", "bin", "npm-cli.js");
const semver = createRequire(npmCli)("semver");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const peers = Object.entries(pkg.peerDependencies).filter(([k]) => k.startsWith("@deepseek-ai/dsh-"));
const ranges = new Set(peers.map(([, r]) => r));
const range = [...ranges][0];
const engines = pkg.engines?.dsh;

console.log("npm semver:", semver.SEMVER_SPEC_VERSION, "| validRange:", semver.validRange(range));
console.log("range:", range);
console.log("uniform across", peers.length, "dsh peers:", ranges.size === 1, "| engines.dsh matches:", engines === range);

const want = {
  "0.2.2-rc.3": false,
  "0.2.2-rc.4": true,
  "0.2.2-rc.5": true,
  "0.2.2": true,
  "0.2.3-alpha.1": true,
  "0.2.3-alpha.2": true,
  "0.2.3-rc.1": true,
  "0.2.3": true,
  "0.3.0-alpha.1": false,
  "0.3.0-rc.1": false,
  "0.3.0": false,
  "0.3.1": false,
  "1.0.0": false,
};

let bad = 0;
for (const [v, expected] of Object.entries(want)) {
  const plain = semver.satisfies(v, range);
  const dsh = semver.satisfies(v, range, { includePrerelease: true });
  const ok = plain === expected && dsh === expected;
  if (!ok) bad++;
  console.log(
    (ok ? "  ok   " : "  FAIL ") + (expected ? "allow " : "block ") + v.padEnd(14) + ` plain=${plain ? "allow" : "block"} dsh=${dsh ? "allow" : "block"}`,
  );
}
console.log("");
const consistent = ranges.size === 1 && engines === range;
if (!consistent) bad++;
console.log(bad === 0 ? `ALL ${Object.keys(want).length} CASES CORRECT IN BOTH MODES` : `${bad} PROBLEM(S)`);
process.exit(bad === 0 ? 0 : 1);
