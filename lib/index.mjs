import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";
import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { SubagentError, delegationDepthOf, finalAssistantOutput, foldSubagentDescriptor } from "@deepseek-ai/dsh-subagent";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
// src/config.ts
/**
* Chain-level advisor persona. The advisor receives either a bounded transcript
* of the main session (inherited mode) or only the question plus out-of-band
* context (standalone mode), and answers the main agent — never the human.
*/
const DEFAULT_ADVISOR_PROMPT = `你是一位经验丰富的技术顾问，为另一个 AI 编程助手提供第二意见。你会看到该助手当前会话的对话抄本（可能省略了较早的消息）以及它此刻提出的问题。

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
const ChainEntryConfig = Schema.object({
	label: Schema.string().description("显示名称（卡片与设置页用）；留空则显示 provider/model。"),
	provider: Schema.string().required().description("DSH provider 路由 key，例如 deepseek-official。"),
	model: Schema.string().required().description("该路由下的模型 id。"),
	reasoningEffort: Schema.string().description("推理档位 id；模型未声明该档位时忽略并沿用模型默认。"),
	maxTokens: Schema.number().min(1).description("单次回答的 maxTokens 上限；不设置则用模型默认。"),
	timeoutMs: Schema.number().min(1e3).max(6e5).description("该条目的超时毫秒数；不设置则用 limits.defaultTimeoutMs。")
});
const FollowupConfig = Schema.object({ 
/** Hard cap on follow-up rounds per consultation thread. */
maxRounds: Schema.natural().min(1).max(20).default(8).description("每个咨询线程最多可追问多少轮。") });
const TriggerConfig = Schema.object({ 
/** Hard trigger: after the same user text repeats this many times, the
*  system-prompt section escalates to a mandatory-consult instruction. */
repeatThreshold: Schema.natural().min(2).max(10).default(3).description("同一用户问题重复出现多少次后，强制提醒主模型咨询顾问。") });
const LimitsConfig = Schema.object({
	defaultTimeoutMs: Schema.number().min(1e3).max(6e5).default(3e5).description("链上条目未单独配置时的默认超时（毫秒）。顾问可能先思考再作答，默认给足 5 分钟。"),
	transcriptMaxChars: Schema.natural().min(2e3).max(4e5).default(12e4).description("发送给顾问的对话抄本字符预算；超出时保留最新部分并标注省略。"),
	perEntryMaxChars: Schema.natural().min(200).max(2e4).default(4e3).description("抄本中单条消息（含工具结果）的最大字符数。")
});
const Config = Schema.object({
	enabled: Schema.boolean().default(true).volatile(),
	mode: Schema.union([Schema.const("auto"), Schema.const("manual")]).default("auto").volatile().description("auto：主模型按提示规则自主咨询；manual：仅用户明确要求时咨询。"),
	contextMode: Schema.union([Schema.const("inherited"), Schema.const("standalone")]).default("inherited").volatile().description("默认咨询模式：inherited 顾问获得会话抄本；standalone 盲审，顾问只看问题与补充背景。可被工具的 mode 参数按次覆盖。"),
	advisorPrompt: Schema.string().default(DEFAULT_ADVISOR_PROMPT).volatile().description("顾问的系统提示词（整条链共用）。"),
	chain: Schema.array(ChainEntryConfig).default([]).volatile().description("顾问模型链，按顺序尝试；前面的失败时顺延到下一个。"),
	followup: FollowupConfig.volatile(),
	/** Set once the user dismissed the one-time legacy-sessions banner. */
	legacyNoticeDismissed: Schema.boolean().default(false).volatile(),
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
function clampInt(value, fallback, lo, hi) {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(hi, Math.max(lo, Math.round(value)));
}
/** Best-effort live config snapshot; falls back to schema defaults when a
*  field is missing so callers never see undefined sub-objects. Tolerates
*  configs written by earlier releases (unknown keys ignored, effort ids
*  kept verbatim). */
function normalizeConfig(raw) {
	const cfg = unwrapVolatile(raw) ?? {};
	return {
		enabled: cfg.enabled !== false,
		mode: cfg.mode === "manual" ? "manual" : "auto",
		contextMode: cfg.contextMode === "standalone" ? "standalone" : "inherited",
		advisorPrompt: typeof cfg.advisorPrompt === "string" && cfg.advisorPrompt.trim() ? cfg.advisorPrompt : DEFAULT_ADVISOR_PROMPT,
		chain: Array.isArray(cfg.chain) ? cfg.chain.filter((e) => !!e && typeof e === "object" && typeof e.provider === "string" && e.provider.length > 0 && typeof e.model === "string" && e.model.length > 0).map((e) => ({
			...typeof e.label === "string" && e.label.trim() ? { label: e.label } : {},
			provider: e.provider,
			model: e.model,
			...typeof e.reasoningEffort === "string" && e.reasoningEffort.trim() ? { reasoningEffort: e.reasoningEffort } : {},
			...typeof e.maxTokens === "number" ? { maxTokens: e.maxTokens } : {},
			...typeof e.timeoutMs === "number" ? { timeoutMs: e.timeoutMs } : {}
		})) : [],
		followup: { maxRounds: clampInt(cfg.followup?.maxRounds, 8, 1, 20) },
		legacyNoticeDismissed: cfg.legacyNoticeDismissed === true,
		trigger: { repeatThreshold: clampInt(cfg.trigger?.repeatThreshold, 3, 2, 10) },
		limits: {
			defaultTimeoutMs: clampInt(cfg.limits?.defaultTimeoutMs, 3e5, 1e3, 6e5),
			transcriptMaxChars: clampInt(cfg.limits?.transcriptMaxChars, 12e4, 2e3, 4e5),
			perEntryMaxChars: clampInt(cfg.limits?.perEntryMaxChars, 4e3, 200, 2e4)
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
* The system-prompt section that teaches the main model when and how to call
* second_opinion. Concise by design: it is injected into every model step.
*
* DSH adaptation notes: the advisor is a read-only subagent that receives a
* bounded transcript of this conversation (or nothing, in blind mode), so the
* instructions tell the model NOT to restate background but to point the
* advisor at files and to supply out-of-transcript facts in `context`.
*/
function buildSectionText(config, pressure, threshold) {
	if (!config.enabled || config.chain.length === 0) return "";
	const lines = [];
	if (config.mode === "manual") {
		lines.push("## Second Opinion（第二意见）使用边界", "second_opinion 向只读的顾问子代理征求第二意见，顾问会收到当前会话的有界抄本。当前为手动模式：仅当用户明确要求咨询顾问（如“问一下顾问”“征求第二意见”）时才调用，平时自行作答；用户要求时相关问题合并为一次咨询。");
		return lines.join("\n");
	}
	lines.push("## Second Opinion（第二意见）使用边界", "second_opinion 向只读的顾问子代理征求第二意见：顾问能读文件、跑只读命令核实，但改不了任何东西，回答只交给你。默认继承模式下顾问收到当前会话的有界文本抄本（工具输出可能被截断、更早消息可能被省略），调用时只提具体问题，不要复述对话已有的内容；问题依赖某个大文件或长输出时给出路径让顾问自己去读；对话外的私有信息（你的推理意图、没说出口的约束、被省略的早期要点）写入 context 参数。盲审模式（mode=standalone）下顾问看不到对话，必须在 context 里写清目标、约束、已尝试的做法和相关文件路径。", "1. 调用判据（满足其一才调用）：此步出错代价高（安全、数据、架构承诺、不可逆操作、对外承诺）；重大方案定稿或重大交付前需要终审；已连续受阻或对结论把握不足。后果可逆的小改动直接做，简单任务不要机械调用。", "2. 不适合：可直接联网查证的简单事实；日常闲聊、纯创意任务。", "3. 用户明确要求咨询顾问时必须调用；相关问题合并为一次咨询，不要拆成多次。", "4. 顾问指出具体缺陷时先验证再决定；纯观点分歧则吸收后继续，不要反复咨询寻求认同，不采纳时说明理由；不要原样转贴整段顾问回复。顾问说缺少信息时，带着补充后的 context 重新调用，或用 consult_id + follow_up 追问。", "5. 追问的结果以工具返回为准；宿主随后可能在对话里投递一条内容相同的子代理完成通知，忽略即可。");
	if (pressure && pressure.count >= threshold) lines.push("", `【强制咨询】当前会话中同一问题已被用户重复 ${pressure.count} 次仍未解决。本轮必须先调用 second_opinion 征求第二意见，再基于顾问意见作答；不得继续重复同一思路。`);
	else if (pressure && pressure.count > 1) lines.push("", `【提醒】当前会话中同一问题已出现 ${pressure.count} 次。若本轮仍无法解决，应调用 second_opinion 征求第二意见。`);
	return lines.join("\n");
}
// src/transcript.ts
const USER_LABEL = "用户";
const ASSISTANT_LABEL = "主模型";
const TOOL_LABEL = "工具结果";
const DEFAULT_HEAD_SUMMARY_MAX_CHARS = 600;
function clip(text, maxChars) {
	if (text.length <= maxChars) return {
		text,
		clipped: false
	};
	return {
		text: `${text.slice(0, maxChars)}…（截断，原 ${text.length} 字符）`,
		clipped: true
	};
}
function compactArgs(raw) {
	if (typeof raw !== "string") return raw === void 0 ? "" : safeStringify(raw);
	try {
		const parsed = JSON.parse(raw);
		return JSON.stringify(parsed);
	} catch {
		return raw;
	}
}
function safeStringify(value) {
	try {
		return JSON.stringify(value) ?? "";
	} catch {
		return "";
	}
}
/** Label for a user-role message: the real user, or the injecting producer. */
function userEntryLabel(source) {
	const kind = source?.kind ?? "user";
	if (kind === USER_LABEL || kind === "user") return USER_LABEL;
	return `注入：${kind}${typeof source?.form === "string" && source.form ? `/${source.form}` : ""}`;
}
/** Render one content block; returns null for blocks the advisor should not see. */
function blockToText(block, perEntryMaxChars, excludedCallIds, excludeToolName, clipped) {
	if (block.type === "text" && typeof block.text === "string") {
		const res = clip(block.text, perEntryMaxChars);
		if (res.clipped) clipped.count += 1;
		return res.text;
	}
	if (block.type === "reasoning") return null;
	if (block.type === "tool-call" && typeof block.name === "string") {
		if (excludeToolName && block.name === excludeToolName && excludedCallIds.has(block.id)) return null;
		const args = clip(compactArgs(block.arguments), perEntryMaxChars);
		if (args.clipped) clipped.count += 1;
		return `（工具调用 ${block.name}：${args.text || "{}"}）`;
	}
	if (block.type === "image" || block.type === "file") return `（${block.type === "image" ? "图片" : "文件"}附件，顾问无法直接查看；如有需要请用只读工具读取工作区中的对应文件）`;
	if (block.type === "tool-addition" || block.type === "tool-removal") return null;
	return null;
}
/** One derived message → a labeled transcript entry; null for skipped roles
*  (system / developer) or entries that render to nothing. */
function messageToEntry(message, perEntryMaxChars, excludedCallIds = /* @__PURE__ */ new Set(), excludeToolName, clipped = { count: 0 }) {
	const role = message.role ?? "";
	if (role === "system" || role === "developer") return null;
	if (role === "user") {
		const source = message.source;
		if (source?.form === "notice" && typeof source.summary === "string") return {
			label: userEntryLabel(source),
			text: source.summary
		};
		const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped);
		return text ? {
			label: userEntryLabel(source),
			text
		} : null;
	}
	if (role === "assistant") {
		const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped);
		return text ? {
			label: ASSISTANT_LABEL,
			text
		} : null;
	}
	if (role === "tool") {
		const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped);
		if (!text) return null;
		return {
			label: `${TOOL_LABEL}${message.isError ? "（失败）" : ""}`,
			text
		};
	}
	return null;
}
function renderBlocks(blocks, perEntryMaxChars, excludedCallIds, excludeToolName, clipped) {
	if (!Array.isArray(blocks)) return "";
	const parts = [];
	for (const block of blocks) {
		const rendered = blockToText(block, perEntryMaxChars, excludedCallIds, excludeToolName, clipped);
		if (rendered !== null && rendered !== "") parts.push(rendered);
	}
	return parts.join("\n").trim();
}
/** Ids of tool calls that already have a result in the log. */
function collectAnsweredCallIds(messages) {
	const answered = /* @__PURE__ */ new Set();
	for (const message of messages) if (message.role === "tool" && message.toolCallId !== void 0) answered.add(message.toolCallId);
	return answered;
}
/** The first real user message, rendered as a short head summary. */
function headSummaryOf(messages, maxChars) {
	for (const message of messages) {
		if (message.role !== "user") continue;
		if (message.source?.kind !== void 0 && message.source.kind !== "user") continue;
		const text = renderBlocks(message.content, maxChars, /* @__PURE__ */ new Set(), void 0, { count: 0 });
		if (text) return clip(text, maxChars).text;
	}
	return null;
}
function buildTranscript(messages, options) {
	const clipped = { count: 0 };
	const exclude = options.excludeToolName;
	const excludedCallIds = /* @__PURE__ */ new Set();
	if (exclude) {
		for (const message of messages) {
			if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
			for (const block of message.content) if (block.type === "tool-call" && block.name === exclude) excludedCallIds.add(block.id);
		}
		for (const id of collectAnsweredCallIds(messages)) excludedCallIds.delete(id);
	}
	const entries = [];
	let firstUserEntryIndex = -1;
	messages.forEach((message) => {
		const entry = messageToEntry(message, options.perEntryMaxChars, excludedCallIds, exclude, clipped);
		if (!entry) return;
		if (firstUserEntryIndex < 0 && message.role === "user" && (message.source?.kind ?? "user") === "user") firstUserEntryIndex = entries.length;
		entries.push(entry);
	});
	const rendered = entries.map((e) => `[${e.label}]\n${e.text}`);
	const kept = [];
	let used = 0;
	let i = rendered.length - 1;
	for (; i >= 0; i--) {
		const cost = rendered[i].length + 1;
		if (used + cost > options.maxChars && kept.length > 0) break;
		kept.unshift(rendered[i]);
		used += cost;
		if (used >= options.maxChars) {
			i--;
			break;
		}
	}
	const dropped = i + 1;
	const parts = [];
	if (dropped > 0) {
		parts.push(`（为控制篇幅，已省略更早的 ${dropped} 条消息）`);
		if (firstUserEntryIndex >= 0 && firstUserEntryIndex < dropped) {
			const head = headSummaryOf(messages, options.headSummaryMaxChars ?? DEFAULT_HEAD_SUMMARY_MAX_CHARS);
			if (head) parts.push(`（最初的用户请求，可能已截断）\n${head}`);
		}
	}
	parts.push(...kept);
	return {
		text: parts.join("\n\n"),
		droppedCount: dropped,
		clippedCount: clipped.count,
		truncated: dropped > 0
	};
}
// src/chain.ts
function entryName(target) {
	return (typeof target.label === "string" && target.label.trim() ? target.label.trim() : "") || `${target.provider}/${target.model}`;
}
// src/advisor/observe.ts
/** Partial text is only a fallback when the settled result carries none. */
const TEXT_CAP = 65536;
function attachObservation(child, now = Date.now) {
	const obs = {
		childId: String(child.id),
		failures: [],
		answerTextStarted: false,
		lastAnswerTextAt: 0,
		text: "",
		toolCalls: 0,
		turnEnds: 0,
		onTurnEnd: (listener) => {
			turnEndListeners.push(listener);
			return () => {
				const i = turnEndListeners.indexOf(listener);
				if (i >= 0) turnEndListeners.splice(i, 1);
			};
		},
		ended: false,
		dispose: () => {}
	};
	const turnEndListeners = [];
	const ctx = child.ctx;
	const disposers = [];
	const listen = (name, listener) => {
		const off = ctx.on(name, listener);
		disposers.push(() => void off());
	};
	listen("agent/request-error", (payload, next) => {
		const p = payload;
		const mine = !p.agent || p.agent === child;
		return Promise.resolve(next()).then((action) => {
			if (mine && p.failure && action === void 0) obs.failures.push(p.failure);
			return action;
		}, (error) => {
			throw error;
		});
	});
	listen("agent/assistant-stream", (payload) => {
		const p = payload;
		if (p.agent && p.agent !== child) return;
		const frame = p.frame;
		if (!frame || frame.type !== "chunk" || !frame.chunk) return;
		if (frame.chunk.type === "text-delta" && typeof frame.chunk.text === "string") {
			obs.answerTextStarted = true;
			obs.lastAnswerTextAt = now();
			if (obs.text.length < TEXT_CAP) obs.text += frame.chunk.text;
		} else if (frame.chunk.type === "tool-call-delta") {
			obs.toolCalls += 1;
			obs.answerTextStarted = false;
			obs.lastAnswerTextAt = 0;
		}
	});
	const offSession = ctx.on("session/event", (session, event) => {
		if (session !== child.session || event?.type !== "turn/end") return;
		obs.turnEnds += 1;
		obs.lastTurnEnd = event.data;
		obs.answerTextStarted = false;
		for (const listener of [...turnEndListeners]) listener();
	});
	disposers.push(() => void offSession());
	obs.dispose = () => {
		for (const off of disposers.splice(0)) off();
	};
	return obs;
}
/** Text of a subagent's final output blocks. */
function contentText(blocks) {
	if (!Array.isArray(blocks)) return "";
	return blocks.map((b) => b?.type === "text" && typeof b.text === "string" ? b.text : "").join("").trim();
}
// src/advisor/types.ts
const noopLogger = () => {};
// src/advisor/identify.ts
/**
* Advisor children are recognized by the durable label the manager writes
* into each child's `subagent/descriptor` event during setup — which lands
* before `subagent/start` fires. The label prefix is the contract; an
* in-flight start counter is only a fallback for a child whose descriptor
* cannot be read yet.
*/
const ADVISOR_LABEL_PREFIX = "second-opinion:";
function advisorLabel(entryLabel) {
	return `${ADVISOR_LABEL_PREFIX}${entryLabel}`;
}
/** Records kept in memory; older ones stay reachable through the durable log. */
const MAX_RECORDS = 64;
var AdvisorRegistry = class {
	records = /* @__PURE__ */ new Map();
	pendingParents = /* @__PURE__ */ new Map();
	turnWaiters = [];
	host;
	sandbox;
	log;
	depthOf;
	descriptorOf;
	now;
	constructor(deps) {
		this.host = deps.host;
		this.sandbox = deps.sandbox;
		this.log = deps.log ?? noopLogger;
		this.depthOf = deps.depthOf ?? defaultDepthOf;
		this.descriptorOf = deps.descriptorOf ?? defaultDescriptorOf;
		this.now = deps.now ?? Date.now;
	}
	/** Register the `subagent/start` / `subagent/end` listeners; returns a disposer. */
	install() {
		const offStart = this.host.on("subagent/start", (info) => this.onStart(info));
		const offEnd = this.host.on("subagent/end", (info) => this.onEnd(info));
		return () => {
			offStart();
			offEnd();
		};
	}
	/** Announce an in-flight start so a child without a readable descriptor is still recognized. */
	notePendingStart(parentSessionId) {
		this.pendingParents.set(parentSessionId, (this.pendingParents.get(parentSessionId) ?? 0) + 1);
	}
	clearPendingStart(parentSessionId) {
		const left = (this.pendingParents.get(parentSessionId) ?? 1) - 1;
		if (left <= 0) this.pendingParents.delete(parentSessionId);
		else this.pendingParents.set(parentSessionId, left);
	}
	isAdvisor(childId) {
		return this.records.has(childId);
	}
	get(childId) {
		return this.records.get(childId);
	}
	observation(childId) {
		return this.records.get(childId)?.observation;
	}
	/** Create the record for a child we started, or fill in what `onStart` could not know. */
	record(input) {
		const existing = this.records.get(input.childId);
		if (existing) {
			if (!existing.consultId) existing.consultId = input.consultId;
			if (!existing.provider) existing.provider = input.provider;
			if (!existing.model) existing.model = input.model;
			if (input.dual) existing.dual = true;
			this.records.delete(input.childId);
			this.records.set(input.childId, existing);
			return existing;
		}
		const record = {
			...input,
			createdAt: this.now(),
			epoch: 0,
			sandbox: "unknown"
		};
		this.records.set(input.childId, record);
		while (this.records.size > MAX_RECORDS) {
			const oldest = this.records.keys().next().value;
			if (oldest === void 0) break;
			this.records.get(oldest)?.observation?.dispose();
			this.records.delete(oldest);
		}
		return record;
	}
	/** Whether an advisor child currently has a live Agent (warm) or must be cold-resumed. */
	isLive(childId) {
		return this.host.agents.get(childId) !== void 0;
	}
	/**
	* Resolve once the child has ended a turn at or after the given epoch and
	* turn count. Warm follow-ups keep the epoch and add a turn; a cold resume
	* starts a new epoch whose observation counts turns from zero.
	*/
	waitForTurnEnd(childId, gate, signal) {
		if (this.turnGateOpen(childId, gate)) return Promise.resolve();
		return new Promise((resolve, reject) => {
			const waiter = {
				childId,
				...gate,
				resolve,
				reject,
				signal
			};
			this.turnWaiters.push(waiter);
			signal?.addEventListener("abort", () => {
				const i = this.turnWaiters.indexOf(waiter);
				if (i >= 0) this.turnWaiters.splice(i, 1);
				reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
			}, { once: true });
		});
	}
	turnGateOpen(childId, gate) {
		const record = this.records.get(childId);
		if (!record || record.epoch < gate.minEpoch) return false;
		return (record.observation?.turnEnds ?? 0) >= gate.minTurnEnds;
	}
	settleTurnWaiters(childId) {
		for (const waiter of [...this.turnWaiters]) {
			if (waiter.childId !== childId) continue;
			if (!this.turnGateOpen(childId, waiter)) continue;
			this.turnWaiters.splice(this.turnWaiters.indexOf(waiter), 1);
			waiter.resolve();
		}
	}
	/** `subagent/start`: recognize our child, confine it to the read-only sandbox, observe it. */
	onStart(info) {
		if (!info.local) return;
		const child = this.host.agents.get(info.id);
		if (!child) return;
		const descriptor = this.descriptorOf(child);
		const childId = String(info.id);
		const parentSessionId = String(info.parentSessionId);
		const known = this.records.has(childId);
		const byLabel = typeof descriptor?.label === "string" && descriptor.label.startsWith("second-opinion:");
		const byPending = !descriptor && (this.pendingParents.get(parentSessionId) ?? 0) > 0;
		if (!known && !byLabel && !byPending) return;
		if (!byLabel && !known) this.log(`advisor: child ${childId} recognized without a descriptor (pending-start fallback)`);
		const record = this.records.get(childId) ?? this.record({
			childId,
			parentSessionId,
			consultId: "",
			label: descriptor?.label ?? "second-opinion:",
			provider: "",
			model: ""
		});
		record.observation?.dispose();
		record.observation = attachObservation(child, this.now);
		record.observation.onTurnEnd(() => this.settleTurnWaiters(childId));
		record.epoch += 1;
		try {
			this.sandbox.setSandboxMode(child.session, "read-only");
			const logged = this.sandbox.lastModeOf?.(child.session) ?? lastLoggedModeOf(child.session);
			const mode = logged !== void 0 ? logged : this.sandbox.overrideOf(child.session);
			record.sandbox = mode === void 0 ? "unknown" : mode === "read-only" ? "read-only" : "failed";
			if (record.sandbox === "failed") this.log(`advisor: child ${childId} sandbox is "${mode}" after requesting read-only`);
		} catch (error) {
			record.sandbox = "failed";
			this.log(`advisor: could not confine child ${childId} to read-only: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	/** `subagent/end`: mark the epoch ended and release waiters whose gate is open. */
	onEnd(info) {
		const childId = String(info.id);
		const record = this.records.get(childId);
		if (!record?.observation) return;
		record.observation.ended = true;
		record.observation.endInfo = info;
		for (const waiter of [...this.turnWaiters]) {
			if (waiter.childId !== childId || record.epoch < waiter.minEpoch) continue;
			if (waiter.minTurnEnds === 0) {
				this.turnWaiters.splice(this.turnWaiters.indexOf(waiter), 1);
				waiter.resolve();
			}
		}
	}
};
function defaultDepthOf(agent) {
	try {
		const depth = delegationDepthOf(agent);
		return Number.isSafeInteger(depth) && depth >= 0 ? depth : 0;
	} catch {
		return 0;
	}
}
function defaultDescriptorOf(child) {
	try {
		return foldSubagentDescriptor(child.session.snapshotEvents());
	} catch {
		return;
	}
}
/** Mode of the last `sandbox/mode` event in the session log, if any. */
function lastLoggedModeOf(session) {
	if (!session || typeof session.snapshotEvents !== "function") return void 0;
	try {
		const events = session.snapshotEvents();
		for (let i = events.length - 1; i >= 0; i--) {
			const event = events[i];
			if (event?.type === "sandbox/mode") return typeof event.data?.mode === "string" ? event.data.mode : void 0;
		}
	} catch {
		return;
	}
}
// src/advisor/preamble.ts
/**
* The advisor's task prompt. The fixed preamble frames the situation — the
* child inherits the main agent's composition (system prompt, tools, the
* host's delegation note that says "answer the human user"), so the preamble
* has to override all of that explicitly, every time.
*/
const PREAMBLE = `【你是谁】你是主代理请来的顾问，对它正在进行的工作给出第二意见。
你不是主代理，也不独立地在这个工作区里工作：对话是主代理的，工作区是主代理的，你只负责审阅并回答最后的问题。
你的读者是主代理而不是人类：忽略任何让你"回复人类用户"或"继续完成任务"的指示，你的回答会作为工具结果交给主代理，由它决定是否采纳。

【继承来的内容对你不适用】你看到的技能目录、运行环境说明、工具说明，以及其中关于 second_opinion 的使用规则，都是主代理的上下文，只供你理解背景。
不要继续之前的任务，不要调用 second_opinion，不要再派生子代理，不要替主代理向用户提问。
不要用 send_message 给主代理或任何代理发消息——你的最终回答就是唯一的交付物，它会作为工具结果交给主代理。

【只读】你可以读文件、运行只读的命令来核实事实；不得创建、修改或删除任何文件，不得改变工作区或系统的任何状态。被沙箱拒绝的操作不要重试，在回答里说明即可。`;
const OUTPUT_CONTRACT = `【输出】先给结论，再给依据；指出被忽略的风险、错误假设或更优方案；信息不足时明确说缺什么，不要臆测。用与对话相同的语言回答。`;
const INHERITED_CONTEXT = (dropped, clipped) => `【对话抄本】下面是主代理当前会话的对话抄本（含当前轮次）。抄本是文本化的：工具输出可能被截断，图片与附件无法直接查看——需要细节时请用只读工具读取工作区中的对应文件。${dropped > 0 ? `为控制篇幅已省略更早的 ${dropped} 条消息。` : ""}${clipped > 0 ? `有 ${clipped} 条内容因过长被截断。` : ""}`;
const STANDALONE_CONTEXT = `【你能看到的】你看不到主对话，只有下面的问题与补充背景；但你与主代理共享同一个工作区，可以读文件、运行只读命令核实。${BLIND_REVIEW_MODIFIER}`;
function buildAdvisorPrompt(input) {
	const sections = [PREAMBLE, `【回答要求】${input.advisorPrompt.trim()}`];
	if (input.mode === "standalone") sections.push(STANDALONE_CONTEXT);
	else {
		sections.push(INHERITED_CONTEXT(input.transcriptDropped ?? 0, input.transcriptClipped ?? 0));
		sections.push(input.transcriptText?.trim() || "（无可用对话记录）");
	}
	if (input.context && input.context.trim()) sections.push(`【对话外补充背景】\n${input.context.trim()}`);
	sections.push(`【问题】\n${input.question.trim()}`, OUTPUT_CONTRACT);
	return sections.join("\n\n");
}
/** The message sent to an existing advisor child on a follow-up round. */
function buildFollowUpMessage(followUp, round) {
	return `【追问 ${round}】仍是同一咨询线程：保持顾问身份与只读约束，只回答这个追问，不要重复此前的回答。\n\n${followUp.trim()}`;
}
// src/advisor/result.ts
const INFRASTRUCTURE_CODES = /* @__PURE__ */ new Set([
	"ACTIVATION_LIMIT_REACHED",
	"ACTIVATION_CLOSING",
	"ACTIVATION_TEARDOWN_FAILED",
	"DEPTH_EXCEEDED",
	"INVALID_DEPTH",
	"DRAINING",
	"WORKING_DIRECTORY_UNAVAILABLE",
	"INVALID_CWD",
	"NO_PROVIDER",
	"PROVIDER_CHANGED",
	"UNSUPPORTED_CAPABILITY",
	"DUPLICATE_PROVIDER",
	"DUPLICATE_CHILD",
	"PRESET_UNAVAILABLE",
	"PRESET_SELECTION_DISABLED",
	"PRESET_NOT_ALLOWED",
	"CONTINUATION_UNAVAILABLE",
	"PERSISTENCE_UNAVAILABLE",
	"NOT_RESUMABLE",
	"NOT_CONTINUABLE",
	"INPUT_CLOSED",
	"SUBAGENT_CONTROL_QUERY_UNAVAILABLE",
	"SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE",
	"SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE",
	"INVALID_AGENT_NAME",
	"DUPLICATE_AGENT_NAME",
	"AGENT_NAME_NOT_FOUND"
]);
const AUTHORIZATION_CODES = /* @__PURE__ */ new Set([
	"UNAUTHORIZED",
	"MODEL_ROUTE_NOT_ALLOWED",
	"MODEL_SELECTION_DISABLED",
	"INVALID_MODEL_SELECTION_SETTINGS"
]);
const CANCELLED_CODES = /* @__PURE__ */ new Set(["CANCELLED"]);
/** Route a thrown error: only model-class failures may fall through to the next chain entry. */
function classifySubagentError(error) {
	if (error instanceof SubagentError) {
		const message = error.message || error.code;
		if (CANCELLED_CODES.has(error.code)) return {
			kind: "other",
			code: error.code,
			message
		};
		if (AUTHORIZATION_CODES.has(error.code)) return {
			kind: "authorization",
			code: error.code,
			message
		};
		if (INFRASTRUCTURE_CODES.has(error.code)) return {
			kind: "infrastructure",
			code: error.code,
			message
		};
		return {
			kind: "model",
			code: error.code,
			message
		};
	}
	return {
		kind: "other",
		message: error instanceof Error ? error.message : String(error)
	};
}
const FAILURE_CATEGORIES = [
	[/CONTEXT_WINDOW_EXCEEDED/i, "上下文超限"],
	[/RATE_LIMIT/i, "限流"],
	[/TIMEOUT/i, "超时"],
	[/TRANSPORT|ECONNRESET|EOF/i, "网络错误"],
	[/SERVER|PI_AI_ERROR/i, "服务端错误"],
	[/AUTH|CREDENTIAL|ACCOUNT_|SIGN_IN/i, "鉴权失败"],
	[/QUOTA/i, "额度不足"],
	[/CONTENT_REFUSED|refusal/i, "内容被拒"],
	[/EMPTY_RESPONSE/i, "空响应"],
	[/MODEL_UNSUPPORTED|INVALID_MODEL|MODEL_DOES_NOT/i, "模型不可用"],
	[/INVALID_REQUEST|INVALID_RESPONSE|MALFORMED_RESPONSE/i, "请求或响应无效"]
];
function describeFailureCode(code) {
	for (const [pattern, label] of FAILURE_CATEGORIES) if (pattern.test(code)) return label;
	return code;
}
function clipMessage(text, max = 300) {
	const t = text.trim();
	return t.length > max ? `${t.slice(0, max)}…` : t;
}
/** Human-readable reason from the child's own request failures; the last one wins. */
function describeFailures(failures) {
	const last = failures[failures.length - 1];
	if (!last) return void 0;
	const category = describeFailureCode(last.code);
	const status = typeof last.status === "number" ? `（HTTP ${last.status}）` : "";
	const detail = clipMessage(last.message ?? "");
	return detail && detail !== category ? `${category}${status}：${detail}` : `${category}${status}`;
}
const STOP_REASON_LABELS = {
	error: "顾问运行出错",
	aborted: "顾问被中止",
	"max-tokens": "顾问输出达到 maxTokens 上限",
	refusal: "顾问拒绝回答"
};
function settleOutcome(input) {
	const { result, observation, abortedBy } = input;
	const text = (result ? contentText(result.output) : "") || observation.text.trim();
	const stopReason = result?.stopReason ?? observation.endInfo?.stopReason;
	if (abortedBy && text) return {
		ok: true,
		content: text,
		stopReason,
		truncated: true,
		failures: observation.failures
	};
	if (stopReason === "completed" && text && !abortedBy) return {
		ok: true,
		content: text,
		stopReason,
		truncated: false,
		failures: observation.failures
	};
	const stopLabel = stopReason ? STOP_REASON_LABELS[stopReason] ?? stopReason : void 0;
	const requestFailure = describeFailures(observation.failures);
	const timeoutLabel = abortedBy === "deadline" ? "超时：到点时尚未开始输出回答正文" : abortedBy === "idle" ? "超时：回答中断后长时间无新输出" : abortedBy === "hard-cap" ? "超时：超过总时长上限" : void 0;
	let reason;
	if (timeoutLabel) reason = requestFailure ? `${timeoutLabel}（最后一次请求错误：${requestFailure}）` : timeoutLabel;
	else if (stopReason === "completed") reason = "顾问正常结束但未返回任何内容（空响应）";
	else if (stopLabel && stopReason !== "error") reason = requestFailure ? `${stopLabel}（最后一次请求错误：${requestFailure}）` : stopLabel;
	else reason = requestFailure ?? stopLabel ?? "未知原因（顾问未返回内容）";
	if (/上下文超限/.test(reason)) reason += "。可在设置里调低抄本预算，或改用盲审模式并在 context 里只写要点";
	return {
		ok: false,
		content: text,
		stopReason,
		truncated: false,
		failure: reason,
		failures: observation.failures
	};
}
function hardCapOf(timeoutMs) {
	return Math.max(3 * timeoutMs, 6e5);
}
const sleep = (ms, signal) => new Promise((resolve, reject) => {
	if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
	const timer = setTimeout(() => {
		signal?.removeEventListener("abort", onAbort);
		resolve();
	}, Math.max(0, ms));
	const onAbort = () => {
		clearTimeout(timer);
		reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
	};
	signal?.addEventListener("abort", onAbort, { once: true });
});
/**
* Await `run` under the advisor timeout rule (design §6): the deadline is hard
* while the child has produced no answer text; once answer text exists the
* rule switches to an idle timer; a hard cap bounds the total. `abort` is
* invoked once and `run` is still awaited so the settled result (partial
* output) is available.
*/
async function waitWithTimeout(input) {
	const now = input.now ?? Date.now;
	const start = now();
	const deadline = start + input.policy.timeoutMs;
	const grace = input.policy.idleGraceMs ?? 3e4;
	const hardCap = start + (input.policy.hardCapMs ?? hardCapOf(input.policy.timeoutMs));
	let abortedBy;
	let abortedAt = 0;
	let settled;
	let rejected;
	input.run.then((value) => {
		settled = { value };
	}, (error) => {
		rejected = { error };
	});
	const abortNow = (reason) => {
		abortedBy = reason;
		abortedAt = now();
		input.abort(reason);
	};
	const wakeAt = (at) => sleep(Math.min(Math.max(0, at - now()), 1e3), input.signal);
	const wakeAtOrSettle = async (at) => {
		await Promise.race([wakeAt(at), input.run.then(() => void 0, () => void 0)]);
	};
	const cancelOnAbort = async (at) => {
		try {
			await wakeAtOrSettle(at);
		} catch (error) {
			abortedAt = now();
			input.abort("deadline");
			throw error;
		}
	};
	while (!settled && !rejected) {
		const t = now();
		if (abortedBy === void 0) {
			if (t >= hardCap) abortNow("hard-cap");
			else if (t >= deadline) {
				if (input.observation()?.answerTextStarted) {
					const idleAt = (input.observation()?.lastAnswerTextAt ?? t) + grace;
					if (t >= idleAt) abortNow("idle");
					else {
						await cancelOnAbort(Math.min(idleAt, hardCap));
						continue;
					}
				} else abortNow("deadline");
			} else {
				await cancelOnAbort(Math.min(deadline, hardCap));
				continue;
			}
		}
		try {
			await Promise.race([input.run, sleep(ABORT_SETTLE_GRACE_MS, input.signal)]);
		} catch (error) {
			if (!settled) throw error;
		}
		if (!settled && !rejected && now() - abortedAt >= 5e3) throw new Error(`顾问中止后 ${ABORT_SETTLE_GRACE_MS / 1e3} 秒内未结束`);
	}
	if (rejected) throw rejected.error;
	return {
		value: settled.value,
		abortedBy
	};
}
/** How long a disposed/interrupted child may take to settle before the wait gives up. */
const ABORT_SETTLE_GRACE_MS = 5e3;
// src/advisor/start.ts
/** The route the host itself uses when delegating: the session's current
*  request header, falling back to the agent's live options. */
function parentRouteOf(parent) {
	const header = parent.session?.requestHeader?.();
	const options = parent.options;
	return {
		provider: header?.config?.provider ?? options?.provider,
		model: header?.config?.model ?? options?.model
	};
}
/**
* Honor the Host's subagent model allowlist. The runtime itself does not
* enforce it (only the model-facing tool does), so the plugin checks it
* itself rather than quietly stepping over a setting the user made.
*/
function assertRouteAllowed(host, parent, entry) {
	const svc = host.optional("subagentModelSelection");
	if (!svc || typeof svc.allowedRoutes !== "function") return { ok: true };
	let routes;
	try {
		routes = svc.allowedRoutes();
	} catch (error) {
		return {
			ok: false,
			kind: "authorization",
			message: `DSH 的「子代理模型选择」设置无效（${error instanceof Error ? error.message : String(error)}）。请到 设置 → 插件 → 子代理 修正后重试。`
		};
	}
	const route = `${entry.provider}/${entry.model}`;
	if (routes === void 0) {
		const parentRoute = parentRouteOf(parent);
		if (parentRoute.provider === entry.provider && parentRoute.model === entry.model) return { ok: true };
		return {
			ok: false,
			kind: "authorization",
			message: `DSH 的「子代理模型选择」当前是关闭的，顾问无法使用与主对话不同的模型（${route}）。请到 设置 → 顾问设置 点击「开启并授权」。`
		};
	}
	if (routes.some((r) => r.provider === entry.provider && r.model === entry.model)) return { ok: true };
	return {
		ok: false,
		kind: "authorization",
		message: `模型 ${route} 尚未授权给子代理。请到 设置 → 顾问设置 点击「授权」，或在 设置 → 插件 → 子代理 的模型白名单里添加它。`
	};
}
/**
* Validate the entry's route against the live model catalog. A reasoning
* effort the model does not declare is dropped (and reported) instead of
* letting the adapter reject the whole call.
*/
async function resolveEntryOptions(host, entry) {
	let info;
	try {
		info = await host.llm.resolveModelInfo(entry.provider, entry.model);
	} catch (error) {
		return {
			ok: false,
			kind: "model",
			message: `模型路由不可用（${entry.provider}/${entry.model}）：${error instanceof Error ? error.message : String(error)}`
		};
	}
	const efforts = (info?.reasoning?.efforts ?? []).map((e) => String(e.id));
	const effortIgnored = entry.reasoningEffort !== void 0 && !efforts.includes(entry.reasoningEffort);
	return {
		ok: true,
		agentOptions: {
			provider: entry.provider,
			model: entry.model,
			...entry.reasoningEffort && !effortIgnored ? { reasoningEffort: entry.reasoningEffort } : {},
			...entry.maxTokens !== void 0 ? { maxTokens: entry.maxTokens } : {}
		},
		effortIgnored
	};
}
/** Start one advisor child under `parent` as a read-only spawn with caller delivery. */
async function startAdvisor(host, registry, input) {
	const parent = input.parent;
	const parentId = String(parent.id);
	const route = assertRouteAllowed(host, parent, input.entry);
	if (!route.ok) return route;
	const options = await resolveEntryOptions(host, input.entry);
	if (!options.ok) return options;
	registry.notePendingStart(parentId);
	let activation;
	try {
		activation = await host.subagents.startActivation({
			provider: "spawn",
			label: advisorLabel(input.entryLabel),
			prompt: [{
				type: "text",
				text: input.promptText
			}],
			parent,
			signal: input.signal,
			delivery: "caller",
			agentOptions: options.agentOptions,
			maxDepth: registry.depthOf(parent) + 1
		});
	} catch (error) {
		const classified = classifySubagentError(error);
		return {
			ok: false,
			kind: classified.kind,
			message: `无法启动顾问（${input.entryLabel}）：${classified.message}`
		};
	} finally {
		registry.clearPendingStart(parentId);
	}
	const childId = String(activation.childId);
	const record = registry.record({
		childId,
		parentSessionId: parentId,
		consultId: input.consultId,
		label: advisorLabel(input.entryLabel),
		provider: input.entry.provider,
		model: input.entry.model
	});
	const observation = registry.observation(childId);
	if (record.sandbox === "failed" || !observation) {
		await activation.dispose().catch(() => {});
		return {
			ok: false,
			kind: "infrastructure",
			message: record.sandbox === "failed" ? "无法把顾问限制在只读沙箱内，已中止本次咨询。" : "未能确认顾问子代理的身份（宿主未提供子代理描述符），已中止本次咨询。"
		};
	}
	return {
		ok: true,
		activation,
		observation,
		record,
		effortIgnored: options.effortIgnored
	};
}
// src/advisor/followup.ts
function threadFactsFromEvents(events) {
	let descriptor;
	try {
		descriptor = foldSubagentDescriptor(events);
	} catch {
		return;
	}
	if (!descriptor) return void 0;
	const userMessages = events.filter((e) => e.type === "user/message").length;
	return {
		label: descriptor.label,
		provider: "agentProvider" in descriptor ? descriptor.agentProvider : void 0,
		model: "agentModel" in descriptor ? descriptor.agentModel : void 0,
		followUps: Math.max(0, userMessages - 1)
	};
}
function eventsOf(host, childId) {
	const live = host.agents.get(childId);
	if (live) try {
		return {
			events: live.session.snapshotEvents(),
			live: true
		};
	} catch {
		return;
	}
}
async function coldEvents(host, childId) {
	const query = host.optional("sessionQuery");
	if (!query || typeof query.readSession !== "function") return void 0;
	try {
		return (await query.readSession(childId)).events;
	} catch {
		return;
	}
}
/** Validate the thread, count rounds, deliver the follow-up to the existing advisor child. */
async function beginFollowUp(host, registry, input) {
	const childId = input.consultId;
	const live = eventsOf(host, childId);
	const events = live?.events ?? await coldEvents(host, childId);
	if (!events) return {
		ok: false,
		kind: "other",
		message: "未找到该 consult_id 对应的咨询记录（可能属于旧版本、其他会话，或记录已不存在）。请开新咨询。"
	};
	const facts = threadFactsFromEvents(events);
	if (!facts || typeof facts.label !== "string" || !facts.label.startsWith("second-opinion:")) return {
		ok: false,
		kind: "other",
		message: "该 consult_id 不是本插件建立的咨询线程（旧版本的 consult_id 不再支持）。请开新咨询。"
	};
	let record = registry.get(childId);
	if (!record) record = registry.record({
		childId,
		parentSessionId: String(input.parent.id),
		consultId: childId,
		label: facts.label,
		provider: facts.provider ?? "",
		model: facts.model ?? ""
	});
	const observation = registry.observation(childId);
	const liveAgent = live ? host.agents.get(childId) : void 0;
	if (liveAgent && (liveAgent.status !== "idle" || observation && observation.turnEnds === 0 && !observation.ended)) return {
		ok: false,
		kind: "other",
		message: "顾问仍在回答，请等它完成后再追问。"
	};
	if (record.dual) return {
		ok: false,
		kind: "other",
		message: "双意见咨询不支持追问；请基于单一模型开新咨询。"
	};
	const round = facts.followUps + 1;
	if (round > input.maxRounds) return {
		ok: false,
		kind: "other",
		message: `该咨询线程已达 ${input.maxRounds} 轮追问上限，请开新咨询。`
	};
	const gate = live && observation ? {
		minEpoch: record.epoch,
		minTurnEnds: observation.turnEnds + 1
	} : {
		minEpoch: record.epoch + 1,
		minTurnEnds: 1
	};
	try {
		await host.subagents.sendMessage(input.parent, childId, [{
			type: "text",
			text: buildFollowUpMessage(input.followUp, round)
		}], { signal: input.signal });
	} catch (error) {
		const classified = classifySubagentError(error);
		if (classified.code === "UNAUTHORIZED") return {
			ok: false,
			kind: "authorization",
			message: "该咨询属于另一个会话（会话被 fork 后旧线程不在当前子代理树中），无法追问。请开新咨询。"
		};
		return {
			ok: false,
			kind: classified.kind,
			message: `追问发送失败：${classified.message}`
		};
	}
	return {
		ok: true,
		childId,
		round,
		gate,
		fromSeq: events.length
	};
}
/** Wait for the follow-up turn under the timeout rule and read the child's answer. */
async function finishFollowUp(host, registry, begin, policy, parent, signal) {
	const { childId } = begin;
	const turnDone = registry.waitForTurnEnd(childId, begin.gate, signal);
	const interrupt = () => {
		try {
			host.subagents.interrupt(childId, {
				kind: "ancestor",
				agent: parent
			});
		} catch {}
	};
	const onAbort = () => interrupt();
	signal.addEventListener("abort", onAbort, { once: true });
	let abortedBy;
	try {
		abortedBy = (await waitWithTimeout({
			run: turnDone,
			observation: () => registry.observation(childId),
			policy,
			abort: interrupt,
			signal
		})).abortedBy;
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
	const observation = registry.observation(childId);
	const live = host.agents.get(childId);
	let text = "";
	if (live) try {
		text = contentText(finalAssistantOutput(live.session.snapshotEvents().slice(begin.fromSeq)));
	} catch {
		text = "";
	}
	else if (observation?.endInfo) text = contentText(observation.endInfo.lastAssistantMessage);
	const outcome = settleOutcome({
		observation: observation ?? {
			childId,
			failures: [],
			answerTextStarted: false,
			lastAnswerTextAt: 0,
			text,
			toolCalls: 0,
			turnEnds: 0,
			onTurnEnd: () => () => {},
			ended: true,
			dispose: () => {}
		},
		abortedBy
	});
	if (!abortedBy && text && !outcome.ok) return {
		...outcome,
		ok: true,
		content: text,
		failure: void 0
	};
	return outcome;
}
// src/tool.ts
/** Refusals carry a `kind`; outcomes never do (their optional `failure` is absent on success). */
const isRefusal = (r) => "kind" in r && typeof r.kind === "string";
const TOOL_NAME = "second_opinion";
const HINT_FOLLOWUP = (consultId) => `\n\n（consult_id: ${consultId} —— 如需继续追问该顾问，携带此 consult_id 与 follow_up 参数再次调用。追问结果以本次工具返回为准；宿主随后可能在对话里投递一条内容相同的子代理完成通知，忽略即可。）`;
const HINT_DUAL = "\n\n（双意见咨询不支持追问；如需追问请基于单一模型开新咨询。）";
function textOfAdvice(value) {
	const notes = value.notes.length ? `\n\n（注：${value.notes.join("；")}）` : "";
	return value.advice + notes + (value.consultId ? value.dual ? HINT_DUAL : HINT_FOLLOWUP(value.consultId) : "");
}
function clipForMeta(text, max = 2e3) {
	if (typeof text !== "string") return void 0;
	return text.length > max ? `${text.slice(0, max)}…` : text;
}
function createSecondOpinionTool(deps) {
	const log = deps.log ?? noopLogger;
	return defineTool({
		name: TOOL_NAME,
		description: "向配置的顾问模型链征求第二意见。顾问是一位只读的子代理：可以读文件、跑只读命令核实，但不能修改任何东西，回答只交给你。默认继承模式：顾问会收到当前会话的有界文本抄本（工具输出可能被截断、更早消息可能被省略），不要在问题中复述背景；问题若依赖对话外的信息（你的意图、没说出口的约束、被省略的早期细节）写进 context，若依赖某个大文件或长输出就给出路径让顾问自己去读。盲审模式（mode=standalone）：顾问看不到对话，务必在 context 里写清目标、约束、已尝试的做法和相关文件路径。支持追问（consult_id + follow_up，顾问说缺信息时也可这样补充）、双意见对比（dual_opinions，并行咨询链上前两位顾问）。适用于重大方案决策前的复核、高风险判断、对自己结论把握不足、或同一问题连续受阻时；用户明确要求咨询顾问时也调用。",
		parameters: {
			question: {
				type: "string",
				description: "新咨询的问题，例如「方案 A 在 X 约束下是否成立」。与 consult_id 二选一：提供 consult_id 时改用 follow_up。"
			},
			context: {
				type: "string",
				description: "可选。对话记录里不存在的信息：你的私有推理意图、未说出口的约束、被抄本省略的早期要点。盲审模式下必须写清目标、约束、已尝试的做法和相关文件路径。"
			},
			mode: {
				type: "string",
				description: "可选，按次覆盖默认咨询模式。inherited：顾问获得会话抄本（默认）；standalone：盲审——顾问不看对话，只依据问题与 context 独立判断，适合需要不受主对话思路影响的场景。"
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
				description: "可选。true 时并行咨询链上前两位顾问（互不可见对方；链上仅一个模型时，同一模型独立咨询两次），返回两份独立意见；不支持追问。"
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
					truncated: { type: "boolean" },
					round: { type: "number" },
					attempts: {
						type: "array",
						items: {
							type: "object",
							additionalProperties: false,
							properties: {
								label: {
									type: "string",
									required: true
								},
								ok: {
									type: "boolean",
									required: true
								},
								reason: { type: "string" }
							}
						}
					},
					notes: {
						type: "array",
						items: { type: "string" }
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: textOfAdvice(value)
			}],
			presentationMeta: (args, value) => {
				const a = args ?? {};
				const v = value;
				const meta = {
					kind: "second-opinion",
					model: v.model,
					consultId: v.consultId,
					dual: v.dual,
					truncated: v.truncated,
					attempts: v.attempts,
					notes: v.notes
				};
				const optional = {
					question: clipForMeta(a.question),
					context: clipForMeta(a.context),
					mode: typeof a.mode === "string" ? a.mode : void 0,
					followUp: clipForMeta(a.follow_up),
					round: v.round
				};
				for (const [key, val] of Object.entries(optional)) if (val !== void 0) meta[key] = val;
				return meta;
			}
		},
		async execute(args, exec) {
			const cfg = deps.getConfig();
			const fail = (advice) => ({
				advice,
				model: "",
				consultId: "",
				dual: false,
				truncated: false,
				attempts: [],
				notes: []
			});
			if (!cfg.enabled) return fail("Second Opinion 当前已停用（设置中可开启）。");
			if (cfg.chain.length === 0) return fail("顾问链尚未配置任何模型。请先到 设置 → 顾问设置 添加顾问模型。");
			const parent = exec.agent;
			if (!parent) return fail("当前执行环境没有会话上下文，无法咨询顾问。");
			if (deps.registry.isAdvisor(String(parent.id)) || isAdvisorChild(parent)) return fail("你已经是顾问子代理：顾问不能再咨询 second_opinion，直接给出你的意见即可。");
			if (args.consult_id) {
				if (args.dual_opinions) return fail("双意见咨询不支持追问；请基于单一模型开新咨询。");
				if (typeof args.follow_up !== "string" || !args.follow_up.trim()) return fail("追问需要提供 follow_up 参数（要继续追问的内容）。");
				const begin = await beginFollowUp(deps.host, deps.registry, {
					parent,
					signal: exec.signal,
					consultId: args.consult_id,
					followUp: args.follow_up,
					maxRounds: cfg.followup.maxRounds
				});
				if (!begin.ok) return {
					...fail(begin.message),
					consultId: args.consult_id
				};
				const record = deps.registry.get(args.consult_id);
				const entryTimeout = record ? cfg.chain.find((e) => e.provider === record.provider && e.model === record.model)?.timeoutMs : void 0;
				const outcome = await finishFollowUp(deps.host, deps.registry, begin, { timeoutMs: entryTimeout ?? cfg.limits.defaultTimeoutMs }, parent, exec.signal);
				const attempts = [{
					label: "追问",
					ok: outcome.ok,
					...outcome.failure ? { reason: outcome.failure } : {}
				}];
				if (!outcome.ok) return {
					advice: `顾问本轮未返回可用回答：${outcome.failure}。可换个问法追问或开新咨询。`,
					model: "",
					consultId: args.consult_id,
					dual: false,
					truncated: false,
					attempts,
					notes: [],
					round: begin.round
				};
				const notes = outcome.truncated ? ["本轮追问超时被中止，以上为已输出的部分回答"] : [];
				return {
					advice: outcome.content,
					model: entryLabelOf(deps, args.consult_id),
					consultId: args.consult_id,
					dual: false,
					truncated: outcome.truncated,
					attempts,
					notes,
					round: begin.round
				};
			}
			if (typeof args.question !== "string" || !args.question.trim()) return fail("缺少 question 参数：请提供要征求第二意见的具体问题（或提供 consult_id + follow_up 进行追问）。");
			const question = args.question.trim();
			const mode = args.mode === "standalone" ? "standalone" : args.mode === "inherited" ? "inherited" : cfg.contextMode;
			const notes = [];
			const promptText = buildPromptText(deps, parent, cfg, mode, question, args.context, notes);
			const live = [];
			const runEntry = async (entry, prompt) => {
				const label = entryName(entry);
				const started = await startAdvisor(deps.host, deps.registry, {
					parent,
					signal: exec.signal,
					entry,
					entryLabel: label,
					promptText: prompt,
					consultId: "",
					mode
				});
				if (!started.ok) return started;
				live.push(started.activation);
				if (started.effortIgnored) notes.push(`推理档位「${entry.reasoningEffort}」未被模型 ${entry.provider}/${entry.model} 声明，已忽略`);
				const childId = String(started.activation.childId);
				try {
					const { value, abortedBy } = await waitWithTimeout({
						run: started.activation.result,
						observation: () => deps.registry.observation(childId) ?? started.observation,
						policy: { timeoutMs: entry.timeoutMs ?? cfg.limits.defaultTimeoutMs },
						abort: () => void started.activation.dispose().catch(() => {}),
						signal: exec.signal
					});
					const outcome = settleOutcome({
						result: value,
						observation: deps.registry.observation(childId) ?? started.observation,
						abortedBy
					});
					if (outcome.ok && outcome.truncated) notes.push(`${label}：超时后按已输出内容截断`);
					return {
						...outcome,
						childId
					};
				} catch (error) {
					if (exec.signal.aborted) throw error;
					const classified = classifySubagentError(error);
					return {
						ok: false,
						kind: classified.kind,
						message: `顾问运行中断（${label}）：${classified.message}`
					};
				} finally {
					live.splice(live.indexOf(started.activation), 1);
					started.observation.text = "";
				}
			};
			const isRun = (r) => !isRefusal(r);
			try {
				if (args.dual_opinions) {
					const pair = cfg.chain.slice(0, 2);
					if (pair.length === 1) pair.push(pair[0]);
					const results = await Promise.all(pair.map((entry) => runEntry(entry, promptText)));
					const sections = [];
					const models = [];
					const attempts = [];
					let anyTruncated = false;
					results.forEach((result, i) => {
						const label = entryName(pair[i]);
						if (!isRefusal(result) && result.ok && result.content.trim()) {
							models.push(`${pair[i].provider}/${pair[i].model}`);
							attempts.push({
								label,
								ok: true
							});
							if (result.truncated) anyTruncated = true;
							sections.push(`【意见一/二 · ${label}${result.truncated ? " · 已截断" : ""}】\n${result.content}`);
						} else {
							const reason = isRefusal(result) ? result.message : result.failure ?? "未返回可用内容";
							attempts.push({
								label,
								ok: false,
								reason
							});
							sections.push(`【意见一/二 · ${label}】本次未返回可用内容：${reason}`);
						}
					});
					const okCount = attempts.filter((a) => a.ok).length;
					if (okCount === 0) {
						const hardStop = results.find((r) => isRefusal(r));
						return {
							...fail(`双意见咨询全部失败：${attempts.filter((a) => !a.ok).map((a) => `${a.label}（${a.reason}）`).join("；")}。${hardStop && isRefusal(hardStop) ? hardStop.message : "请基于自己的判断继续。"}`),
							consultId: "",
							dual: true,
							attempts,
							notes
						};
					}
					const failedNote = okCount < attempts.length ? "（注：部分顾问未返回可用内容，本次仅包含成功返回的意见。）" : "";
					const firstChild = results.filter(isRun).find((r) => r.ok)?.childId ?? "";
					for (const r of results.filter(isRun)) if (r.ok) deps.registry.record({
						childId: r.childId,
						parentSessionId: String(parent.id),
						consultId: r.childId,
						label: "second-opinion:dual",
						provider: "",
						model: "",
						dual: true
					});
					return {
						advice: sections.join("\n\n———\n\n") + failedNote,
						model: models.join(" + "),
						consultId: firstChild,
						dual: true,
						truncated: anyTruncated,
						attempts,
						notes
					};
				}
				const attempts = [];
				for (const entry of cfg.chain) {
					const label = entryName(entry);
					const result = await runEntry(entry, promptText);
					if (!isRefusal(result) && result.ok) {
						attempts.push({
							label,
							ok: true
						});
						deps.registry.record({
							childId: result.childId,
							parentSessionId: String(parent.id),
							consultId: result.childId,
							label: ADVISOR_LABEL_PREFIX + label,
							provider: entry.provider,
							model: entry.model
						});
						return {
							advice: result.content,
							model: `${entry.provider}/${entry.model}`,
							consultId: result.childId,
							dual: false,
							truncated: result.truncated,
							attempts,
							notes
						};
					}
					if (isRefusal(result)) {
						attempts.push({
							label,
							ok: false,
							reason: result.message
						});
						return {
							...fail(result.message),
							consultId: "",
							dual: false,
							attempts,
							notes
						};
					}
					attempts.push({
						label,
						ok: false,
						reason: result.failure
					});
					log(`advisor: ${label} failed: ${result.failure}`);
				}
				return {
					...fail(`顾问链全部调用失败：${attempts.map((a) => `${a.label}（${a.reason}）`).join("；")}。请基于自己的判断继续，或稍后重试。`),
					consultId: "",
					dual: false,
					attempts,
					notes
				};
			} catch (error) {
				await Promise.allSettled(live.map((a) => a.dispose()));
				throw error;
			} finally {
				if (exec.signal.aborted) await Promise.allSettled(live.map((a) => a.dispose()));
			}
		}
	});
}
function buildPromptText(deps, parent, cfg, mode, question, context, notes) {
	if (mode === "standalone") return buildAdvisorPrompt({
		mode,
		advisorPrompt: cfg.advisorPrompt,
		question,
		context
	});
	let history = [];
	try {
		history = parent.session.deriveMessages();
	} catch (error) {
		deps.log?.(`advisor: deriveMessages failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	const transcript = buildTranscript(history, {
		maxChars: cfg.limits.transcriptMaxChars,
		perEntryMaxChars: cfg.limits.perEntryMaxChars,
		excludeToolName: TOOL_NAME
	});
	if (transcript.droppedCount > 0) notes.push(`抄本省略了更早的 ${transcript.droppedCount} 条消息（已附最初请求摘要）`);
	if (transcript.clippedCount > 0) notes.push(`${transcript.clippedCount} 条内容因过长被截断，顾问看到的工具输出可能不完整`);
	return buildAdvisorPrompt({
		mode,
		advisorPrompt: cfg.advisorPrompt,
		question,
		context,
		transcriptText: transcript.text,
		transcriptDropped: transcript.droppedCount,
		transcriptClipped: transcript.clippedCount
	});
}
function entryLabelOf(deps, childId) {
	const record = deps.registry.get(childId);
	return record?.provider && record?.model ? `${record.provider}/${record.model}` : "顾问";
}
function isAdvisorChild(agent) {
	try {
		const descriptor = foldSubagentDescriptor(agent.session.snapshotEvents());
		return typeof descriptor?.label === "string" && descriptor.label.startsWith("second-opinion:");
	} catch {
		return false;
	}
}
// src/legacy/shim.ts
/**
* Legacy READ shim.
*
* Versions up to 0.3.9 wrote `advisor/*` events into the parent session log
* for the chat card. The persistence read path refuses to reconstruct a log
* that contains an unknown, non-ignorable event type, so those sessions open
* only while some plugin registers the types. 0.3.10 never writes them — it
* only keeps old sessions openable, and it never throws: a frozen, renamed,
* or missing Set must not keep the plugin itself from loading (which would
* leave the same sessions unopenable anyway).
*
* Exit path: once a repair tool has rewritten the legacy events as ignorable
* records, this shim can be removed.
*/
const LEGACY_ADVISOR_EVENT_TYPES = [
	"advisor/start",
	"advisor/delta",
	"advisor/message",
	"advisor/end",
	"advisor/followup"
];
function installLegacyShim(known = KNOWN_SESSION_EVENT_TYPES, log = () => {}) {
	try {
		const set = known;
		if (!set || typeof set.add !== "function") {
			log("advisor: KNOWN_SESSION_EVENT_TYPES is not a mutable Set; sessions written by versions <= 0.3.9 may not open");
			return false;
		}
		if (Object.isFrozen(set)) {
			log("advisor: KNOWN_SESSION_EVENT_TYPES is frozen; sessions written by versions <= 0.3.9 may not open");
			return false;
		}
		for (const type of LEGACY_ADVISOR_EVENT_TYPES) set.add(type);
		return true;
	} catch (error) {
		log(`advisor: legacy event shim failed: ${error instanceof Error ? error.message : String(error)}`);
		return false;
	}
}
// src/index.ts
const name = "dsh-advisor-chain";
/** `subagents` and `agents` run the advisor; `llm` validates routes and efforts.
*  Optional services (sandbox policy, model allowlist, session query) are read
*  through `ctx.get` so a host without them degrades instead of failing. */
const inject = [
	"tools",
	"llm",
	"subagents",
	"agents",
	"systemPrompt"
];
function makeLogger(ctx) {
	const named = typeof ctx.logger === "function" ? ctx.logger("dsh-advisor-chain") : void 0;
	if (named) return (message) => named.info(message);
	return (message) => console.info(`[dsh-advisor-chain] ${message}`);
}
function apply(ctx, _config) {
	const liveConfig = () => normalizeConfig(ctx.fiber.config);
	const log = makeLogger(ctx);
	installLegacyShim(void 0, log);
	const pressure = new RepeatPressureTracker();
	ctx.on("session/event", (session, event) => pressure.handleEvent(session?.id ?? "", event));
	const host = {
		subagents: ctx.subagents,
		agents: ctx.agents,
		llm: ctx.llm,
		optional: (name) => ctx.get?.(name),
		on: ((name, listener) => ctx.on(name, listener))
	};
	const registry = new AdvisorRegistry({
		host,
		sandbox: {
			setSandboxMode: (session, mode) => setSandboxMode(session, mode),
			overrideOf: (session) => ctx.sandboxPolicy?.overrideOf(session)
		},
		log
	});
	ctx.effect(() => registry.install(), "dsh-advisor-chain: advisor child watcher");
	ctx.effect(() => ctx.tools.register(createSecondOpinionTool({
		host,
		registry,
		getConfig: liveConfig,
		log
	})), "dsh-advisor-chain: second_opinion tool");
	const systemPrompt = ctx.systemPrompt ?? (typeof ctx.get === "function" ? ctx.get("systemPrompt") : void 0);
	if (systemPrompt) ctx.effect(() => systemPrompt.section({
		name: "dsh-advisor-chain-boundary",
		order: 151,
		text: (assembly) => {
			const cfg = liveConfig();
			return buildSectionText(cfg, pressure.get(assembly?.session?.id), cfg.trigger.repeatThreshold);
		}
	}), "dsh-advisor-chain: system prompt section");
	if (typeof ctx.inject === "function") ctx.inject(["settings"], (scoped) => {
		const dispose = scoped.settings.configure({ auto: false }, ctx.fiber);
		return () => {
			if (typeof dispose === "function") dispose();
		};
	});
}
export { Config, apply, inject, name };
