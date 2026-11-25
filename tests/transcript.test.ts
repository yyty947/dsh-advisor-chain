import { describe, expect, it } from "vitest";
import { buildTranscript, messageToEntry, userEntryLabel, type TranscriptMessageLike } from "../src/transcript";

const user = (text: string): TranscriptMessageLike => ({ role: "user", source: { kind: "user" }, content: [{ type: "text", text }] });
const assistant = (...blocks: Array<Record<string, unknown>>): TranscriptMessageLike => ({
  role: "assistant",
  source: { kind: "model", provider: "p", model: "m" },
  content: blocks as never,
});
const toolResult = (callId: string, text: string, isError = false): TranscriptMessageLike => ({
  role: "tool",
  source: { kind: "tool", callId },
  toolCallId: callId,
  isError,
  content: [{ type: "text", text }],
});

describe("messageToEntry", () => {
  it("keeps tool call names AND arguments, skipping reasoning", () => {
    const entry = messageToEntry(
      assistant(
        { type: "reasoning", text: "let me think about this at length" },
        { type: "text", text: "我先看一下配置。" },
        { type: "tool-call", id: "c1", name: "read", arguments: JSON.stringify({ file_path: "src/index.ts", limit: 40 }) },
      ),
      2000,
    );
    expect(entry?.label).toBe("主模型");
    expect(entry?.text).toBe("我先看一下配置。\n（工具调用 read：{\"file_path\":\"src/index.ts\",\"limit\":40}）");
    expect(entry?.text).not.toContain("let me think");
  });

  it("labels injected user-role context by producer instead of as the user", () => {
    const skills = { role: "user", source: { kind: "skills", form: "catalog" }, content: [{ type: "text", text: "可用技能：…" }] };
    const env = { role: "user", source: { kind: "environment", form: "snapshot" }, content: [{ type: "text", text: "cwd: C:\\x" }] };
    expect(userEntryLabel(skills.source)).toBe("注入：skills/catalog");
    expect(userEntryLabel(env.source)).toBe("注入：environment/snapshot");
    expect(messageToEntry(skills, 2000)?.label).toBe("注入：skills/catalog");
    expect(messageToEntry(user("hi"), 2000)?.label).toBe("用户");
  });

  it("reduces a notice to its one-line summary", () => {
    const notice = { role: "user", source: { kind: "subagent-settled", form: "notice", summary: "顾问已完成" }, content: [{ type: "text", text: "LONG BODY" }] };
    expect(messageToEntry(notice, 2000)).toEqual({ label: "注入：subagent-settled/notice", text: "顾问已完成" });
  });

  it("marks failed tool results", () => {
    expect(messageToEntry(toolResult("c1", "boom", true), 2000)).toEqual({ label: "工具结果（失败）", text: "boom" });
  });

  it("drops system and developer messages", () => {
    expect(messageToEntry({ role: "system", content: [{ type: "text", text: "harness" }] }, 2000)).toBeNull();
    expect(messageToEntry({ role: "developer", content: [{ type: "tool-addition", toolName: "x" }] }, 2000)).toBeNull();
  });

  it("clips long entries and counts the clip", () => {
    const clipped = { count: 0 };
    const entry = messageToEntry(toolResult("c1", "x".repeat(500)), 100, new Set(), undefined, clipped);
    expect(entry?.text.startsWith("x".repeat(100))).toBe(true);
    expect(entry?.text).toContain("（截断，原 500 字符）");
    expect(clipped.count).toBe(1);
  });
});

