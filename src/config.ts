import Schema from "@deepseek-ai/schemastery";

/**
 * Chain-level advisor persona. The advisor receives either a bounded transcript
 * of the main session (inherited mode) or only the question plus out-of-band
 * context (standalone mode), and answers the main agent — never the human.
 */
export const DEFAULT_ADVISOR_PROMPT = `你是一位经验丰富的技术顾问，为另一个 AI 编程助手提供第二意见。你会看到该助手当前会话的对话抄本（可能省略了较早的消息）以及它此刻提出的问题。

回答要求：
- 先给结论，再给依据；观点明确，不模棱两可；论证充分但不冗余。
- 指出对话中被忽略的风险、错误假设或更优的替代方案。
- 信息不足以判断时，明确指出缺少哪些信息，不要基于臆测作答。
- 对已有信息中的不确定内容，标注不确定并说明如何验证。
- 抄本注明省略了较早消息时，对涉及早期细节的判断降低相应置信度。
- 用与对话相同的语言回答。`;

/**
 * One entry of the advisor fallback chain, tried in order.
 *
 * `reasoningEffort` is deliberately a free string: stored configs from earlier
 * releases carry literal ids that may or may not be declared by the model, and
 * a closed union here would make those configs fail validation at load time —
 * which would keep the legacy shim from running and leave old sessions
 * unopenable. The tool validates the id against the live model at call time.
 */
export const ChainEntryConfig = Schema.object({
  label: Schema.string().description("显示名称（卡片与设置页用）；留空则显示 provider/model。"),
  provider: Schema.string().required().description("DSH provider 路由 key，例如 deepseek-official。"),
  model: Schema.string().required().description("该路由下的模型 id。"),
  reasoningEffort: Schema.string().description("推理档位 id；模型未声明该档位时忽略并沿用模型默认。"),
  maxTokens: Schema.number().min(1).description("单次回答的 maxTokens 上限；不设置则用模型默认。"),
  timeoutMs: Schema.number().min(1000).max(600000).description("该条目的超时毫秒数；不设置则用 limits.defaultTimeoutMs。"),
});

export const FollowupConfig = Schema.object({
  /** Hard cap on follow-up rounds per consultation thread. */
  maxRounds: Schema.natural().min(1).max(20).default(8).description("每个咨询线程最多可追问多少轮。"),
});

export const TriggerConfig = Schema.object({
  /** Hard trigger: after the same user text repeats this many times, the
   *  system-prompt section escalates to a mandatory-consult instruction. */
  repeatThreshold: Schema.natural().min(2).max(10).default(3).description("同一用户问题重复出现多少次后，强制提醒主模型咨询顾问。"),
});

export const LimitsConfig = Schema.object({
  defaultTimeoutMs: Schema.number().min(1000).max(600000).default(300000).description("链上条目未单独配置时的默认超时（毫秒）。顾问可能先思考再作答，默认给足 5 分钟。"),
  transcriptMaxChars: Schema.natural().min(2000).max(400000).default(120000).description("发送给顾问的对话抄本字符预算；超出时保留最新部分并标注省略。"),
  perEntryMaxChars: Schema.natural().min(200).max(20000).default(4000).description("抄本中单条消息（含工具结果）的最大字符数。"),
});

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).volatile(),
  mode: Schema.union([Schema.const("auto"), Schema.const("manual")]).default("auto").volatile().description("auto：主模型按提示规则自主咨询；manual：仅用户明确要求时咨询。"),
  contextMode: Schema.union([Schema.const("inherited"), Schema.const("standalone")]).default("inherited").volatile().description("默认咨询模式：inherited 顾问获得会话抄本；standalone 盲审，顾问只看问题与补充背景。可被工具的 mode 参数按次覆盖。"),
  advisorPrompt: Schema.string().default(DEFAULT_ADVISOR_PROMPT).volatile().description("顾问的系统提示词（整条链共用）。"),
  chain: Schema.array(ChainEntryConfig).default([]).volatile().description("顾问模型链，按顺序尝试；前面的失败时顺延到下一个。"),
  followup: FollowupConfig.volatile(),
  /** Set once the user dismissed the one-time legacy-sessions banner. */
  legacyNoticeDismissed: Schema.boolean().default(false).volatile(),
  trigger: TriggerConfig.volatile(),
  limits: LimitsConfig.volatile(),
});

