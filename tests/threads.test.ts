import { describe, expect, it } from "vitest";
import {
  MAX_THREAD_CHARS,
  MAX_THREAD_ROUNDS,
  rebuildThread,
  threadCapacityError,
  threadToMessages,
  type ThreadEventLike,
} from "../src/threads";

const start = (consultId: string, question: string, mode: "inherited" | "standalone" = "inherited", context?: string): ThreadEventLike => ({
  type: "advisor/start",
  data: { consultId, question, mode, ...context === undefined ? {} : { context } },
});
const answer = (consultId: string, content: string, provider = "p1", model = "m1", round?: number): ThreadEventLike => ({
  type: "advisor/message",
  data: { consultId, content, provider, model, ...round === undefined ? {} : { round } },
});
const followup = (consultId: string, text: string, round: number): ThreadEventLike => ({
  type: "advisor/followup",
  data: { consultId, followUp: text, round },
});
const noise: ThreadEventLike = { type: "user/message", data: { content: [{ type: "text", text: "unrelated" }] } };

describe("rebuildThread", () => {
  it("rebuilds question, answer, and follow-up rounds chronologically", () => {
    const events = [
      noise,
      start("c1", "方案 A 是否成立？", "inherited", "约束：Node 18"),
      answer("c1", "成立，依据如下……"),
      followup("c1", "那 B 呢？", 1),
      answer("c1", "B 也成立，但需注意……", "p1", "m1", 1),
      noise,
    ];
    const thread = rebuildThread(events, "c1")!;
    expect(thread.mode).toBe("inherited");
    expect(thread.context).toBe("约束：Node 18");
    expect(thread.turns).toEqual([
      { role: "user", text: "方案 A 是否成立？" },
      { role: "advisor", text: "成立，依据如下……" },
      { role: "user", text: "那 B 呢？" },
      { role: "advisor", text: "B 也成立，但需注意……" },
    ]);
    expect(thread.rounds).toBe(1);
    expect(thread.usedProvider).toBe("p1");
    expect(thread.usedModel).toBe("m1");
    expect(thread.sizeChars).toBeGreaterThan(0);
  });

  it("preserves standalone mode and ignores events of other consultations", () => {
    const events = [
      start("c1", "盲审问题", "standalone"),
      answer("c2", "别的咨询的回答"),
      answer("c1", "盲审回答"),
    ];
    const thread = rebuildThread(events, "c1")!;
    expect(thread.mode).toBe("standalone");
    expect(thread.turns).toEqual([
      { role: "user", text: "盲审问题" },
      { role: "advisor", text: "盲审回答" },
    ]);
  });

  it("returns undefined for an unknown consult id", () => {
    expect(rebuildThread([start("c1", "q")], "nope")).toBeUndefined();
    expect(rebuildThread([], "c1")).toBeUndefined();
  });
});

describe("threadCapacityError", () => {
  const threadWithRounds = (rounds: number, sizeChars = 100) =>
    rebuildThread(
      [
        start("c1", "q"),
        ...Array.from({ length: rounds + 1 }, (_, i) => answer("c1", `a${i}`, "p", "m", i)),
        ...Array.from({ length: rounds }, (_, i) => followup("c1", `f${i}`, i + 1)),
      ],
      "c1",
    )!;

  it("allows a thread within limits", () => {
    expect(threadCapacityError(threadWithRounds(2), 50)).toBeUndefined();
  });

  it(`rejects at ${MAX_THREAD_ROUNDS} rounds`, () => {
    const err = threadCapacityError(threadWithRounds(MAX_THREAD_ROUNDS), 50)!;
    expect(err).toContain("轮");
  });

  it(`rejects when the incoming text pushes past ${MAX_THREAD_CHARS} chars`, () => {
    const thread = threadWithRounds(1);
    thread.sizeChars = MAX_THREAD_CHARS - 10;
    expect(threadCapacityError(thread, 50)).toContain("KB");
    expect(threadCapacityError(thread, 5)).toBeUndefined();
  });
});

describe("threadToMessages", () => {
  it("appends the new follow-up as the final user message", () => {
    const thread = rebuildThread(
      [start("c1", "q"), answer("c1", "a"), followup("c1", "f1", 1), answer("c1", "a2", "p", "m", 1)],
      "c1",
    )!;
    const messages = threadToMessages(thread, "再展开讲讲");
    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "q"],
      ["assistant", "a"],
      ["user", "f1"],
      ["assistant", "a2"],
      ["user", "再展开讲讲"],
    ]);
  });
});
