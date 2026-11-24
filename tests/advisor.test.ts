import { describe, expect, it, vi } from "vitest";
import { SubagentError } from "@deepseek-ai/dsh-subagent";
import type { SubagentActivation } from "@deepseek-ai/dsh-subagent";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { ADVISOR_LABEL_PREFIX, AdvisorRegistry } from "../src/advisor/identify";
import { ADVISOR_PRESET_ID } from "../src/advisor/preset";
import { attachObservation, emptyUsage, type ChildObservation } from "../src/advisor/observe";
import { beginFollowUp, threadFactsFromEvents } from "../src/advisor/followup";
import { buildAdvisorPrompt } from "../src/advisor/preamble";
import { assertRouteAllowed, parentRouteOf, resolveEntryOptions, startAdvisor } from "../src/advisor/start";
import { classifySubagentError, describeFailures, settleOutcome, waitWithTimeout, type AbortReason } from "../src/advisor/result";
import type { HostServices } from "../src/advisor/types";
import { installLegacyShim } from "../src/legacy/shim";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => unknown;

function fakeHost(services: Record<string, unknown> = {}) {
  const listeners: Record<string, Listener[]> = {};
  const host = {
    subagents: {
      startActivation: vi.fn(),
      sendMessage: vi.fn(async () => "mid"),
      interrupt: vi.fn(),
    },
    agents: { get: vi.fn(() => undefined) },
    llm: { resolveModelInfo: vi.fn(async () => ({ reasoning: { efforts: [{ id: "high", name: "High" }] } })) },
    optional: <T,>(name: string) => services[name] as T | undefined,
    on: (name: string, listener: Listener) => {
      (listeners[name] ??= []).push(listener);
      return () => {
        listeners[name] = (listeners[name] ?? []).filter((l) => l !== listener);
      };
    },
    emit: (name: string, ...args: unknown[]) => (listeners[name] ?? []).forEach((l) => l(...(args as never[]))),
  };
  return host as unknown as HostServices & { emit: (name: string, ...args: unknown[]) => void };
}

function fakeAgent(id: string, extra: Record<string, unknown> = {}): Agent {
  const ctxListeners: Record<string, Listener[]> = {};
  const agent = {
    id,
    status: "idle",
    options: { provider: "p-parent", model: "m-parent" },
    session: { id, snapshotEvents: () => [] as never[], ...((extra.session as object) ?? {}) },
    ctx: {
      on: (name: string, listener: Listener) => {
        (ctxListeners[name] ??= []).push(listener);
        return () => {
          ctxListeners[name] = (ctxListeners[name] ?? []).filter((l) => l !== listener);
        };
      },
      // Waterfall listeners get a `next` that delegates to an empty remainder.
      emit: (name: string, ...args: unknown[]) => (ctxListeners[name] ?? []).forEach((l) => l(...(args as never[]), (() => Promise.resolve(undefined)) as never)),
    },
    ...extra,
  };
  return agent as unknown as Agent;
}

const parent = () => fakeAgent("parent-1");

function observationOf(overrides: Partial<ChildObservation> = {}): ChildObservation {
  return {
    childId: "c1",
    failures: [],
    answerTextStarted: false,
    lastAnswerTextAt: 0,
    text: "",
    toolCalls: 0,
    turnEnds: 0,
    usage: emptyUsage(),
    onTurnEnd: () => () => {},
    ended: false,
    dispose: () => {},
    ...overrides,
  };
}

describe("classifySubagentError", () => {
  it("routes by code: only model-class failures may fall through the chain", () => {
    expect(classifySubagentError(new SubagentError("full", "ACTIVATION_LIMIT_REACHED")).kind).toBe("infrastructure");
    expect(classifySubagentError(new SubagentError("tree", "DRAINING")).kind).toBe("infrastructure");
    expect(classifySubagentError(new SubagentError("nope", "UNAUTHORIZED")).kind).toBe("authorization");
    expect(classifySubagentError(new SubagentError("nope", "MODEL_ROUTE_NOT_ALLOWED")).kind).toBe("authorization");
    expect(classifySubagentError(new SubagentError("nope", "LLM_PROVIDER_NOT_FOUND")).kind).toBe("model");
    expect(classifySubagentError(new Error("boom")).kind).toBe("other");
  });
});