export type ChainEntry = {
  label?: string;
  provider: string;
  model: string;
  reasoningEffort?: string;
  maxTokens?: number;
  timeoutMs?: number;
};

export type AdvisorConfig = {
  enabled: boolean;
  mode: "auto" | "manual";
  /** Default consultation mode; overridable per call via the tool's mode param. */
  contextMode: "inherited" | "standalone";
  advisorPrompt: string;
  chain: ChainEntry[];
  followup: { maxRounds: number };
  legacyNoticeDismissed: boolean;
  trigger: { repeatThreshold: number };
  limits: { defaultTimeoutMs: number; transcriptMaxChars: number; perEntryMaxChars: number };
};

/** Prepended to the advisor system prompt on standalone (blind) calls — the
 *  confirmed wording also tells the advisor that the requester's stated views
 *  are one-sided and may be overturned with reasons. */
export const BLIND_REVIEW_MODIFIER = "这是一次盲审请求：你看不到主对话记录，只能依据主代理提出的问题与其主动补充的背景作答。主代理陈述的观点、倾向或已做的假设只是它单方面的判断，仅供参考，可以在有依据的前提下推翻，推翻时请说明理由。信息不足以给出可靠判断时，明确指出还缺少哪些信息，不要臆测补全。";

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

function clampInt(value: unknown, fallback: number, lo: number, hi: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(value)));
}

/** Best-effort live config snapshot; falls back to schema defaults when a
 *  field is missing so callers never see undefined sub-objects. Tolerates
 *  configs written by earlier releases (unknown keys ignored, effort ids
 *  kept verbatim). */
export function normalizeConfig(raw: unknown): AdvisorConfig {
  const cfg = (unwrapVolatile(raw) ?? {}) as Partial<AdvisorConfig> & Record<string, unknown>;
  return {
    enabled: cfg.enabled !== false,
    mode: cfg.mode === "manual" ? "manual" : "auto",
    contextMode: cfg.contextMode === "standalone" ? "standalone" : "inherited",
    advisorPrompt: typeof cfg.advisorPrompt === "string" && cfg.advisorPrompt.trim() ? cfg.advisorPrompt : DEFAULT_ADVISOR_PROMPT,
    chain: Array.isArray(cfg.chain)
      ? cfg.chain
          .filter((e): e is ChainEntry & Record<string, unknown> => !!e && typeof e === "object" && typeof (e as ChainEntry).provider === "string" && (e as ChainEntry).provider.length > 0 && typeof (e as ChainEntry).model === "string" && (e as ChainEntry).model.length > 0)
          // Rebuild each entry from the known fields only: keys written by
          // earlier releases (temperature, …) are dropped here rather than
          // carried into the new engine.
          .map((e) => ({
            ...(typeof e.label === "string" && e.label.trim() ? { label: e.label } : {}),
            provider: e.provider,
            model: e.model,
            ...(typeof e.reasoningEffort === "string" && e.reasoningEffort.trim() ? { reasoningEffort: e.reasoningEffort } : {}),
            ...(typeof e.maxTokens === "number" ? { maxTokens: e.maxTokens } : {}),
            ...(typeof e.timeoutMs === "number" ? { timeoutMs: e.timeoutMs } : {}),
          }))
      : [],
    followup: { maxRounds: clampInt(cfg.followup?.maxRounds, 8, 1, 20) },
    legacyNoticeDismissed: cfg.legacyNoticeDismissed === true,
    trigger: { repeatThreshold: clampInt(cfg.trigger?.repeatThreshold, 3, 2, 10) },
    limits: {
      defaultTimeoutMs: clampInt(cfg.limits?.defaultTimeoutMs, 300000, 1000, 600000),
      transcriptMaxChars: clampInt(cfg.limits?.transcriptMaxChars, 120000, 2000, 400000),
      perEntryMaxChars: clampInt(cfg.limits?.perEntryMaxChars, 4000, 200, 20000),
    },
  };
}
