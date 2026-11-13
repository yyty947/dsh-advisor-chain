import { describe, expect, it } from "vitest";
import { buildAdvisorUserPrompt, buildTranscript, messageToEntry } from "../src/transcript";

const msg = (role: string, text: string) => ({ role, content: [{ type: "text", text }] });

describe("messageToEntry", () => {
  it("labels user/assistant/tool and skips system/developer", () => {
    expect(messageToEntry(msg("user", "hi"), 100)?.label).toBe("用户");
    expect(messageToEntry(msg("assistant", "hello"), 100)?.label).toBe("主模型");
    expect(messageToEntry(msg("tool", "output"), 100)?.label).toBe("工具结果");
    expect(messageToEntry(msg("system", "big harness prompt"), 100)).toBeNull();
    expect(messageToEntry(msg("developer", "policy"), 100)).toBeNull();
  });

  it("clips a single entry to perEntryMaxChars", () => {
    const entry = messageToEntry(msg("tool", "x".repeat(5000)), 1000)!;
    expect(entry.text.length).toBeLessThan(1100);
    expect(entry.text).toContain("截断");
  });

  it("summarizes unknown non-text blocks in a bounded way", () => {
    const entry = messageToEntry({ role: "assistant", content: [{ type: "weird-block", data: { big: "y".repeat(500) } }] }, 5000)!;
    expect(entry.text.length).toBeLessThan(400);
    expect(entry.text).toContain("weird-block");
  });
});

describe("buildTranscript", () => {
  it("keeps everything within the budget", () => {
    const messages = [msg("user", "q1"), msg("assistant", "a1"), msg("user", "q2")];
    const result = buildTranscript(messages, { maxChars: 10000, perEntryMaxChars: 2000 });
    expect(result.truncated).toBe(false);
    expect(result.text).toContain("[用户]\nq1");
    expect(result.text).toContain("[主模型]\na1");
    expect(result.text).toContain("[用户]\nq2");
  });

  it("drops the oldest messages and marks truncation", () => {
    const messages = Array.from({ length: 10 }, (_, i) => msg("user", `message-number-${i}`));
    const result = buildTranscript(messages, { maxChars: 200, perEntryMaxChars: 2000 });
    expect(result.truncated).toBe(true);
    expect(result.droppedCount).toBeGreaterThan(0);
    expect(result.text).toContain("已省略更早的");
    // newest kept, oldest dropped
    expect(result.text).toContain("message-number-9");
    expect(result.text).not.toContain("message-number-0");
  });

  it("always keeps at least the newest entry even when it alone exceeds the budget", () => {
    const messages = [msg("user", "old"), msg("assistant", "n".repeat(500))];
    const result = buildTranscript(messages, { maxChars: 50, perEntryMaxChars: 2000 });
    expect(result.text).toContain("nnn");
  });
});

describe("buildAdvisorUserPrompt", () => {
  it("assembles transcript, context, and question sections", () => {
    const prompt = buildAdvisorUserPrompt({ transcriptText: "[用户]\nhi", question: "方案 A 是否成立？", context: "必须兼容 Node 18" });
    expect(prompt).toContain("对话抄本");
    expect(prompt).toContain("[用户]\nhi");
    expect(prompt).toContain("助手补充的对话外信息");
    expect(prompt).toContain("必须兼容 Node 18");
    expect(prompt).toContain("助手此刻的问题");
    expect(prompt).toContain("方案 A 是否成立？");
  });

  it("omits the context section when absent", () => {
    const prompt = buildAdvisorUserPrompt({ transcriptText: "t", question: "q" });
    expect(prompt).not.toContain("助手补充的对话外信息");
  });
});
