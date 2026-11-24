import type { Agent, AgentOptions } from "@deepseek-ai/dsh-agent";
import type { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import type { SubagentActivation } from "@deepseek-ai/dsh-subagent";
import type { ChainEntry } from "../config";
import { t, type Lang } from "../i18n";
import { advisorLabel, type AdvisorChildRecord, type AdvisorRegistry } from "./identify";
import type { ChildObservation } from "./observe";
import { classifySubagentError, type FailureClass } from "./result";
import type { HostServices } from "./types";

export interface Refusal {
  ok: false;
  kind: FailureClass;
  message: string;
}

export type RouteCheck = Refusal | { ok: true };

interface AllowedRoutesService {
  allowedRoutes(): Array<{ provider: string; model: string }> | undefined;
}

/** The route the host itself uses when delegating: the session's current
 *  request header, falling back to the agent's live options. */
export function parentRouteOf(parent: Agent): { provider?: string; model?: string } {
  const session = parent.session as { requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined } | undefined;
  const header = session?.requestHeader?.();
  const options = parent.options as AgentOptions | undefined;
  return {
    provider: header?.config?.provider ?? options?.provider,
    model: header?.config?.model ?? options?.model,
  };
}

/**
 * Honor the Host's subagent model allowlist. The runtime itself does not
 * enforce it (only the model-facing tool does), so the plugin checks it
 * itself rather than quietly stepping over a setting the user made.
 */
export function assertRouteAllowed(host: HostServices, parent: Agent, entry: ChainEntry, lang: Lang = "zh"): RouteCheck {
  const svc = host.optional<AllowedRoutesService>("subagentModelSelection");
  if (!svc || typeof svc.allowedRoutes !== "function") return { ok: true };
  let routes: Array<{ provider: string; model: string }> | undefined;
  try {
    routes = svc.allowedRoutes();
  } catch (error) {
    return {
      ok: false,
      kind: "authorization",
      message: t(lang, "start.settingInvalid", { detail: error instanceof Error ? error.message : String(error) }),
    };
  }
  const route = `${entry.provider}/${entry.model}`;
  if (routes === undefined) {
    const parentRoute = parentRouteOf(parent);
    if (parentRoute.provider === entry.provider && parentRoute.model === entry.model) return { ok: true };
    return { ok: false, kind: "authorization", message: t(lang, "start.selectionOff", { route }) };
  }
  if (routes.some((r) => r.provider === entry.provider && r.model === entry.model)) return { ok: true };
  return { ok: false, kind: "authorization", message: t(lang, "start.unauthorized", { route }) };
}

export type EntryOptionsResult = { ok: true; agentOptions: AgentOptions; effortIgnored: boolean } | Refusal;

/**
 * Validate the entry's route against the live model catalog. A reasoning
 * effort the model does not declare is dropped (and reported) instead of
 * letting the adapter reject the whole call.
 */
export async function resolveEntryOptions(host: HostServices, entry: ChainEntry, lang: Lang = "zh"): Promise<EntryOptionsResult> {
  let info: Awaited<ReturnType<HostServices["llm"]["resolveModelInfo"]>>;
  try {
    info = await host.llm.resolveModelInfo(entry.provider, entry.model);
  } catch (error) {
    return {
      ok: false,
      kind: "model",
      message: t(lang, "start.routeUnavailable", { route: `${entry.provider}/${entry.model}`, detail: error instanceof Error ? error.message : String(error) }),
    };
  }
  const efforts = (info?.reasoning?.efforts ?? []).map((e) => String(e.id));
  const effortIgnored = entry.reasoningEffort !== undefined && !efforts.includes(entry.reasoningEffort);
  const agentOptions: AgentOptions = {
    provider: entry.provider,
    model: entry.model,
    ...(entry.reasoningEffort && !effortIgnored ? { reasoningEffort: entry.reasoningEffort as ReasoningEffortId } : {}),
    ...(entry.maxTokens !== undefined ? { maxTokens: entry.maxTokens } : {}),
  };
  return { ok: true, agentOptions, effortIgnored };
}

export interface StartInput {
  parent: Agent;
  signal: AbortSignal;
  entry: ChainEntry;
  entryLabel: string;
  promptText: string;
  mode: "inherited" | "standalone";
  lang?: Lang;
}

export type StartResult =
  | { ok: true; activation: SubagentActivation; observation: ChildObservation; record: AdvisorChildRecord; effortIgnored: boolean }
  | Refusal;

/** Start one advisor child under `parent` as a read-only spawn with caller delivery. */
export async function startAdvisor(host: HostServices, registry: AdvisorRegistry, input: StartInput): Promise<StartResult> {
  const parent = input.parent;
  const parentId = String(parent.id);
  const lang = input.lang ?? "zh";
  const route = assertRouteAllowed(host, parent, input.entry, lang);
  if (!route.ok) return route;
  const options = await resolveEntryOptions(host, input.entry, lang);
  if (!options.ok) return options;

  registry.notePendingStart(parentId);
  let activation: SubagentActivation;
  try {
    activation = await host.subagents.startActivation({
      provider: "spawn",
      label: advisorLabel(input.entryLabel),
      prompt: [{ type: "text", text: input.promptText }],
      parent,
      signal: input.signal,
      delivery: "caller",
      agentOptions: options.agentOptions,
      // The advisor may run, but nothing may be delegated from inside it.
      maxDepth: registry.depthOf(parent) + 1,
    });
  } catch (error) {
    const classified = classifySubagentError(error);
    return { ok: false, kind: classified.kind, message: t(lang, "start.cannotStart", { label: input.entryLabel, message: classified.message }) };
  } finally {
    registry.clearPendingStart(parentId);
  }

  const childId = String(activation.childId);
  const record = registry.record({
    childId,
    parentSessionId: parentId,
    consultId: "",
    label: advisorLabel(input.entryLabel),
    provider: input.entry.provider,
    model: input.entry.model,
  });
  const observation = registry.observation(childId);
  if (record.sandbox === "failed" || !observation) {
    await activation.dispose().catch(() => {});
    return { ok: false, kind: "infrastructure", message: t(lang, record.sandbox === "failed" ? "start.sandboxFailed" : "start.unrecognized") };
  }
  return { ok: true, activation, observation, record, effortIgnored: options.effortIgnored };
}