describe("describeFailures", () => {
  it("turns the last provider failure into a readable reason", () => {
    expect(describeFailures([{ code: "RATE_LIMIT", message: "slow down", status: 429 }])).toBe("限流（HTTP 429）：slow down");
    expect(describeFailures([{ code: "CONTEXT_WINDOW_EXCEEDED", message: "too long" }])).toBe("上下文超限：too long");
    expect(describeFailures([{ code: "WEIRD", message: "" }])).toBe("WEIRD");
    expect(describeFailures([])).toBeUndefined();
  });
});

describe("settleOutcome", () => {
  it("treats completed-with-text as success and completed-without-text as failure", () => {
    expect(settleOutcome({ result: { output: [{ type: "text", text: "answer" }], stopReason: "completed" }, observation: observationOf() }).ok).toBe(true);
    const empty = settleOutcome({ result: { output: [], stopReason: "completed" }, observation: observationOf() });
    expect(empty.ok).toBe(false);
    expect(empty.failure).toContain("空响应");
  });
  it("keeps partial text as a truncated success when aborted by our timeout", () => {
    const r = settleOutcome({ observation: observationOf({ text: "half an answer" }), abortedBy: "idle" });
    expect(r).toMatchObject({ ok: true, truncated: true, content: "half an answer" });
  });
  it("prefers the collected failure reason over the stop reason", () => {
    const r = settleOutcome({ result: { output: [], stopReason: "error" }, observation: observationOf({ failures: [{ code: "AUTH", message: "bad key" }] }) });
    expect(r.ok).toBe(false);
    expect(r.failure).toBe("鉴权失败：bad key");
  });
});

describe("waitWithTimeout", () => {
  const never = () => new Promise<never>(() => {});
  const observation = () => obs;
  let obs: ChildObservation;

  it("aborts at the deadline when no answer text has started", async () => {
    obs = observationOf();
    const aborts: AbortReason[] = [];
    let resolveRun!: (v: string) => void;
    const run = new Promise<string>((r) => (resolveRun = r));
    const p = waitWithTimeout({ run, observation, policy: { timeoutMs: 20 }, abort: (r) => { aborts.push(r); resolveRun("settled"); } });
    const { value, abortedBy } = await p;
    expect(aborts).toEqual(["deadline"]);
    expect(abortedBy).toBe("deadline");
    expect(value).toBe("settled");
  });

  it("extends past the deadline while answer text keeps flowing, then aborts on idle", async () => {
    obs = observationOf({ answerTextStarted: true, lastAnswerTextAt: Date.now() });
    const aborts: AbortReason[] = [];
    let resolveRun!: (v: string) => void;
    const run = new Promise<string>((r) => (resolveRun = r));
    const p = waitWithTimeout({ run, observation, policy: { timeoutMs: 20, idleGraceMs: 60 }, abort: (r) => { aborts.push(r); resolveRun("partial"); } });
    // Answer text keeps flowing for 50 ms past the 20 ms deadline, then stops.
    const ticker = setInterval(() => { obs.lastAnswerTextAt = Date.now(); obs.text += "…"; }, 10);
    const start = Date.now();
    setTimeout(() => clearInterval(ticker), 50);
    const { value, abortedBy } = await p;
    const elapsed = Date.now() - start;
    // Past the deadline, and only after the quiet period that followed the last delta.
    expect(elapsed).toBeGreaterThanOrEqual(50 + 50);
    expect(abortedBy).toBe("idle");
    expect(aborts).toEqual(["idle"]);
    expect(value).toBe("partial");
  });

  it("enforces the hard cap regardless of progress", async () => {
    obs = observationOf({ answerTextStarted: true, lastAnswerTextAt: Date.now() });
    const aborts: AbortReason[] = [];
    let resolveRun!: (v: string) => void;
    const run = new Promise<string>((r) => (resolveRun = r));
    const ticker = setInterval(() => { obs.lastAnswerTextAt = Date.now(); }, 5);
    const { abortedBy } = await waitWithTimeout({ run, observation, policy: { timeoutMs: 10, hardCapMs: 40 }, abort: (r) => { aborts.push(r); resolveRun("x"); } });
    clearInterval(ticker);
    expect(abortedBy).toBe("hard-cap");
    expect(aborts).toEqual(["hard-cap"]);
  });

  it("rethrows caller cancellation after aborting the child", async () => {
    obs = observationOf();
    const abort = vi.fn();
    const ac = new AbortController();
    const p = waitWithTimeout({ run: never(), observation, policy: { timeoutMs: 10_000 }, abort, signal: ac.signal });
    setTimeout(() => ac.abort(new DOMException("Aborted", "AbortError")), 10);
    await expect(p).rejects.toThrow("Aborted");
    expect(abort).toHaveBeenCalledWith("deadline");
  });
});

