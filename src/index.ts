import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";
import { Config, normalizeConfig } from "./config";
import { RepeatPressureTracker } from "./pressure";
import { buildSectionText } from "./prompt";
import { createSecondOpinionTool } from "./tool";
import { AdvisorRegistry } from "./advisor/identify";
import type { HostServices, Logger } from "./advisor/types";
import { installLegacyShim } from "./legacy/shim";

export { Config } from "./config";

export const name = "dsh-advisor-chain";

/** `subagents` and `agents` run the advisor; `llm` validates routes and efforts.
 *  Optional services (sandbox policy, model allowlist, session query) are read
 *  through `ctx.get` so a host without them degrades instead of failing. */
export const inject = ["tools", "llm", "subagents", "agents", "systemPrompt"];

interface HostContext {
  fiber: { config: unknown };
  logger?: { (name: string): { info(message: string): void; warn(message: string): void } };
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
  effect(setup: () => unknown, label?: string): unknown;
  tools: { register: (tool: unknown) => unknown };
  systemPrompt?: {
    section: (options: { name: string; order: number; text: (assembly?: { session?: { id?: string } }) => string }) => unknown;
  };
  inject?: (services: string[], callback: (scoped: HostContext & { settings: { configure: (options: { auto: boolean }, fiber: unknown) => unknown } }) => unknown) => unknown;
  get?: (key: string) => unknown;
  subagents: HostServices["subagents"];
  agents: HostServices["agents"];
  llm: HostServices["llm"];
  sandboxPolicy?: { overrideOf(session: unknown): string | undefined };
}

function makeLogger(ctx: HostContext): Logger {
  const named = typeof ctx.logger === "function" ? ctx.logger("dsh-advisor-chain") : undefined;
  if (named) return (message) => named.info(message);
  return (message) => console.info(`[dsh-advisor-chain] ${message}`);
}

export function apply(ctx: HostContext, _config: unknown) {
  const liveConfig = () => normalizeConfig(ctx.fiber.config);
  const log = makeLogger(ctx);

  // Read-only compatibility for sessions written by versions <= 0.3.9.
  installLegacyShim(undefined, log);

  const pressure = new RepeatPressureTracker();
  ctx.on("session/event", (session, event) => pressure.handleEvent((session as { id?: string } | undefined)?.id ?? "", event as Parameters<typeof pressure.handleEvent>[1]));

  const host: HostServices = {
    subagents: ctx.subagents,
    agents: ctx.agents,
    llm: ctx.llm,
    optional: <T>(name: string) => ctx.get?.(name) as T | undefined,
    on: ((name: string, listener: (payload: never) => void) => ctx.on(name, listener as (...args: unknown[]) => unknown)) as HostServices["on"],
  };
  const registry = new AdvisorRegistry({
    host,
    sandbox: {
      setSandboxMode: (session, mode) => setSandboxMode(session as never, mode),
      overrideOf: (session) => ctx.sandboxPolicy?.overrideOf(session),
    },
    log,
  });
  ctx.effect(() => registry.install(), "dsh-advisor-chain: advisor child watcher");
  ctx.effect(() => ctx.tools.register(createSecondOpinionTool({ host, registry, getConfig: liveConfig, log })), "dsh-advisor-chain: second_opinion tool");

  const systemPrompt = ctx.systemPrompt ?? (typeof ctx.get === "function" ? (ctx.get("systemPrompt") as HostContext["systemPrompt"]) : undefined);
  if (systemPrompt) {
    ctx.effect(
      () =>
        systemPrompt.section({
          name: "dsh-advisor-chain-boundary",
          order: 151,
          // `session` is the documented field of AssembleContext; the optional
          // `agent` augmentation is not relied upon.
          text: (assembly) => {
            const cfg = liveConfig();
            return buildSectionText(cfg, pressure.get(assembly?.session?.id), cfg.trigger.repeatThreshold);
          },
        }),
      "dsh-advisor-chain: system prompt section",
    );
  }

  // We ship our own settings tab, so opt out of the auto-generated generic
  // form; reads/writes through the settings service stay available.
  if (typeof ctx.inject === "function") {
    ctx.inject(["settings"], (scoped) => {
      const dispose = scoped.settings.configure({ auto: false }, ctx.fiber);
      return () => {
        if (typeof dispose === "function") dispose();
      };
    });
  }
}
