(function() {

// src/client/i18n.ts
/**
	* Browser-side copy for the settings page, the chat cards and the navigation
	* entry, in every supported language.
	*
	* The dictionaries are registered with the host's locale service
	* (`ctx.locale.register(NS, { zh, en, … })`); the host resolves keys through
	* the active language's fallback chain (zh → en) and re-renders outlets that
	* were registered with `locale: NS`. Adding a language = adding one object
	* with the same keys here and passing it to `register`.
	*
	* Keys are flat; `{name}` placeholders are filled by the host's translator.
	*/
	const CLIENT_NS = "dsh-advisor-chain";
	const zh = {
		"nav.title": "顾问设置",
		"common.foldOpen": "▾",
		"common.foldClosed": "▸",
		"common.retry": "重试",
		"common.okMark": "✓",
		"common.failMark": "✗",
		"common.delete": "删除",
		"common.moveUp": "上移",
		"common.moveDown": "下移",
		"common.cancelEdits": "放弃修改",
		"common.save": "保存",
		"common.saving": "保存中…",
		"common.unsaved": "有未保存更改",
		"common.remoteMissing": "当前环境没有 remote 服务，无法读写配置。",
		"common.remoteFailed": "{what}失败：{detail}",
		"common.remoteAbnormal": "远程调用返回异常",
		"common.readSettings": "读取设置",
		"common.loading": "加载配置中…",
		"common.nsMissing": "未找到本插件的配置命名空间（插件可能未启用或未安装完成）。",
		"card.title": "Second Opinion 咨询",
		"card.followUpTitle": "追问 {round}",
		"card.followUpTitlePlain": "追问",
		"card.statusRunning": "咨询中…",
		"card.statusDone": "完成",
		"card.statusFailed": "失败",
		"card.modeStandalone": "盲审",
		"card.modeInherited": "继承",
		"card.truncated": "已截断",
		"card.contextToggle": "补充背景",
		"card.runningHint": "顾问正在只读审阅，回答完成后显示在这里（过程可在子代理面板查看）",
		"card.attempts": "尝试记录：",
		"card.toolFailed": "工具调用失败",
		"card.usage": "本次：输入 {input} / 输出 {output} token{cached}，耗时 {duration}",
		"card.usageCached": "（其中缓存命中 {cached}）",
		"card.usageSeconds": "{s} 秒",
		"card.openProcess": "查看过程",
		"card.openProcessHint": "在右侧栏打开顾问的子会话，查看它读了什么、怎么想的",
		"card.opinion": "意见 {n}",
		"legacy.badge": "旧版记录",
		"legacy.thinking": "顾问思考过程",
		"legacy.consulting": "正在咨询 {label} …",
		"legacy.followUp": "追问 {n}：{text}",
		"legacy.thinkingEllipsis": "思考中…",
		"status.ok": "✓ 可用",
		"status.providerMissing": "⚠ 供应商不存在",
		"status.modelUnknown": "⚠ 模型未配置",
		"status.catalogUnknown": "⚠ 未取到模型列表",
		"status.selectionOff": "⚠ 子代理模型选择已关闭",
		"status.unauthorized": "⚠ 未授权",
		"status.effortUndeclared": "⚠ 档位未声明",
		"status.pickProvider": "请选择供应商。",
		"status.providerMissingDetail": "DSH 里没有叫「{provider}」的供应商。请到 设置 → 模型 检查或重新添加，然后回来改选。",
		"status.pickModel": "请选择模型。",
		"status.modelUnknownDetail": "模型「{model}」不在该供应商的模型列表里。请到 设置 → 模型 添加，或在这里改选。",
		"status.catalogUnknownDetail": "未取到「{provider}」的模型列表（登录型账号的模型不在配置文件里）。已填写的模型会在调用时校验；也可以点「获取模型列表」再试。",
		"status.noAllowlist": "当前 DSH 组合没有子代理模型白名单，可直接使用。",
		"status.selectionOffDetail": "DSH 的「子代理模型选择」是关闭的，顾问无法使用和主对话不同的模型。「开启并授权」会打开它并把上面的模型加入白名单。",
		"status.unauthorizedDetail": "这个模型还没授权给子代理。点「授权」即可——会把「{route}」写进 DSH 的子代理模型白名单{name}。",
		"status.unauthorizedName": "（{name}）",
		"status.effortUndeclaredNone": "模型 {model} 没有声明推理等级，档位「{effort}」会被忽略。到 设置 → 模型 → 编辑该供应商 → 自定义设置 → 模型选项 → 推理等级 开启，或把档位留空。",
		"status.effortUndeclaredOther": "模型 {model} 声明的推理等级是 {declared}，档位「{effort}」会被忽略。",
		"entry.labelField": "显示名（可选）",
		"entry.labelPlaceholder": "如：架构顾问",
		"entry.providerField": "供应商",
		"entry.providerNone": "（未获取到供应商）",
		"entry.modelField": "模型",
		"entry.modelPick": "请选择",
		"entry.modelCatalogEmpty": "未取到模型列表",
		"entry.modelNotListed": "{model}（不在已获取的模型列表里）",
		"entry.discover": "获取模型列表",
		"entry.discovering": "获取中…",
		"entry.effortField": "推理档位",
		"entry.effortDefault": "默认（模型默认档位）",
		"entry.effortDefaultUndeclared": "默认（该模型未声明推理等级）",
		"entry.effortUndeclaredOption": "{effort}（未声明，会被忽略）",
		"entry.maxTokensField": "maxTokens",
		"entry.timeoutField": "超时（毫秒）",
		"entry.authorize": "授权",
		"entry.authorizeEnable": "开启并授权",
		"entry.discoveredCount": "已获取「{provider}」的 {count} 个模型，可在下拉中选择。",
		"entry.discoveredNone": "没有取到「{provider}」的模型列表：该供应商可能需要先在 设置 → 模型 里登录或配置。",
		"entry.discoverFailed": "获取模型列表失败：{message}",
		"settings.enabledTitle": "启用 Second Opinion",
		"settings.enabledDesc": "停用后 second_opinion 不可用，也不再注入使用边界提示。",
		"settings.triggerTitle": "触发模式",
		"settings.triggerDesc": "auto：主模型按调用判据自主咨询；manual：仅用户明确要求时咨询。",
		"settings.triggerAuto": "auto（主模型自主判断）",
		"settings.triggerManual": "manual（仅用户要求时）",
		"settings.modeTitle": "默认咨询模式",
		"settings.modeDesc": "继承：顾问收到当前会话的有界抄本；盲审：顾问不看对话，只依据问题与补充背景独立判断。可在调用时按次覆盖。",
		"settings.modeInherited": "继承（会话抄本）",
		"settings.modeStandalone": "盲审（独立判断）",
		"settings.compositionTitle": "顾问组成",
		"settings.compositionDesc": "精简：顾问只带只读工具（读取、搜索、只读命令），输入更小、身份更干净，不可用时自动回退；继承：顾问带主对话的全部工具与提示（技能目录、MCP 工具等），每次咨询的输入明显更大。",
		"settings.compositionLean": "精简（只读工具）",
		"settings.compositionInherit": "继承主对话",
		"settings.chainTitle": "顾问模型链",
		"settings.chainDesc": "按顺序尝试；某项失败自动顺延下一个。顾问是只读子代理：能读文件、跑只读命令核实，改不了任何东西。模型与推理等级在 设置 → 模型 里配置，这里只从中选择。",
		"settings.chainAuthorizeAll": "授权全部",
		"settings.chainEnableAndAuthorizeAll": "开启并授权全部",
		"settings.chainAdd": "＋ 添加顾问模型",
		"settings.chainEmpty": "尚未配置顾问模型——先在 设置 → 模型 里添加供应商和模型，再在这里选择。",
		"settings.promptTitle": "顾问提示词",
		"settings.promptDesc": "整条链共用的回答要求；清空并保存可回落到插件默认。身份、只读与输出约束由插件固定追加，不在这里。",
		"settings.followUpTitle": "最多追问轮数",
		"settings.followUpDesc": "每个咨询线程最多可追问多少轮；追问复用同一个顾问子会话。",
		"settings.timeoutTitle": "默认超时（毫秒）",
		"settings.timeoutDesc": "顾问未单独配置超时时的上限。顾问可能先思考再作答；开始输出回答后只要持续输出就不会被打断。",
		"settings.transcriptTitle": "抄本字符预算",
		"settings.transcriptDesc": "继承模式下发给顾问的会话抄本总字符上限；超出时保留最新部分并附最初请求的摘要。",
		"settings.perEntryTitle": "单条消息上限",
		"settings.perEntryDesc": "抄本中单条消息（含工具输出）的最大字符数；超出部分被截断，顾问可按路径自行读取完整内容。",
		"settings.repeatTitle": "重复提问强制咨询阈值",
		"settings.repeatDesc": "同一用户问题重复达到该次数时，提示升级为强制咨询。",
		"auth.noSetting": "当前 DSH 组合没有「子代理模型选择」设置，无法自动授权。请到 设置 → 插件 → 子代理 手动开启。",
		"auth.write": "写入子代理模型白名单",
		"auth.done": "已授权 {count} 个模型给子代理（DSH 的子代理模型选择已{state}）。",
		"auth.stateKept": "保持开启",
		"auth.stateOn": "开启",
		"auth.conflict": "设置刚被别处修改，已重新加载；请再点一次「授权」。",
		"auth.failed": "自动授权失败：{message}。请到 设置 → 插件 → 子代理 手动开启模型选择并添加模型。",
		"save.write": "保存设置",
		"save.done": "已保存并即时生效。{dropped}",
		"save.dropped": " 已忽略 {count} 个未填供应商/模型的未完成条目。",
		"save.conflict": "检测到配置已被外部修改：已重新加载最新配置，未保存的修改已被替换，请重新调整后再保存。",
		"save.failed": "保存失败：{message}",
		"banner.write": "记录提醒状态",
		"banner.dismissed": "已记录，之后不再显示这条提醒。",
		"banner.dismissFailed": "记录失败：{message}；本次关闭后下次仍会显示。",
		"banner.title": "你从旧版本升级而来",
		"banner.body": "升级前的会话里留有旧版 Second Opinion 写入的咨询记录：只要本插件保持启用，这些会话可以正常打开；卸载本插件后它们可能无法打开。本版本不再写入这类记录，修复旧会话的工具将在下一版本提供。",
		"banner.link": "详见 README「升级须知」",
		"banner.dismiss": "知道了",
		"about.title": "关于",
		"about.by": "Second Opinion（dsh-advisor-chain）由 ",
		"about.inspired": " 开发。灵感来自 ",
		"about.end": "。"
	};
	const en = {
		"nav.title": "Advisor",
		"common.foldOpen": "▾",
		"common.foldClosed": "▸",
		"common.retry": "Retry",
		"common.okMark": "✓",
		"common.failMark": "✗",
		"common.delete": "Delete",
		"common.moveUp": "Move up",
		"common.moveDown": "Move down",
		"common.cancelEdits": "Discard edits",
		"common.save": "Save",
		"common.saving": "Saving…",
		"common.unsaved": "Unsaved changes",
		"common.remoteMissing": "This environment has no remote service, so settings cannot be read or written.",
		"common.remoteFailed": "{what} failed: {detail}",
		"common.remoteAbnormal": "the remote call returned an error",
		"common.readSettings": "Reading settings",
		"common.loading": "Loading settings…",
		"common.nsMissing": "This plugin's settings namespace was not found (the plugin may be disabled or not fully installed).",
		"card.title": "Second Opinion consultation",
		"card.followUpTitle": "Follow-up {round}",
		"card.followUpTitlePlain": "Follow-up",
		"card.statusRunning": "Consulting…",
		"card.statusDone": "Done",
		"card.statusFailed": "Failed",
		"card.modeStandalone": "Blind review",
		"card.modeInherited": "Inherited",
		"card.truncated": "truncated",
		"card.contextToggle": "Background",
		"card.runningHint": "The advisor is reviewing read-only; its answer appears here when finished (progress is in the subagent panel)",
		"card.attempts": "Attempts: ",
		"card.toolFailed": "Tool call failed",
		"card.usage": "This call: {input} input / {output} output tokens{cached}, {duration}",
		"card.usageCached": " ({cached} cache hits)",
		"card.usageSeconds": "{s} s",
		"card.openProcess": "View process",
		"card.openProcessHint": "Open the advisor's conversation in the right sidebar to see what it read and how it reasoned",
		"card.opinion": "Opinion {n}",
		"legacy.badge": "legacy record",
		"legacy.thinking": "Advisor reasoning",
		"legacy.consulting": "Consulting {label} …",
		"legacy.followUp": "Follow-up {n}: {text}",
		"legacy.thinkingEllipsis": "Thinking…",
		"status.ok": "✓ Ready",
		"status.providerMissing": "⚠ Provider not found",
		"status.modelUnknown": "⚠ Model not configured",
		"status.catalogUnknown": "⚠ Model list unavailable",
		"status.selectionOff": "⚠ Subagent model selection is off",
		"status.unauthorized": "⚠ Not authorized",
		"status.effortUndeclared": "⚠ Effort not declared",
		"status.pickProvider": "Pick a provider.",
		"status.providerMissingDetail": "DSH has no provider named \"{provider}\". Check or re-add it under Settings → Models, then pick it here again.",
		"status.pickModel": "Pick a model.",
		"status.modelUnknownDetail": "Model \"{model}\" is not in this provider's model list. Add it under Settings → Models or pick another one here.",
		"status.catalogUnknownDetail": "The model list for \"{provider}\" was not retrieved (signed-in account models are not in the settings file). A model you type is validated at call time; you can also click \"Fetch model list\" to retry.",
		"status.noAllowlist": "This DSH composition has no subagent model allowlist; the model can be used directly.",
		"status.selectionOffDetail": "DSH's subagent model selection is off, so the advisor cannot use a model different from the main conversation. \"Enable and authorize\" turns it on and adds the models above to the allowlist.",
		"status.unauthorizedDetail": "This model is not yet authorized for subagents. Click \"Authorize\" — it writes \"{route}\" into DSH's subagent model allowlist{name}.",
		"status.unauthorizedName": " ({name})",
		"status.effortUndeclaredNone": "Model {model} declares no reasoning effort, so \"{effort}\" is ignored. Enable efforts under Settings → Models → edit the provider → Custom settings → Model options → Reasoning effort, or leave the effort empty.",
		"status.effortUndeclaredOther": "Model {model} declares the efforts {declared}; \"{effort}\" is ignored.",
		"entry.labelField": "Display name (optional)",
		"entry.labelPlaceholder": "e.g. Architecture advisor",
		"entry.providerField": "Provider",
		"entry.providerNone": "(no providers retrieved)",
		"entry.modelField": "Model",
		"entry.modelPick": "Pick…",
		"entry.modelCatalogEmpty": "Model list unavailable",
		"entry.modelNotListed": "{model} (not in the retrieved list)",
		"entry.discover": "Fetch model list",
		"entry.discovering": "Fetching…",
		"entry.effortField": "Reasoning effort",
		"entry.effortDefault": "Default (model default)",
		"entry.effortDefaultUndeclared": "Default (model declares no efforts)",
		"entry.effortUndeclaredOption": "{effort} (not declared, ignored)",
		"entry.maxTokensField": "maxTokens",
		"entry.timeoutField": "Timeout (ms)",
		"entry.authorize": "Authorize",
		"entry.authorizeEnable": "Enable and authorize",
		"entry.discoveredCount": "Retrieved {count} models for \"{provider}\"; pick one from the dropdown.",
		"entry.discoveredNone": "No model list was retrieved for \"{provider}\": the provider may need a sign-in or configuration under Settings → Models first.",
		"entry.discoverFailed": "Fetching the model list failed: {message}",
		"settings.enabledTitle": "Enable Second Opinion",
		"settings.enabledDesc": "When disabled, second_opinion is unavailable and the usage guidance is not injected.",
		"settings.triggerTitle": "Trigger mode",
		"settings.triggerDesc": "auto: the main model consults on its own judgement; manual: only when the user explicitly asks.",
		"settings.triggerAuto": "auto (main model decides)",
		"settings.triggerManual": "manual (only on request)",
		"settings.modeTitle": "Default consultation mode",
		"settings.modeDesc": "Inherited: the advisor receives a bounded transcript of this conversation; blind review: the advisor sees no conversation and judges only from the question and background. Overridable per call.",
		"settings.modeInherited": "Inherited (transcript)",
		"settings.modeStandalone": "Blind review (independent)",
		"settings.compositionTitle": "Advisor composition",
		"settings.compositionDesc": "Lean: the advisor carries only read-only tools (read, search, read-only commands) — smaller input and a cleaner identity, falling back automatically when unavailable. Inherit: the advisor carries the main conversation's full tools and prompt (skill catalog, MCP tools, …), which makes every consultation's input much larger.",
		"settings.compositionLean": "Lean (read-only tools)",
		"settings.compositionInherit": "Inherit the main conversation",
		"settings.chainTitle": "Advisor model chain",
		"settings.chainDesc": "Tried in order; a failure falls through to the next. The advisor is a read-only subagent: it can read files and run read-only commands to verify, but cannot change anything. Models and reasoning efforts are configured in Settings → Models; this page only picks from them.",
		"settings.chainAuthorizeAll": "Authorize all",
		"settings.chainEnableAndAuthorizeAll": "Enable and authorize all",
		"settings.chainAdd": "＋ Add advisor model",
		"settings.chainEmpty": "No advisor model configured yet — add a provider and model under Settings → Models first, then pick them here.",
		"settings.promptTitle": "Advisor prompt",
		"settings.promptDesc": "Answer requirements shared by the whole chain; clear and save to fall back to the built-in default. Identity, read-only and output constraints are appended by the plugin and are not edited here.",
		"settings.followUpTitle": "Max follow-up rounds",
		"settings.followUpDesc": "How many follow-up rounds each consultation thread allows; follow-ups reuse the same advisor subagent.",
		"settings.timeoutTitle": "Default timeout (ms)",
		"settings.timeoutDesc": "The cap when an entry has no timeout of its own. The advisor may think before answering; once it starts writing, it is never cut off while output continues.",
		"settings.transcriptTitle": "Transcript budget (characters)",
		"settings.transcriptDesc": "Total character budget of the conversation transcript sent in inherited mode; beyond it the newest part is kept and the original request is summarized.",
		"settings.perEntryTitle": "Per-message cap",
		"settings.perEntryDesc": "Maximum characters per message (including tool outputs) in the transcript; longer content is clipped and the advisor reads the full file by path.",
		"settings.repeatTitle": "Repeated-question threshold",
		"settings.repeatDesc": "When the same user question has been repeated this many times, the reminder escalates to a mandatory consultation.",
		"auth.noSetting": "This DSH composition has no \"subagent model selection\" setting, so automatic authorization is unavailable. Enable it manually under Settings → Plugins → Subagents.",
		"auth.write": "Writing the subagent model allowlist",
		"auth.done": "Authorized {count} model(s) for subagents (DSH's subagent model selection is {state}).",
		"auth.stateKept": "still on",
		"auth.stateOn": "now on",
		"auth.conflict": "Settings changed elsewhere; reloaded — click \"Authorize\" once more.",
		"auth.failed": "Automatic authorization failed: {message}. Enable model selection and add the model manually under Settings → Plugins → Subagents.",
		"save.write": "Saving settings",
		"save.done": "Saved and effective immediately.{dropped}",
		"save.dropped": " {count} incomplete entries without a provider or model were skipped.",
		"save.conflict": "Settings changed elsewhere: the latest configuration was reloaded and unsaved edits were replaced; adjust again before saving.",
		"save.failed": "Saving failed: {message}",
		"banner.write": "Recording the notice state",
		"banner.dismissed": "Recorded; this notice will not show again.",
		"banner.dismissFailed": "Recording failed: {message}; the notice will show again next time.",
		"banner.title": "You upgraded from an older version",
		"banner.body": "Sessions from before the upgrade contain consultation records written by the old Second Opinion: they open normally while this plugin stays enabled, but may fail to open after it is uninstalled. This version no longer writes such records; a repair tool arrives in the next version.",
		"banner.link": "See the README upgrade notes",
		"banner.dismiss": "Got it",
		"about.title": "About",
		"about.by": "Second Opinion (dsh-advisor-chain) is developed by ",
		"about.inspired": ". Inspired by ",
		"about.end": "."
	};
	const CLIENT_DICTIONARIES = {
		zh,
		en
	};
	/** Stand-in used until the host's locale service binds the namespace (and in tests). */
	function fallbackTranslate(key, params) {
		const template = zh[key] ?? key;
		if (!params) return template;
		return template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name] ?? "") : match);
	}

