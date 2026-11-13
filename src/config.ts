import Schema from "@deepseek-ai/schemastery";

/**
 * Chain-level advisor persona. The advisor receives the main session's
 * derived message history as a compact transcript, plus the main model's
 * question and optional out-of-band context.
 */
export const DEFAULT_ADVISOR_PROMPT = `你是一位经验丰富的技术顾问，为另一个 AI 编程助手提供第二意见。你会看到该助手当前会话的对话抄本（用户消息、助手回复与工具结果）以及它此刻提出的问题。

回答要求：
- 先给结论，再给依据；观点明确，不要模棱两可。
- 指出对话中被忽略的风险、错误假设或更优的替代方案。
- 对自己不确定的内容明确标注不确定，并说明如何验证。
- 用与对话相同的语言回答；简洁直接，不要客套。`;

export const ReasoningEffort = Schema.union([
  Schema.const("off"),
  Schema.const("low"),
  Schema.const("high"),
  Schema.const("max"),
]);

/** One entry of the advisor fallback chain, tried in order. */
export const ChainEntryConfig = Schema.object({
  label: Schema.string().description("显示名称（卡片与设置页用）；留空则显示 provider/model。"),
  provider: Schema.string().required().description("DSH provider 路由 key，例如 deepseek-official。"),
  model: Schema.string().required().description("该路由下的模型 id。"),
  reasoningEffort: ReasoningEffort.description("推理档位；不设置则用模型默认。"),
  temperature: Schema.number().min(0).max(2).description("采样温度；不设置则用模型默认。"),
  maxTokens: Schema.number().min(1).description("单次回答的 maxTokens 上限；不设置则用默认值 16384。"),
  timeoutMs: Schema.number().min(1000).max(600000).description("该条目的超时毫秒数；不设置则用 limits.defaultTimeoutMs。"),
});

export const TriggerConfig = Schema.object({
  /** Hard trigger: after the same user text repeats this many times, the
   *  system-prompt section escalates to a mandatory-consult instruction. */
  repeatThreshold: Schema.natural().min(2).max(10).default(3).description("同一用户问题重复出现多少次后，强制提醒主模型咨询顾问。"),
});

export const LimitsConfig = Schema.object({
  defaultTimeoutMs: Schema.number().min(1000).max(600000).default(120000).description("链上条目未单独配置时的默认超时（毫秒）。"),
  transcriptMaxChars: Schema.natural().min(2000).max(400000).default(60000).description("发送给顾问的对话抄本字符预算；超出时保留最新部分并标注省略。"),
  perEntryMaxChars: Schema.natural().min(200).max(20000).default(2000).description("抄本中单条消息（含工具结果）的最大字符数。"),
});

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).volatile(),
  mode: Schema.union([Schema.const("auto"), Schema.const("manual")]).default("auto").volatile().description("auto：主模型按提示规则自主咨询；manual：仅用户明确要求时咨询。"),
  advisorPrompt: Schema.string().default(DEFAULT_ADVISOR_PROMPT).volatile().description("顾问的系统提示词（整条链共用）。"),
  chain: Schema.array(ChainEntryConfig).default([]).volatile().description("顾问模型链，按顺序尝试；前面的失败（出错或超时无产出）时顺延到下一个。"),
  trigger: TriggerConfig.volatile(),
  limits: LimitsConfig.volatile(),
});

export type ChainEntry = {
  label?: string;
  provider: string;
  model: string;
  reasoningEffort?: "off" | "low" | "high" | "max";
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
};

export type AdvisorConfig = {
  enabled: boolean;
  mode: "auto" | "manual";
  advisorPrompt: string;
  chain: ChainEntry[];
  trigger: { repeatThreshold: number };
  limits: { defaultTimeoutMs: number; transcriptMaxChars: number; perEntryMaxChars: number };
};

/** Read through schemastery volatile observables so live settings edits apply
 *  without a plugin restart. Plain values pass through unchanged. */
export function unwrapVolatile(value: unknown): unknown {
  if (value && typeof value === "object" && "get" in value && typeof (value as { get: unknown }).get === "function") {
    return unwrapVolatile((value as { get: () => unknown }).get());
  }
  if (Array.isArray(value)) return value.map(unwrapVolatile);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, unwrapVolatile(v)]));
  }
  return value;
}

/** Best-effort live config snapshot; falls back to schema defaults when a
 *  field is missing so callers never see undefined sub-objects. */
export function normalizeConfig(raw: unknown): AdvisorConfig {
  const cfg = (unwrapVolatile(raw) ?? {}) as Partial<AdvisorConfig>;
  return {
    enabled: cfg.enabled !== false,
    mode: cfg.mode === "manual" ? "manual" : "auto",
    advisorPrompt: typeof cfg.advisorPrompt === "string" && cfg.advisorPrompt.trim() ? cfg.advisorPrompt : DEFAULT_ADVISOR_PROMPT,
    chain: Array.isArray(cfg.chain)
      ? cfg.chain.filter((e): e is ChainEntry => !!e && typeof e === "object" && typeof e.provider === "string" && e.provider.length > 0 && typeof e.model === "string" && e.model.length > 0)
      : [],
    trigger: { repeatThreshold: cfg.trigger?.repeatThreshold ?? 3 },
    limits: {
      defaultTimeoutMs: cfg.limits?.defaultTimeoutMs ?? 120000,
      transcriptMaxChars: cfg.limits?.transcriptMaxChars ?? 60000,
      perEntryMaxChars: cfg.limits?.perEntryMaxChars ?? 2000,
    },
  };
}
