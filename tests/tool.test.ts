import { describe, expect, it, vi } from "vitest";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SubagentActivation } from "@deepseek-ai/dsh-subagent";
import { createSecondOpinionTool, type ToolValue } from "../src/tool";
import { ADVISOR_LABEL_PREFIX, AdvisorRegistry } from "../src/advisor/identify";
import type { HostServices } from "../src/advisor/types";
import { normalizeConfig } from "../src/config";

/** Mirror of the host's lossless-JSON rules for a tool value. */
function lossless(value: unknown, path = "$"): string | null {
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0) ? null : `${path}: bad number`;
  if (typeof value !== "object") return `${path}: non-JSON ${typeof value}`;
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) return `${path}: sparse/extra array keys`;
    for (let i = 0; i < value.length; i++) {
      const r = lossless(value[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return `${path}: non-plain object`;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return `${path}: symbol key`;
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (!d.enumerable) return `${path}.${key}: non-enumerable`;
    const r = lossless((value as Record<string, unknown>)[key], `${path}.${key}`);
    if (r) return r;
  }
  return null;
}

function fakeParent(): Agent {
  return { id: "parent-1", options: { provider: "p", model: "m" }, session: { id: "parent-1", deriveMessages: () => [], snapshotEvents: () => [] } } as unknown as Agent;
}

function fakeHost(childId: string, answer: string | Error) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners: Record<string, Array<(...args: any[]) => unknown>> = {};
  const childListeners: Record<string, Array<(...args: any[]) => unknown>> = {};
  const child = { id: childId, status: "idle", session: { id: childId, snapshotEvents: () => [] }, ctx: { on: (name: string, l: (...args: any[]) => unknown) => { (childListeners[name] ??= []).push(l); return () => true; } } };
  const host = {
    subagents: {
      startActivation: vi.fn(async () => {
        for (const l of listeners["subagent/start"] ?? []) l({ runId: "r", provider: "spawn", parentSessionId: "parent-1", id: childId, local: true });
        const result = answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ output: [{ type: "text", text: answer }], stopReason: "completed" });
        return { childId, name: "agent-1", result, dispose: vi.fn(async () => {}) } as unknown as SubagentActivation;
      }),
      sendMessage: vi.fn(async () => "mid"),
      interrupt: vi.fn(),
    },
    agents: { get: vi.fn(() => child) },
    llm: { resolveModelInfo: vi.fn(async () => ({ reasoning: { efforts: [] } })) },
    optional: vi.fn(() => undefined),
    on: (name: string, listener: (...args: never[]) => unknown) => {
      (listeners[name] ??= []).push(listener);
      return () => true;
    },
    emit: (name: string, ...args: unknown[]) => (listeners[name] ?? []).forEach((l) => l(...(args as never[]))),
    emitChild: (name: string, ...args: unknown[]) => (childListeners[name] ?? []).forEach((l) => l(...args)),
  };
  return host as unknown as HostServices & { emit: (name: string, ...args: unknown[]) => void; emitChild: (name: string, ...args: unknown[]) => void };
}

function deps(host: HostServices, config: Record<string, unknown> = {}) {
  const registry = new AdvisorRegistry({ host, sandbox: { setSandboxMode: vi.fn(), overrideOf: vi.fn(() => "read-only") }, descriptorOf: () => ({ label: `${ADVISOR_LABEL_PREFIX}x` }), depthOf: () => 0 });
  registry.install();
  return { host, registry, getConfig: () => normalizeConfig({ chain: [{ provider: "z-ai", model: "glm-5.4", reasoningEffort: "max" }], limits: { defaultTimeoutMs: 5000 }, ...config }) };
}

const exec = (parent: Agent = fakeParent()) => ({ agent: parent, signal: new AbortController().signal }) as never;

