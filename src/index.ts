import { Config, normalizeConfig } from "./config";
import { RepeatPressureTracker } from "./pressure";
import { buildSectionText } from "./prompt";
import { createAdvisorAskTool } from "./tool";

export { Config } from "./config";

export const name = "dsh-advisor-plugin";

export const inject = ["tools", "llm", "systemPrompt", "sessions"];

interface HostContext {
  fiber: { config: unknown };
  on(event: "session/event", listener: (session: { id: string }, event: unknown) => void): unknown;
  effect(setup: () => unknown, label?: string): unknown;
  tools: { register: (tool: unknown) => unknown };
  systemPrompt?: {
    section: (options: {
      name: string;
      order: number;
      text: (assembly?: { agent?: { session?: { id?: string } } }) => string;
    }) => unknown;
  };
  inject?: (services: string[], callback: (scoped: HostContext & { settings: { configure: (options: { auto: boolean }, fiber: unknown) => unknown } }) => unknown) => unknown;
  get?: (key: string) => unknown;
}

export function apply(ctx: HostContext, _config: unknown) {
  const liveConfig = () => normalizeConfig(ctx.fiber.config);

  const pressure = new RepeatPressureTracker();
  ctx.on("session/event", (session, event) => {
    pressure.handleEvent(session?.id ?? "", event as Parameters<typeof pressure.handleEvent>[1]);
  });

  ctx.effect(() => ctx.tools.register(createAdvisorAskTool({ ctx: ctx as unknown as Parameters<typeof createAdvisorAskTool>[0]["ctx"], getConfig: liveConfig })), "dsh-advisor-plugin: advisor_ask tool");

  const systemPrompt = ctx.systemPrompt ?? (typeof ctx.get === "function" ? (ctx.get("systemPrompt") as HostContext["systemPrompt"]) : undefined);
  if (systemPrompt) {
    ctx.effect(
      () =>
        systemPrompt.section({
          name: "dsh-advisor-plugin-boundary",
          order: 151,
          text: (assembly) => {
            const cfg = liveConfig();
            const sessionId = assembly?.agent?.session?.id;
            return buildSectionText(cfg, pressure.get(sessionId), cfg.trigger.repeatThreshold);
          },
        }),
      "dsh-advisor-plugin: system prompt section",
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