// src/client.ts
	window.__ModuleLoader__.load({
		id: "dsh-advisor-chain",
		factory(require) {
			const React = require("react");
			const h = React.createElement;
			const useState = React.useState;
			const useEffect = React.useEffect;
			const useRef = React.useRef;
			/** Translator; replaced by the host-bound one once the locale service registers our namespace. */
			let t = fallbackTranslate;
			const R = {
				sm: "var(--dsw-radius-sm, 8px)",
				md: "var(--dsw-radius-md, 12px)",
				lg: "var(--dsw-radius-lg, 16px)",
				xl: "var(--dsw-radius-xl, 20px)"
			};
			const cardStyle = {
				border: "1px solid var(--dsw-alias-border-l1)",
				borderRadius: R.xl,
				background: "var(--dsw-alias-bg-layer-1)",
				padding: "12px 14px",
				margin: "6px 0",
				fontSize: 13,
				lineHeight: 1.6
			};
			const badgeStyle = (color) => ({
				display: "inline-block",
				padding: "0 8px",
				borderRadius: R.sm,
				fontSize: 11,
				lineHeight: "20px",
				color: "var(--dsw-alias-bg-base)",
				background: color,
				marginLeft: 6
			});
			/** Neutral outline badge: readable in both themes, unlike a layer fill
			*  paired with the base text color (dark-on-dark in the dark theme). */
			const subtleBadgeStyle = {
				display: "inline-block",
				padding: "0 8px",
				borderRadius: R.sm,
				fontSize: 11,
				lineHeight: "18px",
				border: "1px solid var(--dsw-alias-border-l2)",
				color: "var(--dsw-alias-label-secondary)",
				background: "transparent",
				marginLeft: 6
			};
			const smallStyle = {
				fontSize: 12,
				opacity: .75
			};
			const warnStyle = {
				fontSize: 12,
				color: "var(--dsw-alias-state-warn-primary)"
			};
			const errorStyle = {
				fontSize: 12,
				color: "var(--dsw-alias-state-error-primary)"
			};
			const okStyle = {
				fontSize: 12,
				color: "var(--dsw-alias-state-success-primary)"
			};
			const labelStyle = {
				fontWeight: 600,
				marginRight: 6
			};
			const toggleStyle = {
				background: "transparent",
				border: "none",
				color: "var(--dsw-alias-brand-primary)",
				cursor: "pointer",
				padding: 0,
				fontSize: 12
			};
			const linkButtonStyle = {
				...toggleStyle,
				marginLeft: "auto",
				whiteSpace: "nowrap"
			};
			const legacyAdvisorCardDefinition = {
				kind: "dsh-advisor-chain-legacy",
				target: "chat",
				match(event) {
					if ((event.type === "advisor/start" || event.type === "advisor/followup") && event.data?.consultId) return {
						id: event.data.consultId,
						role: event.type === "advisor/start" ? "start" : "update"
					};
					if ((event.type === "advisor/delta" || event.type === "advisor/message" || event.type === "advisor/end") && event.data?.consultId) return {
						id: event.data.consultId,
						role: "update"
					};
					return null;
				},
				start(_context, match) {
					const data = match.event.data;
					return {
						consultId: data.consultId,
						question: data.question,
						context: data.context,
						chain: data.chain,
						status: "running",
						currentAttempt: 0,
						liveContent: "",
						liveThinking: "",
						messages: [],
						followUps: [],
						attempts: []
					};
				},
				update(context, match) {
					const data = match.event.data;
					const state = context.state;
					if (match.event.type === "advisor/delta") {
						const attemptIndex = data.attemptIndex ?? 0;
						const round = typeof data.round === "number" ? data.round : 0;
						if (round >= 1) {
							const followUps = state.followUps.map((f, i) => i === round - 1 ? {
								...f,
								answer: (f.answer ?? "") + (data.contentDelta ?? "")
							} : f);
							return {
								...state,
								currentAttempt: attemptIndex,
								followUps
							};
						}
						const reset = attemptIndex !== state.currentAttempt;
						return {
							...state,
							currentAttempt: attemptIndex,
							liveContent: (reset ? "" : state.liveContent) + (data.contentDelta ?? ""),
							liveThinking: (reset ? "" : state.liveThinking) + (data.thinkingDelta ?? "")
						};
					}
					if (match.event.type === "advisor/followup") {
						const round = data.round ?? state.followUps.length + 1;
						const followUps = [...state.followUps];
						followUps[round - 1] = { text: data.followUp ?? "" };
						return {
							...state,
							followUps,
							liveContent: "",
							liveThinking: ""
						};
					}
					if (match.event.type === "advisor/message") {
						const round = typeof data.round === "number" ? data.round : 0;
						if (round >= 1) {
							const followUps = state.followUps.map((f, i) => i === round - 1 ? {
								...f,
								answer: data.content ?? "",
								truncated: data.truncated === true || f.truncated
							} : f);
							return {
								...state,
								followUps,
								liveContent: "",
								liveThinking: ""
							};
						}
						const attemptIndex = data.attemptIndex ?? 0;
						const row = {
							attemptIndex,
							label: data.label ?? "",
							model: `${data.provider}/${data.model}`,
							content: data.content ?? "",
							thinking: data.thinking,
							truncated: data.truncated === true
						};
						const messages = state.messages.filter((m) => m.attemptIndex !== attemptIndex);
						messages.push(row);
						return {
							...state,
							messages,
							liveContent: "",
							liveThinking: ""
						};
					}
					if (match.event.type === "advisor/end") return {
						...state,
						status: data.status ?? "done",
						attempts: data.attempts ?? state.attempts,
						truncated: data.truncated === true || state.truncated
					};
					return state;
				},
				buildViewNode(context) {
					if (context.state === void 0) return null;
					return {
						key: context.key,
						kind: "dsh-advisor-chain-legacy",
						id: context.id,
						target: "chat",
						anchorSeq: context.start?.event?.seq ?? context.matches?.[0]?.event?.seq ?? 0,
						location: context.start?.location ?? context.matches?.[0]?.location ?? { kind: "unresolved" },
						visibility: "visible",
						data: context.state
					};
				}
			};
			function Fold({ title, children, defaultOpen = false }) {
				const [open, setOpen] = useState(defaultOpen);
				return h("div", null, h("button", {
					style: toggleStyle,
					onClick: () => setOpen(!open),
					type: "button"
				}, `${open ? t("common.foldOpen") : t("common.foldClosed")} ${title}`), open ? h("div", { style: {
					whiteSpace: "pre-wrap",
					...smallStyle,
					marginTop: 4
				} }, children) : null);
			}
			const codeFont = "var(--dsw-font-markdown-code-block-small, ui-monospace, Consolas, monospace)";
			const inlineCodeStyle = {
				fontFamily: codeFont,
				fontSize: 12,
				background: "var(--dsw-alias-markdown-code-block)",
				padding: "0 4px",
				borderRadius: 4
			};
			const preStyle = {
				margin: "8px 0",
				padding: "8px 10px",
				borderRadius: R.sm,
				background: "var(--dsw-alias-markdown-code-block)",
				overflowX: "auto",
				fontSize: 12,
				lineHeight: 1.5
			};
			const paraStyle = {
				whiteSpace: "pre-wrap",
				marginTop: 6
			};
			const listStyle = {
				margin: "6px 0",
				paddingLeft: 20
			};
			function inlineSpans(text, keyPrefix) {
				const parts = [];
				const re = /(\*\*[^*\n]+?\*\*|`[^`\n]+`)/g;
				let last = 0;
				let i = 0;
				let match;
				while ((match = re.exec(text)) !== null) {
					if (match.index > last) parts.push(text.slice(last, match.index));
					const token = match[0];
					if (token.startsWith("**")) parts.push(h("strong", { key: `${keyPrefix}-b${i++}` }, token.slice(2, -2)));
					else parts.push(h("code", {
						key: `${keyPrefix}-c${i++}`,
						style: inlineCodeStyle
					}, token.slice(1, -1)));
					last = match.index + token.length;
				}
				if (last < text.length) parts.push(text.slice(last));
				return parts;
			}
			function renderMarkdown(text) {
				const lines = text.replace(/\r\n/g, "\n").split("\n");
				const out = [];
				let para = [];
				let list = null;
				let ordered = false;
				let code = null;
				let k = 0;
				const flushPara = () => {
					if (!para.length) return;
					const key = k++;
					out.push(h("div", {
						key,
						style: paraStyle
					}, inlineSpans(para.join("\n"), `p${key}`)));
					para = [];
				};
				const flushList = () => {
					if (!list) return;
					const key = k++;
					const items = list;
					out.push(h(ordered ? "ol" : "ul", {
						key,
						style: listStyle
					}, items.map((item, idx) => h("li", {
						key: idx,
						style: {
							whiteSpace: "pre-wrap",
							marginBottom: 2
						}
					}, inlineSpans(item, `l${key}-${idx}`)))));
					list = null;
				};
				const flushCode = () => {
					if (!code) return;
					const key = k++;
					out.push(h("pre", {
						key,
						style: preStyle
					}, h("code", { style: { fontFamily: codeFont } }, code.join("\n"))));
					code = null;
				};
				for (const raw of lines) {
					if (code) {
						if (/^\s*```\s*$/.test(raw)) flushCode();
						else code.push(raw);
						continue;
					}
					const line = raw.trimEnd();
					if (/^\s*```/.test(line)) {
						flushPara();
						flushList();
						code = [];
						continue;
					}
					const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
					if (heading) {
						flushPara();
						flushList();
						const level = heading[1].length;
						const key = k++;
						out.push(h("div", {
							key,
							style: {
								fontWeight: 600,
								fontSize: level <= 2 ? 15 : 13.5,
								marginTop: 10,
								marginBottom: 2
							}
						}, inlineSpans(heading[2], `h${key}`)));
						continue;
					}
					if (!line.trim()) {
						flushPara();
						flushList();
						continue;
					}
					const bullet = /^\s*[-*•]\s+(.*)$/.exec(raw);
					const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(raw);
					if (bullet || numbered) {
						flushPara();
						const isOrdered = !!numbered;
						if (!list || ordered !== isOrdered) {
							flushList();
							list = [];
							ordered = isOrdered;
						}
						list.push((bullet ?? numbered)[1]);
						continue;
					}
					if (list) {
						list[list.length - 1] += `\n${line}`;
						continue;
					}
					para.push(line);
				}
				flushCode();
				flushList();
				flushPara();
				return out;
			}
			function LegacyAdvisorCardView(props) {
				const data = props.node?.data;
				const [contextOpen, setContextOpen] = useState(false);
				if (!data) return null;
				const failed = data.status === "failed";
				const running = data.status === "running";
				const messages = data.messages ?? [];
				const followUps = data.followUps ?? [];
				const statusBadge = failed ? badgeStyle("var(--dsw-alias-state-error-primary)") : running ? badgeStyle("var(--dsw-alias-state-warn-primary)") : badgeStyle("var(--dsw-alias-state-success-primary)");
				const statusText = failed ? t("card.statusFailed") : running ? t("card.statusRunning") : t("card.statusDone");
				return h("div", { style: cardStyle }, h("div", null, h("span", { style: labelStyle }, t("card.title")), h("span", { style: subtleBadgeStyle }, t("legacy.badge")), h("span", { style: statusBadge }, statusText), messages.map((m) => h("span", {
					key: m.attemptIndex,
					style: badgeStyle("var(--dsw-alias-brand-primary)")
				}, m.model)), data.truncated ? h("span", { style: badgeStyle("var(--dsw-alias-state-warn-primary)") }, t("card.truncated")) : null), h("div", { style: {
					fontWeight: 600,
					margin: "6px 0 2px"
				} }, data.question), data.context ? h("div", null, h("button", {
					style: toggleStyle,
					type: "button",
					onClick: () => setContextOpen(!contextOpen)
				}, `${contextOpen ? t("common.foldOpen") : t("common.foldClosed")} ${t("card.contextToggle")}`), contextOpen ? h("div", { style: {
					whiteSpace: "pre-wrap",
					...smallStyle,
					marginTop: 4
				} }, data.context) : null) : null, messages.length > 0 && messages.some((m) => m.thinking) ? h(Fold, { title: t("legacy.thinking") }, messages.map((m) => m.thinking).filter(Boolean).join("\n\n")) : null, messages.length > 0 ? h("div", { style: {
					display: "flex",
					gap: 12,
					flexWrap: "wrap",
					marginTop: 6
				} }, messages.map((m) => h("div", {
					key: m.attemptIndex,
					style: {
						flex: "1 1 240px",
						minWidth: 240,
						border: "1px solid var(--dsw-alias-border-l1)",
						borderRadius: R.lg,
						padding: "6px 8px"
					}
				}, h("div", { style: {
					...smallStyle,
					marginBottom: 4
				} }, m.label || m.model), h("div", null, renderMarkdown(m.content))))) : running ? h("div", { style: {
					whiteSpace: "pre-wrap",
					marginTop: 6
				} }, data.liveContent ? data.liveContent + "▍" : t("legacy.consulting", { label: data.chain?.[data.currentAttempt]?.label ?? "" })) : null, followUps.map((f, i) => h("div", {
					key: i,
					style: {
						marginTop: 10,
						paddingTop: 8,
						borderTop: "0.5px solid var(--dsw-alias-border-l1)"
					}
				}, h("div", { style: {
					fontWeight: 600,
					...smallStyle
				} }, t("legacy.followUp", {
					n: i + 1,
					text: f.text
				})), h("div", null, f.answer === void 0 ? h("span", { style: smallStyle }, t("legacy.thinkingEllipsis")) : renderMarkdown(f.answer)))), data.attempts?.length ? h("div", { style: {
					marginTop: 8,
					...smallStyle
				} }, t("card.attempts"), data.attempts.map((attempt, i) => h("span", { key: i }, i > 0 ? " → " : "", attempt.ok ? t("common.okMark") : t("common.failMark"), attempt.label, attempt.ok || !attempt.error ? "" : `（${attempt.error}）`))) : null);
			}
			/** Opens a `dsh-resource://` address in the right Sidebar; bound when the host provides `sidebarRight`. */
			let openInSidebar;
			/** Address of an advisor child's conversation in the Session panel's Subagents catalog. */
			function subagentChatAddress(parent, child) {
				return `dsh-resource://subagentchat/session/${encodeURIComponent(child)}?parent=${encodeURIComponent(parent)}&mode=continuable`;
			}
			/** Read the call's arguments from the host's `PartialArguments` reader
			*  (`text(key)` / `value(key)`), falling back to the raw JSON when the
			*  reader is unavailable (malformed or older blocks). */
			function argsOf(block) {
				const a = block?.args;
				if (a && typeof a.text === "function") {
					const text = (key) => a.text(key) || void 0;
					return {
						question: text("question"),
						context: text("context"),
						mode: text("mode"),
						follow_up: text("follow_up"),
						consult_id: text("consult_id"),
						dual_opinions: typeof a.value === "function" ? a.value("dual_opinions") === true : void 0
					};
				}
				const raw = typeof block?.argsRaw === "string" ? block.argsRaw : typeof block?.call?.argsRaw === "string" ? block.call.argsRaw : void 0;
				if (typeof raw === "string" && raw.trim()) try {
					return JSON.parse(raw);
				} catch {
					return {};
				}
				return {};
			}
			function metaOf(block) {
				const m = block?.meta;
				return m && typeof m === "object" && m.kind === "second-opinion" ? m : void 0;
			}
			function contentText(block) {
				return (block?.content ?? []).map((c) => c?.type === "text" && typeof c.text === "string" ? c.text : "").join("").trim();
			}
			/** Keyed `tool.call.toolview` row for `second_opinion`. Malformed input
			*  degrades to a plain rendering of whatever the block carries. */
			function SecondOpinionToolRow(props) {
				const block = props.block;
				const [contextOpen, setContextOpen] = useState(false);
				const running = props.phase !== "result" && block?.kind !== "tool-result";
				const args = argsOf(block);
				const meta = metaOf(block);
				const question = meta?.question ?? meta?.followUp ?? args.question ?? args.follow_up ?? "";
				const context = meta?.context ?? args.context;
				const attempts = meta?.attempts ?? [];
				const okCount = attempts.filter((a) => a.ok).length;
				const failed = !running && (block?.isError === true || attempts.length > 0 && okCount === 0);
				const truncated = meta?.truncated === true;
				const statusBadge = running ? badgeStyle("var(--dsw-alias-state-warn-primary)") : failed ? badgeStyle("var(--dsw-alias-state-error-primary)") : badgeStyle("var(--dsw-alias-state-success-primary)");
				const statusText = running ? t("card.statusRunning") : failed ? t("card.statusFailed") : t("card.statusDone");
				const models = (meta?.model ?? "").split(" + ").filter(Boolean);
				const text = contentText(block);
				const title = (meta?.round ?? 0) >= 1 || !!args.consult_id && !args.question ? meta?.round ? t("card.followUpTitle", { round: meta.round }) : t("card.followUpTitlePlain") : t("card.title");
				const mode = meta?.mode ?? args.mode;
				const dualColumns = meta?.dual && Array.isArray(meta.opinions) && meta.opinions.length === 2 ? meta.opinions : void 0;
				const processLink = (childId, style = linkButtonStyle) => openInSidebar && childId && meta?.parent ? h("button", {
					style,
					type: "button",
					title: t("card.openProcessHint"),
					onClick: () => openInSidebar(subagentChatAddress(meta.parent, childId))
				}, t("card.openProcess")) : null;
				return h("div", {
					style: cardStyle,
					"data-dsh-advisor": "card"
				}, h("div", { style: {
					display: "flex",
					alignItems: "center",
					flexWrap: "wrap",
					gap: 4
				} }, h("span", { style: labelStyle }, title), h("span", { style: statusBadge }, statusText), mode ? h("span", { style: subtleBadgeStyle }, mode === "standalone" ? t("card.modeStandalone") : t("card.modeInherited")) : null, models.map((m, i) => h("span", {
					key: i,
					style: badgeStyle("var(--dsw-alias-brand-primary)")
				}, m)), truncated ? h("span", { style: badgeStyle("var(--dsw-alias-state-warn-primary)") }, t("card.truncated")) : null, dualColumns ? null : processLink(meta?.consultId)), question ? h("div", { style: {
					fontWeight: 600,
					margin: "6px 0 2px"
				} }, question) : null, context ? h("div", null, h("button", {
					style: toggleStyle,
					type: "button",
					onClick: () => setContextOpen(!contextOpen)
				}, `${contextOpen ? t("common.foldOpen") : t("common.foldClosed")} ${t("card.contextToggle")}`), contextOpen ? h("div", { style: {
					whiteSpace: "pre-wrap",
					...smallStyle,
					marginTop: 4
				} }, context) : null) : null, running ? h("div", { style: smallStyle }, t("card.runningHint")) : null, attempts.length ? h("div", { style: {
					marginTop: 8,
					...smallStyle
				} }, t("card.attempts"), attempts.map((a, i) => h("span", {
					key: i,
					style: a.ok ? okStyle : errorStyle
				}, i > 0 ? " → " : "", a.ok ? `${t("common.okMark")} ` : `${t("common.failMark")} `, a.label, !a.ok && a.reason ? `（${a.reason.length > 300 ? a.reason.slice(0, 300) + "…" : a.reason}）` : ""))) : null, (meta?.notes ?? []).length ? h("ul", { style: {
					...warnStyle,
					margin: "6px 0 0",
					paddingLeft: 18
				} }, meta.notes.map((n, i) => h("li", { key: i }, n))) : null, meta?.usage ? h("div", { style: smallStyle }, t("card.usage", {
					input: meta.usage.inputTokens + meta.usage.cacheReadTokens + meta.usage.cacheWriteTokens,
					output: meta.usage.outputTokens,
					cached: meta.usage.cacheReadTokens + meta.usage.cacheWriteTokens > 0 ? t("card.usageCached", { cached: meta.usage.cacheReadTokens + meta.usage.cacheWriteTokens }) : "",
					duration: t("card.usageSeconds", { s: Math.max(1, Math.round(meta.usage.durationMs / 1e3)) })
				})) : null, !running && dualColumns ? h("div", { style: {
					display: "flex",
					gap: 8,
					flexWrap: "wrap",
					marginTop: 4
				} }, dualColumns.map((o, i) => h("div", {
					key: i,
					style: {
						flex: "1 1 240px",
						minWidth: 240,
						border: "1px solid var(--dsw-alias-border-l1)",
						borderRadius: R.lg,
						padding: "6px 8px"
					}
				}, h("div", { style: {
					display: "flex",
					alignItems: "center",
					fontWeight: 600,
					marginBottom: 2
				} }, h("span", { style: { minWidth: 0 } }, `${t("card.opinion", { n: i + 1 })} · ${o.label}`), processLink(o.consultId, {
					...linkButtonStyle,
					marginLeft: 6
				})), o.ok ? h("div", null, renderMarkdown(o.content)) : h("div", { style: errorStyle }, o.content)))) : null, !running && text && !dualColumns ? h("div", { style: { marginTop: 2 } }, renderMarkdown(text)) : null, !running && !text && block?.error ? h("div", { style: errorStyle }, block.error.reason ?? block.error.code ?? block.error.name ?? t("card.toolFailed")) : null);
			}
			function unwrap(response, what) {
				if (response && response.ok && response.value !== void 0) return response.value;
				const detail = response?.error?.code ? `${response.error.code}：${response.error.message ?? ""}` : response?.error?.message ?? t("common.remoteAbnormal");
				throw new Error(t("common.remoteFailed", {
					what,
					detail
				}));
			}
			function getRemote(ctx) {
				const candidate = ctx;
				return candidate.remote ?? (typeof candidate.get === "function" ? candidate.get("remote") : void 0);
			}
			const NS = "dsh-advisor-chain";
			const SUBAGENT_NS = "subagent-model-selection-settings";
			/** Built-in DeepSeek routes advertise these; adapter-owned, not in settings. */
			const BUILTIN_DEEPSEEK_EFFORTS = [
				"off",
				"low",
				"high",
				"max"
			];
			const REPO_URL = "https://github.com/yyty947/dsh-advisor-chain";
			const UPGRADE_NOTES_URL = `${REPO_URL}#升级须知`;
			function effortsOf(raw) {
				if (Array.isArray(raw)) return raw.map(String);
				if (raw && typeof raw === "object") return Object.keys(raw);
			}
			/** Models (and declared reasoning efforts) a provider has in DSH's own
			*  settings — the 模型 page writes them; no network involved. Shapes differ:
			*  - llm-pi-ai: `providers[route].models[]` with per-model `reasoningEfforts`,
			*    plus `providers[route].modelOverrides[modelId]` for corrections;
			*  - DeepSeek routes (api-key): a `models` catalog in their own namespace
			*    with top-level `modelOverrides[modelId]`;
			*  - DeepSeek account: NO catalog in settings (the account service lists
			*    models) — only overrides may be present. Callers fall back to
			*    `discoverModels` for such providers.
			*  Built-in DeepSeek models advertise off/low/high/max through the adapter. */
			function providerModels(namespaces, provider) {
				const out = {
					models: [],
					builtin: false
				};
				const byId = /* @__PURE__ */ new Map();
				const register = (m) => {
					const id = typeof m === "string" ? m : m?.id;
					if (typeof id !== "string" || !id || byId.has(id)) return;
					const entry = {
						id,
						name: typeof m?.name === "string" ? m.name : void 0,
						efforts: void 0
					};
					const efforts = effortsOf(m?.reasoningEfforts);
					if (efforts && efforts.length) entry.efforts = efforts;
					byId.set(id, entry);
				};
				const applyOverride = (id, o) => {
					const entry = byId.get(id);
					if (!entry || !o || typeof o !== "object") return;
					const raw = o.reasoningEfforts;
					if (raw === false) entry.efforts = void 0;
					else {
						const efforts = effortsOf(raw);
						if (efforts) entry.efforts = efforts;
					}
				};
				const isDeepSeekNs = (ns) => /deepseek/i.test(ns);
				const isDeepSeekRoute = /deepseek/i.test(provider);
				for (const section of namespaces ?? []) {
					const value = section.value;
					if (!value || typeof value !== "object") continue;
					const route = value.providers?.[provider];
					if (route && typeof route === "object") {
						if (Array.isArray(route.models)) route.models.forEach(register);
						if (route.modelOverrides && typeof route.modelOverrides === "object") for (const [id, o] of Object.entries(route.modelOverrides)) applyOverride(id, o);
					}
					if (isDeepSeekNs(section.ns) && isDeepSeekRoute) {
						if (Array.isArray(value.models)) {
							out.builtin = true;
							value.models.forEach(register);
						}
						if (value.modelOverrides && typeof value.modelOverrides === "object") {
							out.builtin = true;
							for (const [id, o] of Object.entries(value.modelOverrides)) applyOverride(id, o);
						}
					}
				}
				if (out.builtin) {
					for (const m of byId.values()) if (!m.efforts) m.efforts = [...BUILTIN_DEEPSEEK_EFFORTS];
					out.builtin = true;
				} else if (/deepseek/i.test(provider)) out.builtin = true;
				out.models = [...byId.values()];
				return out;
			}
			function AdvisorSettingsTab() {
				const [draft, setDraft] = useState(null);
				const [revision, setRevision] = useState(0);
				const [savedSnapshot, setSavedSnapshot] = useState("");
				const [allNamespaces, setAllNamespaces] = useState([]);
				const [providers, setProviders] = useState([]);
				const [allow, setAllow] = useState({
					enabled: false,
					routes: [],
					revision: 0,
					present: false
				});
				const [authWritable, setAuthWritable] = useState(true);
				/** Models discovered through the official `discoverModels` remote, per provider
				*  (for routes whose models live outside the settings document, e.g. a
				*  signed-in DeepSeek account). */
				const [discovered, setDiscovered] = useState({});
				/** True when the stored config still carries keys only 0.3.9 wrote — the
				*  signal that this installation has sessions with legacy `advisor/*` events. */
				const [legacyUser, setLegacyUser] = useState(false);
				const [busy, setBusy] = useState(null);
				const [saving, setSaving] = useState(false);
				const [msg, setMsg] = useState("");
				const [error, setError] = useState("");
				const dockRef = useRef(null);
				const [surface, setSurface] = useState("var(--dsw-alias-bg-base)");
				const [scrollerPad, setScrollerPad] = useState(0);
				const [dockHeight, setDockHeight] = useState(48);
				useEffect(() => {
					let node = dockRef.current;
					while (node) {
						const bg = getComputedStyle(node).backgroundColor;
						if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
							setSurface(bg);
							break;
						}
						node = node.parentElement;
					}
					let scroller;
					let p = dockRef.current?.parentElement ?? null;
					while (p) {
						const oy = getComputedStyle(p).overflowY;
						if (oy === "auto" || oy === "scroll" || oy === "overlay") {
							scroller = p;
							break;
						}
						p = p.parentElement;
					}
					if (scroller) setScrollerPad(parseFloat(getComputedStyle(scroller).paddingBottom) || 0);
					const onResize = () => {
						if (scroller) setScrollerPad(parseFloat(getComputedStyle(scroller).paddingBottom) || 0);
					};
					window.addEventListener("resize", onResize);
					return () => window.removeEventListener("resize", onResize);
				}, []);
				useEffect(() => {
					const dock = dockRef.current;
					if (dock) setDockHeight(dock.offsetHeight + 8);
				}, [msg, error]);
				const readAllow = (namespaces) => {
					const ns = namespaces.find((n) => n.ns === SUBAGENT_NS);
					const value = ns?.value;
					setAllow({
						present: !!ns,
						enabled: value?.enabled === true,
						routes: Array.isArray(value?.allowedModels) ? value.allowedModels.filter((r) => r && typeof r.provider === "string" && typeof r.model === "string") : [],
						revision: ns?.revision ?? 0
					});
				};
				const reload = async (opts) => {
					if (!opts?.silent) {
						setMsg("");
						setError("");
					}
					try {
						const remote = getRemote(currentCtx);
						if (!remote) {
							setError(t("common.remoteMissing"));
							return;
						}
						const desc = unwrap(await remote.settings.describe(), t("common.readSettings"));
						const namespaces = Array.isArray(desc?.namespaces) ? desc.namespaces : [];
						setAllNamespaces(namespaces);
						readAllow(namespaces);
						const ns = namespaces.find((n) => n.ns === NS);
						if (!ns) {
							setError(t("common.nsMissing"));
							return;
						}
						const value = ns.value;
						const next = {
							enabled: value.enabled !== false,
							mode: value.mode === "manual" ? "manual" : "auto",
							contextMode: value.contextMode === "standalone" ? "standalone" : "inherited",
							advisorComposition: value.advisorComposition === "inherit" ? "inherit" : "lean",
							advisorPrompt: typeof value.advisorPrompt === "string" ? value.advisorPrompt : "",
							chain: Array.isArray(value.chain) ? value.chain : [],
							followup: { maxRounds: value.followup?.maxRounds ?? 8 },
							legacyNoticeDismissed: value.legacyNoticeDismissed === true,
							trigger: { repeatThreshold: value.trigger?.repeatThreshold ?? 3 },
							limits: {
								defaultTimeoutMs: value.limits?.defaultTimeoutMs ?? 3e5,
								transcriptMaxChars: value.limits?.transcriptMaxChars ?? 12e4,
								perEntryMaxChars: value.limits?.perEntryMaxChars ?? 4e3
							}
						};
						setDraft(next);
						setRevision(ns.revision);
						setSavedSnapshot(JSON.stringify(next));
						const raw = ns.value;
						setLegacyUser(Object.prototype.hasOwnProperty.call(raw, "modelCatalog") || Array.isArray(raw.chain) && raw.chain.some((e) => e && typeof e === "object" && "temperature" in e));
						const provs = await remote.llm.listProviders().catch(() => void 0);
						setProviders(provs && provs.ok && Array.isArray(provs.value) ? provs.value : []);
					} catch (e) {
						setError(e instanceof Error ? e.message : String(e));
					}
				};
				useEffect(() => {
					reload();
				}, []);
				const patch = (part) => setDraft((d) => d ? {
					...d,
					...part
				} : d);
				const patchEntry = (index, part) => setDraft((d) => d ? {
					...d,
					chain: d.chain.map((e, i) => i === index ? {
						...e,
						...part
					} : e)
				} : d);
				const removeEntry = (index) => setDraft((d) => d ? {
					...d,
					chain: d.chain.filter((_, i) => i !== index)
				} : d);
				const moveEntry = (index, delta) => setDraft((d) => {
					if (!d) return d;
					const target = index + delta;
					if (target < 0 || target >= d.chain.length) return d;
					const chain = [...d.chain];
					const [item] = chain.splice(index, 1);
					chain.splice(target, 0, item);
					return {
						...d,
						chain
					};
				});
				const addEntry = () => setDraft((d) => d ? {
					...d,
					chain: [...d.chain, {
						label: "",
						provider: providers[0]?.id ?? "",
						model: ""
					}]
				} : d);
				const patchProvider = (index, provider) => {
					patchEntry(index, {
						provider,
						model: "",
						reasoningEffort: void 0
					});
					if (provider && providerModels(allNamespaces, provider).models.length === 0) discover(provider);
				};
				const discover = async (provider) => {
					if (!provider) return;
					setBusy(`discover:${provider}`);
					setMsg("");
					setError("");
					try {
						const remote = getRemote(currentCtx);
						const confs = await remote.llm.listConfigurableProviders().catch(() => void 0);
						const settingsNs = confs && confs.ok && Array.isArray(confs.value) ? confs.value.find((c) => c.provider === provider)?.settingsNs : void 0;
						const found = settingsNs ? unwrap(await remote.llm.discoverModels(settingsNs, { provider }), t("entry.discover")) : [];
						setDiscovered((d) => ({
							...d,
							[provider]: found.map((m) => m.id)
						}));
						setMsg(found.length ? t("entry.discoveredCount", {
							provider,
							count: found.length
						}) : t("entry.discoveredNone", { provider }));
					} catch (e) {
						setError(t("entry.discoverFailed", { message: e instanceof Error ? e.message : String(e) }));
					} finally {
						setBusy(null);
					}
				};
				/** Everything the model dropdown may offer for a provider right now. */
				const catalogOf = (provider) => {
					const info = providerModels(allNamespaces, provider);
					const extra = (discovered[provider] ?? []).filter((id) => !info.models.some((m) => m.id === id)).map((id) => ({
						id,
						efforts: info.builtin ? [...BUILTIN_DEEPSEEK_EFFORTS] : void 0,
						discovered: true
					}));
					return [...info.models, ...extra];
				};
				const statusOf = (entry) => {
					if (!entry.provider) return {
						kind: "provider-missing",
						text: t("status.pickProvider")
					};
					if (providers.length > 0 && !providers.some((p) => p.id === entry.provider)) return {
						kind: "provider-missing",
						text: t("status.providerMissingDetail", { provider: entry.provider })
					};
					const catalog = catalogOf(entry.provider);
					if (!entry.model) return {
						kind: "model-unknown",
						text: t("status.pickModel")
					};
					if (catalog.length > 0 && !catalog.some((m) => m.id === entry.model)) return {
						kind: "model-unknown",
						text: t("status.modelUnknownDetail", { model: entry.model })
					};
					if (catalog.length === 0) return {
						kind: "catalog-unknown",
						text: t("status.catalogUnknownDetail", { provider: entry.provider })
					};
					if (!allow.present) return {
						kind: "ok",
						text: t("status.noAllowlist")
					};
					if (!allow.enabled) return {
						kind: "selection-off",
						text: t("status.selectionOffDetail")
					};
					if (!allow.routes.some((r) => r.provider === entry.provider && r.model === entry.model)) {
						const p = providers.find((x) => x.id === entry.provider);
						return {
							kind: "unauthorized",
							text: t("status.unauthorizedDetail", {
								route: `${entry.provider} / ${entry.model}`,
								name: p?.name ? t("status.unauthorizedName", { name: p.name }) : ""
							})
						};
					}
					if (entry.reasoningEffort) {
						const declared = catalog.find((m) => m.id === entry.model)?.efforts ?? [];
						if (declared.length === 0) return {
							kind: "effort-undeclared",
							text: t("status.effortUndeclaredNone", {
								model: entry.model,
								effort: entry.reasoningEffort
							})
						};
						if (!declared.includes(entry.reasoningEffort)) return {
							kind: "effort-undeclared",
							text: t("status.effortUndeclaredOther", {
								model: entry.model,
								declared: declared.join(" / "),
								effort: entry.reasoningEffort
							})
						};
					}
					return {
						kind: "ok",
						text: ""
					};
				};
				const authorize = async (entries) => {
					const remote = getRemote(currentCtx);
					setBusy("authorize");
					setMsg("");
					setError("");
					try {
						const ns = unwrap(await remote.settings.describe(), t("common.readSettings")).namespaces.find((n) => n.ns === SUBAGENT_NS);
						if (!ns) throw new Error(t("auth.noSetting"));
						const current = ns.value;
						const routes = Array.isArray(current?.allowedModels) ? [...current.allowedModels] : [];
						for (const e of entries) if (e.provider && e.model && !routes.some((r) => r.provider === e.provider && r.model === e.model)) routes.push({
							provider: e.provider,
							model: e.model
						});
						const view = unwrap(await remote.settings.update(SUBAGENT_NS, {
							enabled: true,
							allowedModels: routes
						}, ns.revision), t("auth.write"));
						setAllow((a) => ({
							...a,
							enabled: true,
							routes,
							revision: view.revision,
							present: true
						}));
						setMsg(t("auth.done", {
							count: entries.length,
							state: current?.enabled ? t("auth.stateKept") : t("auth.stateOn")
						}));
					} catch (e) {
						const message = e instanceof Error ? e.message : String(e);
						if (/conflict|stale|changed since it was read|revision/i.test(message)) {
							await reload({ silent: true });
							setMsg(t("auth.conflict"));
						} else {
							setAuthWritable(false);
							setError(t("auth.failed", { message }));
						}
					} finally {
						setBusy(null);
					}
				};
				const dismissLegacyNotice = async () => {
					patch({ legacyNoticeDismissed: true });
					try {
						const remote = getRemote(currentCtx);
						const ns = (await remote.settings.describe()).value?.namespaces.find((n) => n.ns === NS);
						const view = unwrap(await remote.settings.update(NS, { legacyNoticeDismissed: true }, ns?.revision ?? revision), t("banner.write"));
						setRevision(view.revision);
						setSavedSnapshot((snap) => {
							try {
								const parsed = JSON.parse(snap);
								return JSON.stringify({
									...parsed,
									legacyNoticeDismissed: true
								});
							} catch {
								return snap;
							}
						});
						setMsg(t("banner.dismissed"));
					} catch (e) {
						setError(t("banner.dismissFailed", { message: e instanceof Error ? e.message : String(e) }));
					}
				};
				const save = async () => {
					if (!draft) return;
					setSaving(true);
					setMsg("");
					setError("");
					try {
						const remote = getRemote(currentCtx);
						const dropped = draft.chain.filter((e) => !e.provider || !e.model).length;
						const clamp = (v, lo, hi) => v === void 0 ? void 0 : Math.min(hi, Math.max(lo, Math.round(v)));
						const sanitized = {
							enabled: draft.enabled,
							mode: draft.mode,
							contextMode: draft.contextMode,
							advisorComposition: draft.advisorComposition,
							advisorPrompt: draft.advisorPrompt,
							chain: draft.chain.filter((e) => e.provider && e.model).map((e) => ({
								...e.label?.trim() ? { label: e.label } : {},
								provider: e.provider,
								model: e.model,
								...e.reasoningEffort ? { reasoningEffort: e.reasoningEffort } : {},
								maxTokens: clamp(e.maxTokens, 1, 1e6),
								timeoutMs: clamp(e.timeoutMs, 1e3, 6e5)
							})),
							followup: { maxRounds: Math.min(20, Math.max(1, draft.followup.maxRounds || 8)) },
							legacyNoticeDismissed: draft.legacyNoticeDismissed,
							trigger: { repeatThreshold: Math.min(10, Math.max(2, draft.trigger.repeatThreshold || 3)) },
							limits: {
								defaultTimeoutMs: clamp(draft.limits.defaultTimeoutMs, 1e3, 6e5) ?? 3e5,
								transcriptMaxChars: clamp(draft.limits.transcriptMaxChars, 2e3, 4e5) ?? 12e4,
								perEntryMaxChars: clamp(draft.limits.perEntryMaxChars, 200, 2e4) ?? 4e3
							}
						};
						const view = unwrap(await remote.settings.update(NS, sanitized, revision), t("save.write"));
						setRevision(view.revision);
						setDraft(view.value);
						setSavedSnapshot(JSON.stringify(view.value));
						setMsg(t("save.done", { dropped: dropped > 0 ? t("save.dropped", { count: dropped }) : "" }));
					} catch (e) {
						const message = e instanceof Error ? e.message : String(e);
						if (/conflict|stale|changed since it was read|revision/i.test(message)) {
							await reload({ silent: true });
							setMsg(t("save.conflict"));
						} else setError(t("save.failed", { message }));
					} finally {
						setSaving(false);
					}
				};
				if (!draft) return h("li", {
					className: "dsh-advisor-chain-settings",
					style: {
						width: "100%",
						color: "var(--dsw-alias-label-primary)",
						fontFamily: "var(--dsw-font-family, inherit)",
						listStyle: "none",
						padding: 0,
						margin: 0
					}
				}, h("div", { style: SET.row }, h("div", { style: error ? SET.msgErr : SET.desc }, error || t("common.loading")), error ? h("button", {
					style: SET.btn,
					type: "button",
					onClick: () => reload()
				}, t("common.retry")) : null));
				const dirty = savedSnapshot !== "" && JSON.stringify(draft) !== savedSnapshot;
				const showLegacyNotice = legacyUser && !draft.legacyNoticeDismissed;
				const unauthorized = draft.chain.filter((e) => e.provider && e.model && ["unauthorized", "selection-off"].includes(statusOf(e).kind));
				const numRow = (title, desc, value, min, max, step, onChange, last = false) => h("div", { style: {
					...SET.row,
					...last ? { borderBottom: "none" } : null
				} }, h("div", { style: { minWidth: 0 } }, h("div", { style: SET.title }, title), h("div", { style: SET.desc }, desc)), h("input", {
					style: {
						...SET.control,
						width: 110
					},
					type: "number",
					min,
					max,
					step,
					value,
					"aria-label": title,
					disabled: saving,
					onChange: (e) => onChange(Number(e.target.value))
				}));
				const modelField = (index, entry) => {
					const catalog = catalogOf(entry.provider);
					const options = [...catalog.map((m) => ({
						value: m.id,
						label: m.name && m.name !== m.id ? `${m.id}（${m.name}）` : m.id
					})), ...entry.model && !catalog.some((m) => m.id === entry.model) ? [{
						value: entry.model,
						label: t("entry.modelNotListed", { model: entry.model })
					}] : []];
					const fetching = busy === `discover:${entry.provider}`;
					return h(Field, { label: t("entry.modelField") }, h("div", { style: {
						display: "flex",
						gap: 6,
						width: "100%",
						minWidth: 0
					} }, h(Dropdown, {
						width: "100%",
						ariaLabel: t("entry.modelField"),
						value: entry.model,
						options: options.length ? options : [{
							value: "",
							label: catalog.length ? t("entry.modelPick") : t("entry.modelCatalogEmpty")
						}],
						onChange: (e) => patchEntry(index, {
							model: e.target.value,
							reasoningEffort: void 0
						})
					}), catalog.length === 0 ? h("button", {
						style: {
							...SET.btn,
							height: 32,
							whiteSpace: "nowrap",
							flexShrink: 0
						},
						type: "button",
						disabled: !entry.provider || busy !== null,
						onClick: () => void discover(entry.provider)
					}, fetching ? t("entry.discovering") : t("entry.discover")) : null));
				};
				const effortField = (index, entry) => {
					const declared = catalogOf(entry.provider).find((m) => m.id === entry.model)?.efforts ?? [];
					const options = [
						{
							value: "",
							label: declared.length ? t("entry.effortDefault") : t("entry.effortDefaultUndeclared")
						},
						...declared.map((v) => ({
							value: v,
							label: v
						})),
						...entry.reasoningEffort && !declared.includes(entry.reasoningEffort) ? [{
							value: entry.reasoningEffort,
							label: t("entry.effortUndeclaredOption", { effort: entry.reasoningEffort })
						}] : []
					];
					return h(Field, { label: t("entry.effortField") }, h(Dropdown, {
						width: 180,
						ariaLabel: t("entry.effortField"),
						value: entry.reasoningEffort ?? "",
						options,
						onChange: (e) => patchEntry(index, { reasoningEffort: e.target.value || void 0 })
					}));
				};
				const entryNode = (index, entry) => {
					const status = statusOf(entry);
					return h("div", {
						key: index,
						style: SET.entry
					}, h("div", { style: {
						display: "flex",
						alignItems: "center",
						gap: 8,
						marginBottom: 10
					} }, h("span", { style: {
						...SET.desc,
						marginTop: 0,
						width: 22
					} }, `#${index + 1}`), h("span", { style: status.kind === "ok" ? okStyle : status.kind === "effort-undeclared" || status.kind === "catalog-unknown" ? warnStyle : errorStyle }, status.kind === "ok" ? t("status.ok") : status.kind === "provider-missing" ? t("status.providerMissing") : status.kind === "model-unknown" ? t("status.modelUnknown") : status.kind === "catalog-unknown" ? t("status.catalogUnknown") : status.kind === "selection-off" ? t("status.selectionOff") : status.kind === "unauthorized" ? t("status.unauthorized") : t("status.effortUndeclared")), h("span", { style: { flex: 1 } }), status.kind === "unauthorized" && authWritable ? h("button", {
						style: SET.btn,
						type: "button",
						disabled: busy !== null,
						onClick: () => authorize([entry])
					}, t("entry.authorize")) : null, status.kind === "selection-off" && authWritable ? h("button", {
						style: SET.btn,
						type: "button",
						disabled: busy !== null,
						onClick: () => authorize([entry])
					}, t("entry.authorizeEnable")) : null, h("button", {
						style: SET.btn,
						type: "button",
						"aria-label": t("common.moveUp"),
						title: t("common.moveUp"),
						onClick: () => moveEntry(index, -1),
						disabled: index === 0
					}, "↑"), h("button", {
						style: SET.btn,
						type: "button",
						"aria-label": t("common.moveDown"),
						title: t("common.moveDown"),
						onClick: () => moveEntry(index, 1),
						disabled: index === draft.chain.length - 1
					}, "↓"), h("button", {
						style: SET.btn,
						type: "button",
						onClick: () => removeEntry(index)
					}, t("common.delete"))), h("div", { style: {
						display: "grid",
						gridTemplateColumns: "minmax(130px, 160px) minmax(0, 1fr) minmax(0, 1fr)",
						gap: 12,
						alignItems: "end"
					} }, h(Field, { label: t("entry.labelField") }, h("input", {
						style: {
							...SET.control,
							width: "100%",
							boxSizing: "border-box"
						},
						placeholder: t("entry.labelPlaceholder"),
						value: entry.label ?? "",
						onChange: (e) => patchEntry(index, { label: e.target.value })
					})), h(Field, { label: t("entry.providerField") }, h(Dropdown, {
						width: "100%",
						ariaLabel: t("entry.providerField"),
						value: entry.provider,
						options: providers.length ? providers.map((p) => ({
							value: p.id,
							label: p.name && p.name !== p.id ? `${p.id}（${p.name}）` : p.id
						})) : [{
							value: entry.provider,
							label: entry.provider || t("entry.providerNone")
						}],
						onChange: (e) => patchProvider(index, e.target.value)
					})), modelField(index, entry)), h("div", { style: {
						display: "flex",
						gap: 12,
						flexWrap: "wrap",
						marginTop: 10
					} }, effortField(index, entry), h(Field, { label: t("entry.maxTokensField") }, h("input", {
						style: {
							...SET.control,
							width: 120
						},
						type: "number",
						min: 1,
						value: entry.maxTokens ?? "",
						onChange: (e) => patchEntry(index, { maxTokens: e.target.value === "" ? void 0 : Number(e.target.value) })
					})), h(Field, { label: t("entry.timeoutField") }, h("input", {
						style: {
							...SET.control,
							width: 130
						},
						type: "number",
						min: 1e3,
						max: 6e5,
						step: 500,
						value: entry.timeoutMs ?? "",
						onChange: (e) => patchEntry(index, { timeoutMs: e.target.value === "" ? void 0 : Number(e.target.value) })
					}))), status.kind !== "ok" ? h("div", { style: {
						...smallStyle,
						...status.kind === "effort-undeclared" || status.kind === "catalog-unknown" ? warnStyle : errorStyle,
						marginTop: 8
					} }, status.text) : null);
				};
				return h("li", {
					className: "dsh-advisor-chain-settings",
					style: {
						width: "100%",
						color: "var(--dsw-alias-label-primary)",
						fontFamily: "var(--dsw-font-family, inherit)",
						listStyle: "none",
						padding: 0,
						margin: 0,
						paddingBottom: dockHeight
					}
				}, h("div", { style: {
					pointerEvents: saving ? "none" : "auto",
					opacity: saving ? .6 : 1
				} }, showLegacyNotice ? h("div", {
					role: "status",
					style: SET.banner
				}, h("div", { style: {
					flex: 1,
					minWidth: 0
				} }, h("div", { style: {
					fontWeight: 600,
					marginBottom: 4
				} }, t("banner.title")), h("div", null, t("banner.body")), h("a", {
					href: UPGRADE_NOTES_URL,
					target: "_blank",
					rel: "noreferrer",
					style: {
						...smallStyle,
						color: "var(--dsw-alias-brand-primary)"
					}
				}, t("banner.link"))), h("button", {
					style: SET.btn,
					type: "button",
					onClick: dismissLegacyNotice
				}, t("banner.dismiss"))) : null, h(SRow, {
					title: t("settings.enabledTitle"),
					desc: t("settings.enabledDesc")
				}, h(Toggle, {
					checked: draft.enabled,
					label: t("settings.enabledTitle"),
					onChange: (next) => patch({ enabled: next })
				})), h(SRow, {
					title: t("settings.triggerTitle"),
					desc: t("settings.triggerDesc")
				}, h(Dropdown, {
					value: draft.mode,
					width: 240,
					ariaLabel: t("settings.triggerTitle"),
					options: [{
						value: "auto",
						label: t("settings.triggerAuto")
					}, {
						value: "manual",
						label: t("settings.triggerManual")
					}],
					onChange: (e) => patch({ mode: e.target.value })
				})), h(SRow, {
					title: t("settings.modeTitle"),
					desc: t("settings.modeDesc")
				}, h(Dropdown, {
					value: draft.contextMode,
					width: 240,
					ariaLabel: t("settings.modeTitle"),
					options: [{
						value: "inherited",
						label: t("settings.modeInherited")
					}, {
						value: "standalone",
						label: t("settings.modeStandalone")
					}],
					onChange: (e) => patch({ contextMode: e.target.value })
				})), h(SRow, {
					title: t("settings.compositionTitle"),
					desc: t("settings.compositionDesc")
				}, h(Dropdown, {
					value: draft.advisorComposition,
					width: 300,
					ariaLabel: t("settings.compositionTitle"),
					options: [{
						value: "lean",
						label: t("settings.compositionLean")
					}, {
						value: "inherit",
						label: t("settings.compositionInherit")
					}],
					onChange: (e) => patch({ advisorComposition: e.target.value })
				})), h("div", { style: {
					...SET.groupHead,
					alignItems: "flex-start"
				} }, h("div", { style: { minWidth: 0 } }, h("div", { style: SET.title }, t("settings.chainTitle")), h("div", { style: SET.desc }, t("settings.chainDesc"))), h("div", { style: {
					display: "flex",
					gap: 8,
					flexShrink: 0
				} }, unauthorized.length > 0 && authWritable ? h("button", {
					style: SET.btn,
					type: "button",
					disabled: busy !== null,
					onClick: () => authorize(unauthorized)
				}, allow.enabled ? t("settings.chainAuthorizeAll") : t("settings.chainEnableAndAuthorizeAll")) : null, h("button", {
					style: SET.btn,
					type: "button",
					onClick: addEntry
				}, t("settings.chainAdd")))), ...draft.chain.map((entry, index) => entryNode(index, entry)), draft.chain.length === 0 ? h("div", { style: {
					...SET.desc,
					padding: "0 0 12px"
				} }, t("settings.chainEmpty")) : null, h("div", { style: {
					padding: "16px 0",
					borderBottom: "0.5px solid var(--dsw-alias-border-l2)"
				} }, h("div", { style: SET.title }, t("settings.promptTitle")), h("div", { style: SET.desc }, t("settings.promptDesc")), h("textarea", {
					style: SET.textarea,
					value: draft.advisorPrompt,
					onChange: (e) => patch({ advisorPrompt: e.target.value })
				})), numRow(t("settings.followUpTitle"), t("settings.followUpDesc"), draft.followup?.maxRounds ?? 8, 1, 20, 1, (v) => patch({ followup: { maxRounds: Math.min(20, Math.max(1, v || 8)) } })), numRow(t("settings.timeoutTitle"), t("settings.timeoutDesc"), draft.limits?.defaultTimeoutMs ?? 3e5, 1e3, 6e5, 500, (v) => patch({ limits: {
					...draft.limits,
					defaultTimeoutMs: v || 3e5
				} })), numRow(t("settings.transcriptTitle"), t("settings.transcriptDesc"), draft.limits?.transcriptMaxChars ?? 12e4, 2e3, 4e5, 1e3, (v) => patch({ limits: {
					...draft.limits,
					transcriptMaxChars: v || 12e4
				} })), numRow(t("settings.perEntryTitle"), t("settings.perEntryDesc"), draft.limits?.perEntryMaxChars ?? 4e3, 200, 2e4, 100, (v) => patch({ limits: {
					...draft.limits,
					perEntryMaxChars: v || 4e3
				} })), numRow(t("settings.repeatTitle"), t("settings.repeatDesc"), draft.trigger?.repeatThreshold ?? 3, 2, 10, 1, (v) => patch({ trigger: { repeatThreshold: Math.min(10, Math.max(2, v || 3)) } }), true), h("div", { style: {
					...SET.row,
					display: "block"
				} }, h("div", { style: SET.title }, t("about.title")), h("div", { style: {
					...SET.desc,
					marginTop: 4
				} }, t("about.by"), h("a", {
					href: REPO_URL,
					target: "_blank",
					rel: "noreferrer",
					style: { color: "var(--dsw-alias-brand-primary)" }
				}, "yyty947"), t("about.inspired"), h("a", {
					href: "https://github.com/pixelsama/codex-advisor",
					target: "_blank",
					rel: "noreferrer",
					style: { color: "var(--dsw-alias-brand-primary)" }
				}, "pixelsama/codex-advisor"), t("about.end")), h("div", { style: SET.desc }, h("a", {
					href: REPO_URL,
					target: "_blank",
					rel: "noreferrer",
					style: { color: "var(--dsw-alias-brand-primary)" }
				}, REPO_URL.replace("https://", ""))))), h("div", {
					ref: (node) => {
						dockRef.current = node;
					},
					role: "status",
					"aria-live": "polite",
					style: {
						position: "sticky",
						bottom: 0,
						marginBottom: scrollerPad ? -scrollerPad : 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 12,
						padding: "10px 16px",
						background: surface,
						borderTop: "1px solid var(--dsw-alias-border-l2)",
						borderRadius: R.md,
						boxShadow: "0 -4px 16px rgba(0,0,0,0.12)"
					}
				}, h("div", { style: {
					flex: 1,
					minWidth: 0,
					maxHeight: 72,
					overflowY: "auto"
				} }, error ? h("div", { style: SET.msgErr }, error) : msg ? h("div", { style: SET.msgOk }, msg) : dirty ? h("div", { style: SET.msgErr }, t("common.unsaved")) : null), h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: 10
				} }, dirty ? h("button", {
					style: SET.btn,
					type: "button",
					onClick: () => reload({ silent: true })
				}, t("common.cancelEdits")) : null, h("button", {
					style: SET.btnPrimary,
					type: "button",
					disabled: saving,
					onClick: save
				}, saving ? t("common.saving") : t("common.save")))));
			}
			const SET = {
				row: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 24,
					padding: "16px 0",
					borderBottom: "0.5px solid var(--dsw-alias-border-l2)"
				},
				title: {
					fontSize: 14,
					lineHeight: "20px"
				},
				desc: {
					marginTop: 4,
					color: "var(--dsw-alias-label-secondary)",
					fontSize: 12,
					lineHeight: "18px"
				},
				groupHead: {
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					gap: 24,
					padding: "16px 0 8px"
				},
				control: {
					height: 32,
					borderRadius: R.md,
					border: "1px solid var(--dsw-alias-border-l2)",
					background: "var(--dsw-alias-bg-base)",
					color: "var(--dsw-alias-label-primary)",
					fontSize: 13,
					padding: "0 10px"
				},
				textarea: {
					width: "100%",
					boxSizing: "border-box",
					minHeight: 120,
					marginTop: 8,
					borderRadius: R.md,
					border: "1px solid var(--dsw-alias-border-l2)",
					background: "var(--dsw-alias-bg-base)",
					color: "var(--dsw-alias-label-primary)",
					fontSize: 13,
					lineHeight: 1.6,
					padding: "8px 10px",
					resize: "vertical",
					fontFamily: "inherit"
				},
				entry: {
					border: "1px solid var(--dsw-alias-border-l1)",
					borderRadius: R.lg,
					padding: 12,
					marginBottom: 12
				},
				banner: {
					display: "flex",
					alignItems: "flex-start",
					gap: 12,
					margin: "12px 0 4px",
					padding: "12px 14px",
					borderRadius: R.lg,
					background: "var(--dsw-alias-bg-warn)",
					border: "1px solid var(--dsw-alias-state-warn-primary)",
					fontSize: 13,
					lineHeight: 1.6
				},
				btn: {
					height: 28,
					padding: "0 12px",
					borderRadius: R.sm,
					border: "1px solid var(--dsw-alias-border-l2)",
					background: "transparent",
					color: "var(--dsw-alias-label-primary)",
					fontSize: 12.5,
					cursor: "pointer",
					whiteSpace: "nowrap",
					flexShrink: 0
				},
				btnPrimary: {
					height: 32,
					padding: "0 18px",
					borderRadius: R.md,
					border: "1px solid transparent",
					background: "var(--dsw-alias-label-primary)",
					color: "var(--dsw-alias-bg-base)",
					fontSize: 13,
					cursor: "pointer"
				},
				msgOk: okStyle,
				msgErr: errorStyle,
				fieldLabel: {
					display: "block",
					marginBottom: 4,
					color: "var(--dsw-alias-label-secondary)",
					fontSize: 12,
					lineHeight: "18px"
				}
			};
			function Toggle({ checked, onChange, label, disabled }) {
				const [focused, setFocused] = useState(false);
				return h("button", {
					role: "switch",
					"aria-checked": checked,
					"aria-label": label,
					type: "button",
					disabled,
					onClick: () => onChange(!checked),
					onFocus: () => setFocused(true),
					onBlur: () => setFocused(false),
					style: {
						position: "relative",
						width: 40,
						height: 22,
						borderRadius: 999,
						border: checked ? "none" : "1px solid var(--dsw-alias-border-l1)",
						padding: 0,
						cursor: disabled ? "default" : "pointer",
						opacity: disabled ? .4 : 1,
						background: checked ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-bg-layer-2)",
						outline: focused ? "2px solid var(--dsw-alias-brand-primary)" : "none",
						outlineOffset: 1,
						transition: "background 160ms ease"
					}
				}, h("span", { style: {
					position: "absolute",
					top: 2,
					left: checked ? 20 : 2,
					width: 18,
					height: 18,
					borderRadius: "50%",
					background: "var(--dsw-alias-bg-base)",
					transition: "left 160ms ease"
				} }));
			}
			function SRow({ title, desc, last, children }) {
				return h("div", { style: {
					...SET.row,
					...last ? { borderBottom: "none" } : null
				} }, h("div", { style: { minWidth: 0 } }, h("div", { style: SET.title }, title), desc ? h("div", { style: SET.desc }, desc) : null), children ?? null);
			}
			function Field({ label, children }) {
				return h("label", { style: {
					display: "flex",
					flexDirection: "column",
					gap: 4,
					minWidth: 0
				} }, h("span", { style: SET.fieldLabel }, label), children);
			}
			function Dropdown({ value, onChange, width, ariaLabel, options }) {
				const [open, setOpen] = useState(false);
				const [highlight, setHighlight] = useState(0);
				const wrapRef = useRef(null);
				useEffect(() => {
					if (!open) return;
					const close = (ev) => {
						const wrap = wrapRef.current;
						const target = ev.target;
						if (wrap?.contains?.(target)) return;
						setOpen(false);
					};
					document.addEventListener("mousedown", close);
					return () => document.removeEventListener("mousedown", close);
				}, [open]);
				const select = (v) => {
					setOpen(false);
					onChange({ target: { value: v } });
				};
				const openAt = (index) => {
					setHighlight(index);
					setOpen(true);
				};
				const key = (ev) => {
					const selected = options.findIndex((o) => o.value === value);
					if (!open && (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === " ")) {
						ev.preventDefault();
						openAt(selected >= 0 ? selected : 0);
					} else if (open && ev.key === "Escape") setOpen(false);
					else if (open && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
						ev.preventDefault();
						setHighlight((x) => Math.min(options.length - 1, Math.max(0, x + (ev.key === "ArrowDown" ? 1 : -1))));
					} else if (open && (ev.key === "Enter" || ev.key === " ")) {
						ev.preventDefault();
						if (options[highlight]) select(options[highlight].value);
					}
				};
				const current = options.find((o) => o.value === value);
				return h("div", {
					ref: (node) => {
						wrapRef.current = node;
					},
					style: {
						position: "relative",
						display: "inline-flex",
						width
					}
				}, h("button", {
					type: "button",
					"aria-haspopup": "listbox",
					"aria-expanded": open,
					"aria-label": ariaLabel,
					onClick: () => open ? setOpen(false) : openAt(Math.max(0, options.findIndex((o) => o.value === value))),
					onKeyDown: key,
					style: {
						...SET.control,
						width: "100%",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 8,
						textAlign: "left",
						cursor: "pointer"
					}
				}, h("span", { style: {
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap"
				} }, current?.label ?? ""), h("span", {
					"aria-hidden": true,
					style: {
						fontSize: 10,
						color: "var(--dsw-alias-label-secondary)",
						flexShrink: 0
					}
				}, open ? "▴" : "▾")), open ? h("div", {
					role: "listbox",
					"aria-label": ariaLabel,
					style: {
						position: "absolute",
						top: "calc(100% + 4px)",
						left: 0,
						width: "100%",
						minWidth: 160,
						maxHeight: 240,
						overflowY: "auto",
						zIndex: 30,
						background: "var(--dsw-alias-bg-overlay)",
						border: "1px solid var(--dsw-alias-border-l1)",
						borderRadius: R.xl,
						padding: 4,
						boxShadow: "0 4px 16px rgba(0,0,0,0.14)"
					}
				}, options.map((o, i) => h("div", {
					key: o.value,
					role: "option",
					"aria-selected": o.value === value,
					onMouseDown: (ev) => {
						ev.stopPropagation();
						select(o.value);
					},
					onClick: (ev) => ev.stopPropagation(),
					onMouseEnter: () => setHighlight(i),
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 8,
						padding: "6px 10px",
						borderRadius: R.sm,
						fontSize: 13,
						cursor: "pointer",
						background: i === highlight ? "var(--dsw-alias-bg-layer-1)" : "transparent",
						color: "var(--dsw-alias-label-primary)"
					}
				}, h("span", { style: {
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap"
				} }, o.label), o.value === value ? h("span", { style: {
					color: "var(--dsw-alias-brand-primary)",
					flexShrink: 0
				} }, "✓") : null))) : null);
			}
			function AdvisorNavIcon(props) {
				const size = props.size ?? 22;
				return h("svg", {
					width: size,
					height: size,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: props.active ? "var(--dsw-alias-brand-primary)" : "currentColor",
					strokeWidth: 1.7,
					strokeLinecap: "round",
					strokeLinejoin: "round",
					"aria-hidden": true,
					focusable: false
				}, h("path", { d: "M4 5.5h16v10.5H9l-4.5 3.5v-3.5H4z" }), h("path", { d: "M8.5 10.5l2.3 2.3 4.7-4.6" }));
			}
			const name = "dsh-advisor-chain";
			const inject = [
				"uiConversation",
				"slots",
				"locale",
				"remote",
				"remote.settings",
				"remote.llm"
			];
			let currentCtx = null;
			function apply(ctx) {
				currentCtx = ctx;
				if (ctx.locale && typeof ctx.locale.register === "function" && typeof ctx.locale.bind === "function") {
					const register = () => ctx.locale.register(CLIENT_NS, CLIENT_DICTIONARIES);
					t = ctx.locale.bind(CLIENT_NS);
					if (typeof ctx.effect === "function") ctx.effect(register, "dsh-advisor-chain: locale dictionaries");
					else register();
				}
				if (typeof ctx.inject === "function") ctx.inject(["sidebarRight"], ((scoped) => {
					openInSidebar = (address) => scoped.sidebarRight.openResource(address);
				}));
				if (ctx.uiConversation?.events?.register) ctx.uiConversation.events.register(legacyAdvisorCardDefinition);
				ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
					name: "tool.call.toolview",
					key: "second_opinion",
					locale: CLIENT_NS
				}, SecondOpinionToolRow));
				ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
					name: "conversation.chat.node",
					key: "dsh-advisor-chain-legacy",
					locale: CLIENT_NS
				}, LegacyAdvisorCardView));
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "dsh-advisor-chain",
					order: 0,
					label: () => t("nav.title"),
					locale: CLIENT_NS
				}, AdvisorSettingsTab));
				ctx.slots.inject("settings.section.icon", () => ctx.slots.register({
					name: "settings.section.icon",
					id: "dsh-advisor-chain"
				}, AdvisorNavIcon));
			}
			return {
				name,
				inject,
				apply
			};
		}
	});

})();