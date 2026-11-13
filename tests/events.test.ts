import { describe, expect, it } from "vitest";
import { appendAdvisorEnd, appendAdvisorMessage, appendAdvisorStart, latestTurnStep } from "../src/events";

function fakeLog(events: Array<{ type: string; data: Record<string, unknown> }>) {
  const appended: Array<{ type: string; data: unknown }> = [];
  return {
    id: "session-test",
    appended,
    snapshotEvents: () => events,
    append: (type: string, data: unknown) => appended.push({ type, data }),
  };
}

describe("latestTurnStep", () => {
  it("finds the closest step/start scanning backwards", () => {
    const log = fakeLog([
      { type: "turn/start", data: { turn: 1 } },
      { type: "step/start", data: { turn: 1, step: 1 } },
      { type: "tool/result", data: {} },
      { type: "step/start", data: { turn: 1, step: 2 } },
    ]);
    expect(latestTurnStep(log)).toEqual({ turn: 1, step: 2 });
  });

  it("falls back to turn/start then 0/0", () => {
    expect(latestTurnStep(fakeLog([{ type: "turn/start", data: { turn: 3 } }]))).toEqual({ turn: 3, step: 0 });
    expect(latestTurnStep(fakeLog([]))).toEqual({ turn: 0, step: 0 });
  });

  it("tolerates a log without snapshotEvents", () => {
    expect(latestTurnStep({})).toEqual({ turn: 0, step: 0 });
  });
});

describe("append builders", () => {
  it("start/delta/message/end carry consultId and turn/step coordinates", () => {
    const log = fakeLog([{ type: "step/start", data: { turn: 2, step: 1 } }]);
    appendAdvisorStart(log, {
      consultId: "c1",
      question: "q",
      chain: [{ provider: "p", model: "m", label: "顾问1" }],
    });
    appendAdvisorMessage(log, {
      consultId: "c1",
      attemptIndex: 0,
      label: "顾问1",
      provider: "p",
      model: "m",
      content: "answer",
    });
    appendAdvisorEnd(log, { consultId: "c1", status: "done", usedModel: "p/m", attempts: [{ label: "顾问1", ok: true }] });
    expect(log.appended.map((e) => e.type)).toEqual(["advisor/start", "advisor/message", "advisor/end"]);
    const start = log.appended[0].data as Record<string, unknown>;
    expect(start.consultId).toBe("c1");
    expect(start.turn).toBe(2);
    expect(start.step).toBe(1);
    expect(start.chain).toEqual([{ label: "顾问1", provider: "p", model: "m" }]);
    const message = log.appended[1].data as Record<string, unknown>;
    expect(message.content).toBe("answer");
    expect(message.truncated).toBeUndefined();
    const end = log.appended[2].data as Record<string, unknown>;
    expect(end.status).toBe("done");
    expect(end.usedModel).toBe("p/m");
  });

  it("omits optional fields instead of writing undefined", () => {
    const log = fakeLog([]);
    appendAdvisorMessage(log, { consultId: "c2", attemptIndex: 0, label: "l", provider: "p", model: "m", content: "x" });
    const data = JSON.stringify(log.appended[0].data);
    expect(data).not.toContain("undefined");
    expect(data).not.toContain('"truncated"');
  });
});
