import { SubagentError, delegationDepthOf, finalAssistantOutput, foldSubagentDescriptor } from "@deepseek-ai/dsh-subagent";
import { setSandboxMode } from "@deepseek-ai/dsh-sandbox-policy";
import Schema from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
// src/advisor/preset.ts
/**
* The advisor preset: a lean agent composition for advisor children.
*
* A spawned child otherwise inherits the parent agent's whole composition —
* the full system prompt (skill catalog, every tool's guidance, our own
* usage-boundary section) plus every tool schema, including host-level MCP
* tools. On the maintainer's machine that costs about 48k input tokens per
* consultation before a single word of transcript. The preset mounts, by
* package name (so plugins that rewrite the shipped presets, such as
* dsh-ops, cannot affect it):
*
* - `tool-fs` with only `read` / `read_image` (write / edit / apply_patch off),
* - `tool-fs-search` (grep / glob),
* - the platform shell (`pwsh` / `bash`) for read-only commands,
* - this plugin in `presetRole`, which masks every host-level tool with a
*   `ToolRestriction` deny list (see `applyAdvisorToolMask`), so the advisor
*   sees exactly what the preset mounts.
*
* The system prompt is then just those tools' guidance plus our preamble. If
* the preset cannot be activated (packages renamed in a future host, …) the
* consultation falls back to the inherited composition and says so.
*/
/** This package's name, as the preset row mounts it; `tests/preset.test.ts` pins it to the entry's `name`. */
const PLUGIN_NAME = "dsh-advisor-chain";
const ADVISOR_PRESET_ID = "dsh-advisor-chain-advisor";
function advisorPresetDefinition(platform = process.platform) {
	return {
		id: ADVISOR_PRESET_ID,
		name: "Second Opinion advisor",
		description: "Read-only advisor composition: read / grep / glob / shell, nothing inherited.",
		order: 1e3,
		plugins: [
			{
				id: "tool-fs",
				name: "@deepseek-ai/dsh-tool-fs",
				config: {
					read: true,
					readImage: true,
					write: false,
					edit: false,
					applyPatch: false
				}
			},
			{
				id: "tool-fs-search",
				name: "@deepseek-ai/dsh-tool-fs-search",
				config: { sampleOverCapGlobResults: false }
			},
			{
				id: "tool-pwsh",
				name: "@deepseek-ai/dsh-tool-pwsh",
				disabled: platform !== "win32"
			},
			{
				id: "tool-bash",
				name: "@deepseek-ai/dsh-tool-bash",
				disabled: platform === "win32"
			},
			{
				id: "advisor-composition",
				name: PLUGIN_NAME,
				config: { presetRole: true }
			}
		]
	};
}
/** Register the preset; resolves to its disposer, or undefined (after logging) when registration failed. */
async function registerAdvisorPreset(registry, log) {
	try {
		const dispose = await registry.register(advisorPresetDefinition());
		log(`advisor preset registered (${ADVISOR_PRESET_ID})`);
		return dispose;
	} catch (error) {
		log(`advisor preset registration failed: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
}
/** Confirm the preset is mounted and healthy before handing it to `startActivation`. */
async function checkAdvisorPreset(registry, log) {
	if (!registry || typeof registry.resolve !== "function") return {
		ok: false,
		reason: "unavailable"
	};
	try {
		const resolved = await registry.resolve(ADVISOR_PRESET_ID);
		if (resolved.broken) return {
			ok: false,
			reason: resolved.broken
		};
		return {
			ok: true,
			preset: ADVISOR_PRESET_ID
		};
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
/** Name the registry reserves for the PTC transport; it cannot be named in a restriction. */
const RESERVED_TOOL_NAMES = /* @__PURE__ */ new Set(["run_code"]);
/**
* Keep every host-level (global) tool out of the advisor's view.
*
* The advisor agent sees its own (empty) layer plus the preset layer, where
* the read-only tools and this restriction both live; an `allow` list cannot
* name the preset's own tools (scope-local names are rejected), so the mask
* is a `deny` list of the global layer — MCP tools, second_opinion, plugin
* managers, … — recomputed whenever the registry changes, because MCP tools
* may register after this plugin activates. Returns the current state for
* diagnostics.
*/
function applyAdvisorToolMask(tools, onChange = () => {}) {
	let lift;
	let denied = [];
	const apply = () => {
		const names = Array.from(new Set(tools.definitions().map((d) => d.name))).filter((name) => !RESERVED_TOOL_NAMES.has(name)).sort();
		if (names.join("\n") === denied.join("\n")) return { denied };
		lift?.();
		lift = void 0;
		denied = names;
		if (names.length > 0) lift = tools.restrict({ deny: names });
		return { denied };
	};
	const unsubscribe = onChange(apply);
	apply();
	return {
		state: () => ({ denied }),
		dispose: () => {
			typeof unsubscribe === "function" && unsubscribe();
			lift?.();
			lift = void 0;
		}
	};
}
// src/advisor/eventlog.ts
var SessionEventLog = class {
	maxSessions;
	headKeep;
	tailKeep;
	sessions = /* @__PURE__ */ new Map();
	constructor(maxSessions = 48, headKeep = 32, tailKeep = 400) {
		this.maxSessions = maxSessions;
		this.headKeep = headKeep;
		this.tailKeep = tailKeep;
	}
	/** Record one appended event; unknown shapes and missing ids are ignored. */
	handleEvent(sessionId, event) {
		if (!sessionId || !event || typeof event !== "object") return;
		let tracked = this.sessions.get(sessionId);
		if (tracked) this.sessions.delete(sessionId);
		else tracked = {
			head: [],
			tail: [],
			total: 0
		};
		this.sessions.set(sessionId, tracked);
		tracked.total += 1;
		if (tracked.head.length < this.headKeep) tracked.head.push(event);
		else {
			tracked.tail.push(event);
			if (tracked.tail.length > this.tailKeep) tracked.tail.shift();
		}
		while (this.sessions.size > this.maxSessions) {
			const oldest = this.sessions.keys().next().value;
			if (oldest === void 0) break;
			this.sessions.delete(oldest);
		}
	}
	/** Whether anything was tracked for this session. */
	has(sessionId) {
		return this.sessions.has(sessionId);
	}
	/** Tracked events in log order; undefined when nothing was tracked. */
	eventsOf(sessionId) {
		const tracked = this.sessions.get(sessionId);
		if (!tracked) return void 0;
		return tracked.tail.length === 0 ? tracked.head : [...tracked.head, ...tracked.tail];
	}
	/** True when the tracked events are the complete log (no gap). */
	isComplete(sessionId) {
		const tracked = this.sessions.get(sessionId);
		if (!tracked) return false;
		return tracked.total === tracked.head.length + tracked.tail.length;
	}
	/** The subagent descriptor folded from the tracked head, when there is one. */
	descriptorOf(sessionId) {
		const events = this.eventsOf(sessionId);
		if (!events || events.length === 0) return void 0;
		try {
			return foldSubagentDescriptor(events);
		} catch {
			return;
		}
	}
	/** Mode of the last tracked `sandbox/mode` event. */
	lastModeOf(sessionId) {
		const events = this.eventsOf(sessionId);
		if (!events) return void 0;
		for (let i = events.length - 1; i >= 0; i--) {
			const event = events[i];
			if (event?.type === "sandbox/mode") {
				const mode = event.data?.mode;
				return typeof mode === "string" ? mode : void 0;
			}
		}
	}
	/** Tracked events at or after a log sequence number. */
	since(sessionId, fromSeq) {
		return (this.eventsOf(sessionId) ?? []).filter((event) => (typeof event.seq === "number" ? event.seq : 0) >= fromSeq);
	}
	/** Drop every tracked session (tests, teardown). */
	clear() {
		this.sessions.clear();
	}
};
// src/config.ts
/**
* Chain-level advisor persona, edited by the user. The default persona lives
* in `src/i18n.ts` and is chosen per call by language; an empty value here
* means "use the default" (older installs that never saved a prompt).
*/
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
	advisorPrompt: Schema.string().default("").volatile().description("顾问的回答要求（整条链共用）；留空则按语言使用内置默认。"),
	advisorComposition: Schema.union([Schema.const("lean"), Schema.const("inherit")]).default("lean").volatile().description("顾问子代理的组成：lean 挂载精简的只读工具集（read / grep / glob / 只读命令），输入更小；inherit 继承主对话的全部工具与提示。精简组成不可用时自动回退为 inherit。"),
	/** True when this instance is mounted inside the advisor preset (see `src/advisor/preset.ts`): it then only applies the tool allow-list. */
	presetRole: Schema.boolean().default(false),
	chain: Schema.array(ChainEntryConfig).default([]).volatile().description("顾问模型链，按顺序尝试；前面的失败时顺延到下一个。"),
	followup: FollowupConfig.volatile(),
	/** Set once the user dismissed the one-time legacy-sessions banner. */
	legacyNoticeDismissed: Schema.boolean().default(false).volatile(),
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
		advisorPrompt: typeof cfg.advisorPrompt === "string" ? cfg.advisorPrompt.trim() : "",
		advisorComposition: cfg.advisorComposition === "inherit" ? "inherit" : "lean",
		presetRole: cfg.presetRole === true,
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
const HOST_MESSAGES = {
	zh: {
		"prompt.header": "## Second Opinion（第二意见）使用边界",
		"prompt.manual": "second_opinion 向只读的顾问子代理征求第二意见，顾问会收到当前会话的有界抄本。当前为手动模式：仅当用户明确要求咨询顾问（如“问一下顾问”“征求第二意见”）时才调用，平时自行作答；用户要求时相关问题合并为一次咨询。",
		"prompt.autoIntro": "second_opinion 向只读的顾问子代理征求第二意见：顾问能读文件、跑只读命令核实，但改不了任何东西，回答只交给你。默认继承模式下顾问收到当前会话的有界文本抄本（工具输出可能被截断、更早消息可能被省略），调用时只提具体问题，不要复述对话已有的内容；问题依赖某个大文件或长输出时给出路径让顾问自己去读；对话外的私有信息（你的推理意图、没说出口的约束、被省略的早期要点）写入 context 参数。盲审模式（mode=standalone）下顾问看不到对话，必须在 context 里写清目标、约束、已尝试的做法和相关文件路径。",
		"prompt.rule1": "1. 调用判据（满足其一才调用）：此步出错代价高（安全、数据、架构承诺、不可逆操作、对外承诺）；重大方案定稿或重大交付前需要终审；已连续受阻或对结论把握不足。后果可逆的小改动直接做，简单任务不要机械调用。",
		"prompt.rule2": "2. 不适合：可直接联网查证的简单事实；日常闲聊、纯创意任务。",
		"prompt.rule3": "3. 用户明确要求咨询顾问时必须调用；相关问题合并为一次咨询，不要拆成多次。",
		"prompt.rule4": "4. 顾问指出具体缺陷时先验证再决定；纯观点分歧则吸收后继续，不要反复咨询寻求认同，不采纳时说明理由；不要原样转贴整段顾问回复。顾问说缺少信息时，带着补充后的 context 重新调用，或用 consult_id + follow_up 追问。",
		"prompt.rule5": "5. 追问的结果以工具返回为准；宿主随后可能在对话里投递一条内容相同的子代理完成通知，忽略即可。",
		"prompt.forced": "【强制咨询】当前会话中同一问题已被用户重复 {count} 次仍未解决。本轮必须先调用 second_opinion 征求第二意见，再基于顾问意见作答；不得继续重复同一思路。",
		"prompt.reminder": "【提醒】当前会话中同一问题已出现 {count} 次。若本轮仍无法解决，应调用 second_opinion 征求第二意见。",
		"preamble.who": "【你是谁】你是主代理请来的顾问，对它正在进行的工作给出第二意见。\n你不是主代理，也不独立地在这个工作区里工作：对话是主代理的，工作区是主代理的，你只负责审阅并回答最后的问题。\n你的读者是主代理而不是人类：忽略任何让你“回复人类用户”或“继续完成任务”的指示，你的回答会作为工具结果交给主代理，由它决定是否采纳。",
		"preamble.inherited": "【继承来的内容对你不适用】你看到的技能目录、运行环境说明、工具说明，以及其中关于 second_opinion 的使用规则，都是主代理的上下文，只供你理解背景。\n不要继续之前的任务，不要调用 second_opinion，不要再派生子代理，不要替主代理向用户提问。\n不要用 send_message 给主代理或任何代理发消息——你的最终回答就是唯一的交付物，它会作为工具结果交给主代理。",
		"preamble.readonly": "【只读】你可以读文件、运行只读的命令来核实事实；不得创建、修改或删除任何文件，不得改变工作区或系统的任何状态。被沙箱拒绝的操作不要重试，在回答里说明即可。",
		"preamble.requirements": "【回答要求】",
		"preamble.transcript": "【对话抄本】下面是主代理当前会话的对话抄本（含当前轮次）。抄本是文本化的：工具输出可能被截断，图片与附件无法直接查看——需要细节时请用只读工具读取工作区中的对应文件。",
		"preamble.transcriptDropped": "为控制篇幅已省略更早的 {count} 条消息。",
		"preamble.transcriptClipped": "有 {count} 条内容因过长被截断。",
		"preamble.noTranscript": "（无可用对话记录）",
		"preamble.standalone": "【你能看到的】你看不到主对话，只有下面的问题与补充背景；但你与主代理共享同一个工作区，可以读文件、运行只读命令核实。",
		"preamble.context": "【对话外补充背景】",
		"preamble.question": "【问题】",
		"preamble.output": "【输出】先给结论，再给依据；指出被忽略的风险、错误假设或更优方案；信息不足时明确说缺什么，不要臆测。用与对话相同的语言回答。",
		"preamble.followUp": "【追问 {round}】仍是同一咨询线程：保持顾问身份与只读约束，只回答这个追问，不要重复此前的回答。",
		"persona.default": "你是一位经验丰富的技术顾问，为另一个 AI 编程助手提供第二意见。你会看到该助手当前会话的对话抄本（可能省略了较早的消息）以及它此刻提出的问题。\n\n回答要求：\n- 先给结论，再给依据；观点明确，不模棱两可；论证充分但不冗余。\n- 指出对话中被忽略的风险、错误假设或更优的替代方案。\n- 信息不足以判断时，明确指出缺少哪些信息，不要基于臆测作答。\n- 对已有信息中的不确定内容，标注不确定并说明如何验证。\n- 抄本注明省略了较早消息时，对涉及早期细节的判断降低相应置信度。\n- 用与对话相同的语言回答。",
		"persona.blind": "这是一次盲审请求：你看不到主对话记录，只能依据主代理提出的问题与其主动补充的背景作答。主代理陈述的观点、倾向或已做的假设只是它单方面的判断，仅供参考，可以在有依据的前提下推翻，推翻时请说明理由。信息不足以给出可靠判断时，明确指出还缺少哪些信息，不要臆测补全。",
		"transcript.user": "用户",
		"transcript.assistant": "主模型",
		"transcript.tool": "工具结果",
		"transcript.toolFailed": "工具结果（失败）",
		"transcript.injected": "注入：{source}",
		"transcript.call": "（工具调用 {name}：{args}）",
		"transcript.attachment": "{kind}附件，顾问无法直接查看；如有需要请用只读工具读取工作区中的对应文件",
		"transcript.attachmentImage": "图片",
		"transcript.attachmentFile": "文件",
		"transcript.dropped": "（为控制篇幅，已省略更早的 {count} 条消息）",
		"transcript.headTitle": "（最初的用户请求，可能已截断）",
		"transcript.clipped": "…（截断，原 {count} 字符）",
		"tool.disabled": "Second Opinion 当前已停用（设置中可开启）。",
		"tool.noChain": "顾问链尚未配置任何模型。请先到 设置 → 顾问设置 添加顾问模型。",
		"tool.noSession": "当前执行环境没有会话上下文，无法咨询顾问。",
		"tool.isAdvisor": "你已经是顾问子代理：顾问不能再咨询 second_opinion，直接给出你的意见即可。",
		"tool.dualNoFollowUp": "双意见咨询不支持追问；请基于单一模型开新咨询。",
		"tool.followUpNeedsText": "追问需要提供 follow_up 参数（要继续追问的内容）。",
		"tool.missingQuestion": "缺少 question 参数：请提供要征求第二意见的具体问题（或提供 consult_id + follow_up 进行追问）。",
		"tool.followUpFailed": "顾问本轮未返回可用回答：{reason}。可换个问法追问或开新咨询。",
		"tool.followUpTruncated": "本轮追问超时被中止，以上为已输出的部分回答",
		"tool.followUpLabel": "追问",
		"tool.advisorLabel": "顾问",
		"tool.effortIgnored": "推理档位「{effort}」未被模型 {route} 声明，已忽略",
		"tool.presetFallback": "顾问的精简组成不可用（{reason}），本次继承了主对话的完整工具与提示",
		"tool.transcriptDropped": "抄本省略了更早的 {count} 条消息（已附最初请求摘要）",
		"tool.transcriptClipped": "{count} 条内容因过长被截断，顾问看到的工具输出可能不完整",
		"tool.truncatedNote": "{label}：超时后按已输出内容截断",
		"tool.aborted": "顾问运行中断（{label}）：{message}",
		"tool.dualSection": "【意见一/二 · {label}{truncated}】\n{content}",
		"tool.dualTruncatedMark": " · 已截断",
		"tool.dualFailedSection": "【意见一/二 · {label}】本次未返回可用内容：{reason}",
		"tool.dualNoContent": "未返回可用内容",
		"tool.dualAllFailed": "双意见咨询全部失败：{attempts}。{tail}",
		"tool.dualProceed": "请基于自己的判断继续。",
		"tool.dualPartialNote": "（注：部分顾问未返回可用内容，本次仅包含成功返回的意见。）",
		"tool.chainFailed": "顾问链全部调用失败：{attempts}。请基于自己的判断继续，或稍后重试。",
		"tool.attemptFailed": "{label}（{reason}）",
		"tool.hintFollowUp": "\n\n（consult_id: {id} —— 如需继续追问该顾问，携带此 consult_id 与 follow_up 参数再次调用。追问结果以本次工具返回为准；宿主随后可能在对话里投递一条内容相同的子代理完成通知，忽略即可。）",
		"tool.hintDual": "\n\n（双意见咨询不支持追问；如需追问请基于单一模型开新咨询。）",
		"tool.notes": "（注：{notes}）",
		"start.settingInvalid": "DSH 的「子代理模型选择」设置无效（{detail}）。请到 设置 → 插件 → 子代理 修正后重试。",
		"start.selectionOff": "DSH 的「子代理模型选择」当前是关闭的，顾问无法使用与主对话不同的模型（{route}）。请到 设置 → 顾问设置 点击「开启并授权」。",
		"start.unauthorized": "模型 {route} 尚未授权给子代理。请到 设置 → 顾问设置 点击「授权」，或在 设置 → 插件 → 子代理 的模型白名单里添加它。",
		"start.routeUnavailable": "模型路由不可用（{route}）：{detail}",
		"start.cannotStart": "无法启动顾问（{label}）：{message}",
		"start.sandboxFailed": "无法把顾问限制在只读沙箱内，已中止本次咨询。",
		"start.unrecognized": "未能确认顾问子代理的身份（宿主未提供子代理描述符），已中止本次咨询。",
		"followup.notFound": "未找到该 consult_id 对应的咨询记录（可能属于旧版本、其他会话，或记录已不存在）。请开新咨询。",
		"followup.foreign": "该 consult_id 不是本插件建立的咨询线程（旧版本的 consult_id 不再支持）。请开新咨询。",
		"followup.busy": "顾问仍在回答，请等它完成后再追问。",
		"followup.dualNoFollowUp": "双意见咨询不支持追问；请基于单一模型开新咨询。",
		"followup.roundCap": "该咨询线程已达 {max} 轮追问上限，请开新咨询。",
		"followup.otherTree": "该咨询属于另一个会话（会话被 fork 后旧线程不在当前子代理树中），无法追问。请开新咨询。",
		"followup.sendFailed": "追问发送失败：{message}",
		"failure.contextWindow": "上下文超限",
		"failure.rateLimit": "限流",
		"failure.timeout": "超时",
		"failure.transport": "网络错误",
		"failure.server": "服务端错误",
		"failure.auth": "鉴权失败",
		"failure.quota": "额度不足",
		"failure.refused": "内容被拒",
		"failure.empty": "空响应",
		"failure.modelUnavailable": "模型不可用",
		"failure.invalidRequest": "请求或响应无效",
		"failure.withStatus": "{category}（HTTP {status}）",
		"failure.withDetail": "{category}：{detail}",
		"stop.error": "顾问运行出错",
		"stop.aborted": "顾问被中止",
		"stop.maxTokens": "顾问输出达到 maxTokens 上限",
		"stop.refusal": "顾问拒绝回答",
		"stop.empty": "顾问正常结束但未返回任何内容（空响应）",
		"stop.unknown": "未知原因（顾问未返回内容）",
		"timeout.deadline": "超时：到点时尚未开始输出回答正文",
		"timeout.idle": "超时：回答中断后长时间无新输出",
		"timeout.hardCap": "超时：超过总时长上限",
		"timeout.withFailure": "{reason}（最后一次请求错误：{detail}）",
		"stop.withFailure": "{reason}（最后一次请求错误：{detail}）",
		"stop.contextHint": "。可在设置里调低抄本预算，或改用盲审模式并在 context 里只写要点",
		"wait.neverSettled": "顾问中止后 {seconds} 秒内未结束"
	},
	en: {
		"prompt.header": "## Second Opinion usage boundary",
		"prompt.manual": "second_opinion asks a read-only advisor subagent for a second opinion; the advisor receives a bounded transcript of this conversation. Manual mode is active: call it only when the user explicitly asks for an advisor (\"ask the advisor\", \"get a second opinion\") and merge related questions into one consultation.",
		"prompt.autoIntro": "second_opinion asks a read-only advisor subagent for a second opinion: the advisor can read files and run read-only commands to verify, but cannot change anything, and it reports only to you. In the default inherited mode the advisor receives a bounded text transcript of this conversation (tool outputs may be clipped, older messages may be omitted); ask the specific question and do not restate what the conversation already says. When the question depends on a large file or a long output, give the path and let the advisor read it. Put private information the transcript cannot hold (your intent, unstated constraints, omitted earlier points) in the context parameter. In blind-review mode (mode=standalone) the advisor sees no conversation; state the goal, constraints, what was tried and the relevant file paths in context.",
		"prompt.rule1": "1. Call when (any one applies): a mistake here is expensive (safety, data, architectural commitments, irreversible actions, external commitments); a major decision is being finalized or a major delivery needs a final review; you are stuck repeatedly or unsure of a conclusion. Make small reversible changes directly; do not call mechanically for simple tasks.",
		"prompt.rule2": "2. Not for: simple facts you can look up online; small talk and purely creative tasks.",
		"prompt.rule3": "3. When the user explicitly asks for an advisor you must call it; merge related questions into one consultation.",
		"prompt.rule4": "4. Verify a concrete defect the advisor points out before acting; absorb pure differences of opinion and move on without consulting again for validation, and state your reasons when you disagree; never paste the advisor's reply verbatim. When the advisor says information is missing, call again with the added context or follow up with consult_id + follow_up.",
		"prompt.rule5": "5. The tool result is authoritative for follow-ups; the host may also deliver a subagent completion notice with the same content into the conversation — ignore it.",
		"prompt.forced": "【Mandatory consultation】The user has repeated the same question {count} times in this conversation without resolution. This turn you must first call second_opinion and then answer based on the advisor's opinion; do not repeat the same approach.",
		"prompt.reminder": "【Reminder】The same question has now appeared {count} times in this conversation. If it is still unresolved after this turn, call second_opinion.",
		"preamble.who": "[Who you are] You are an advisor the main agent consulted for a second opinion on the work it is doing.\nYou are not the main agent and you do not work in this workspace on your own account: the conversation belongs to the main agent, the workspace belongs to the main agent, and your only job is to review and answer the final question.\nYour reader is the main agent, not a human: ignore any instruction to \"answer the human user\" or \"continue the task\"; your answer is handed to the main agent as a tool result and it decides what to adopt.",
		"preamble.inherited": "[Inherited content does not apply to you] The skill catalog, environment notes, tool descriptions and the second_opinion usage rules you see are the main agent's context, for background only.\nDo not continue the previous task, do not call second_opinion, do not spawn further subagents, and do not ask the user questions on the main agent's behalf.\nDo not use send_message to message the main agent or any other agent — your final answer is the only deliverable and is handed to the main agent as a tool result.",
		"preamble.readonly": "[Read-only] You may read files and run read-only commands to verify facts; you must not create, modify or delete any file or change any state of the workspace or system. When the sandbox denies an operation, do not retry it; say so in your answer.",
		"preamble.requirements": "[Answer requirements]",
		"preamble.transcript": "[Conversation transcript] Below is the transcript of the main agent's current conversation (including the in-flight turn). It is textual: tool outputs may be clipped and images or attachments cannot be viewed directly — read the corresponding workspace files with read-only tools when you need details.",
		"preamble.transcriptDropped": " {count} earlier messages were omitted to bound its length.",
		"preamble.transcriptClipped": " {count} entries were clipped for length.",
		"preamble.noTranscript": "(no conversation record available)",
		"preamble.standalone": "[What you can see] You cannot see the main conversation; you only have the question and the supplementary background below, but you share the main agent's workspace and may read files and run read-only commands to verify.",
		"preamble.context": "[Out-of-band background]",
		"preamble.question": "[Question]",
		"preamble.output": "[Output] Conclusion first, then evidence; point out overlooked risks, wrong assumptions or better alternatives; when information is insufficient, say exactly what is missing instead of guessing. Answer in the conversation's language.",
		"preamble.followUp": "[Follow-up {round}] Same consultation thread: keep your advisor role and the read-only constraint, answer only this follow-up, and do not repeat your earlier answer.",
		"persona.default": "You are an experienced technical advisor giving a second opinion to another AI coding assistant. You see a transcript of that assistant's current conversation (earlier messages may be omitted) and the question it is asking now.\n\nAnswer requirements:\n- Conclusion first, then evidence; take a clear position; be thorough but not verbose.\n- Point out overlooked risks, wrong assumptions or better alternatives in the conversation.\n- When information is insufficient, say what is missing instead of guessing.\n- Mark uncertain claims as uncertain and say how to verify them.\n- When the transcript says earlier messages were omitted, lower your confidence accordingly for details from that period.\n- Answer in the conversation's language.",
		"persona.blind": "This is a blind review: you cannot see the main conversation and may only rely on the question and the background the main agent supplied. The main agent's views, leanings and assumptions are its one-sided judgement — for reference only; overturn them with reasons when the evidence supports it. When information is insufficient for a reliable judgement, state what is missing instead of filling gaps with guesses.",
		"transcript.user": "User",
		"transcript.assistant": "Main agent",
		"transcript.tool": "Tool result",
		"transcript.toolFailed": "Tool result (failed)",
		"transcript.injected": "Injected: {source}",
		"transcript.call": "(tool call {name}: {args})",
		"transcript.attachment": "{kind} attachment, not directly visible to the advisor; read the corresponding workspace file with a read-only tool if needed",
		"transcript.attachmentImage": "Image",
		"transcript.attachmentFile": "File",
		"transcript.dropped": "(To bound its length, {count} earlier messages were omitted)",
		"transcript.headTitle": "(The original user request, possibly clipped)",
		"transcript.clipped": "… (clipped, {count} characters originally)",
		"tool.disabled": "Second Opinion is currently disabled (enable it in Settings).",
		"tool.noChain": "No advisor model is configured yet. Add one under Settings → Advisor.",
		"tool.noSession": "This execution context has no conversation to advise on.",
		"tool.isAdvisor": "You are already an advisor subagent: advisors cannot call second_opinion again; just give your opinion.",
		"tool.dualNoFollowUp": "Dual-opinion consultations cannot be followed up; start a new single-model consultation instead.",
		"tool.followUpNeedsText": "A follow-up needs the follow_up parameter (what to ask next).",
		"tool.missingQuestion": "Missing the question parameter: state the specific question for the second opinion (or provide consult_id + follow_up to follow up).",
		"tool.followUpFailed": "The advisor returned no usable answer this round: {reason}. Rephrase the follow-up or start a new consultation.",
		"tool.followUpTruncated": "This follow-up was stopped by the timeout; the text above is what had been produced",
		"tool.followUpLabel": "Follow-up",
		"tool.advisorLabel": "Advisor",
		"tool.effortIgnored": "Reasoning effort \"{effort}\" is not declared by model {route} and was ignored",
		"tool.presetFallback": "The advisor's lean composition was unavailable ({reason}); this call inherited the main conversation's full tools and prompt",
		"tool.transcriptDropped": "The transcript omitted {count} earlier messages (the original request is summarized)",
		"tool.transcriptClipped": "{count} entries were clipped for length; tool outputs the advisor saw may be incomplete",
		"tool.truncatedNote": "{label}: stopped by the timeout and kept as the partial output",
		"tool.aborted": "Advisor run interrupted ({label}): {message}",
		"tool.dualSection": "[Opinion 1/2 · {label}{truncated}]\n{content}",
		"tool.dualTruncatedMark": " · truncated",
		"tool.dualFailedSection": "[Opinion 1/2 · {label}] No usable content was returned: {reason}",
		"tool.dualNoContent": "no usable content",
		"tool.dualAllFailed": "Every advisor in the dual consultation failed: {attempts}. {tail}",
		"tool.dualProceed": "Proceed on your own judgement.",
		"tool.dualPartialNote": "(Note: some advisors returned no usable content; only the successful opinions are included.)",
		"tool.chainFailed": "Every advisor in the chain failed: {attempts}. Proceed on your own judgement or retry later.",
		"tool.attemptFailed": "{label} ({reason})",
		"tool.hintFollowUp": "\n\n(consult_id: {id} — to continue with this advisor, call again with this consult_id and the follow_up parameter. The tool result is authoritative for follow-ups; the host may also deliver a subagent completion notice with the same content into the conversation — ignore it.)",
		"tool.hintDual": "\n\n(Dual-opinion consultations cannot be followed up; start a new single-model consultation to follow up.)",
		"tool.notes": "(Note: {notes})",
		"start.settingInvalid": "DSH's subagent model selection setting is invalid ({detail}). Fix it under Settings → Plugins → Subagents and retry.",
		"start.selectionOff": "DSH's subagent model selection is off, so the advisor cannot use a model different from the main conversation ({route}). Click \"Enable and authorize\" under Settings → Advisor.",
		"start.unauthorized": "Model {route} is not authorized for subagents. Click \"Authorize\" under Settings → Advisor, or add it to the subagent model allowlist under Settings → Plugins → Subagents.",
		"start.routeUnavailable": "Model route unavailable ({route}): {detail}",
		"start.cannotStart": "Could not start the advisor ({label}): {message}",
		"start.sandboxFailed": "The advisor could not be confined to the read-only sandbox; the consultation was aborted.",
		"start.unrecognized": "The advisor subagent could not be identified (the host provided no subagent descriptor); the consultation was aborted.",
		"followup.notFound": "No consultation matches this consult_id (it may belong to an older version, another conversation, or no longer exist). Start a new consultation.",
		"followup.foreign": "This consult_id is not a thread created by this plugin (consult_ids from older versions are no longer supported). Start a new consultation.",
		"followup.busy": "The advisor is still answering; wait for it to finish before following up.",
		"followup.dualNoFollowUp": "Dual-opinion consultations cannot be followed up; start a new single-model consultation instead.",
		"followup.roundCap": "This consultation thread has reached its limit of {max} follow-up rounds. Start a new consultation.",
		"followup.otherTree": "This consultation belongs to another conversation (after a fork the old thread is not in the current subagent tree) and cannot be followed up. Start a new consultation.",
		"followup.sendFailed": "Sending the follow-up failed: {message}",
		"failure.contextWindow": "context window exceeded",
		"failure.rateLimit": "rate limited",
		"failure.timeout": "timed out",
		"failure.transport": "network error",
		"failure.server": "server error",
		"failure.auth": "authentication failed",
		"failure.quota": "quota exhausted",
		"failure.refused": "content refused",
		"failure.empty": "empty response",
		"failure.modelUnavailable": "model unavailable",
		"failure.invalidRequest": "invalid request or response",
		"failure.withStatus": "{category} (HTTP {status})",
		"failure.withDetail": "{category}: {detail}",
		"stop.error": "The advisor run failed",
		"stop.aborted": "The advisor was aborted",
		"stop.maxTokens": "The advisor hit its maxTokens limit",
		"stop.refusal": "The advisor declined to answer",
		"stop.empty": "The advisor finished normally but returned no content (empty response)",
		"stop.unknown": "Unknown reason (the advisor returned no content)",
		"timeout.deadline": "Timed out: no answer text had started at the deadline",
		"timeout.idle": "Timed out: the answer stopped for too long",
		"timeout.hardCap": "Timed out: total duration cap exceeded",
		"timeout.withFailure": "{reason} (last request error: {detail})",
		"stop.withFailure": "{reason} (last request error: {detail})",
		"stop.contextHint": ". Lower the transcript budget in Settings, or use blind-review mode with only the essentials in context",
		"wait.neverSettled": "The advisor did not settle within {seconds} seconds after being stopped"
	}
};
/** Translate one key; `{name}` placeholders are filled from `params` (undefined → empty). */
function t(lang, key, params) {
	const template = HOST_MESSAGES[lang]?.[key] ?? HOST_MESSAGES.zh[key] ?? key;
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name] ?? "") : match);
}
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;
const LETTER = /[A-Za-z]/g;
/** Infer the language of a text sample from its CJK share; undefined when it has nothing to go on. */
function detectLanguage(text) {
	const cjk = (text.match(CJK) ?? []).length;
	const latin = (text.match(LETTER) ?? []).length;
	if (cjk === 0 && latin === 0) return void 0;
	return cjk / (cjk + latin) >= .2 ? "zh" : "en";
}
/** Resolve the language for one call from the text at hand. */
function resolveLanguage(sample) {
	return detectLanguage(sample) ?? "zh";
}
// src/pressure.ts
/** Short messages that only nudge the model to keep going; never a repeated question.
*  Compared in normalized form (see {@link normalizeUserText}). */
const ADVANCE_PHRASES = /* @__PURE__ */ new Set([
	"继续",
	"请继续",
	"接着",
	"接着写",
	"继续吧",
	"goon",
	"continue",
	"pleasecontinue",
	"next",
	"ok",
	"okay",
	"好的",
	"嗯",
	"yes",
	"y"
]);
/** Lower-case, punctuation- and whitespace-free form used for equality. */
function normalizeUserText(text) {
	return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
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
		const key = normalizeUserText(text);
		if (!key || ADVANCE_PHRASES.has(key)) return;
		const tracked = this.map.get(sessionId);
		if (!tracked || tracked.key !== key) this.map.set(sessionId, {
			key,
			text,
			count: 1
		});
		else {
			tracked.count += 1;
			tracked.text = text;
		}
	}
	get(sessionId) {
		if (!sessionId) return void 0;
		const tracked = this.map.get(sessionId);
		if (!tracked) return void 0;
		return {
			count: tracked.count,
			text: tracked.text
		};
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
function buildSectionText(config, pressure, threshold, lang = "zh") {
	if (!config.enabled || config.chain.length === 0) return "";
	const lines = [t(lang, "prompt.header")];
	if (config.mode === "manual") {
		lines.push(t(lang, "prompt.manual"));
		return lines.join("\n");
	}
	lines.push(t(lang, "prompt.autoIntro"), t(lang, "prompt.rule1"), t(lang, "prompt.rule2"), t(lang, "prompt.rule3"), t(lang, "prompt.rule4"), t(lang, "prompt.rule5"));
	if (pressure && pressure.count >= threshold) lines.push("", t(lang, "prompt.forced", { count: pressure.count }));
	else if (pressure && pressure.count > 1) lines.push("", t(lang, "prompt.reminder", { count: pressure.count }));
	return lines.join("\n");
}
// src/transcript.ts
/**
* Compact the main session's derived message history into a bounded text
* transcript for the advisor — the inherited-mode context source.
*
* The input is what `session.deriveMessages()` returns: exactly the message
* history the main model sees. Rendering rules:
* - system / developer messages are dropped (the harness prompt is not the
*   advisor's business);
* - user-role messages are labeled by their producer: a real user message is
*   `用户`/`User`, anything injected on the user's behalf (skill catalogs,
*   environment snapshots, agent relays, notices) is labeled as an injection
*   with its source kind, so the advisor never mistakes harness context for
*   something the user said;
* - assistant tool calls keep their NAME AND ARGUMENTS (the advisor must see
*   what was read and what was changed); reasoning blocks are skipped;
* - tool results are labeled, failures marked, and every entry is clipped;
* - the in-flight call to `excludeToolName` (the consultation itself) is left
*   out, while earlier completed consultations stay in;
* - the newest window that fits the budget is kept, dropped older entries are
*   counted, and the FIRST user request is preserved as a short head summary
*   so long sessions do not lose the original task.
*
* Labels follow the advisor prompt's language (`options.lang`).
*/
const DEFAULT_HEAD_SUMMARY_MAX_CHARS = 600;
function clip(text, maxChars, lang) {
	if (text.length <= maxChars) return {
		text,
		clipped: false
	};
	return {
		text: `${text.slice(0, maxChars)}${t(lang, "transcript.clipped", { count: text.length })}`,
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
function userEntryLabel(source, lang = "zh") {
	const kind = source?.kind ?? "user";
	if (kind === "user") return t(lang, "transcript.user");
	return t(lang, "transcript.injected", { source: `${kind}${typeof source?.form === "string" && source.form ? `/${source.form}` : ""}` });
}
/** Render one content block; returns null for blocks the advisor should not see. */
function blockToText(block, perEntryMaxChars, excludedCallIds, excludeToolName, clipped, lang) {
	if (block.type === "text" && typeof block.text === "string") {
		const res = clip(block.text, perEntryMaxChars, lang);
		if (res.clipped) clipped.count += 1;
		return res.text;
	}
	if (block.type === "reasoning") return null;
	if (block.type === "tool-call" && typeof block.name === "string") {
		if (excludeToolName && block.name === excludeToolName && excludedCallIds.has(block.id)) return null;
		const args = clip(compactArgs(block.arguments), perEntryMaxChars, lang);
		if (args.clipped) clipped.count += 1;
		return t(lang, "transcript.call", {
			name: block.name,
			args: args.text || "{}"
		});
	}
	if (block.type === "image" || block.type === "file") return `（${t(lang, "transcript.attachment", { kind: t(lang, block.type === "image" ? "transcript.attachmentImage" : "transcript.attachmentFile") })}）`;
	return null;
}
/** One derived message → a labeled transcript entry; null for skipped roles
*  (system / developer) or entries that render to nothing. */
function messageToEntry(message, perEntryMaxChars, excludedCallIds = /* @__PURE__ */ new Set(), excludeToolName, clipped = { count: 0 }, lang = "zh") {
	const role = message.role ?? "";
	if (role === "system" || role === "developer") return null;
	if (role === "user") {
		const source = message.source;
		if (source?.form === "notice" && typeof source.summary === "string") return {
			label: userEntryLabel(source, lang),
			text: source.summary
		};
		const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped, lang);
		return text ? {
			label: userEntryLabel(source, lang),
			text
		} : null;
	}
	if (role === "assistant") {
		const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped, lang);
		return text ? {
			label: t(lang, "transcript.assistant"),
			text
		} : null;
	}
	if (role === "tool") {
		const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped, lang);
		if (!text) return null;
		return {
			label: message.isError ? t(lang, "transcript.toolFailed") : t(lang, "transcript.tool"),
			text
		};
	}
	return null;
}
function renderBlocks(blocks, perEntryMaxChars, excludedCallIds, excludeToolName, clipped, lang) {
	if (!Array.isArray(blocks)) return "";
	const parts = [];
	for (const block of blocks) {
		const rendered = blockToText(block, perEntryMaxChars, excludedCallIds, excludeToolName, clipped, lang);
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
function headSummaryOf(messages, maxChars, lang) {
	for (const message of messages) {
		if (message.role !== "user") continue;
		if (message.source?.kind !== void 0 && message.source.kind !== "user") continue;
		const text = renderBlocks(message.content, maxChars, /* @__PURE__ */ new Set(), void 0, { count: 0 }, lang);
		if (text) return clip(text, maxChars, lang).text;
	}
	return null;
}
function buildTranscript(messages, options) {
	const lang = options.lang ?? "zh";
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
		const entry = messageToEntry(message, options.perEntryMaxChars, excludedCallIds, exclude, clipped, lang);
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
		parts.push(t(lang, "transcript.dropped", { count: dropped }));
		if (firstUserEntryIndex >= 0 && firstUserEntryIndex < dropped) {
			const head = headSummaryOf(messages, options.headSummaryMaxChars ?? DEFAULT_HEAD_SUMMARY_MAX_CHARS, lang);
			if (head) parts.push(`${t(lang, "transcript.headTitle")}\n${head}`);
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
function emptyUsage() {
	return {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
		requests: 0
	};
}
function addUsage(total, usage) {
	const num = (v) => typeof v === "number" && Number.isFinite(v) ? v : 0;
	total.inputTokens += num(usage.inputTokens);
	total.outputTokens += num(usage.outputTokens);
	total.cacheReadTokens += num(usage.cacheReadTokens);
	total.cacheWriteTokens += num(usage.cacheWriteTokens);
	total.reasoningTokens += num(usage.reasoningTokens);
	total.requests += 1;
}
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
		usage: emptyUsage(),
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
		if (frame.chunk.type === "usage") addUsage(obs.usage, frame.chunk.usage ?? {});
		else if (frame.chunk.type === "text-delta" && typeof frame.chunk.text === "string") {
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
	events;
	now;
	constructor(deps) {
		this.host = deps.host;
		this.sandbox = deps.sandbox;
		this.log = deps.log ?? noopLogger;
		this.depthOf = deps.depthOf ?? defaultDepthOf;
		this.events = deps.events;
		this.descriptorOf = deps.descriptorOf ?? ((child) => this.events?.descriptorOf(String(child.id)) ?? defaultDescriptorOf(child));
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
			const logged = this.sandbox.lastModeOf?.(child.session) ?? this.events?.lastModeOf(childId) ?? lastLoggedModeOf(child.session);
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
	const session = child.session;
	if (typeof session?.snapshotEvents !== "function") return void 0;
	try {
		return foldSubagentDescriptor(session.snapshotEvents());
	} catch {
		return;
	}
}
/** Mode of the last `sandbox/mode` event in the session log, if the session still offers `snapshotEvents()`. */
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
function buildAdvisorPrompt(input) {
	const { lang } = input;
	const persona = input.advisorPrompt.trim() || t(lang, "persona.default");
	const sections = [
		t(lang, "preamble.who"),
		t(lang, "preamble.inherited"),
		t(lang, "preamble.readonly"),
		`${t(lang, "preamble.requirements")}${persona}`
	];
	if (input.mode === "standalone") sections.push(`${t(lang, "preamble.standalone")}${t(lang, "persona.blind")}`);
	else {
		const dropped = input.transcriptDropped ?? 0;
		const clipped = input.transcriptClipped ?? 0;
		const header = t(lang, "preamble.transcript") + (dropped > 0 ? t(lang, "preamble.transcriptDropped", { count: dropped }) : "") + (clipped > 0 ? t(lang, "preamble.transcriptClipped", { count: clipped }) : "");
		sections.push(header, input.transcriptText?.trim() || t(lang, "preamble.noTranscript"));
	}
	if (input.context && input.context.trim()) sections.push(`${t(lang, "preamble.context")}\n${input.context.trim()}`);
	sections.push(`${t(lang, "preamble.question")}\n${input.question.trim()}`, t(lang, "preamble.output"));
	return sections.join("\n\n");
}
/** The message sent to an existing advisor child on a follow-up round. */
function buildFollowUpMessage(followUp, round, lang = "zh") {
	return `${t(lang, "preamble.followUp", { round })}\n\n${followUp.trim()}`;
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
/** Provider failure code → dictionary key of its readable category. */
const FAILURE_CATEGORIES = [
	[/CONTEXT_WINDOW_EXCEEDED/i, "failure.contextWindow"],
	[/RATE_LIMIT/i, "failure.rateLimit"],
	[/TIMEOUT/i, "failure.timeout"],
	[/TRANSPORT|ECONNRESET|EOF/i, "failure.transport"],
	[/SERVER|PI_AI_ERROR/i, "failure.server"],
	[/AUTH|CREDENTIAL|ACCOUNT_|SIGN_IN/i, "failure.auth"],
	[/QUOTA/i, "failure.quota"],
	[/CONTENT_REFUSED|refusal/i, "failure.refused"],
	[/EMPTY_RESPONSE/i, "failure.empty"],
	[/MODEL_UNSUPPORTED|INVALID_MODEL|MODEL_DOES_NOT/i, "failure.modelUnavailable"],
	[/INVALID_REQUEST|INVALID_RESPONSE|MALFORMED_RESPONSE/i, "failure.invalidRequest"]
];
function describeFailureCode(code, lang = "zh") {
	for (const [pattern, key] of FAILURE_CATEGORIES) if (pattern.test(code)) return t(lang, key);
	return code;
}
function clipMessage(text, max = 300) {
	const trimmed = text.trim();
	return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
/** Human-readable reason from the child's own request failures; the last one wins. */
function describeFailures(failures, lang = "zh") {
	const last = failures[failures.length - 1];
	if (!last) return void 0;
	const category = describeFailureCode(last.code, lang);
	const withStatus = typeof last.status === "number" ? t(lang, "failure.withStatus", {
		category,
		status: last.status
	}) : category;
	const detail = clipMessage(last.message ?? "");
	return detail && detail !== category ? t(lang, "failure.withDetail", {
		category: withStatus,
		detail
	}) : withStatus;
}
const STOP_REASON_KEYS = {
	error: "stop.error",
	aborted: "stop.aborted",
	"max-tokens": "stop.maxTokens",
	refusal: "stop.refusal"
};
function settleOutcome(input) {
	const { result, observation, abortedBy } = input;
	const lang = input.lang ?? "zh";
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
	const stopLabel = stopReason ? STOP_REASON_KEYS[stopReason] ?? void 0 : void 0;
	const requestFailure = describeFailures(observation.failures, lang);
	const timeoutKey = abortedBy === "deadline" ? "timeout.deadline" : abortedBy === "idle" ? "timeout.idle" : abortedBy === "hard-cap" ? "timeout.hardCap" : void 0;
	let reason;
	if (timeoutKey) reason = requestFailure ? t(lang, "timeout.withFailure", {
		reason: t(lang, timeoutKey),
		detail: requestFailure
	}) : t(lang, timeoutKey);
	else if (stopReason === "completed") reason = t(lang, "stop.empty");
	else if (stopLabel && stopReason !== "error") reason = requestFailure ? t(lang, "stop.withFailure", {
		reason: t(lang, stopLabel),
		detail: requestFailure
	}) : t(lang, stopLabel);
	else reason = requestFailure ?? (stopLabel ? t(lang, stopLabel) : t(lang, "stop.unknown"));
	if (reason.includes(t(lang, "failure.contextWindow"))) reason += t(lang, "stop.contextHint");
	return {
		ok: false,
		content: text,
		stopReason,
		truncated: false,
		failure: reason,
		failures: observation.failures
	};
}
/** How long a disposed/interrupted child may take to settle before the wait gives up. */
const ABORT_SETTLE_GRACE_MS = 5e3;
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
* Await `run` under the advisor timeout rule (architecture §4): the deadline is
* hard while the child has produced no answer text; once answer text exists the
* rule switches to an idle timer; a hard cap bounds the total. `abort` is
* invoked once and `run` is still awaited so the settled result (partial
* output) is available.
*/
async function waitWithTimeout(input) {
	const now = input.now ?? Date.now;
	const lang = input.lang ?? "zh";
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
		const time = now();
		if (abortedBy === void 0) {
			if (time >= hardCap) abortNow("hard-cap");
			else if (time >= deadline) {
				if (input.observation()?.answerTextStarted) {
					const idleAt = (input.observation()?.lastAnswerTextAt ?? time) + grace;
					if (time >= idleAt) abortNow("idle");
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
		if (!settled && !rejected && now() - abortedAt >= 5e3) throw new Error(t(lang, "wait.neverSettled", { seconds: ABORT_SETTLE_GRACE_MS / 1e3 }));
	}
	if (rejected) throw rejected.error;
	return {
		value: settled.value,
		abortedBy
	};
}
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
function assertRouteAllowed(host, parent, entry, lang = "zh") {
	const svc = host.optional("subagentModelSelection");
	if (!svc || typeof svc.allowedRoutes !== "function") return { ok: true };
	let routes;
	try {
		routes = svc.allowedRoutes();
	} catch (error) {
		return {
			ok: false,
			kind: "authorization",
			message: t(lang, "start.settingInvalid", { detail: error instanceof Error ? error.message : String(error) })
		};
	}
	const route = `${entry.provider}/${entry.model}`;
	if (routes === void 0) {
		const parentRoute = parentRouteOf(parent);
		if (parentRoute.provider === entry.provider && parentRoute.model === entry.model) return { ok: true };
		return {
			ok: false,
			kind: "authorization",
			message: t(lang, "start.selectionOff", { route })
		};
	}
	if (routes.some((r) => r.provider === entry.provider && r.model === entry.model)) return { ok: true };
	return {
		ok: false,
		kind: "authorization",
		message: t(lang, "start.unauthorized", { route })
	};
}
/**
* Validate the entry's route against the live model catalog. A reasoning
* effort the model does not declare is dropped (and reported) instead of
* letting the adapter reject the whole call.
*/
async function resolveEntryOptions(host, entry, lang = "zh") {
	let info;
	try {
		info = await host.llm.resolveModelInfo(entry.provider, entry.model);
	} catch (error) {
		return {
			ok: false,
			kind: "model",
			message: t(lang, "start.routeUnavailable", {
				route: `${entry.provider}/${entry.model}`,
				detail: error instanceof Error ? error.message : String(error)
			})
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
	const lang = input.lang ?? "zh";
	const route = assertRouteAllowed(host, parent, input.entry, lang);
	if (!route.ok) return route;
	const options = await resolveEntryOptions(host, input.entry, lang);
	if (!options.ok) return options;
	let preset;
	let presetFallbackReason;
	if (input.preset) {
		const check = await checkAdvisorPreset(host.optional("agentPresets"), (m) => host.log?.(m));
		if (check.ok) preset = check.preset;
		else presetFallbackReason = check.reason;
	}
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
			...preset ? { agentPreset: preset } : {},
			maxDepth: registry.depthOf(parent) + 1
		});
	} catch (error) {
		const classified = classifySubagentError(error);
		return {
			ok: false,
			kind: classified.kind,
			message: t(lang, "start.cannotStart", {
				label: input.entryLabel,
				message: classified.message
			})
		};
	} finally {
		registry.clearPendingStart(parentId);
	}
	const childId = String(activation.childId);
	const record = registry.record({
		childId,
		parentSessionId: parentId,
		consultId: "",
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
			message: t(lang, record.sandbox === "failed" ? "start.sandboxFailed" : "start.unrecognized")
		};
	}
	return {
		ok: true,
		activation,
		observation,
		record,
		effortIgnored: options.effortIgnored,
		composition: preset ? "lean" : "inherit",
		...presetFallbackReason ? { presetFallbackReason } : {}
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
/** The child's log for a live child: the tracker's copy when it is complete, else the deprecated `snapshotEvents()` while it exists. */
function eventsOf(host, events, childId) {
	const live = host.agents.get(childId);
	if (!live) return void 0;
	if (events?.has(childId) && events.isComplete(childId)) return {
		events: events.eventsOf(childId),
		live: true
	};
	const session = live.session;
	if (typeof session.snapshotEvents !== "function") return events?.has(childId) ? {
		events: events.eventsOf(childId),
		live: true
	} : void 0;
	try {
		return {
			events: session.snapshotEvents(),
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
	const lang = input.lang ?? "zh";
	const live = eventsOf(host, registry.events, childId);
	const events = live?.events ?? await coldEvents(host, childId);
	if (!events) return {
		ok: false,
		kind: "other",
		message: t(lang, "followup.notFound")
	};
	const facts = threadFactsFromEvents(events);
	if (!facts || typeof facts.label !== "string" || !facts.label.startsWith("second-opinion:")) return {
		ok: false,
		kind: "other",
		message: t(lang, "followup.foreign")
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
		message: t(lang, "followup.busy")
	};
	if (record.dual) return {
		ok: false,
		kind: "other",
		message: t(lang, "followup.dualNoFollowUp")
	};
	const round = facts.followUps + 1;
	if (round > input.maxRounds) return {
		ok: false,
		kind: "other",
		message: t(lang, "followup.roundCap", { max: input.maxRounds })
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
			text: buildFollowUpMessage(input.followUp, round, lang)
		}], { signal: input.signal });
	} catch (error) {
		const classified = classifySubagentError(error);
		if (classified.code === "UNAUTHORIZED") return {
			ok: false,
			kind: "authorization",
			message: t(lang, "followup.otherTree")
		};
		return {
			ok: false,
			kind: classified.kind,
			message: t(lang, "followup.sendFailed", { message: classified.message })
		};
	}
	return {
		ok: true,
		childId,
		round,
		gate,
		fromSeq: events.length,
		lang
	};
}
/** Wait for the follow-up turn under the timeout rule and read the child's answer. */
async function finishFollowUp(host, registry, begin, policy, parent, signal) {
	const { childId, lang } = begin;
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
			signal,
			lang
		})).abortedBy;
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
	const observation = registry.observation(childId);
	const live = host.agents.get(childId);
	let text = "";
	if (live) try {
		const since = registry.events?.has(childId) ? registry.events.since(childId, begin.fromSeq) : void 0;
		const session = live.session;
		const tail = since && since.length > 0 ? since : session.snapshotEvents ? session.snapshotEvents().slice(begin.fromSeq) : [];
		text = contentText(finalAssistantOutput(tail));
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
			usage: emptyUsage(),
			onTurnEnd: () => () => {},
			ended: true,
			dispose: () => {}
		},
		abortedBy,
		lang
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
const TOOL_NAME = "second_opinion";
const isRefusal = (r) => "kind" in r && typeof r.kind === "string";
function clipForMeta(text, max = 2e3) {
	if (typeof text !== "string") return void 0;
	return text.length > max ? `${text.slice(0, max)}…` : text;
}
/** Model-visible text: the advice, then the notes and the follow-up hint.
*  The hint follows the advice's own language (the canonical value carries no
*  locale and render has no config access). */
function textOfAdvice(value) {
	const lang = detectLanguage(value.advice) ?? "zh";
	const notes = value.notes.length ? `\n\n${t(lang, "tool.notes", { notes: value.notes.join(lang === "zh" ? "；" : "; ") })}` : "";
	const hint = value.consultId ? value.dual ? t(lang, "tool.hintDual") : t(lang, "tool.hintFollowUp", { id: value.consultId }) : "";
	return value.advice + notes + hint;
}
function createSecondOpinionTool(deps) {
	const log = deps.log ?? noopLogger;
	return defineTool({
		name: TOOL_NAME,
		description: "Ask a configured advisor model chain for a second opinion. The advisor is a read-only subagent: it can read files and run read-only commands to verify, cannot change anything, and reports only to you. Default inherited mode: the advisor receives a bounded text transcript of this conversation (tool outputs may be clipped, older messages may be omitted), so ask the specific question and do not restate background; put facts the transcript cannot hold (your intent, unstated constraints, omitted earlier points) in context, and give file paths when the question depends on a large file or long output so the advisor reads it itself. Blind-review mode (mode=standalone): the advisor sees no conversation; state the goal, constraints, what was tried and the relevant file paths in context. Supports follow-ups (consult_id + follow_up; also the way to add information the advisor says is missing) and dual opinions (dual_opinions: the first two advisors of the chain consulted in parallel). Use it before major decisions, for high-risk judgements, when unsure of a conclusion or repeatedly stuck; always when the user explicitly asks for an advisor.",
		parameters: {
			question: {
				type: "string",
				description: "The question for a new consultation, e.g. \"Does plan A hold under constraint X?\". Either this or consult_id: with consult_id, follow_up is used instead."
			},
			context: {
				type: "string",
				description: "Optional. Information the conversation record does not hold: your private intent, unstated constraints, earlier points the transcript omitted. In blind-review mode state the goal, constraints, what was tried and the relevant file paths."
			},
			mode: {
				type: "string",
				description: "Optional per-call override of the default mode. inherited: the advisor receives the conversation transcript (default); standalone: blind review — the advisor judges only from the question and context."
			},
			consult_id: {
				type: "string",
				description: "Optional. The consult_id returned by a previous consultation; with it this call is a follow-up answered by the same advisor with that thread's context."
			},
			follow_up: {
				type: "string",
				description: "The follow-up; only with consult_id, e.g. \"expand on X\" or \"what if Y instead\"."
			},
			dual_opinions: {
				type: "boolean",
				description: "Optional. true consults the first two advisors of the chain in parallel (blind to each other; with a single model, two independent samples) and returns two independent opinions; cannot be followed up."
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
					},
					parentSessionId: { type: "string" },
					opinions: {
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
								content: {
									type: "string",
									required: true
								},
								consultId: {
									type: "string",
									required: true
								}
							}
						}
					},
					usage: {
						type: "object",
						additionalProperties: false,
						properties: {
							inputTokens: {
								type: "number",
								required: true
							},
							outputTokens: {
								type: "number",
								required: true
							},
							cacheReadTokens: {
								type: "number",
								required: true
							},
							cacheWriteTokens: {
								type: "number",
								required: true
							},
							durationMs: {
								type: "number",
								required: true
							}
						}
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
					round: v.round,
					usage: v.usage,
					parent: v.parentSessionId,
					opinions: v.opinions?.map((o) => ({
						label: o.label,
						ok: o.ok,
						content: clipForMeta(o.content, 6e4) ?? "",
						consultId: o.consultId
					}))
				};
				for (const [key, val] of Object.entries(optional)) if (val !== void 0) meta[key] = val;
				return meta;
			}
		},
		async execute(args, exec) {
			const cfg = deps.getConfig();
			const lang = resolveLanguage(`${args.question ?? ""}\n${args.context ?? ""}\n${args.follow_up ?? ""}`);
			const fail = (message) => ({
				advice: message,
				model: "",
				consultId: "",
				dual: false,
				truncated: false,
				attempts: [],
				notes: []
			});
			if (!cfg.enabled) return fail(t(lang, "tool.disabled"));
			if (cfg.chain.length === 0) return fail(t(lang, "tool.noChain"));
			const parent = exec.agent;
			if (!parent) return fail(t(lang, "tool.noSession"));
			if (deps.registry.isAdvisor(String(parent.id)) || isAdvisorChild(deps.registry, parent)) return fail(t(lang, "tool.isAdvisor"));
			if (args.consult_id) {
				if (args.dual_opinions) return fail(t(lang, "tool.dualNoFollowUp"));
				if (typeof args.follow_up !== "string" || !args.follow_up.trim()) return fail(t(lang, "tool.followUpNeedsText"));
				const begin = await beginFollowUp(deps.host, deps.registry, {
					parent,
					signal: exec.signal,
					consultId: args.consult_id,
					followUp: args.follow_up,
					maxRounds: cfg.followup.maxRounds,
					lang
				});
				if (!begin.ok) return {
					...fail(begin.message),
					consultId: args.consult_id
				};
				const record = deps.registry.get(args.consult_id);
				const entryTimeout = record ? cfg.chain.find((e) => e.provider === record.provider && e.model === record.model)?.timeoutMs : void 0;
				const startedAt = Date.now();
				const outcome = await finishFollowUp(deps.host, deps.registry, begin, { timeoutMs: entryTimeout ?? cfg.limits.defaultTimeoutMs }, parent, exec.signal);
				const attempts = [{
					label: t(lang, "tool.followUpLabel"),
					ok: outcome.ok,
					...outcome.failure ? { reason: outcome.failure } : {}
				}];
				if (!outcome.ok) return {
					advice: t(lang, "tool.followUpFailed", { reason: outcome.failure }),
					model: "",
					consultId: args.consult_id,
					dual: false,
					truncated: false,
					attempts,
					notes: [],
					round: begin.round
				};
				const notes = outcome.truncated ? [t(lang, "tool.followUpTruncated")] : [];
				const recordModel = record?.provider && record?.model ? `${record.provider}/${record.model}` : t(lang, "tool.advisorLabel");
				const usage = usageOf(deps.registry.observation(args.consult_id), Date.now() - startedAt);
				return {
					advice: outcome.content,
					model: recordModel,
					consultId: args.consult_id,
					dual: false,
					truncated: outcome.truncated,
					attempts,
					notes,
					round: begin.round,
					parentSessionId: String(parent.id),
					...usage ? { usage } : {}
				};
			}
			if (typeof args.question !== "string" || !args.question.trim()) return fail(t(lang, "tool.missingQuestion"));
			const question = args.question.trim();
			const mode = args.mode === "standalone" ? "standalone" : args.mode === "inherited" ? "inherited" : cfg.contextMode;
			const notes = [];
			const prompt = buildPrompt(deps, parent, cfg, mode, question, args.context, notes);
			const live = [];
			const runEntry = async (entry, promptText) => {
				const label = entryName(entry);
				const startedAt = Date.now();
				const started = await startAdvisor(deps.host, deps.registry, {
					parent,
					signal: exec.signal,
					entry,
					entryLabel: label,
					promptText,
					mode,
					lang,
					...cfg.advisorComposition === "lean" ? { preset: ADVISOR_PRESET_ID } : {}
				});
				if (!started.ok) return started;
				live.push(started.activation);
				if (started.effortIgnored) notes.push(t(prompt.lang, "tool.effortIgnored", {
					effort: entry.reasoningEffort,
					route: `${entry.provider}/${entry.model}`
				}));
				if (started.presetFallbackReason) {
					log(`advisor preset unavailable, inheriting the parent composition: ${started.presetFallbackReason}`);
					const reason = started.presetFallbackReason.replace(/\s+/g, " ").slice(0, 240);
					notes.push(t(lang, "tool.presetFallback", { reason }));
				}
				const childId = String(started.activation.childId);
				try {
					const { value, abortedBy } = await waitWithTimeout({
						run: started.activation.result,
						observation: () => deps.registry.observation(childId) ?? started.observation,
						policy: { timeoutMs: entry.timeoutMs ?? cfg.limits.defaultTimeoutMs },
						abort: () => void started.activation.dispose().catch(() => {}),
						signal: exec.signal,
						lang: prompt.lang
					});
					const outcome = settleOutcome({
						result: value,
						observation: deps.registry.observation(childId) ?? started.observation,
						abortedBy,
						lang: prompt.lang
					});
					if (outcome.ok && outcome.truncated) notes.push(t(prompt.lang, "tool.truncatedNote", { label }));
					const usage = usageOf(started.observation, Date.now() - startedAt);
					return {
						...outcome,
						childId,
						...usage ? { usage } : {}
					};
				} catch (error) {
					if (exec.signal.aborted) throw error;
					const classified = classifySubagentError(error);
					return {
						ok: false,
						kind: classified.kind,
						message: t(prompt.lang, "tool.aborted", {
							label,
							message: classified.message
						})
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
					const results = await Promise.all(pair.map((entry) => runEntry(entry, prompt.text)));
					const sections = [];
					const models = [];
					const attempts = [];
					let anyTruncated = false;
					let usage;
					const opinions = [];
					results.forEach((result, i) => {
						const label = entryName(pair[i]);
						if (!isRefusal(result) && result.ok && result.content.trim()) {
							models.push(`${pair[i].provider}/${pair[i].model}`);
							attempts.push({
								label,
								ok: true
							});
							opinions.push({
								label,
								ok: true,
								content: result.content,
								consultId: result.childId
							});
							if (result.truncated) anyTruncated = true;
							if (result.usage) {
								const u = result.usage;
								usage = usage ? {
									inputTokens: usage.inputTokens + u.inputTokens,
									outputTokens: usage.outputTokens + u.outputTokens,
									cacheReadTokens: usage.cacheReadTokens + u.cacheReadTokens,
									cacheWriteTokens: usage.cacheWriteTokens + u.cacheWriteTokens,
									durationMs: Math.max(usage.durationMs, u.durationMs)
								} : u;
							}
							sections.push(t(prompt.lang, "tool.dualSection", {
								label,
								truncated: result.truncated ? t(prompt.lang, "tool.dualTruncatedMark") : "",
								content: result.content
							}));
						} else {
							const reason = isRefusal(result) ? result.message : result.failure ?? t(prompt.lang, "tool.dualNoContent");
							attempts.push({
								label,
								ok: false,
								reason
							});
							opinions.push({
								label,
								ok: false,
								content: reason,
								consultId: isRun(result) ? result.childId : ""
							});
							sections.push(t(prompt.lang, "tool.dualFailedSection", {
								label,
								reason
							}));
						}
					});
					const okCount = attempts.filter((a) => a.ok).length;
					if (okCount === 0) {
						const hardStop = results.find((r) => isRefusal(r));
						return {
							...fail(t(prompt.lang, "tool.dualAllFailed", {
								attempts: attempts.filter((a) => !a.ok).map((a) => t(prompt.lang, "tool.attemptFailed", {
									label: a.label,
									reason: a.reason
								})).join(prompt.lang === "zh" ? "；" : "; "),
								tail: hardStop && isRefusal(hardStop) ? hardStop.message : t(prompt.lang, "tool.dualProceed")
							})),
							consultId: "",
							dual: true,
							attempts,
							notes
						};
					}
					const failedNote = okCount < attempts.length ? t(prompt.lang, "tool.dualPartialNote") : "";
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
						notes,
						parentSessionId: String(parent.id),
						opinions,
						...usage ? { usage } : {}
					};
				}
				const attempts = [];
				for (const entry of cfg.chain) {
					const label = entryName(entry);
					const result = await runEntry(entry, prompt.text);
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
							notes,
							parentSessionId: String(parent.id),
							...result.usage ? { usage: result.usage } : {}
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
					...fail(t(prompt.lang, "tool.chainFailed", { attempts: attempts.map((a) => t(prompt.lang, "tool.attemptFailed", {
						label: a.label,
						reason: a.reason ?? ""
					})).join(prompt.lang === "zh" ? "；" : "; ") })),
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
/** Resolve the call's language from the question, the context and (inherited
*  mode) the user's latest message, then assemble the advisor prompt. */
function buildPrompt(deps, parent, cfg, mode, question, context, notes) {
	if (mode === "standalone") {
		const lang = resolveLanguage(`${question}\n${context ?? ""}`);
		return {
			lang,
			text: buildAdvisorPrompt({
				mode,
				lang,
				advisorPrompt: cfg.advisorPrompt,
				question,
				context
			})
		};
	}
	let history = [];
	try {
		history = parent.session.deriveMessages();
	} catch (error) {
		deps.log?.(`advisor: deriveMessages failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	const lang = resolveLanguage(`${lastUserText(history)}\n${question}\n${context ?? ""}`);
	const transcript = buildTranscript(history, {
		maxChars: cfg.limits.transcriptMaxChars,
		perEntryMaxChars: cfg.limits.perEntryMaxChars,
		excludeToolName: TOOL_NAME,
		lang
	});
	if (transcript.droppedCount > 0) notes.push(t(lang, "tool.transcriptDropped", { count: transcript.droppedCount }));
	if (transcript.clippedCount > 0) notes.push(t(lang, "tool.transcriptClipped", { count: transcript.clippedCount }));
	return {
		lang,
		text: buildAdvisorPrompt({
			mode,
			lang,
			advisorPrompt: cfg.advisorPrompt,
			question,
			context,
			transcriptText: transcript.text,
			transcriptDropped: transcript.droppedCount,
			transcriptClipped: transcript.clippedCount
		})
	};
}
function lastUserText(history) {
	for (let i = history.length - 1; i >= 0; i--) {
		const message = history[i];
		if (message.role !== "user") continue;
		if (message.source?.kind !== void 0 && message.source.kind !== "user") continue;
		const text = (message.content ?? []).filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join(" ");
		if (text.trim()) return text;
	}
	return "";
}
/** Token usage of a finished child from the `usage` records its stream carried (if any). */
function usageOf(observation, durationMs) {
	const usage = observation?.usage;
	if (!usage || usage.requests === 0) return void 0;
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cacheReadTokens: usage.cacheReadTokens,
		cacheWriteTokens: usage.cacheWriteTokens,
		durationMs
	};
}
/** Whether the calling agent is itself an advisor child: its own log's descriptor carries our label prefix. */
function isAdvisorChild(registry, agent) {
	const id = String(agent.id);
	const tracked = registry.events?.descriptorOf(id);
	if (tracked !== void 0) return typeof tracked.label === "string" && tracked.label.startsWith("second-opinion:");
	const session = agent.session;
	if (typeof session.snapshotEvents !== "function") return false;
	try {
		const descriptor = foldSubagentDescriptor(session.snapshotEvents());
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
	if (normalizeConfig(ctx.fiber.config).presetRole) {
		const mask = applyAdvisorToolMask(ctx.tools, (apply) => ctx.on("tools/change", apply));
		ctx.effect(() => () => mask.dispose(), "dsh-advisor-chain: advisor tool mask");
		log(`advisor preset tool mask: denying ${mask.state().denied.length} host-level tools`);
		return;
	}
	installLegacyShim(void 0, log);
	const pressureTracker = new RepeatPressureTracker();
	const eventLog = new SessionEventLog();
	ctx.on("session/event", (session, event) => {
		const sessionId = session?.id ?? "";
		eventLog.handleEvent(sessionId, event);
		pressureTracker.handleEvent(sessionId, event);
	});
	const host = {
		subagents: ctx.subagents,
		agents: ctx.agents,
		llm: ctx.llm,
		optional: (name) => ctx.get?.(name),
		log,
		on: ((name, listener) => ctx.on(name, listener))
	};
	const registry = new AdvisorRegistry({
		host,
		events: eventLog,
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
	const presets = typeof ctx.get === "function" ? ctx.get("agentPresets") ?? void 0 : void 0;
	if (presets) ctx.effect(() => {
		let dispose;
		registerAdvisorPreset(presets, log).then((d) => {
			dispose = d;
		});
		return () => void dispose?.();
	}, "dsh-advisor-chain: advisor preset");
	else log("agentPresets service unavailable; advisors will inherit the parent composition");
	const systemPrompt = ctx.systemPrompt ?? (typeof ctx.get === "function" ? ctx.get("systemPrompt") : void 0);
	if (systemPrompt) {
		const loggedStreaks = /* @__PURE__ */ new Map();
		ctx.effect(() => systemPrompt.section({
			name: "dsh-advisor-chain-boundary",
			order: 151,
			text: (assembly) => {
				const cfg = liveConfig();
				if (presets?.presetForSession?.(assembly?.session) === "dsh-advisor-chain-advisor") return "";
				const pressure = pressureTracker.get(assembly?.session?.id);
				const sessionId = assembly?.session?.id;
				if (sessionId && pressure && pressure.count >= cfg.trigger.repeatThreshold && loggedStreaks.get(sessionId) !== pressure.count) {
					loggedStreaks.set(sessionId, pressure.count);
					log(`hard trigger engaged: session ${sessionId} has repeated the same question ${pressure.count} times`);
				}
				return buildSectionText(cfg, pressure, cfg.trigger.repeatThreshold, resolveLanguage(pressure?.text ?? ""));
			}
		}), "dsh-advisor-chain: system prompt section");
	}
	if (typeof ctx.inject === "function") ctx.inject(["settings"], (scoped) => {
		const dispose = scoped.settings.configure({ auto: false }, ctx.fiber);
		return () => {
			if (typeof dispose === "function") dispose();
		};
	});
}
export { Config, apply, inject, name };