describe("AdvisorRegistry", () => {
  const descriptor = (label: string) => () => ({ label });
  const sandbox = () => ({ setSandboxMode: vi.fn(), overrideOf: vi.fn(() => "read-only") });

  it("confines only children carrying the advisor label prefix and observes them", () => {
    const host = fakeHost();
    const controls = sandbox();
    const registry = new AdvisorRegistry({ host, sandbox: controls, descriptorOf: (child) => (String(child.id) === "child-1" ? { label: `${ADVISOR_LABEL_PREFIX}glm` } : undefined) });
    const child = fakeAgent("child-1");
    (host.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(child);
    const other = fakeAgent("child-2");
    registry.install();
    host.emit("subagent/start", { runId: "r", provider: "spawn", parentSessionId: "parent-1", id: "child-1", local: true });
    expect(controls.setSandboxMode).toHaveBeenCalledTimes(1);
    expect(registry.observation("child-1")).toBeDefined();
    expect(registry.get("child-1")?.sandbox).toBe("read-only");
    (host.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(other);
    host.emit("subagent/start", { runId: "r2", provider: "spawn", parentSessionId: "parent-1", id: "child-2", local: true });
    expect(controls.setSandboxMode).toHaveBeenCalledTimes(1);
    expect(registry.isAdvisor("child-2")).toBe(false);
  });

  it("recognizes a child without a descriptor while its start is pending", () => {
    const host = fakeHost();
    const registry = new AdvisorRegistry({ host, sandbox: sandbox(), descriptorOf: () => undefined });
    (host.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeAgent("child-9"));
    registry.install();
    registry.notePendingStart("parent-1");
    host.emit("subagent/start", { runId: "r", provider: "spawn", parentSessionId: "parent-1", id: "child-9", local: true });
    expect(registry.isAdvisor("child-9")).toBe(true);
  });

  it("marks the sandbox as failed when the read-back is not read-only", () => {
    const host = fakeHost();
    const controls = { setSandboxMode: vi.fn(), overrideOf: vi.fn(() => "danger-full-access") };
    const registry = new AdvisorRegistry({ host, sandbox: controls, descriptorOf: descriptor(`${ADVISOR_LABEL_PREFIX}x`) });
    (host.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeAgent("child-1"));
    registry.install();
    host.emit("subagent/start", { runId: "r", provider: "spawn", parentSessionId: "p", id: "child-1", local: true });
    expect(registry.get("child-1")?.sandbox).toBe("failed");
  });

  it("bounds memory: the oldest records are evicted, the newest stay reachable", () => {
    const host = fakeHost();
    const registry = new AdvisorRegistry({ host, sandbox: sandbox() });
    for (let i = 0; i < 70; i++) registry.record({ childId: `c${i}`, parentSessionId: "p", consultId: `c${i}`, label: "l", provider: "p", model: "m" });
    expect(registry.isAdvisor("c0")).toBe(false);
    expect(registry.isAdvisor("c69")).toBe(true);
  });

  it("trusts the session log over the (eventually consistent) projection", () => {
    const host = fakeHost();
    // The projection still reports the delegated mode right after the append;
    // the log already holds our read-only event.
    let events: Array<Record<string, unknown>> = [{ type: "sandbox/mode", data: { mode: "danger-full-access", source: "delegation" } }];
    const controls = {
      setSandboxMode: vi.fn(() => { events = [...events, { type: "sandbox/mode", data: { mode: "read-only" } }]; }),
      overrideOf: vi.fn(() => "danger-full-access"),
    };
    const registry = new AdvisorRegistry({ host, sandbox: controls, descriptorOf: descriptor(`${ADVISOR_LABEL_PREFIX}x`) });
    (host.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(fakeAgent("child-1", { session: { snapshotEvents: () => events } }));
    registry.install();
    host.emit("subagent/start", { runId: "r", provider: "spawn", parentSessionId: "p", id: "child-1", local: true });
    expect(registry.get("child-1")?.sandbox).toBe("read-only");
    expect(controls.overrideOf).not.toHaveBeenCalled();
  });

  it("counts turns and releases turn waiters on session turn/end and on subagent/end", async () => {
    const host = fakeHost();
    const registry = new AdvisorRegistry({ host, sandbox: sandbox(), descriptorOf: descriptor(`${ADVISOR_LABEL_PREFIX}x`) });
    const child = fakeAgent("child-1");
    (host.agents.get as ReturnType<typeof vi.fn>).mockReturnValue(child);
    registry.install();
    host.emit("subagent/start", { runId: "r", provider: "spawn", parentSessionId: "p", id: "child-1", local: true });
    const done = registry.waitForTurnEnd("child-1", { minEpoch: 1, minTurnEnds: 1 });
    (child as unknown as { ctx: { emit: (n: string, ...a: unknown[]) => void } }).ctx.emit("session/event", child.session, { type: "turn/end", data: { turn: 1 } });
    await done;
    expect(registry.observation("child-1")?.turnEnds).toBe(1);
    host.emit("subagent/end", { runId: "r", provider: "spawn", parentSessionId: "p", id: "child-1", local: true, stopReason: "completed" });
    expect(registry.observation("child-1")?.ended).toBe(true);
  });
});

describe("attachObservation", () => {
  it("tracks answer text vs tool calls and collects request failures", async () => {
    const child = fakeAgent("c");
    const obs = attachObservation(child);
    const ctx = (child as unknown as { ctx: { emit: (n: string, ...a: unknown[]) => void } }).ctx;
    ctx.emit("agent/assistant-stream", { agent: child, frame: { type: "chunk", chunk: { type: "reasoning-delta", text: "thinking" } } });
    expect(obs.answerTextStarted).toBe(false);
    ctx.emit("agent/assistant-stream", { agent: child, frame: { type: "chunk", chunk: { type: "text-delta", text: "Ans" } } });
    expect(obs.answerTextStarted).toBe(true);
    expect(obs.text).toBe("Ans");
    ctx.emit("agent/assistant-stream", { agent: child, frame: { type: "chunk", chunk: { type: "tool-call-delta" } } });
    expect(obs.answerTextStarted).toBe(false);
    expect(obs.toolCalls).toBe(1);
    ctx.emit("agent/request-error", { agent: child, failure: { code: "SERVER", message: "down" } });
    await Promise.resolve();
    expect(obs.failures).toHaveLength(1);
    ctx.emit("agent/request-error", { agent: fakeAgent("other"), failure: { code: "SERVER", message: "not mine" } });
    await Promise.resolve();
    expect(obs.failures).toHaveLength(1);
    obs.dispose();
  });

  it("delegates the request-error waterfall and records only terminal failures", async () => {
    const listeners: Record<string, Listener> = {};
    const child = {
      id: "c",
      session: { id: "c" },
      ctx: { on: (name: string, l: Listener) => { listeners[name] = l; return () => true; } },
    } as unknown as Agent;
    const obs = attachObservation(child);
    const listener = listeners["agent/request-error"];
    // A downstream listener recovers (retry): our listener must pass the
    // action through untouched and must NOT record the failure.
    const recovered = await listener({ agent: child, failure: { code: "RATE_LIMIT", message: "slow" } }, () => Promise.resolve({ kind: "retry" }));
    expect(recovered).toEqual({ kind: "retry" });
    expect(obs.failures).toHaveLength(0);
    // Terminal failure: recorded, and the (undefined) action is passed through.
    const terminal = await listener({ agent: child, failure: { code: "AUTH", message: "bad key" } }, () => Promise.resolve(undefined));
    expect(terminal).toBeUndefined();
    expect(obs.failures).toEqual([{ code: "AUTH", message: "bad key" }]);
    // Somebody else's agent: delegated, not recorded.
    await listener({ agent: fakeAgent("other"), failure: { code: "AUTH", message: "x" } }, () => Promise.resolve(undefined));
    expect(obs.failures).toHaveLength(1);
    obs.dispose();
  });
});

describe("assertRouteAllowed", () => {
  const entry = { provider: "z-ai", model: "glm-5.4" };

  it("reads the parent's route from the session request header before the agent options", () => {
    const agent = fakeAgent("p", {
      options: { provider: "old", model: "old-model" },
      session: { requestHeader: () => ({ config: { provider: "z-ai", model: "glm-5.4" } }) },
    });
    expect(parentRouteOf(agent)).toEqual({ provider: "z-ai", model: "glm-5.4" });
    expect(parentRouteOf(parent())).toEqual({ provider: "p-parent", model: "m-parent" });
  });

  it("skips the check on a host without the allowlist service", () => {
    expect(assertRouteAllowed(fakeHost(), parent(), entry)).toEqual({ ok: true });
  });
  it("when the setting is disabled, only the parent's own route is allowed", () => {
    const host = fakeHost({ subagentModelSelection: { allowedRoutes: () => undefined } });
    expect(assertRouteAllowed(host, fakeAgent("p", { options: { provider: "z-ai", model: "glm-5.4" } }), entry)).toEqual({ ok: true });
    const r = assertRouteAllowed(host, parent(), entry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe("authorization");
  });
  it("requires the exact route in the allowlist and surfaces invalid settings", () => {
    const host = fakeHost({ subagentModelSelection: { allowedRoutes: () => [{ provider: "z-ai", model: "glm-5.3-flash" }] } });
    expect(assertRouteAllowed(host, parent(), entry).ok).toBe(false);
    expect(assertRouteAllowed(host, parent(), { provider: "z-ai", model: "glm-5.3-flash" })).toEqual({ ok: true });
    const broken = fakeHost({ subagentModelSelection: { allowedRoutes: () => { throw new Error("empty list"); } } });
    const r = assertRouteAllowed(broken, parent(), entry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("设置无效");
  });
});

describe("resolveEntryOptions", () => {
  it("drops an effort the model does not declare and reports it", async () => {
    const host = fakeHost();
    const r = await resolveEntryOptions(host, { provider: "p", model: "m", reasoningEffort: "max", maxTokens: 1000 });
    expect(r).toEqual({ ok: true, agentOptions: { provider: "p", model: "m", maxTokens: 1000 }, effortIgnored: true });
    const kept = await resolveEntryOptions(host, { provider: "p", model: "m", reasoningEffort: "high" });
    expect(kept).toMatchObject({ ok: true, effortIgnored: false, agentOptions: { reasoningEffort: "high" } });
  });
  it("reports an unresolvable route as a model-class failure", async () => {
    const host = fakeHost();
    host.llm.resolveModelInfo = vi.fn(async () => { throw new Error("no adapter"); });
    const r = await resolveEntryOptions(host, { provider: "ghost", model: "m" });
    expect(r).toMatchObject({ ok: false, kind: "model" });
  });
});

describe("startAdvisor", () => {
  it("starts a read-only spawn with caller delivery, depth cap and label prefix", async () => {
    const host = fakeHost();
    const activation = { childId: "child-1", name: "agent-1", result: new Promise(() => {}), dispose: vi.fn(async () => {}) } as unknown as SubagentActivation;
    // The real manager emits `subagent/start` before startActivation resolves.
    host.subagents.startActivation = vi.fn(async () => {
      host.emit("subagent/start", { runId: "r", provider: "spawn", parentSessionId: "parent-1", id: "child-1", local: true });
      return activation;
    });
    const controls = sandboxFn();
    const registry = new AdvisorRegistry({ host, sandbox: controls, descriptorOf: () => ({ label: `${ADVISOR_LABEL_PREFIX}z-ai/glm-5.4` }), depthOf: () => 0 });
    registry.install();
    host.agents.get = vi.fn(() => fakeAgent("child-1"));
    const r = await startAdvisor(host, registry, {
      parent: parent(),
      signal: new AbortController().signal,
      entry: { provider: "z-ai", model: "glm-5.4" },
      entryLabel: "z-ai/glm-5.4",
      promptText: "prompt",
      mode: "inherited",
    });
    expect(r.ok).toBe(true);
    const spec = (host.subagents.startActivation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(spec).toMatchObject({ provider: "spawn", label: `${ADVISOR_LABEL_PREFIX}z-ai/glm-5.4`, delivery: "caller", maxDepth: 1, agentOptions: { provider: "z-ai", model: "glm-5.4" } });
    expect(registry.get("child-1")?.consultId).toBe(""); // the tool records consult_id once the child wins
  });
  it("starts the child on the lean preset when the preset is healthy", async () => {
    const host = presetHost({ resolve: async () => ({ id: ADVISOR_PRESET_ID }) });
    const registry = new AdvisorRegistry({ host, sandbox: sandboxFn(), descriptorOf: () => ({ label: `${ADVISOR_LABEL_PREFIX}x` }) });
    registry.install();
    const r = await startAdvisor(host, registry, { parent: parent(), signal: new AbortController().signal, entry: { provider: "z-ai", model: "glm-5.4" }, entryLabel: "x", promptText: "p", mode: "standalone", preset: ADVISOR_PRESET_ID });
    expect(r).toMatchObject({ ok: true, composition: "lean" });
    expect((host.subagents.startActivation as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ agentPreset: ADVISOR_PRESET_ID });
  });
  it("falls back to the inherited composition and reports why when the preset is broken or unavailable", async () => {
    const host = presetHost({ resolve: async () => ({ id: ADVISOR_PRESET_ID, broken: "tool-fs: import failed" }) });
    const registry = new AdvisorRegistry({ host, sandbox: sandboxFn(), descriptorOf: () => ({ label: `${ADVISOR_LABEL_PREFIX}x` }) });
    registry.install();
    const input = { parent: parent(), signal: new AbortController().signal, entry: { provider: "z-ai", model: "glm-5.4" }, entryLabel: "x", promptText: "p", mode: "standalone" as const, preset: ADVISOR_PRESET_ID };
    const r = await startAdvisor(host, registry, input);
    expect(r).toMatchObject({ ok: true, composition: "inherit", presetFallbackReason: "tool-fs: import failed" });
    const spec = (host.subagents.startActivation as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect("agentPreset" in spec).toBe(false);
    // No preset service at all: same fallback, still consults.
    host.optional = vi.fn(() => undefined) as never;
    const r2 = await startAdvisor(host, registry, input);
    expect(r2).toMatchObject({ ok: true, presetFallbackReason: "unavailable" });
  });
  it("refuses before starting when the route is not authorized", async () => {
    const host = fakeHost({ subagentModelSelection: { allowedRoutes: () => [] } });
    const registry = new AdvisorRegistry({ host, sandbox: sandboxFn() });
    const r = await startAdvisor(host, registry, { parent: parent(), signal: new AbortController().signal, entry: { provider: "z-ai", model: "glm-5.4" }, entryLabel: "x", promptText: "p", mode: "inherited" });
    expect(r.ok).toBe(false);
    expect(host.subagents.startActivation).not.toHaveBeenCalled();
  });
  it("classifies a thrown capacity error as infrastructure and disposes a child whose sandbox failed", async () => {
    const host = fakeHost();
    host.subagents.startActivation = vi.fn(async () => { throw new SubagentError("full", "ACTIVATION_LIMIT_REACHED"); });
    const registry = new AdvisorRegistry({ host, sandbox: sandboxFn() });
    const r = await startAdvisor(host, registry, { parent: parent(), signal: new AbortController().signal, entry: { provider: "z-ai", model: "glm-5.4" }, entryLabel: "x", promptText: "p", mode: "inherited" });
    expect(r).toMatchObject({ ok: false, kind: "infrastructure" });

    const dispose = vi.fn(async () => {});
    host.subagents.startActivation = vi.fn(async () => {
      host.emit("subagent/start", { runId: "r", provider: "spawn", parentSessionId: "parent-1", id: "child-2", local: true });
      return { childId: "child-2", name: "agent-2", result: new Promise(() => {}), dispose } as unknown as SubagentActivation;
    });
    const controls = { setSandboxMode: vi.fn(), overrideOf: vi.fn(() => "workspace-write" as string | undefined) };
    const registry2 = new AdvisorRegistry({ host, sandbox: controls, descriptorOf: () => ({ label: `${ADVISOR_LABEL_PREFIX}x` }) });
    registry2.install();
    host.agents.get = vi.fn(() => fakeAgent("child-2"));
    const r2 = await startAdvisor(host, registry2, { parent: parent(), signal: new AbortController().signal, entry: { provider: "z-ai", model: "glm-5.4" }, entryLabel: "x", promptText: "p", mode: "inherited" });
    expect(r2).toMatchObject({ ok: false, kind: "infrastructure" });
    expect(dispose).toHaveBeenCalled();
  });
});

function sandboxFn() {
  return { setSandboxMode: vi.fn(), overrideOf: vi.fn((): string | undefined => "read-only") };
}

/** A host whose `agentPresets` service answers `resolve` with the given implementation and whose spawn succeeds as child-1. */
function presetHost(agentPresets: { resolve: (id: string) => Promise<{ id: string; broken?: string }> }) {
  const host = fakeHost();
  host.optional = vi.fn((name: string) => (name === "agentPresets" ? agentPresets : undefined)) as never;
  host.agents.get = vi.fn(() => fakeAgent("child-1"));
  host.subagents.startActivation = vi.fn(async () => {
    host.emit("subagent/start", { runId: "r", provider: "spawn", parentSessionId: "parent-1", id: "child-1", local: true });
    return { childId: "child-1", name: "agent-1", result: new Promise(() => {}), dispose: vi.fn(async () => {}) } as unknown as SubagentActivation;
  });
  return host;
}

describe("follow-up validation", () => {
  const descriptorEvents = (label: string, userMessages: number): Array<Record<string, unknown>> => [
    { type: "subagent/descriptor", seq: 0, time: 0, data: { version: 3, mode: "continuable", provider: "spawn", label, agentProvider: "p", agentModel: "m" } },
    ...Array.from({ length: userMessages }, (_, i) => ({ type: "user/message", seq: i + 1, time: 0, data: {} })),
  ];

  it("reads thread facts from the child's own log", () => {
    const facts = threadFactsFromEvents(descriptorEvents(`${ADVISOR_LABEL_PREFIX}x`, 3));
    expect(facts).toEqual({ label: `${ADVISOR_LABEL_PREFIX}x`, provider: "p", model: "m", followUps: 2 });
    expect(threadFactsFromEvents(descriptorEvents("nope", 1).slice(1))).toBeUndefined();
  });

  it("rejects an unknown or foreign consult_id and enforces the round cap", async () => {
    const host = fakeHost();
    const registry = new AdvisorRegistry({ host, sandbox: sandboxFn(), descriptorOf: () => undefined });
    const unknown = await beginFollowUp(host, registry, { parent: parent(), signal: new AbortController().signal, consultId: "nope", followUp: "why?", maxRounds: 8 });
    expect(unknown.ok).toBe(false);

    const foreign = fakeAgent("legacy", { session: { snapshotEvents: () => descriptorEvents("legacy-label", 1) } });
    host.agents.get = vi.fn(() => foreign);
    const r2 = await beginFollowUp(host, registry, { parent: parent(), signal: new AbortController().signal, consultId: "legacy", followUp: "why?", maxRounds: 8 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.message).toContain("不是本插件");

    const child = fakeAgent("child-1", { session: { snapshotEvents: () => descriptorEvents(`${ADVISOR_LABEL_PREFIX}x`, 9) } });
    host.agents.get = vi.fn(() => child);
    registry.record({ childId: "child-1", parentSessionId: "parent-1", consultId: "child-1", label: `${ADVISOR_LABEL_PREFIX}x`, provider: "p", model: "m" });
    const capped = await beginFollowUp(host, registry, { parent: parent(), signal: new AbortController().signal, consultId: "child-1", followUp: "why?", maxRounds: 8 });
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.message).toContain("上限");
    expect(host.subagents.sendMessage).not.toHaveBeenCalled();
  });

  it("delivers a valid follow-up and maps tree errors to an actionable message", async () => {
    const host = fakeHost();
    const registry = new AdvisorRegistry({ host, sandbox: sandboxFn(), descriptorOf: () => undefined });
    const child = fakeAgent("child-1", { session: { snapshotEvents: () => descriptorEvents(`${ADVISOR_LABEL_PREFIX}x`, 2) } });
    host.agents.get = vi.fn(() => child);
    const r = await beginFollowUp(host, registry, { parent: parent(), signal: new AbortController().signal, consultId: "child-1", followUp: " why? ", maxRounds: 8 });
    expect(r).toMatchObject({ ok: true, round: 2 });
    expect(host.subagents.sendMessage).toHaveBeenCalledTimes(1);

    host.subagents.sendMessage = vi.fn(async () => { throw new SubagentError("outside tree", "UNAUTHORIZED"); });
    const r2 = await beginFollowUp(host, registry, { parent: parent(), signal: new AbortController().signal, consultId: "child-1", followUp: "why?", maxRounds: 8 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.message).toContain("另一个会话");
  });

  it("refuses a follow-up on a dual-opinion child and on a still-running advisor", async () => {
    const host = fakeHost();
    const registry = new AdvisorRegistry({ host, sandbox: sandboxFn(), descriptorOf: () => undefined });
    registry.record({ childId: "dual-1", parentSessionId: "parent-1", consultId: "dual-1", label: `${ADVISOR_LABEL_PREFIX}dual`, provider: "p", model: "m", dual: true });
    host.agents.get = vi.fn(() => fakeAgent("dual-1", { session: { snapshotEvents: () => descriptorEvents(`${ADVISOR_LABEL_PREFIX}dual`, 1) } }));
    const dual = await beginFollowUp(host, registry, { parent: parent(), signal: new AbortController().signal, consultId: "dual-1", followUp: "why?", maxRounds: 8 });
    expect(dual.ok).toBe(false);
    if (!dual.ok) expect(dual.message).toContain("双意见");

    registry.record({ childId: "busy-1", parentSessionId: "parent-1", consultId: "busy-1", label: `${ADVISOR_LABEL_PREFIX}x`, provider: "p", model: "m" });
    host.agents.get = vi.fn(() => fakeAgent("busy-1", { status: "running", session: { snapshotEvents: () => descriptorEvents(`${ADVISOR_LABEL_PREFIX}x`, 1) } }));
    const busy = await beginFollowUp(host, registry, { parent: parent(), signal: new AbortController().signal, consultId: "busy-1", followUp: "why?", maxRounds: 8 });
    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.message).toContain("仍在回答");
    expect(host.subagents.sendMessage).not.toHaveBeenCalled();
  });
});

describe("advisor prompt", () => {
  it("frames the advisor as a read-only consultant answering the main agent in both modes", () => {
    const inherited = buildAdvisorPrompt({ mode: "inherited", lang: "zh", advisorPrompt: "persona", question: "q", context: "ctx", transcriptText: "T", transcriptDropped: 3, transcriptClipped: 1 });
    expect(inherited).toContain("你的读者是主代理");
    expect(inherited).toContain("不得创建、修改或删除任何文件");
    expect(inherited).toContain("已省略更早的 3 条消息");
    expect(inherited).toContain("有 1 条内容因过长被截断");
    expect(inherited).toContain("【对话外补充背景】\nctx");
    expect(inherited.endsWith("【问题】\nq")).toBe(false);
    const blind = buildAdvisorPrompt({ mode: "standalone", lang: "zh", advisorPrompt: "persona", question: "q" });
    expect(blind).toContain("你看不到主对话");
    expect(blind).toContain("盲审");
    expect(blind).not.toContain("【对话抄本】");
  });
});

describe("legacy shim", () => {
  it("registers the legacy types and never throws", () => {
    const set = new Set<string>();
    expect(installLegacyShim(set)).toBe(true);
    expect(set.has("advisor/start")).toBe(true);
    const logs: string[] = [];
    expect(installLegacyShim(undefined, (m) => logs.push(m))).toBe(true);
    expect(installLegacyShim(Object.freeze(new Set<string>()), (m) => logs.push(m))).toBe(false);
    expect(installLegacyShim(null, (m) => logs.push(m))).toBe(false);
    expect(installLegacyShim({ add: () => { throw new Error("no"); } }, (m) => logs.push(m))).toBe(false);
    expect(logs.length).toBeGreaterThanOrEqual(3);
  });
});
