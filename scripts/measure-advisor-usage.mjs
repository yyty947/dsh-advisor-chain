// Read-only dev tool: decode session logs and report the token usage each
// model request reported, so advisor-input changes can be measured rather
// than guessed (AGENTS.md → 成本). Never writes or modifies a log.
//
// Usage: node scripts/measure-advisor-usage.mjs <session.v4.jsonl.zstd>...
//   Pass advisor child session logs (directories named by the child id under
//   ~/.dsh/sessions/<workspace>/) to compare compositions.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { zstdDecompressSync } from "node:zlib";
import { basename, join } from "node:path";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error("usage: node scripts/measure-advisor-usage.mjs <session log>...");
  process.exit(2);
}

function decode(path) {
  const raw = readFileSync(path);
  // Node ≥ 22.15 decompresses zstd natively; fall back to a zstd binary.
  if (typeof zstdDecompressSync === "function") return zstdDecompressSync(raw).toString("utf8");
  return execFileSync("zstd", ["-dc", path], { encoding: "utf8", maxBuffer: 1 << 30 });
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const rows = [];
for (const path of paths) {
  const text = decode(path);
  const totals = { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
  let systemChars = 0;
  let toolSchemas = 0;
  let toolSchemaChars = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "system/message") {
      const blocks = e.data?.message?.content ?? [];
      systemChars += blocks.reduce((n, b) => n + (typeof b.text === "string" ? b.text.length : 0), 0);
    }
    const tools = e.data?.header?.tools;
    if (e.type === "request/header" && Array.isArray(tools)) {
      toolSchemas = Math.max(toolSchemas, tools.length);
      toolSchemaChars = Math.max(toolSchemaChars, JSON.stringify(tools).length);
    }
    // Each model request records its usage on the assistant message it produced.
    const u = e.type === "assistant/message" ? e.data?.usage : undefined;
    if (u && typeof u === "object") {
      totals.requests += 1;
      totals.input += num(u.inputTokens);
      totals.cacheRead += num(u.cacheReadTokens);
      totals.cacheWrite += num(u.cacheWriteTokens);
      totals.output += num(u.outputTokens);
      totals.reasoning += num(u.reasoningTokens);
    }
  }
  rows.push({
    session: basename(path.replace(/[\\/]$/, "")).slice(0, 8),
    requests: totals.requests,
    input: totals.input + totals.cacheRead + totals.cacheWrite,
    output: totals.output,
    systemChars,
    toolSchemas,
    toolSchemaChars,
  });
}
console.table(rows);
