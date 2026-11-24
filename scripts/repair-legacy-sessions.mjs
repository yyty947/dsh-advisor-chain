#!/usr/bin/env node
// One-time repair for sessions written by dsh-advisor-chain <= 0.3.9.
//
// Those versions wrote `advisor/*` events into the parent session log for
// their chat card. The host refuses to open a log holding an unknown,
// non-ignorable event type, so such sessions open only while the plugin is
// enabled (it registers the types). This script rewrites every `advisor/*`
// event as an ignorable plugin record (`plugin:dsh-advisor-chain/*`), which
// any host retains and skips — after that the sessions open with or without
// the plugin. 0.3.10 and later never write such events.
//
// Whether to run it is YOUR decision. By default it only reports what it
// would do; nothing is written unless you pass --apply (and confirm).
//
//   node repair-legacy-sessions.mjs                 # preview (dry run)
//   node repair-legacy-sessions.mjs --apply         # repair, with a confirmation prompt
//   node repair-legacy-sessions.mjs --apply --yes   # repair, no prompt
//   node repair-legacy-sessions.mjs --root <dir>    # sessions root (default: ~/.dsh/sessions)
//
// Run it with DSH CLOSED: a session the host holds open would be rewritten
// underneath it. Every rewritten log is first copied to
// `<log>.bak-<timestamp>` next to it; to undo, close DSH and copy the backup
// back. Requires Node.js 22.15+ (native zstd). Old chat cards from those
// sessions stop rendering as cards afterwards (the advisor text itself stays
// in the tool results).

import { readFileSync, writeFileSync, readdirSync, statSync, renameSync, copyFileSync, existsSync } from "node:fs";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

/** Must match LEGACY_ADVISOR_EVENT_TYPES in src/legacy/shim.ts (tests/repair.test.ts pins this). */
const LEGACY_TYPES = ["advisor/start", "advisor/delta", "advisor/message", "advisor/end", "advisor/followup"];
const RECORD_PREFIX = "plugin:dsh-advisor-chain/";
const MIN_AGE_MINUTES = 10;

function parseArgs(argv) {
  const args = { apply: false, yes: false, root: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--yes" || a === "-y") args.yes = true;
    else if (a === "--root") args.root = argv[++i];
    else if (a === "-h" || a === "--help") args.help = true;
    else { console.error(`unknown argument: ${a}`); process.exit(2); }
  }
  return args;
}

function usage() {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
}

/** Rewrite one decoded log; unmodified lines keep their exact text. */
export function rewriteLog(text) {
  const lines = text.split("\n");
  let legacyEvents = 0;
  let badLines = 0;
  const out = lines.map((line) => {
    if (!line.trim()) return line;
    let event;
    try { event = JSON.parse(line); } catch { badLines += 1; return line; }
    if (!event || !LEGACY_TYPES.includes(event.type)) return line;
    legacyEvents += 1;
    const type = RECORD_PREFIX + event.type.slice("advisor/".length);
    return JSON.stringify({ ...event, type, ignorable: true });
  });
  return { text: out.join("\n"), legacyEvents, badLines, changed: legacyEvents > 0 };
}

function findLogs(root) {
  const found = [];
  if (!existsSync(root)) return found;
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/^session\.v\d+\.jsonl\.zstd$/.test(e.name)) found.push(p);
    }
  };
  walk(root, 0);
  return found;
}

function decode(path) {
  return zstdDecompressSync(readFileSync(path)).toString("utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();
  if (typeof zstdDecompressSync !== "function") {
    console.error("this Node.js lacks zstd support; use Node.js 22.15 or newer");
    process.exit(1);
  }
  const root = resolve(args.root ?? join(homedir(), ".dsh", "sessions"));
  console.log(`sessions root: ${root}`);
  const logs = findLogs(root);
  console.log(`session logs found: ${logs.length}`);

  const plan = [];
  const skipped = [];
  for (const path of logs) {
    try {
      const ageMs = Date.now() - statSync(path).mtimeMs;
      const result = rewriteLog(decode(path));
      if (!result.changed) continue;
      if (ageMs < MIN_AGE_MINUTES * 60_000) { skipped.push({ path, reason: `modified ${Math.round(ageMs / 60_000)} min ago (close DSH and retry)` }); continue; }
      plan.push({ path, legacyEvents: result.legacyEvents, badLines: result.badLines, text: result.text });
    } catch (error) {
      skipped.push({ path, reason: `could not decode: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  if (plan.length === 0) {
    console.log("\nno sessions contain legacy advisor events — nothing to repair.");
    for (const s of skipped) console.log(`skipped: ${s.path} (${s.reason})`);
    return 0;
  }
  console.log(`\nsessions with legacy advisor events: ${plan.length}`);
  for (const p of plan) console.log(`  ${p.path}  (${p.legacyEvents} events)`);
  for (const s of skipped) console.log(`  skipped: ${s.path} (${s.reason})`);

  if (!args.apply) {
    console.log("\nDRY RUN — nothing was written. Close DSH, then re-run with --apply to repair.");
    return 0;
  }
  if (!args.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((res) => rl.question('\nClose DSH first. Type "repair" to rewrite these logs (backups are kept): ', res));
    rl.close();
    if (answer.trim() !== "repair") { console.log("aborted — nothing was written."); return 1; }
  }

  let repaired = 0;
  const failures = [];
  for (const p of plan) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${p.path}.bak-${stamp}`;
    const tmp = `${p.path}.repair-tmp`;
    try {
      copyFileSync(p.path, backup);
      writeFileSync(tmp, zstdCompressSync(Buffer.from(p.text, "utf8")));
      // Verify before swapping: every line parses and no legacy type remains.
      const check = rewriteLog(decode(tmp));
      const lineCount = (s) => s.split("\n").length;
      if (check.legacyEvents !== 0 || check.badLines !== p.badLines || lineCount(check.text) !== lineCount(p.text)) {
        throw new Error("verification failed after rewrite");
      }
      renameSync(tmp, p.path);
      repaired += 1;
      console.log(`repaired: ${p.path}  (backup: ${backup})`);
    } catch (error) {
      failures.push({ path: p.path, reason: error instanceof Error ? error.message : String(error) });
      try { if (existsSync(tmp)) renameSync(tmp, p.path + ".failed"); } catch { /* keep going */ }
    }
  }
  console.log(`\nrepaired ${repaired} of ${plan.length} logs.`);
  for (const f of failures) console.log(`FAILED: ${f.path} (${f.reason}) — the original is untouched, a backup may sit next to it`);
  return failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(1); });
}
