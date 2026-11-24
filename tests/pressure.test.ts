import { describe, expect, it } from "vitest";
import { RepeatPressureTracker, extractUserMessageText } from "../src/pressure";

const userEvent = (text: string) => ({ type: "user/message", data: { content: [{ type: "text", text }] } });

describe("extractUserMessageText", () => {
  it("extracts text from user/message events only", () => {
    expect(extractUserMessageText(userEvent("hello"))).toBe("hello");
    expect(extractUserMessageText({ type: "assistant/message", data: { content: [{ type: "text", text: "x" }] } })).toBeNull();
    expect(extractUserMessageText({ type: "user/message", data: { content: [] } })).toBeNull();
    expect(extractUserMessageText({ type: "user/message", data: {} })).toBeNull();
  });
});

describe("RepeatPressureTracker", () => {
  it("counts consecutive repeats of the same text per session", () => {
    const tracker = new RepeatPressureTracker();
    tracker.handleEvent("s1", userEvent("为什么不工作"));
    tracker.handleEvent("s1", userEvent("为什么不工作"));
    tracker.handleEvent("s1", userEvent("为什么不工作"));
    expect(tracker.get("s1")).toEqual({ count: 3, text: "为什么不工作" });
  });

  it("resets the count when the text changes", () => {
    const tracker = new RepeatPressureTracker();
    tracker.handleEvent("s1", userEvent("问题 A"));
    tracker.handleEvent("s1", userEvent("问题 A"));
    tracker.handleEvent("s1", userEvent("问题 B"));
    expect(tracker.get("s1")).toEqual({ count: 1, text: "问题 B" });
  });

  it("tracks sessions independently and tolerates unknown ids", () => {
    const tracker = new RepeatPressureTracker();
    tracker.handleEvent("s1", userEvent("x"));
    tracker.handleEvent("s2", userEvent("x"));
    tracker.handleEvent("s2", userEvent("x"));
    expect(tracker.get("s1")?.count).toBe(1);
    expect(tracker.get("s2")?.count).toBe(2);
    expect(tracker.get(undefined)).toBeUndefined();
    expect(tracker.get("missing")).toBeUndefined();
  });

  it("ignores non-user events", () => {
    const tracker = new RepeatPressureTracker();
    tracker.handleEvent("s1", { type: "tool/result", data: { message: {} } });
    expect(tracker.get("s1")).toBeUndefined();
  });

  it("compares normalized text: case, punctuation and whitespace do not break the streak", () => {
    const tracker = new RepeatPressureTracker();
    tracker.handleEvent("s1", userEvent("Why doesn't this work?"));
    tracker.handleEvent("s1", userEvent("why doesnt this work"));
    tracker.handleEvent("s1", userEvent("  Why  doesn't this work! "));
    expect(tracker.get("s1")?.count).toBe(3);
    expect(tracker.get("s1")?.text).toBe("Why  doesn't this work!"); // raw text of the last message (trimmed)
    tracker.handleEvent("s1", userEvent("为什么不工作？"));
    tracker.handleEvent("s1", userEvent("为什么不工作"));
    expect(tracker.get("s1")?.count).toBe(2);
  });

  it("never counts advance phrases or content-free messages", () => {
    const tracker = new RepeatPressureTracker();
    tracker.handleEvent("s1", userEvent("继续"));
    tracker.handleEvent("s1", userEvent("继续"));
    tracker.handleEvent("s1", userEvent("Please continue"));
    tracker.handleEvent("s1", userEvent("!!!"));
    tracker.handleEvent("s1", userEvent("好的"));
    expect(tracker.get("s1")).toBeUndefined();
    tracker.handleEvent("s1", userEvent("fix the bug"));
    tracker.handleEvent("s1", userEvent("继续"));
    expect(tracker.get("s1")).toEqual({ count: 1, text: "fix the bug" }); // the nudge neither counts nor resets
    tracker.handleEvent("s1", userEvent("fix the bug"));
    expect(tracker.get("s1")?.count).toBe(2);
  });
});
