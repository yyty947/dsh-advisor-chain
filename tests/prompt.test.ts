import { describe, expect, it } from "vitest";
import { buildSectionText } from "../src/prompt";
import { DEFAULT_ADVISOR_PROMPT, normalizeConfig } from "../src/config";

const base = {
  enabled: true,
  mode: "auto" as const,
  contextMode: "inherited" as const,
  advisorPrompt: DEFAULT_ADVISOR_PROMPT,
  chain: [{ provider: "p", model: "m" }],
  followup: { maxRounds: 8 },
  legacyNoticeDismissed: false,
  trigger: { repeatThreshold: 3 },
  limits: { defaultTimeoutMs: 300000, transcriptMaxChars: 120000, perEntryMaxChars: 4000 },
};

describe("buildSectionText", () => {
  it("returns empty when disabled or chain empty", () => {
    expect(buildSectionText({ ...base, enabled: false }, undefined, 3)).toBe("");
    expect(buildSectionText({ ...base, chain: [] }, undefined, 3)).toBe("");
  });

  it("manual mode is a short paragraph without auto guidance", () => {
    const text = buildSectionText({ ...base, mode: "manual" }, undefined, 3);
    expect(text).toContain("手动模式");
    expect(text).not.toContain("调用判据");
  });

  it("auto mode contains DSH-adapted guidance and no codex-era protocol", () => {
    const text = buildSectionText(base, undefined, 3);
    expect(text).toContain("second_opinion");
    expect(text).toContain("不要复述对话已有的内容");
    // merged codex refinements
    expect(text).toContain("调用判据");
    expect(text).toContain("不要机械调用");
    expect(text).toContain("合并为一次咨询");
    expect(text).toContain("先验证再决定");
    // codex-advisor protocol artifacts must not appear
    expect(text).not.toContain("ask_advisors");
    expect(text).not.toContain("CODEX_ADVISOR");
    expect(text).not.toContain("模型优先级");
    expect(text).not.toContain("spawn_agent");
  });

  it("escalates at the repeat threshold and reminds below it", () => {
    const high = buildSectionText(base, { count: 3, text: "q" }, 3);
    expect(high).toContain("强制咨询");
    const low = buildSectionText(base, { count: 2, text: "q" }, 3);
    expect(low).toContain("提醒");
    expect(low).not.toContain("强制咨询");
    expect(buildSectionText(base, { count: 1, text: "q" }, 3)).not.toContain("提醒");
  });
});

describe("normalizeConfig", () => {
  it("fills schema defaults for missing fields", () => {
    const cfg = normalizeConfig({});
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode).toBe("auto");
    expect(cfg.chain).toEqual([]);
    expect(cfg.trigger.repeatThreshold).toBe(3);
    expect(cfg.limits.transcriptMaxChars).toBe(120000);
  });

  it("drops invalid chain entries and keeps valid ones", () => {
    const cfg = normalizeConfig({
      chain: [
        { provider: "p1", model: "m1" },
        { provider: "", model: "m2" },
        { provider: "p3" },
        { model: "m4" },
        null,
      ],
    });
    expect(cfg.chain).toEqual([{ label: undefined, provider: "p1", model: "m1" }]);
  });

  it("unwraps schemastery volatile observables", () => {
    const volatile = { get: () => "manual" };
    const cfg = normalizeConfig({ mode: volatile, chain: [{ provider: "p", model: "m" }] });
    expect(cfg.mode).toBe("manual");
    expect(cfg.chain[0].provider).toBe("p");
  });

  it("drops the persisted model catalog written by earlier releases", () => {
    const cfg = normalizeConfig({ modelCatalog: { "z-ai": ["glm-5.3-flash"] } });
    expect("modelCatalog" in cfg).toBe(false);
  });
});
