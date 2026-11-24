import { describe, expect, it } from "vitest";
import { ADVISOR_PRESET_ID, advisorPresetDefinition, applyAdvisorToolMask, checkAdvisorPreset, registerAdvisorPreset } from "../src/advisor/preset";
import { name as pluginName } from "../src/index";

describe("advisor preset definition", () => {
  it("mounts built-in packages by name, with only the read tools enabled, and this plugin in presetRole", () => {
    const def = advisorPresetDefinition("win32");
    expect(def.id).toBe(ADVISOR_PRESET_ID);
    const names = def.plugins.map((p) => p.name);
    expect(names).toEqual(["@deepseek-ai/dsh-tool-fs", "@deepseek-ai/dsh-tool-fs-search", "@deepseek-ai/dsh-tool-pwsh", "@deepseek-ai/dsh-tool-bash", pluginName]);
    expect(def.plugins[0].config).toEqual({ read: true, readImage: true, write: false, edit: false, applyPatch: false });
    // Exactly one shell row is active for a platform.
    expect(def.plugins.filter((p) => p.name.includes("tool-pwsh") || p.name.includes("tool-bash")).map((p) => !!p.disabled)).toEqual([false, true]);
    expect(advisorPresetDefinition("linux").plugins.filter((p) => p.name.includes("tool-pwsh") || p.name.includes("tool-bash")).map((p) => !!p.disabled)).toEqual([true, false]);
    expect(def.plugins.at(-1)).toEqual({ id: "advisor-composition", name: pluginName, config: { presetRole: true } });
    // Nothing from the main composition that bloats the advisor's prompt.
    for (const banned of ["skill", "subagent", "todo", "plan", "web", "cordis", "present", "office", "ask-user"]) {
      expect(names.some((n) => n.includes(banned)), banned).toBe(false);
    }
  });
});

describe("applyAdvisorToolMask", () => {
  it("denies every host-level tool, recomputes on registry change, and lifts the old mask", () => {
    let global = [{ name: "second_opinion" }, { name: "mcp__Github__get_me" }, { name: "run_code" }];
    const restrictions: Array<{ deny: string[] }> = [];
    const lifted: number[] = [];
    let notify: (() => void) | undefined;
    const tools = {
      definitions: () => global,
      restrict: (filter: { deny: string[] }) => {
        restrictions.push(filter);
        const index = restrictions.length - 1;
        return () => lifted.push(index);
      },
    };
    const mask = applyAdvisorToolMask(tools, (apply) => {
      notify = apply;
      return () => {};
    });
    expect(restrictions).toEqual([{ deny: ["mcp__Github__get_me", "second_opinion"] }]); // run_code is reserved and skipped
    // A tool registering later (MCP connecting) is picked up; unrelated changes do not churn.
    notify!();
    expect(restrictions).toHaveLength(1);
    global = [...global, { name: "mcp__Stitch__get_project" }];
    notify!();
    expect(restrictions).toHaveLength(2);
    expect(restrictions[1].deny).toContain("mcp__Stitch__get_project");
    expect(lifted).toEqual([0]);
    expect(mask.state().denied).toHaveLength(3);
    mask.dispose();
    expect(lifted).toEqual([0, 1]);
  });
});

describe("registerAdvisorPreset / checkAdvisorPreset", () => {
  it("returns the registry's disposer on success and logs the registration", async () => {
    const dispose = async () => {};
    const logs: string[] = [];
    const registry = { register: async () => dispose, resolve: async () => ({ id: ADVISOR_PRESET_ID }) };
    expect(await registerAdvisorPreset(registry, (m) => logs.push(m))).toBe(dispose);
    expect(logs[0]).toContain(ADVISOR_PRESET_ID);
    expect(await checkAdvisorPreset(registry, () => {})).toEqual({ ok: true, preset: ADVISOR_PRESET_ID });
  });
  it("swallows registration failures and reports a broken or unknown preset as not ok", async () => {
    const logs: string[] = [];
    expect(await registerAdvisorPreset({ register: async () => { throw new Error("dup"); }, resolve: async () => ({ id: "" }) }, (m) => logs.push(m))).toBeUndefined();
    expect(logs[0]).toContain("dup");
    expect(await checkAdvisorPreset({ register: async () => async () => {}, resolve: async () => ({ id: ADVISOR_PRESET_ID, broken: "row tool-fs failed" }) }, () => {})).toEqual({ ok: false, reason: "row tool-fs failed" });
    expect(await checkAdvisorPreset({ register: async () => async () => {}, resolve: async () => { throw new Error("not-found"); } }, () => {})).toEqual({ ok: false, reason: "not-found" });
    expect(await checkAdvisorPreset(undefined, () => {})).toEqual({ ok: false, reason: "unavailable" });
  });
});