describe("second_opinion tool", () => {
  it("returns a lossless-JSON value whose consult_id is the winning child's session id", async () => {
    const d = deps(fakeHost("child-abc", "意见：可以。"));
    const tool = createSecondOpinionTool(d);
    const value = (await tool.execute({ question: "问题？", context: "背景", mode: "standalone" }, exec())) as ToolValue;
    expect(lossless(value)).toBeNull();
    expect(value).toMatchObject({ advice: "意见：可以。", model: "z-ai/glm-5.4", consultId: "child-abc", dual: false, truncated: false, attempts: [{ label: "z-ai/glm-5.4", ok: true }] });
    // The undeclared effort was dropped and reported.
    expect(value.notes.join("\n")).toContain("推理档位「max」");
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    const meta = tool.output.presentationMeta!({ question: "问题？", mode: "standalone" }, value as never);
    expect(lossless(meta)).toBeNull();
    expect(meta).toMatchObject({ kind: "second-opinion", consultId: "child-abc", attempts: [{ label: "z-ai/glm-5.4", ok: true }] });
    const rendered = tool.output.render({ question: "问题？" }, value as never) as Array<{ type: string; text: string }>;
    expect(rendered[0].text).toContain("consult_id: child-abc");
  });

  it("routes a rejected activation result through the classification table and stops the chain", async () => {
    const host = fakeHost("child-1", new Error("boom"));
    const d = deps(host);
    const tool = createSecondOpinionTool(d);
    // An infrastructure fault rejects the activation promise; the tool reports it
    // as an actionable failure instead of throwing, and the chain does not continue.
    const value = (await tool.execute({ question: "问题？" }, exec())) as ToolValue;
    expect(value.advice).toContain("顾问运行中断");
    expect(value.advice).toContain("boom");
    expect(value.attempts).toEqual([{ label: "z-ai/glm-5.4", ok: false, reason: "顾问运行中断（z-ai/glm-5.4）：boom" }]);
    expect(lossless(value)).toBeNull();

    host.optional = vi.fn(() => ({ allowedRoutes: () => [] })) as never;
    const refused = (await tool.execute({ question: "问题？" }, exec())) as ToolValue;
    expect(refused.advice).toContain("尚未授权给子代理");
    expect(refused.consultId).toBe("");
    expect(lossless(refused)).toBeNull();
  });

  it("refuses a call made from inside an advisor child", async () => {
    const d = deps(fakeHost("child-1", "x"));
    d.registry.record({ childId: "advisor-child", parentSessionId: "p", consultId: "advisor-child", label: `${ADVISOR_LABEL_PREFIX}x`, provider: "p", model: "m" });
    const tool = createSecondOpinionTool(d);
    const value = (await tool.execute({ question: "问题？" }, exec({ ...fakeParent(), id: "advisor-child" } as Agent))) as ToolValue;
    expect(value.advice).toContain("顾问子代理");
    expect(hostCalls(d)).toBe(0);
  });

  it("answers in the plugin language inferred from an English question", async () => {
    const d = deps(fakeHost("child-abc", "Looks fine."));
    const tool = createSecondOpinionTool(d);
    const value = (await tool.execute({ question: "Is plan A sound?", mode: "standalone" }, exec())) as ToolValue;
    expect(value.advice).toBe("Looks fine.");
    expect(value.notes.join("\n")).toContain('Reasoning effort "max"');
    const rendered = tool.output.render({ question: "问题？" }, value as never) as Array<{ type: string; text: string }>;
    expect(rendered[0].text).toContain("consult_id: child-abc");
    expect(rendered[0].text).not.toContain("追问");
  });

  it("reports the advisor's token usage when its stream carried usage chunks", async () => {
    const host = fakeHost("child-u", "ok");
    host.subagents.startActivation = vi.fn(async () => {
      host.emit("subagent/start", { runId: "r", provider: "spawn", parentSessionId: "parent-1", id: "child-u", local: true });
      host.emitChild("agent/assistant-stream", { agent: host.agents.get("child-u" as never), frame: { type: "chunk", chunk: { type: "usage", usage: { inputTokens: 1200, outputTokens: 80, cacheReadTokens: 5000 } } } });
      host.emitChild("agent/assistant-stream", { agent: host.agents.get("child-u" as never), frame: { type: "chunk", chunk: { type: "usage", usage: { inputTokens: 300, outputTokens: 20 } } } });
      return { childId: "child-u", name: "agent-1", result: Promise.resolve({ output: [{ type: "text", text: "ok" }], stopReason: "completed" }), dispose: vi.fn(async () => {}) } as unknown as SubagentActivation;
    });
    const d = deps(host);
    const tool = createSecondOpinionTool(d);
    const value = (await tool.execute({ question: "问题？", mode: "standalone" }, exec())) as ToolValue;
    expect(value.usage).toMatchObject({ inputTokens: 1500, outputTokens: 100, cacheReadTokens: 5000, cacheWriteTokens: 0 });
    expect(typeof value.usage!.durationMs).toBe("number");
    expect(lossless(value)).toBeNull();
    const meta = tool.output.presentationMeta!({ question: "q?" }, value as never);
    expect(meta).toMatchObject({ usage: { inputTokens: 1500 } });
  });
});

function hostCalls(d: ReturnType<typeof deps>): number {
  return (d.host.subagents.startActivation as ReturnType<typeof vi.fn>).mock.calls.length;
}
