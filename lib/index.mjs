import Schema from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
// src/config.ts
/**
* Chain-level advisor persona. The advisor receives the main session's
* derived message history as a compact transcript, plus the main model's
* question and optional out-of-band context.
*/
const DEFAULT_ADVISOR_PROMPT = `你是一位经验丰富的技术顾问，为另一个 AI 编程助手提供第二意见。你会看到该助手当前会话的对话抄本（用户消息、助手回复与工具结果）以及它此刻提出的问题。

回答要求：
- 先给结论，再给依据；观点明确，不要模棱两可。
- 指出对话中被忽略的风险、错误假设或更优的替代方案。
- 对自己不确定的内容明确标注不确定，并说明如何验证。
- 用与对话相同的语言回答；简洁直接，不要客套。`;
const ReasoningEffort = Schema.union([
	Schema.const("off"),
	Schema.const("low"),
	Schema.const("high"),
	Schema.const("max")
]);
/** One entry of the advisor fallback chain, tried in order. */
const ChainEntryConfig = Schema.object({
	label: Schema.string().description("显示名称（卡片与设置页用）；留空则显示 provider/model。"),
	provider: Schema.string().required().description("DSH provider 路由 key，例如 deepseek-official。"),
	model: Schema.string().required().description("该路由下的模型 id。"),
	reasoningEffort: ReasoningEffort.description("推理档位；不设置则用模型默认。"),
	temperature: Schema.number().min(0).max(2).description("采样温度；不设置则用模型默认。"),
	maxTokens: Schema.number().min(1).description("单次回答的 maxTokens 上限；不设置则用默认值 16384。"),
	timeoutMs: Schema.number().min(1e3).max(6e5).description("该条目的超时毫秒数；不设置则用 limits.defaultTimeoutMs。")
});
const TriggerConfig = Schema.object({ 
/** Hard trigger: after the same user text repeats this many times, the
*  system-prompt section escalates to a mandatory-consult instruction. */
repeatThreshold: Schema.natural().min(2).max(10).default(3).description("同一用户问题重复出现多少次后，强制提醒主模型咨询顾问。") });
const LimitsConfig = Schema.object({
	defaultTimeoutMs: Schema.number().min(1e3).max(6e5).default(12e4).description("链上条目未单独配置时的默认超时（毫秒）。"),
	transcriptMaxChars: Schema.natural().min(2e3).max(4e5).default(6e4).description("发送给顾问的对话抄本字符预算；超出时保留最新部分并标注省略。"),
	perEntryMaxChars: Schema.natural().min(200).max(2e4).default(2e3).description("抄本中单条消息（含工具结果）的最大字符数。")
});
const Config = Schema.object({
	enabled: Schema.boolean().default(true).volatile(),
	mode: Schema.union([Schema.const("auto"), Schema.const("manual")]).default("auto").volatile().description("auto：主模型按提示规则自主咨询；manual：仅用户明确要求时咨询。"),
	advisorPrompt: Schema.string().default(DEFAULT_ADVISOR_PROMPT).volatile().description("顾问的系统提示词（整条链共用）。"),
	chain: Schema.array(ChainEntryConfig).default([]).volatile().description("顾问模型链，按顺序尝试；前面的失败（出错或超时无产出）时顺延到下一个。"),
	trigger: TriggerConfig.volatile(),
	limits: LimitsConfig.volatile()
});
/** Read through schemastery volatile observables so live settings edits apply
*  without a plugin restart. Plain values pass through unchanged. */
function unwrapVolatile(value) {
	if (value && typeof value === "object" && "get" in value && typeof value.get === "function") return unwrapVolatile(value.get());
	if (Array.isArray(value)) return value.map(unwrapVolatile);
	if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrapVolatile(v)]));
	return value;
}
/** Best-effort live config snapshot; falls back to schema defaults when a
*  field is missing so callers never see undefined sub-objects. */
function normalizeConfig(raw) {
	const cfg = unwrapVolatile(raw) ?? {};
	return {
		enabled: cfg.enabled !== false,
		mode: cfg.mode === "manual" ? "manual" : "auto",
		advisorPrompt: typeof cfg.advisorPrompt === "string" && cfg.advisorPrompt.trim() ? cfg.advisorPrompt : DEFAULT_ADVISOR_PROMPT,
		chain: Array.isArray(cfg.chain) ? cfg.chain.filter((e) => !!e && typeof e === "object" && typeof e.provider === "string" && e.provider.length > 0 && typeof e.model === "string" && e.model.length > 0) : [],
		trigger: { repeatThreshold: cfg.trigger?.repeatThreshold ?? 3 },
		limits: {
			defaultTimeoutMs: cfg.limits?.defaultTimeoutMs ?? 12e4,
			transcriptMaxChars: cfg.limits?.transcriptMaxChars ?? 6e4,
			perEntryMaxChars: cfg.limits?.perEntryMaxChars ?? 2e3
		}
	};
}
// src/pressure.ts
function extractUserMessageText(event) {
	if (event.type !== "user/message") return null;
	const content = event.data?.content;
	if (!Array.isArray(content)) return null;
	const text = content.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join(" ").trim();
	return text.length > 0 ? text : null;
}
var RepeatPressureTracker = class {
	map = /* @__PURE__ */ new Map();
	handleEvent(sessionId, event) {
		const text = extractUserMessageText(event);
		if (!text) return;
		const tracked = this.map.get(sessionId);
		if (!tracked || tracked.text !== text) this.map.set(sessionId, {
			text,
			count: 1
		});
		else tracked.count += 1;
	}
	get(sessionId) {
		if (!sessionId) return void 0;
		return this.map.get(sessionId);
	}
};
// src/prompt.ts
/**
* The system-prompt section that teaches the main model when to call
* advisor_ask. Concise by design: it is injected into every model step.
*
* DSH adaptation notes (deliberately different from the codex-advisor
* protocol): the advisor inherits the full conversation automatically, so
* the instructions tell the model NOT to restate background; the fallback
* chain is executed in code, so nothing here mentions model priorities or
* retries; there is no V1/V2 interface and no recursion marker.
*/
function buildSectionText(config, pressure, threshold) {
	if (!config.enabled || config.chain.length === 0) return "";
	const lines = [];
	if (config.mode === "manual") {
		lines.push("## Advisor 顾问使用边界", "advisor_ask 向顾问模型征求第二意见，顾问会自动看到当前会话的完整对话。当前为手动模式：仅当用户明确要求咨询顾问（如“问一下顾问”“征求第二意见”）时才调用，平时自行作答。");
		return lines.join("\n");
	}
	lines.push("## Advisor 顾问使用边界", "你可以调用 advisor_ask 向顾问模型征求第二意见。顾问会自动看到当前会话的完整对话记录，调用时只提出具体问题，不要复述对话中已有的内容；对话之外的私有信息（你的推理意图、未说出口的约束）可写入 context 参数。", "1. 适合咨询：重大方案决策前的复核；高风险判断（安全、数据、架构承诺）；你对自己的结论把握不足；同一问题连续多轮没有进展。", "2. 不适合：可以直接联网查证的简单事实；日常闲聊、纯创意任务。", "3. 用户明确要求咨询顾问时必须调用。", "4. 拿到顾问意见后自行判断取舍，不要原样转贴整段回复。");
	if (pressure && pressure.count >= threshold) lines.push("", `【强制咨询】当前会话中同一问题已被用户重复 ${pressure.count} 次仍未解决。本轮必须先调用 advisor_ask 征求第二意见，再基于顾问意见作答；不得继续重复同一思路。`);
	else if (pressure && pressure.count > 1) lines.push("", `【提醒】当前会话中同一问题已出现 ${pressure.count} 次。若本轮仍无法解决，应调用 advisor_ask 征求第二意见。`);
	return lines.join("\n");
}
// src/chain.ts
var AllEntriesFailedError = class extends Error {
	failures;
	constructor(failures) {
		super(`所有顾问模型均调用失败：${failures.map((f) => `${entryName(f.target)}（${f.error}）`).join("；")}`);
		this.failures = failures;
		this.name = "AllEntriesFailedError";
	}
};
function entryName(target) {
	return (typeof target.label === "string" && target.label.trim() ? target.label.trim() : "") || `${target.provider}/${target.model}`;
}
/**
* Try entries in order. An attempt succeeds when it resolves with non-empty
* content (a timeout with partial content counts as a truncated success; a
* timeout with no content counts as a failure). Caller-signal aborts always
* propagate.
*/
async function runAdvisorChain(entries, callOne, callbacks, signal) {
	const failures = [];
	for (let index = 0; index < entries.length; index++) {
		if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
		const target = entries[index];
		callbacks.onAttempt?.(index, target);
		let result;
		try {
			result = await callOne(target, signal ?? new AbortController().signal);
		} catch (error) {
			if (signal?.aborted) throw error;
			const message = error instanceof Error ? error.message : String(error);
			failures.push({
				target,
				error: message
			});
			callbacks.onFail?.(index, target, message);
			continue;
		}
		if (!result.content.trim()) {
			const message = result.truncated ? "超时且无内容产出" : "空响应";
			failures.push({
				target,
				error: message
			});
			callbacks.onFail?.(index, target, message);
			continue;
		}
		callbacks.onDone?.(index, target, result);
		return {
			result,
			winner: target,
			winnerIndex: index,
			failures
		};
	}
	throw new AllEntriesFailedError(failures);
}
// src/events.ts
/**
* Host-side registration for the advisor session event vocabulary.
*
* Same pragmatic workaround dsh-advisor-group uses: `Session.append()` only
* accepts event types inside KNOWN_SESSION_EVENT_TYPES (or ignorable
* envelopes, which the public append API cannot set), so we mutate the
* runtime Set at module load to make our durable card events survive
* restart/resume. Replace this when DSH ships an official plugin-event
* registration surface.
*/
const ADVISOR_EVENT_TYPES = [
	"advisor/start",
	"advisor/delta",
	"advisor/message",
	"advisor/end"
];
function ensureAdvisorEventTypes() {
	const known = KNOWN_SESSION_EVENT_TYPES;
	if (!known || typeof known !== "object" || typeof known.add !== "function" || Object.isFrozen(known)) throw new Error("dsh-advisor-plugin: KNOWN_SESSION_EVENT_TYPES is not mutable. The plugin cannot register durable advisor events; please update it when DSH provides an official plugin-event registration API.");
	for (const type of ADVISOR_EVENT_TYPES) known.add(type);
}
ensureAdvisorEventTypes();
/**
* Derive the latest turn/step coordinates from the durable log. The agent
* loop logs turn/start and step/start before tool execution, so scanning
* backwards gives the closest coordinates for card placement.
*/
function latestTurnStep(log) {
	let events = [];
	try {
		events = log.snapshotEvents?.() ?? [];
	} catch {
		events = [];
	}
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (event.type === "step/start") return {
			turn: Number(event.data?.turn ?? 0),
			step: Number(event.data?.step ?? 0)
		};
		if (event.type === "turn/start") return {
			turn: Number(event.data?.turn ?? 0),
			step: 0
		};
	}
	return {
		turn: 0,
		step: 0
	};
}
function appendAdvisorStart(log, input) {
	const { turn, step } = latestTurnStep(log);
	log.append?.("advisor/start", {
		consultId: input.consultId,
		turn,
		step,
		question: input.question,
		...input.context === void 0 ? {} : { context: input.context },
		chain: input.chain.map((entry) => ({
			label: entry.label ?? `${entry.provider}/${entry.model}`,
			provider: entry.provider,
			model: entry.model
		}))
	});
}
function appendAdvisorDelta(log, input) {
	const { turn, step } = latestTurnStep(log);
	log.append?.("advisor/delta", {
		consultId: input.consultId,
		turn,
		step,
		attemptIndex: input.attemptIndex,
		label: input.label,
		...input.text ? { contentDelta: input.text } : {},
		...input.thinking ? { thinkingDelta: input.thinking } : {}
	});
}
function appendAdvisorMessage(log, input) {
	const { turn, step } = latestTurnStep(log);
	log.append?.("advisor/message", {
		consultId: input.consultId,
		turn,
		step,
		attemptIndex: input.attemptIndex,
		label: input.label,
		provider: input.provider,
		model: input.model,
		content: input.content,
		...input.thinking ? { thinking: input.thinking } : {},
		...input.truncated ? { truncated: true } : {}
	});
}
function appendAdvisorEnd(log, input) {
	const { turn, step } = latestTurnStep(log);
	log.append?.("advisor/end", {
		consultId: input.consultId,
		turn,
		step,
		status: input.status,
		...input.usedModel ? { usedModel: input.usedModel } : {},
		attempts: input.attempts,
		...input.truncated ? { truncated: true } : {}
	});
}
// src/transcript.ts
const ROLE_LABELS = {
	user: "用户",
	assistant: "主模型",
	tool: "工具结果"
};
function clip(text, maxChars) {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}…（截断，原 ${text.length} 字符）`;
}
/** Render one content block; unknown shapes degrade to a bounded JSON dump. */
function blockToText(block) {
	if (block.type === "text" && typeof block.text === "string") return block.text;
	const type = typeof block.type === "string" ? block.type : "unknown";
	if (typeof block.name === "string" && type.includes("tool")) return `（${type.includes("call") ? "工具调用" : "工具"} ${block.name}）`;
	try {
		return `（非文本块 ${type}：${JSON.stringify(block).slice(0, 200)}）`;
	} catch {
		return `（非文本块 ${type}）`;
	}
}
/** One derived message → a labeled transcript entry; null for skipped roles
*  (system/developer) or empty text. */
function messageToEntry(message, perEntryMaxChars) {
	const role = typeof message.role === "string" ? message.role : "";
	const label = ROLE_LABELS[role];
	if (!label) return null;
	const text = clip((Array.isArray(message.content) ? message.content : []).map(blockToText).join("\n").trim(), perEntryMaxChars);
	if (!text) return null;
	return {
		label,
		text
	};
}
function buildTranscript(messages, options) {
	const entries = [];
	for (const message of messages) {
		const entry = messageToEntry(message, options.perEntryMaxChars);
		if (entry) entries.push(`[${entry.label}]\n${entry.text}`);
	}
	let kept = [];
	let used = 0;
	let i = entries.length - 1;
	for (; i >= 0; i--) {
		const cost = entries[i].length + 1;
		if (used + cost > options.maxChars && kept.length > 0) break;
		kept.unshift(entries[i]);
		used += cost;
		if (used >= options.maxChars) {
			i--;
			break;
		}
	}
	const dropped = i + 1;
	const parts = [];
	if (dropped > 0) parts.push(`（为控制篇幅，已省略更早的 ${dropped} 条消息）`);
	parts.push(...kept);
	return {
		text: parts.join("\n\n"),
		droppedCount: dropped,
		truncated: dropped > 0
	};
}
/** The final user prompt handed to the advisor model. */
function buildAdvisorUserPrompt(input) {
	const sections = [];
	sections.push(`以下是你所在的 AI 助手当前会话的对话抄本（可能已省略较早部分）：\n\n${input.transcriptText || "（无可用对话记录）"}`);
	if (input.context && input.context.trim()) sections.push(`助手补充的对话外信息：\n${input.context.trim()}`);
	sections.push(`助手此刻的问题：\n${input.question}`);
	return sections.join("\n\n---\n\n");
}
// src/tool.ts
/** Combine an optional caller signal with a hard timeout; the pair keeps the
*  timeout signal reachable so an aborted stream can be classified:
*  timeout fired → graceful truncation; caller signal → cancellation. */
function timeoutSignalPair(ms, signal) {
	const timeout = AbortSignal.timeout(ms);
	return {
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
		isTimeout: () => timeout.aborted
	};
}
function sessionLogOf(exec) {
	return exec.agent?.session ?? void 0;
}
function createAdvisorAskTool(deps) {
	return defineTool({
		name: "advisor_ask",
		description: "向配置的顾问模型征求第二意见。顾问会自动看到当前会话的完整对话记录，不要在问题中复述对话已有的内容。适用于重大方案决策前的复核、高风险判断、对自己结论把握不足、或同一问题连续受阻时；用户明确要求咨询顾问时也调用。返回顾问的回答文本。",
		parameters: {
			question: {
				type: "string",
				description: "要征求第二意见的具体问题，例如「方案 A 在 X 约束下是否成立」。无需包含对话已有的背景。"
			},
			context: {
				type: "string",
				description: "可选。仅补充对话记录中不存在的信息：你的私有推理意图、未说出口的约束、或来自更早被省略历史的要点。没有就省略。"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					advice: {
						type: "string",
						required: true
					},
					model: { type: "string" },
					truncated: { type: "boolean" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.advice
			}]
		},
		async execute(args, exec) {
			const cfg = deps.getConfig();
			if (typeof args.question !== "string" || !args.question.trim()) return {
				advice: "缺少 question 参数：请提供要征求第二意见的具体问题。",
				model: "",
				truncated: false
			};
			if (!cfg.enabled) return {
				advice: "顾问插件当前已停用（设置中可开启）。",
				model: "",
				truncated: false
			};
			if (cfg.chain.length === 0) return {
				advice: "顾问链尚未配置任何模型。请先到 设置 → 插件 → Advisor 添加顾问模型。",
				model: "",
				truncated: false
			};
			const sessionLog = sessionLogOf(exec);
			let history = [];
			try {
				history = sessionLog?.deriveMessages?.() ?? [];
			} catch {
				history = [];
			}
			const userPrompt = buildAdvisorUserPrompt({
				transcriptText: buildTranscript(history, {
					maxChars: cfg.limits.transcriptMaxChars,
					perEntryMaxChars: cfg.limits.perEntryMaxChars
				}).text,
				question: args.question.trim(),
				context: args.context
			});
			const consultId = randomUUID();
			appendAdvisorStart(sessionLog ?? {}, {
				consultId,
				question: args.question.trim(),
				...args.context === void 0 ? {} : { context: args.context },
				chain: cfg.chain
			});
			let pendingText = "";
			let pendingThinking = "";
			let flushTimer = null;
			let currentAttempt = 0;
			const flush = () => {
				if (flushTimer) {
					clearTimeout(flushTimer);
					flushTimer = null;
				}
				if (!pendingText && !pendingThinking) return;
				if (sessionLog) appendAdvisorDelta(sessionLog, {
					consultId,
					attemptIndex: currentAttempt,
					label: entryName(cfg.chain[currentAttempt]),
					...pendingText ? { text: pendingText } : {},
					...pendingThinking ? { thinking: pendingThinking } : {}
				});
				pendingText = "";
				pendingThinking = "";
			};
			const emitDelta = (delta) => {
				if (delta.text) pendingText += delta.text;
				if (delta.thinking) pendingThinking += delta.thinking;
				if (!flushTimer) flushTimer = setTimeout(flush, 200);
			};
			const attempts = [];
			try {
				const callOne = async (entry, signal) => {
					const pair = timeoutSignalPair(entry.timeoutMs ?? cfg.limits.defaultTimeoutMs, signal);
					const options = {
						provider: entry.provider,
						model: entry.model,
						system: cfg.advisorPrompt,
						messages: [createUserMessage({
							content: [{
								type: "text",
								text: userPrompt
							}],
							source: { kind: "user" }
						})],
						maxTokens: entry.maxTokens ?? 16384,
						signal: pair.signal,
						...entry.reasoningEffort === void 0 ? {} : { reasoningEffort: entry.reasoningEffort },
						...entry.temperature === void 0 ? {} : { temperature: entry.temperature }
					};
					let text = "";
					let thinking = "";
					try {
						for await (const chunk of deps.ctx.llm.stream(options)) if (chunk.type === "text-delta" && typeof chunk.text === "string") {
							text += chunk.text;
							emitDelta({ text: chunk.text });
						} else if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
							thinking += chunk.text;
							emitDelta({ thinking: chunk.text });
						}
					} catch (error) {
						flush();
						if (pair.isTimeout()) return {
							content: text,
							thinking,
							truncated: {
								reason: "timeout",
								atMs: Date.now()
							}
						};
						throw error;
					}
					flush();
					if (pair.isTimeout()) return {
						content: text,
						thinking,
						truncated: {
							reason: "timeout",
							atMs: Date.now()
						}
					};
					if (signal.aborted) throw new DOMException("Aborted", "AbortError");
					return {
						content: text,
						thinking
					};
				};
				const outcome = await runAdvisorChain(cfg.chain, callOne, {
					onAttempt: (index) => {
						flush();
						currentAttempt = index;
					},
					onFail: (index, target, error) => {
						attempts.push({
							label: entryName(target),
							ok: false,
							error
						});
					},
					onDone: (index, target, result) => {
						attempts.push({
							label: entryName(target),
							ok: true
						});
						if (sessionLog) appendAdvisorMessage(sessionLog, {
							consultId,
							attemptIndex: index,
							label: entryName(target),
							provider: target.provider,
							model: target.model,
							content: result.content,
							...result.thinking ? { thinking: result.thinking } : {},
							...result.truncated ? { truncated: true } : {}
						});
					}
				}, exec.signal);
				appendAdvisorEnd(sessionLog ?? {}, {
					consultId,
					status: "done",
					usedModel: `${outcome.winner.provider}/${outcome.winner.model}`,
					attempts,
					...outcome.result?.truncated ? { truncated: true } : {}
				});
				return {
					advice: outcome.result.content,
					model: `${outcome.winner.provider}/${outcome.winner.model}`,
					truncated: outcome.result?.truncated !== void 0
				};
			} catch (error) {
				flush();
				if (error instanceof AllEntriesFailedError) {
					appendAdvisorEnd(sessionLog ?? {}, {
						consultId,
						status: "failed",
						attempts
					});
					return {
						advice: `顾问链全部调用失败：${error.failures.map((f) => `${entryName(f.target)}（${f.error}）`).join("；")}。请基于自己的判断继续，或稍后重试。`,
						model: "",
						truncated: false
					};
				}
				appendAdvisorEnd(sessionLog ?? {}, {
					consultId,
					status: "failed",
					attempts
				});
				throw error;
			}
		}
	});
}
// src/index.ts
const name = "dsh-advisor-plugin";
const inject = [
	"tools",
	"llm",
	"systemPrompt",
	"sessions"
];
function apply(ctx, _config) {
	const liveConfig = () => normalizeConfig(ctx.fiber.config);
	const pressure = new RepeatPressureTracker();
	ctx.on("session/event", (session, event) => {
		pressure.handleEvent(session?.id ?? "", event);
	});
	ctx.effect(() => ctx.tools.register(createAdvisorAskTool({
		ctx,
		getConfig: liveConfig
	})), "dsh-advisor-plugin: advisor_ask tool");
	const systemPrompt = ctx.systemPrompt ?? (typeof ctx.get === "function" ? ctx.get("systemPrompt") : void 0);
	if (systemPrompt) ctx.effect(() => systemPrompt.section({
		name: "dsh-advisor-plugin-boundary",
		order: 151,
		text: (assembly) => {
			const cfg = liveConfig();
			const sessionId = assembly?.agent?.session?.id;
			return buildSectionText(cfg, pressure.get(sessionId), cfg.trigger.repeatThreshold);
		}
	}), "dsh-advisor-plugin: system prompt section");
	if (typeof ctx.inject === "function") ctx.inject(["settings"], (scoped) => {
		const dispose = scoped.settings.configure({ auto: false }, ctx.fiber);
		return () => {
			if (typeof dispose === "function") dispose();
		};
	});
}
export { Config, apply, inject, name };
