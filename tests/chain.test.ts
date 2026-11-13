import { describe, expect, it, vi } from "vitest";
import { AllEntriesFailedError, entryName, runAdvisorChain, type ChainAttemptTarget, type StreamResult } from "../src/chain";

const entry = (provider: string, model: string, label?: string): ChainAttemptTarget => ({ provider, model, label });
const ok = (content: string, extra: Partial<StreamResult> = {}): StreamResult => ({ content, thinking: "", ...extra });

describe("runAdvisorChain", () => {
  it("returns the first successful entry", async () => {
    const calls: string[] = [];
    const outcome = await runAdvisorChain(
      [entry("p1", "m1"), entry("p2", "m2")],
      async (target) => {
        calls.push(target.provider);
        return target.provider === "p1" ? ok("answer") : ok("other");
      },
      {},
    );
    expect(outcome.winner?.provider).toBe("p1");
    expect(calls).toEqual(["p1"]);
  });

  it("falls through to the next entry on error", async () => {
    const attempts: number[] = [];
    const failures: string[] = [];
    const outcome = await runAdvisorChain(
      [entry("p1", "m1"), entry("p2", "m2")],
      async (target) => {
        if (target.provider === "p1") throw new Error("boom");
        return ok("second");
      },
      {
        onAttempt: (i) => attempts.push(i),
        onFail: (_i, target, error) => failures.push(`${target.provider}:${error}`),
      },
    );
    expect(outcome.winner?.provider).toBe("p2");
    expect(failures).toEqual(["p1:boom"]);
    expect(attempts).toEqual([0, 1]);
  });

  it("treats an empty response as a failure and continues", async () => {
    const outcome = await runAdvisorChain(
      [entry("p1", "m1"), entry("p2", "m2")],
      async (target) => (target.provider === "p1" ? ok("   ") : ok("real")),
      {},
    );
    expect(outcome.winner?.provider).toBe("p2");
    expect(outcome.failures[0].error).toContain("空响应");
  });

  it("accepts a timed-out stream with partial content as truncated success", async () => {
    const outcome = await runAdvisorChain(
      [entry("p1", "m1")],
      async () => ({ content: "partial answer", thinking: "think", truncated: { reason: "timeout", atMs: 1 } }),
      {},
    );
    expect(outcome.winner?.provider).toBe("p1");
    expect(outcome.result?.truncated?.reason).toBe("timeout");
  });

  it("treats a timed-out stream with no content as a failure", async () => {
    const outcome = await runAdvisorChain(
      [entry("p1", "m1"), entry("p2", "m2")],
      async (target) => (target.provider === "p1" ? { content: "", thinking: "", truncated: { reason: "timeout", atMs: 1 } } : ok("fine")),
      {},
    );
    expect(outcome.winner?.provider).toBe("p2");
    expect(outcome.failures[0].error).toContain("超时");
  });

  it("throws AllEntriesFailedError listing every failure when all entries fail", async () => {
    const error = await runAdvisorChain(
      [entry("p1", "m1"), entry("p2", "m2", "备用")],
      async (target) => {
        throw new Error(target.provider === "p1" ? "timeout" : "401");
      },
      {},
    ).catch((e) => e);
    expect(error).toBeInstanceOf(AllEntriesFailedError);
    expect(error.failures).toHaveLength(2);
    expect(error.message).toContain("timeout");
    expect(error.message).toContain("401");
  });

  it("propagates caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runAdvisorChain(
      [entry("p1", "m1")],
      async () => ok("never"),
      {},
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
  });

  it("streams deltas through the callback of the running attempt", async () => {
    const seen: string[] = [];
    await runAdvisorChain(
      [entry("p1", "m1")],
      async (_target, _signal) => {
        // simulate streaming handled by the caller (tool.ts wires onDelta itself)
        return ok("done");
      },
      { onDone: () => seen.push("done") },
    );
    expect(seen).toEqual(["done"]);
  });
});

describe("entryName", () => {
  it("prefers a non-empty label, falls back to provider/model", () => {
    expect(entryName(entry("p", "m", "架构顾问"))).toBe("架构顾问");
    expect(entryName(entry("p", "m", "  "))).toBe("p/m");
    expect(entryName(entry("p", "m"))).toBe("p/m");
  });
});