describe("buildTranscript", () => {
  const opts = { maxChars: 100000, perEntryMaxChars: 2000 };

  it("leaves out every second_opinion call and result, so a new advisor is not anchored by earlier opinions", () => {
    const result = buildTranscript(
      [
        user("第一个问题"),
        assistant({ type: "tool-call", id: "a", name: "second_opinion", arguments: "{\"question\":\"q1\"}" }),
        toolResult("a", "第一份意见"),
        assistant({ type: "text", text: "继续干活" }),
        assistant({ type: "tool-call", id: "b", name: "second_opinion", arguments: "{\"question\":\"q2\"}" }),
      ],
      { ...opts, excludeToolName: "second_opinion" },
    );
    expect(result.text).not.toContain("q1");
    expect(result.text).not.toContain("第一份意见");
    expect(result.text).not.toContain("q2");
    // Both assistant messages that only held a consultation call disappear entirely.
    expect(result.text.match(/\[主模型\]/g)?.length).toBe(1);
    expect(result.omitted).toEqual({ priorAdvice: 1 });
  });

  it("drops harness bookkeeping, keeps only the newest snapshot, and reports what it left out", () => {
    const injected = (kind: string, text: string): TranscriptMessageLike => ({ role: "user", source: { kind }, content: [{ type: "text", text }] });
    const result = buildTranscript(
      [
        injected("skill-catalog", "技能目录 A".repeat(500)),
        injected("time-context", "时间 1"),
        user("真实问题"),
        injected("time-context", "时间 2"),
        { role: "user", source: { kind: "subagent-settled", form: "notice", summary: "agent-1 finished" }, content: [] },
        injected("agent-instructions", "AGENTS 旧版"),
        injected("agent-instructions", "AGENTS 新版"),
        injected("agent-message", "来自其他代理的内容"),
      ],
      opts,
    );
    expect(result.text).not.toContain("技能目录");
    expect(result.text).not.toContain("时间 1");
    expect(result.text).toContain("时间 2");
    expect(result.text).not.toContain("agent-1 finished");
    expect(result.text).not.toContain("AGENTS 旧版");
    expect(result.text).toContain("AGENTS 新版");
    expect(result.text).toContain("来自其他代理的内容");
    expect(result.text).toContain("真实问题");
    expect(result.keptCount).toBe(4);
    expect(result.omitted).toEqual({ skills: 1, notices: 1, snapshots: 2 });
  });

  it("keeps the newest window within the budget and restores the original request as a head summary", () => {
    const messages: TranscriptMessageLike[] = [user("最初的任务：实现 X")];
    for (let i = 0; i < 20; i++) {
      messages.push(assistant({ type: "text", text: `步骤 ${i} `.repeat(20) }));
      messages.push(toolResult(`c${i}`, `结果 ${i} `.repeat(20)));
    }
    const result = buildTranscript(messages, { maxChars: 1500, perEntryMaxChars: 2000 });
    expect(result.truncated).toBe(true);
    expect(result.droppedCount).toBeGreaterThan(0);
    expect(result.text.startsWith("（为控制篇幅，已省略更早的")).toBe(true);
    expect(result.text).toContain("（最初的用户请求，可能已截断）\n最初的任务：实现 X");
    expect(result.text).toContain("结果 19");
    expect(result.text.length).toBeLessThanOrEqual(1500 + 200);
  });

  it("does not add a head summary when the original request is still inside the window", () => {
    const result = buildTranscript([user("任务"), assistant({ type: "text", text: "ok" })], opts);
    expect(result.truncated).toBe(false);
    expect(result.text).not.toContain("最初的用户请求");
    expect(result.text).toBe("[用户]\n任务\n\n[主模型]\nok");
  });

  it("reports clipped entries separately from dropped ones", () => {
    const result = buildTranscript([user("y".repeat(300)), toolResult("c", "z".repeat(300))], { maxChars: 100000, perEntryMaxChars: 50 });
    expect(result.droppedCount).toBe(0);
    expect(result.clippedCount).toBe(2);
  });

  it("returns only a placeholder when nothing is renderable", () => {
    const result = buildTranscript([{ role: "system", content: [] }], opts);
    expect(result.text).toBe("");
    expect(result.truncated).toBe(false);
  });
});
