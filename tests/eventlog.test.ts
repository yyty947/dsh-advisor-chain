import { describe, expect, it } from "vitest";
import { SessionEventLog } from "../src/advisor/eventlog";
import { ADVISOR_LABEL_PREFIX } from "../src/advisor/identify";

const descriptor = (label: string) => ({ type: "subagent/descriptor", seq: 0, time: 0, data: { version: 3, mode: "continuable", provider: "spawn", label, agentProvider: "p", agentModel: "m" } });

describe("SessionEventLog", () => {
  it("folds the descriptor and the last sandbox mode from the tracked stream", () => {
    const log = new SessionEventLog();
    log.handleEvent("c1", descriptor(`${ADVISOR_LABEL_PREFIX}x`) as never);
    log.handleEvent("c1", { type: "sandbox/mode", seq: 1, data: { mode: "workspace-write" } } as never);
    log.handleEvent("c1", { type: "sandbox/mode", seq: 2, data: { mode: "read-only" } } as never);
    expect(log.descriptorOf("c1")?.label).toBe(`${ADVISOR_LABEL_PREFIX}x`);
    expect(log.lastModeOf("c1")).toBe("read-only");
    expect(log.isComplete("c1")).toBe(true);
    expect(log.descriptorOf("missing")).toBeUndefined();
    expect(log.lastModeOf("missing")).toBeUndefined();
  });
  it("keeps the head whole and a rolling tail, reporting the gap", () => {
    const log = new SessionEventLog(4, 3, 2);
    log.handleEvent("c1", descriptor("l") as never);
    for (let i = 1; i <= 6; i++) log.handleEvent("c1", { type: "user/message", seq: i } as never);
    // head = seq 0..2, tail = seq 5..6
    expect(log.eventsOf("c1")?.map((e) => e.seq)).toEqual([0, 1, 2, 5, 6]);
    expect(log.isComplete("c1")).toBe(false);
    expect(log.descriptorOf("c1")?.label).toBe("l"); // the head still carries the descriptor
    expect(log.since("c1", 5).map((e) => e.seq)).toEqual([5, 6]);
  });
  it("evicts the least recently used sessions and ignores malformed input", () => {
    const log = new SessionEventLog(2);
    log.handleEvent("a", { type: "x" } as never);
    log.handleEvent("b", { type: "x" } as never);
    log.handleEvent("a", { type: "y" } as never); // bump a
    log.handleEvent("c", { type: "x" } as never); // evicts b
    expect(log.has("a")).toBe(true);
    expect(log.has("b")).toBe(false);
    expect(log.has("c")).toBe(true);
    log.handleEvent("", { type: "x" } as never);
    log.handleEvent("a", undefined as never);
    expect(log.eventsOf("a")?.length).toBe(2);
  });
});
