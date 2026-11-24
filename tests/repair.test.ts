import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LEGACY_ADVISOR_EVENT_TYPES } from "../src/legacy/shim";

const script = readFileSync(resolve("scripts/repair-legacy-sessions.mjs"), "utf8");
/** The script is a standalone executable (it must run with DSH closed, without the plugin loaded); import its pure rewriter. */
// @ts-expect-error — the script is plain ESM without type declarations
const { rewriteLog } = await import("../scripts/repair-legacy-sessions.mjs");

describe("repair-legacy-sessions script", () => {
  it("targets exactly the event types the read shim registers", () => {
    const m = script.match(/const LEGACY_TYPES = \[([^\]]+)\]/);
    expect(m).not.toBeNull();
    const types = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    expect(types).toEqual([...LEGACY_ADVISOR_EVENT_TYPES]);
  });

  it("rewrites legacy events into ignorable plugin records and leaves everything else byte-for-byte", () => {
    const header = JSON.stringify({ type: "session", seq: 0, time: 1, data: { id: "s1" } });
    const user = JSON.stringify({ type: "user/message", seq: 1, time: 2, data: { content: [{ type: "text", text: "hi" }] } });
    const legacy = JSON.stringify({ type: "advisor/start", seq: 2, time: 3, data: { consultId: "c1" } });
    const legacyDelta = '{"type":"advisor/delta","seq":3,"time":4,"data":{"text":"…"}}';
    const result = rewriteLog([header, user, legacy, legacyDelta, ""].join("\n"));
    expect(result).toMatchObject({ legacyEvents: 2, badLines: 0, changed: true });
    const lines = result.text.split("\n");
    expect(lines[0]).toBe(header);
    expect(lines[1]).toBe(user);
    expect(JSON.parse(lines[2])).toEqual({ type: "plugin:dsh-advisor-chain/start", seq: 2, time: 3, data: { consultId: "c1" }, ignorable: true });
    expect(JSON.parse(lines[3])).toEqual({ type: "plugin:dsh-advisor-chain/delta", seq: 3, time: 4, data: { text: "…" }, ignorable: true });
    expect(lines[4]).toBe("");
    // Record types follow the host's plugin record grammar: "plugin:" + lowercase slash-separated segments.
    expect(JSON.parse(lines[2]).type).toMatch(/^plugin:[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/);
  });

  it("is a no-op for logs without legacy events and tolerates unparsable lines", () => {
    const text = ['{"type":"session","seq":0}', "not json"].join("\n");
    const result = rewriteLog(text);
    expect(result).toMatchObject({ legacyEvents: 0, badLines: 1, changed: false });
    expect(result.text).toBe(text);
  });
});
