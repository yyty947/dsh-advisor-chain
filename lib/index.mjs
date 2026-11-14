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
const DEFAULT_ADVISOR_PROMPT = `你是一位经验丰富的技术顾问，为另一个 AI 编程助手提供第二意见。你会看到该助手当前会话的对话抄本（可能省略了较早的消息）以及它此刻提出的问题。

回答要求：
- 先给结论，再给依据；观点明确，不模棱两可；论证充分但不冗余。
- 指出对话中被忽略的风险、错误假设或更优的替代方案。
- 信息不足以判断时，明确指出缺少哪些信息，不要基于臆测作答。
- 对已有信息中的不确定内容，标注不确定并说明如何验证。
- 抄本注明省略了较早消息时，对涉及早期细节的判断降低相应置信度。
- 用与对话相同的语言回答。`;
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
	contextMode: Schema.union([Schema.const("inherited"), Schema.const("standalone")]).default("inherited").volatile().description("默认咨询模式：inherited 顾问自动继承完整对话；standalone 盲审，顾问只看问题与补充背景。可被工具的 mode 参数按次覆盖。"),
	advisorPrompt: Schema.string().default(DEFAULT_ADVISOR_PROMPT).volatile().description("顾问的系统提示词（整条链共用）。"),
	chain: Schema.array(ChainEntryConfig).default([]).volatile().description("顾问模型链，按顺序尝试；前面的失败（出错或超时无产出）时顺延到下一个。"),
	trigger: TriggerConfig.volatile(),
	limits: LimitsConfig.volatile()
});
/** Prepended to the advisor system prompt on standalone (blind) calls — the
*  confirmed wording also tells the advisor that the requester's stated views
*  are one-sided and may be overturned with reasons. */
const BLIND_REVIEW_MODIFIER = "这是一次盲审请求：你看不到主对话记录，只能依据主代理提出的问题与其主动补充的背景作答。主代理陈述的观点、倾向或已做的假设只是它单方面的判断，仅供参考，可以在有依据的前提下推翻，推翻时请说明理由。信息不足以给出可靠判断时，明确指出还缺少哪些信息，不要臆测补全。";
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
		contextMode: cfg.contextMode === "standalone" ? "standalone" : "inherited",
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
* second_opinion. Concise by design: it is injected into every model step.
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
		lines.push("## Second Opinion（第二意见）使用边界", "second_opinion 向顾问模型征求第二意见，顾问会自动看到当前会话的完整对话。当前为手动模式：仅当用户明确要求咨询顾问（如“问一下顾问”“征求第二意见”）时才调用，平时自行作答；用户要求时相关问题合并为一次咨询。");
		return lines.join("\n");
	}
	lines.push("## Second Opinion（第二意见）使用边界", "second_opinion 向顾问模型征求第二意见。顾问自动看到当前会话的完整对话，调用时只提具体问题，不要复述对话已有的内容；对话外的私有信息（你的推理意图、未说出口的约束）写入 context 参数。", "1. 调用判据（满足其一才调用）：此步出错代价高（安全、数据、架构承诺、不可逆操作、对外承诺）；重大方案定稿或重大交付前需要终审；已连续受阻或对结论把握不足。后果可逆的小改动直接做，简单任务不要机械调用。", "2. 不适合：可直接联网查证的简单事实；日常闲聊、纯创意任务。", "3. 用户明确要求咨询顾问时必须调用；相关问题合并为一次咨询，不要拆成多次。", "4. 顾问指出具体缺陷时先验证再决定；纯观点分歧则吸收后继续，不要反复咨询寻求认同，不采纳时说明理由；不要原样转贴整段顾问回复。");
	if (pressure && pressure.count >= threshold) lines.push("", `【强制咨询】当前会话中同一问题已被用户重复 ${pressure.count} 次仍未解决。本轮必须先调用 second_opinion 征求第二意见，再基于顾问意见作答；不得继续重复同一思路。`);
	else if (pressure && pressure.count > 1) lines.push("", `【提醒】当前会话中同一问题已出现 ${pressure.count} 次。若本轮仍无法解决，应调用 second_opinion 征求第二意见。`);
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
*
* Note: the event type names (advisor/*) deliberately predate the package
* rename to dsh-second-opinion and are kept — renaming stored event types
* would orphan the card events already persisted in existing sessions, and
* the names are session-local vocabulary with no namespace collision.
*/
const ADVISOR_EVENT_TYPES = [
	"advisor/start",
	"advisor/delta",
	"advisor/message",
	"advisor/end",
	"advisor/followup"
];
function ensureAdvisorEventTypes() {
	const known = KNOWN_SESSION_EVENT_TYPES;
	if (!known || typeof known !== "object" || typeof known.add !== "function" || Object.isFrozen(known)) throw new Error("dsh-second-opinion: KNOWN_SESSION_EVENT_TYPES is not mutable. The plugin cannot register durable advisor events; please update it when DSH provides an official plugin-event registration API.");
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
		...input.mode === void 0 ? {} : { mode: input.mode },
		chain: input.chain.map((entry) => ({
			label: entry.label ?? `${entry.provider}/${entry.model}`,
			provider: entry.provider,
			model: entry.model
		}))
	});
}
/** One durable follow-up question inside an existing consultation thread. */
function appendAdvisorFollowup(log, input) {
	const { turn, step } = latestTurnStep(log);
	log.append?.("advisor/followup", {
		consultId: input.consultId,
		turn,
		step,
		round: input.round,
		followUp: input.followUp,
		provider: input.provider,
		model: input.model
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
		...input.round === void 0 ? {} : { round: input.round },
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
		...input.round === void 0 ? {} : { round: input.round },
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
const MAX_THREAD_CHARS = 98304;
/**
* Rebuild one consultation thread by scanning events chronologically.
* Returns undefined when no events for the consultId exist (unknown id).
*/
function rebuildThread(events, consultId) {
	let thread;
	let followUpCount = 0;
	for (const event of events) {
		const data = event?.data;
		if (!data || data.consultId !== consultId) continue;
		if (event.type === "advisor/start") {
			thread = {
				consultId,
				mode: data.mode === "standalone" ? "standalone" : "inherited",
				question: typeof data.question === "string" ? data.question : "",
				context: typeof data.context === "string" ? data.context : void 0,
				turns: [],
				rounds: 0,
				sizeChars: 0
			};
			if (thread.question) {
				thread.turns.push({
					role: "user",
					text: thread.question
				});
				thread.sizeChars += thread.question.length + (thread.context?.length ?? 0);
			}
			continue;
		}
		if (!thread) continue;
		if (event.type === "advisor/followup") {
			followUpCount += 1;
			const text = typeof data.followUp === "string" ? data.followUp : "";
			thread.turns.push({
				role: "user",
				text
			});
			thread.sizeChars += text.length;
			continue;
		}
		if (event.type === "advisor/message") {
			const text = typeof data.content === "string" ? data.content : "";
			thread.turns.push({
				role: "advisor",
				text
			});
			thread.sizeChars += text.length;
			thread.rounds += 1;
			if (typeof data.provider === "string") thread.usedProvider = data.provider;
			if (typeof data.model === "string") thread.usedModel = data.model;
			continue;
		}
	}
	if (!thread) return void 0;
	thread.rounds = Math.max(thread.rounds - 1, 0);
	return thread;
}
/** Capacity check per the confirmed design: 8 rounds / 96 KB per thread. */
function threadCapacityError(thread, incomingChars) {
	if (thread.rounds >= 8) return `该咨询线程已达 8 轮追问上限，请开新咨询。`;
	if (thread.sizeChars + incomingChars > 98304) return `该咨询线程体积已达上限（${MAX_THREAD_CHARS / 1024} KB），请开新咨询。`;
}
/** Messages array for ctx.llm.stream: persona turns of the rebuilt thread,
*  with the new follow-up as the final user message. Advisor turns map to
*  assistant messages. */
function threadToMessages(thread, followUp) {
	const messages = thread.turns.map((turn) => ({
		role: turn.role === "advisor" ? "assistant" : "user",
		text: turn.text
	}));
	messages.push({
		role: "user",
		text: followUp
	});
	return messages;
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
const HINT_FOLLOWUP = (consultId) => `\n\n（consult_id: ${consultId} —— 如需继续追问该顾问，携带此 consult_id 与 follow_up 参数再次调用。）`;
const HINT_DUAL = "\n\n（双意见咨询不支持追问；如需追问请基于单一模型开新咨询。）";
function createSecondOpinionTool(deps) {
	return defineTool({
		name: "second_opinion",
		description: "向配置的顾问模型链征求第二意见。默认自动继承当前会话的完整对话（不要在问题中复述背景）；支持追问（consult_id + follow_up）、盲审模式（mode=standalone，顾问不看对话只依据问题与背景独立判断）与双意见对比（dual_opinions，并行听取链上前两位顾问）。适用于重大方案决策前的复核、高风险判断、对自己结论把握不足、或同一问题连续受阻时；用户明确要求咨询顾问时也调用。",
		parameters: {
			question: {
				type: "string",
				description: "新咨询的问题，例如「方案 A 在 X 约束下是否成立」。与 consult_id 二选一：提供 consult_id 时改用 follow_up。"
			},
			context: {
				type: "string",
				description: "可选。仅补充对话记录中不存在的信息：你的私有推理意图、未说出口的约束、或来自更早被省略历史的要点。没有就省略。"
			},
			mode: {
				type: "string",
				description: "可选，按次覆盖默认咨询模式。inherited：继承完整对话（默认）；standalone：盲审——顾问不看对话，只依据问题与 context 独立判断，适合需要不受主对话思路影响的场景。"
			},
			consult_id: {
				type: "string",
				description: "可选。之前咨询结果返回的 consult_id；提供后进入追问模式，本次 follow_up 会由原顾问带着该线程上下文作答。"
			},
			follow_up: {
				type: "string",
				description: "追问内容；仅在提供 consult_id 时使用，例如「你提到的 X 展开讲讲」「如果换成 Y 会怎样」。"
			},
			dual_opinions: {
				type: "boolean",
				description: "可选。true 时并行咨询链上前两位顾问（互不可见对方；链上仅一个模型时，同一模型独立采样两次），返回两份独立意见；不支持追问。"
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
					consultId: { type: "string" },
					dual: { type: "boolean" },
					truncated: { type: "boolean" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.advice + (value.consultId ? HINT_FOLLOWUP(value.consultId) : value.dual ? HINT_DUAL : "")
			}]
		},
		async execute(args, exec) {
			const cfg = deps.getConfig();
			const fail = (advice) => ({
				advice,
				model: "",
				consultId: "",
				dual: false,
				truncated: false
			});
			if (!cfg.enabled) return fail("Second Opinion 当前已停用（设置中可开启）。");
			if (cfg.chain.length === 0) return fail("顾问链尚未配置任何模型。请先到 设置 → Second Opinion 添加顾问模型。");
			const sessionLog = sessionLogOf(exec);
			const mode = args.mode === "standalone" ? "standalone" : args.mode === "inherited" ? "inherited" : cfg.contextMode;
			const system = mode === "standalone" ? `${cfg.advisorPrompt}\n\n${BLIND_REVIEW_MODIFIER}` : cfg.advisorPrompt;
			const failWithLog = (consultId, attempts, advice) => {
				appendAdvisorEnd(sessionLog ?? {}, {
					consultId,
					status: "failed",
					attempts
				});
				return {
					advice,
					model: "",
					consultId: "",
					dual: false,
					truncated: false
				};
			};
			if (args.consult_id) {
				if (args.dual_opinions) return fail("双意见咨询不支持追问；请基于单一模型开新咨询。");
				if (typeof args.follow_up !== "string" || !args.follow_up.trim()) return fail("追问需要提供 follow_up 参数（要继续追问的内容）。");
				if (!sessionLog) return fail("当前会话不支持追问（无会话日志）。请开新咨询。");
				let events = [];
				try {
					events = sessionLog.snapshotEvents?.() ?? [];
				} catch {
					events = [];
				}
				const thread = rebuildThread(events, args.consult_id);
				if (!thread) return fail("未找到该 consult_id 对应的咨询记录（可能属于其他会话，或记录已不存在）。请开新咨询。");
				const followUp = args.follow_up.trim();
				const capErr = threadCapacityError(thread, followUp.length);
				if (capErr) return fail(capErr);
				const provider = thread.usedProvider;
				const model = thread.usedModel;
				if (!provider || !model) return fail("该线程缺少可用的顾问模型记录，请开新咨询。");
				const followRound = thread.rounds + 1;
				const consultId = args.consult_id;
				appendAdvisorFollowup(sessionLog, {
					consultId,
					round: followRound,
					followUp,
					provider,
					model
				});
				try {
					const result = await streamOnce(deps, cfg, sessionLog, {
						consultId,
						entry: {
							provider,
							model
						},
						system,
						messages: threadToMessages(thread, followUp),
						attemptIndex: 0,
						round: followRound,
						label: `${provider}/${model}`,
						signal: exec.signal
					});
					if (!result.content.trim()) return failWithLog(consultId, [{
						label: `${provider}/${model}`,
						ok: false,
						error: "空响应"
					}], `顾问本轮返回为空，请换个问法追问或开新咨询。`);
					appendAdvisorMessage(sessionLog, {
						consultId,
						attemptIndex: 0,
						round: followRound,
						label: `${provider}/${model}`,
						provider,
						model,
						content: result.content,
						...result.thinking ? { thinking: result.thinking } : {},
						...result.truncated ? { truncated: true } : {}
					});
					appendAdvisorEnd(sessionLog, {
						consultId,
						status: "done",
						usedModel: `${provider}/${model}`,
						attempts: [{
							label: `${provider}/${model}`,
							ok: true
						}],
						...result.truncated ? { truncated: true } : {}
					});
					return {
						advice: result.content,
						model: `${provider}/${model}`,
						consultId,
						dual: false,
						truncated: result.truncated !== void 0
					};
				} catch (error) {
					if (exec.signal?.aborted) throw error;
					return failWithLog(consultId, [{
						label: `${provider}/${model}`,
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					}], `追问调用失败：${error instanceof Error ? error.message : String(error)}。可开新咨询重试。`);
				}
			}
			if (typeof args.question !== "string" || !args.question.trim()) return fail("缺少 question 参数：请提供要征求第二意见的具体问题（或提供 consult_id + follow_up 进行追问）。");
			const question = args.question.trim();
			const consultId = randomUUID();
			const userPrompt = mode === "standalone" ? [question, ...args.context && args.context.trim() ? [args.context.trim()] : []].join("\n\n") : buildAdvisorUserPrompt({
				transcriptText: (() => {
					let history = [];
					try {
						history = sessionLog?.deriveMessages?.() ?? [];
					} catch {
						history = [];
					}
					return buildTranscript(history, {
						maxChars: cfg.limits.transcriptMaxChars,
						perEntryMaxChars: cfg.limits.perEntryMaxChars
					}).text;
				})(),
				question,
				context: args.context
			});
			if (args.dual_opinions) {
				const pair = cfg.chain.slice(0, 2);
				if (pair.length === 1) pair.push(pair[0]);
				appendAdvisorStart(sessionLog ?? {}, {
					consultId,
					question,
					...args.context === void 0 ? {} : { context: args.context },
					mode,
					chain: pair
				});
				const settled = await Promise.allSettled(pair.map((entry, attemptIndex) => streamOnce(deps, cfg, sessionLog, {
					consultId,
					entry,
					system,
					messages: [{
						role: "user",
						text: userPrompt
					}],
					attemptIndex,
					label: entryName(entry),
					signal: exec.signal
				})));
				const sections = [];
				const models = [];
				const attempts = [];
				let anyTruncated = false;
				let anyContent = false;
				settled.forEach((outcome, i) => {
					const label = entryName(pair[i]);
					if (outcome.status === "fulfilled" && outcome.value.content.trim()) {
						anyContent = true;
						if (outcome.value.truncated) anyTruncated = true;
						models.push(`${pair[i].provider}/${pair[i].model}`);
						attempts.push({
							label,
							ok: true
						});
						if (sessionLog) appendAdvisorMessage(sessionLog, {
							consultId,
							attemptIndex: i,
							label,
							provider: pair[i].provider,
							model: pair[i].model,
							content: outcome.value.content,
							...outcome.value.thinking ? { thinking: outcome.value.thinking } : {},
							...outcome.value.truncated ? { truncated: true } : {}
						});
						sections.push(`【意见一/二 · ${label}${outcome.value.truncated ? " · 已截断" : ""}】\n${outcome.value.content}`);
					} else {
						const reason = outcome.status === "rejected" ? outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason) : "空响应";
						attempts.push({
							label,
							ok: false,
							error: reason
						});
						sections.push(`【意见一/二 · ${label}】本次未返回可用内容：${reason}`);
					}
				});
				appendAdvisorEnd(sessionLog ?? {}, {
					consultId,
					status: anyContent ? "done" : "failed",
					usedModel: models.join(" + "),
					attempts,
					...anyTruncated ? { truncated: true } : {}
				});
				if (!anyContent) return {
					advice: `双意见咨询全部失败：${attempts.filter((a) => !a.ok).map((a) => `${a.label}（${a.error}）`).join("；")}。请基于自己的判断继续。`,
					model: "",
					consultId,
					dual: true,
					truncated: false
				};
				const failedNote = attempts.some((a) => !a.ok) ? `\n\n（注：部分顾问未返回可用内容，本次仅包含成功返回的意见。）` : "";
				return {
					advice: sections.join("\n\n———\n\n") + failedNote,
					model: models.join(" + "),
					consultId,
					dual: true,
					truncated: anyTruncated
				};
			}
			appendAdvisorStart(sessionLog ?? {}, {
				consultId,
				question,
				...args.context === void 0 ? {} : { context: args.context },
				mode,
				chain: cfg.chain
			});
			const attempts = [];
			try {
				const outcome = await runAdvisorChain(cfg.chain, (entry, signal) => streamOnce(deps, cfg, sessionLog, {
					consultId,
					entry,
					system,
					messages: [{
						role: "user",
						text: userPrompt
					}],
					attemptIndex: cfg.chain.indexOf(entry),
					label: entryName(entry),
					signal
				}), {
					onFail: (_index, target, error) => {
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
					consultId,
					dual: false,
					truncated: outcome.result?.truncated !== void 0
				};
			} catch (error) {
				if (error instanceof AllEntriesFailedError) return failWithLog(consultId, attempts, `顾问链全部调用失败：${error.failures.map((f) => `${entryName(f.target)}（${f.error}）`).join("；")}。请基于自己的判断继续，或稍后重试。`);
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
/** One throttled, durable-streaming model call shared by every consult shape.
*  Deltas batch into advisor/delta events (200ms), timeouts degrade into
*  truncated results instead of throwing (caller signal still throws). */
async function streamOnce(deps, cfg, sessionLog, input) {
	const pair = timeoutSignalPair(input.entry.timeoutMs ?? cfg.limits.defaultTimeoutMs, input.signal);
	const options = {
		provider: input.entry.provider,
		model: input.entry.model,
		system: input.system,
		messages: input.messages.map((m) => m.role === "user" ? createUserMessage({
			content: [{
				type: "text",
				text: m.text
			}],
			source: { kind: "user" }
		}) : {
			role: "assistant",
			content: [{
				type: "text",
				text: m.text
			}],
			source: { kind: "assistant" }
		}),
		maxTokens: input.entry.maxTokens ?? 16384,
		signal: pair.signal,
		...input.entry.reasoningEffort === void 0 ? {} : { reasoningEffort: input.entry.reasoningEffort },
		...input.entry.temperature === void 0 ? {} : { temperature: input.entry.temperature }
	};
	let text = "";
	let thinking = "";
	let pendingText = "";
	let pendingThinking = "";
	let flushTimer = null;
	const flush = () => {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (!pendingText && !pendingThinking) return;
		if (sessionLog) appendAdvisorDelta(sessionLog, {
			consultId: input.consultId,
			attemptIndex: input.attemptIndex,
			...input.round === void 0 ? {} : { round: input.round },
			label: input.label,
			...pendingText ? { text: pendingText } : {},
			...pendingThinking ? { thinking: pendingThinking } : {}
		});
		pendingText = "";
		pendingThinking = "";
	};
	try {
		for await (const chunk of deps.ctx.llm.stream(options)) if (chunk.type === "text-delta" && typeof chunk.text === "string") {
			text += chunk.text;
			pendingText += chunk.text;
		} else if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
			thinking += chunk.text;
			pendingThinking += chunk.text;
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
	if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
	return {
		content: text,
		thinking
	};
}
// src/index.ts
const name = "dsh-second-opinion";
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
	ctx.effect(() => ctx.tools.register(createSecondOpinionTool({
		ctx,
		getConfig: liveConfig
	})), "dsh-second-opinion: second_opinion tool");
	const systemPrompt = ctx.systemPrompt ?? (typeof ctx.get === "function" ? ctx.get("systemPrompt") : void 0);
	if (systemPrompt) ctx.effect(() => systemPrompt.section({
		name: "dsh-second-opinion-boundary",
		order: 151,
		text: (assembly) => {
			const cfg = liveConfig();
			const sessionId = assembly?.agent?.session?.id;
			return buildSectionText(cfg, pressure.get(sessionId), cfg.trigger.repeatThreshold);
		}
	}), "dsh-second-opinion: system prompt section");
	if (typeof ctx.inject === "function") ctx.inject(["settings"], (scoped) => {
		const dispose = scoped.settings.configure({ auto: false }, ctx.fiber);
		return () => {
			if (typeof dispose === "function") dispose();
		};
	});
}
export { Config, apply, inject, name };
