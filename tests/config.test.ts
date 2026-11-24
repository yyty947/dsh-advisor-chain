import { describe, expect, it } from "vitest";
import { Config, normalizeConfig, type AdvisorConfig } from "../src/config";

/** Config as persisted by 0.3.9: temperature per entry, a persisted model
 *  catalog, a literal reasoning effort that the model may not declare. */
const legacyConfig = {
  enabled: true,
  mode: "auto",
  contextMode: "inherited",
  advisorPrompt: "custom prompt",
  chain: [
    { label: "", provider: "z-ai", model: "glm-5.3-flash", reasoningEffort: "max", temperature: 0, maxTokens: 65536, timeoutMs: 60000 },
    { provider: "lab-gateway", model: "qwen-example", reasoningEffort: "max" },
  ],
  trigger: { repeatThreshold: 3 },
  limits: { defaultTimeoutMs: 120000, transcriptMaxChars: 60000, perEntryMaxChars: 2000 },
  modelCatalog: { "z-ai": ["glm-5.3-flash"] },
};

describe("normalizeConfig", () => {
  it("keeps a legacy config loadable: drops dead keys, keeps effort ids verbatim", () => {
    const cfg = normalizeConfig(legacyConfig);
    expect(cfg.enabled).toBe(true);
    expect(cfg.advisorPrompt).toBe("custom prompt");
    expect(cfg.chain).toHaveLength(2);
    expect(cfg.chain[0]).toEqual({
      provider: "z-ai",
      model: "glm-5.3-flash",
      reasoningEffort: "max",
      maxTokens: 65536,
      timeoutMs: 60000,
    });
    expect(cfg.chain[1]).toEqual({ provider: "lab-gateway", model: "qwen-example", reasoningEffort: "max" });
    expect("modelCatalog" in cfg).toBe(false);
    expect("temperature" in cfg.chain[0]).toBe(false);
  });

  it("applies the 0.3.10 defaults when fields are absent", () => {
    const cfg = normalizeConfig({});
    expect(cfg).toEqual({
      enabled: true,
      mode: "auto",
      contextMode: "inherited",
      advisorPrompt: "",
      chain: [],
      followup: { maxRounds: 8 },
      legacyNoticeDismissed: false,
      trigger: { repeatThreshold: 3 },
      limits: { defaultTimeoutMs: 300000, transcriptMaxChars: 120000, perEntryMaxChars: 4000 },
    } satisfies AdvisorConfig);
  });

  it("clamps out-of-range numeric settings instead of trusting them", () => {
    const cfg = normalizeConfig({
      followup: { maxRounds: 99 },
      limits: { defaultTimeoutMs: 10, transcriptMaxChars: 10, perEntryMaxChars: 999999 },
      trigger: { repeatThreshold: 1 },
    });
    expect(cfg.followup.maxRounds).toBe(20);
    expect(cfg.limits).toEqual({ defaultTimeoutMs: 1000, transcriptMaxChars: 2000, perEntryMaxChars: 20000 });
    expect(cfg.trigger.repeatThreshold).toBe(2);
  });

  it("skips chain entries without a provider or model", () => {
    const cfg = normalizeConfig({ chain: [{ provider: "", model: "x" }, { provider: "p" }, { provider: "p", model: "m" }] });
    expect(cfg.chain).toEqual([{ provider: "p", model: "m" }]);
  });

  it("reads schemastery volatiles through their get() accessor", () => {
    const volatile = (value: unknown) => ({ get: () => value });
    const cfg = normalizeConfig({
      enabled: volatile(false),
      chain: volatile([{ provider: "p", model: "m" }]),
      limits: volatile({ defaultTimeoutMs: volatile(5000) }),
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.chain).toEqual([{ provider: "p", model: "m" }]);
    expect(cfg.limits.defaultTimeoutMs).toBe(5000);
  });
});

describe("Config schema", () => {
  it("accepts a legacy config, including unknown keys and free-form effort ids", () => {
    const parsed = Config(legacyConfig as never) as unknown as ReturnType<typeof Config>;
    expect(parsed).toBeTruthy();
    const cfg = normalizeConfig(parsed);
    expect(cfg.chain[0].reasoningEffort).toBe("max");
    expect(cfg.limits.defaultTimeoutMs).toBe(120000);
  });
});
