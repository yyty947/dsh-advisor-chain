(function() {

// src/client.ts
	window.__ModuleLoader__.load({
		id: "dsh-advisor-chain",
		factory(require) {
			const React = require("react");
			const h = React.createElement;
			const useState = React.useState;
			const useEffect = React.useEffect;
			const useRef = React.useRef;
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
				}, `${open ? "▾" : "▸"} ${title}`), open ? h("div", { style: {
					whiteSpace: "pre-wrap",
					...smallStyle,
					marginTop: 4
				} }, children) : null);
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
				const statusText = failed ? "失败" : running ? "咨询中…" : "完成";
				return h("div", { style: cardStyle }, h("div", null, h("span", { style: labelStyle }, "Second Opinion 咨询"), h("span", { style: badgeStyle("var(--dsw-alias-bg-layer-2)") }, "旧版记录"), h("span", { style: statusBadge }, statusText), messages.map((m) => h("span", {
					key: m.attemptIndex,
					style: badgeStyle("var(--dsw-alias-brand-primary)")
				}, m.model)), data.truncated ? h("span", { style: badgeStyle("var(--dsw-alias-state-warn-primary)") }, "已截断") : null), h("div", { style: {
					fontWeight: 600,
					margin: "6px 0 2px"
				} }, data.question), data.context ? h("div", null, h("button", {
					style: toggleStyle,
					type: "button",
					onClick: () => setContextOpen(!contextOpen)
				}, `${contextOpen ? "▾" : "▸"} 补充背景`), contextOpen ? h("div", { style: {
					whiteSpace: "pre-wrap",
					...smallStyle,
					marginTop: 4
				} }, data.context) : null) : null, messages.length > 0 && messages.some((m) => m.thinking) ? h(Fold, { title: "顾问思考过程" }, messages.map((m) => m.thinking).filter(Boolean).join("\n\n")) : null, messages.length > 0 ? h("div", { style: {
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
				} }, m.label || m.model), h("div", { style: { whiteSpace: "pre-wrap" } }, m.content)))) : running ? h("div", { style: {
					whiteSpace: "pre-wrap",
					marginTop: 6
				} }, data.liveContent ? data.liveContent + "▍" : `正在咨询 ${data.chain?.[data.currentAttempt]?.label ?? ""} …`) : null, followUps.map((f, i) => h("div", {
					key: i,
					style: {
						marginTop: 10,
						paddingTop: 8,
						borderTop: "0.5px solid var(--dsw-alias-border-l1)"
					}
				}, h("div", { style: {
					fontWeight: 600,
					...smallStyle
				} }, `追问 ${i + 1}：${f.text}`), h("div", { style: {
					whiteSpace: "pre-wrap",
					marginTop: 4
				} }, f.answer ?? "思考中…"))), data.attempts?.length ? h("div", { style: {
					marginTop: 8,
					...smallStyle
				} }, "尝试记录：", data.attempts.map((attempt, i) => h("span", { key: i }, i > 0 ? " → " : "", attempt.ok ? "✓" : "✗", attempt.label, attempt.ok || !attempt.error ? "" : `（${attempt.error}）`))) : null);
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
				const statusText = running ? "咨询中…" : failed ? "失败" : "完成";
				const models = (meta?.model ?? "").split(" + ").filter(Boolean);
				const text = contentText(block);
				const title = (meta?.round ?? 0) >= 1 || !!args.consult_id && !args.question ? meta?.round ? `追问 ${meta.round}` : "追问" : "Second Opinion 咨询";
				const mode = meta?.mode ?? args.mode;
				return h("div", {
					style: cardStyle,
					"data-dsh-advisor": "card"
				}, h("div", { style: {
					display: "flex",
					alignItems: "center",
					flexWrap: "wrap",
					gap: 4
				} }, h("span", { style: labelStyle }, title), h("span", { style: statusBadge }, statusText), mode ? h("span", { style: badgeStyle("var(--dsw-alias-bg-layer-2)") }, mode === "standalone" ? "盲审" : "继承") : null, models.map((m, i) => h("span", {
					key: i,
					style: badgeStyle("var(--dsw-alias-brand-primary)")
				}, m)), truncated ? h("span", { style: badgeStyle("var(--dsw-alias-state-warn-primary)") }, "已截断") : null), question ? h("div", { style: {
					fontWeight: 600,
					margin: "6px 0 2px"
				} }, question) : null, context ? h("div", null, h("button", {
					style: toggleStyle,
					type: "button",
					onClick: () => setContextOpen(!contextOpen)
				}, `${contextOpen ? "▾" : "▸"} 补充背景`), contextOpen ? h("div", { style: {
					whiteSpace: "pre-wrap",
					...smallStyle,
					marginTop: 4
				} }, context) : null) : null, running ? h("div", { style: smallStyle }, "顾问正在只读审阅，回答完成后显示在这里（过程可在子代理面板查看）") : null, attempts.length ? h("div", { style: {
					marginTop: 8,
					...smallStyle
				} }, "尝试记录：", attempts.map((a, i) => h("span", {
					key: i,
					style: a.ok ? okStyle : errorStyle
				}, i > 0 ? " → " : "", a.ok ? "✓ " : "✗ ", a.label, !a.ok && a.reason ? `（${a.reason.length > 300 ? a.reason.slice(0, 300) + "…" : a.reason}）` : ""))) : null, (meta?.notes ?? []).length ? h("ul", { style: {
					...warnStyle,
					margin: "6px 0 0",
					paddingLeft: 18
				} }, meta.notes.map((n, i) => h("li", { key: i }, n))) : null, !running && text ? h("div", { style: {
					whiteSpace: "pre-wrap",
					marginTop: 8
				} }, text) : null, !running && !text && block?.error ? h("div", { style: errorStyle }, block.error.reason ?? block.error.code ?? block.error.name ?? "工具调用失败") : null);
			}
			function unwrap(response, what) {
				if (response && response.ok && response.value !== void 0) return response.value;
				const detail = response?.error?.code ? `${response.error.code}：${response.error.message ?? ""}` : response?.error?.message ?? "远程调用返回异常";
				throw new Error(`${what}失败：${detail}`);
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
							setError("当前环境没有 remote 服务，无法读写配置。");
							return;
						}
						const desc = unwrap(await remote.settings.describe(), "读取设置");
						const namespaces = Array.isArray(desc?.namespaces) ? desc.namespaces : [];
						setAllNamespaces(namespaces);
						readAllow(namespaces);
						const ns = namespaces.find((n) => n.ns === NS);
						if (!ns) {
							setError("未找到本插件的配置命名空间（插件可能未启用或未安装完成）。");
							return;
						}
						const value = ns.value;
						const next = {
							enabled: value.enabled !== false,
							mode: value.mode === "manual" ? "manual" : "auto",
							contextMode: value.contextMode === "standalone" ? "standalone" : "inherited",
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
						const found = settingsNs ? unwrap(await remote.llm.discoverModels(settingsNs, { provider }), "获取模型列表") : [];
						setDiscovered((d) => ({
							...d,
							[provider]: found.map((m) => m.id)
						}));
						setMsg(found.length ? `已获取「${provider}」的 ${found.length} 个模型，可在下拉中选择。` : `没有取到「${provider}」的模型列表：该供应商可能需要先在 设置 → 模型 里登录或配置。`);
					} catch (e) {
						setError(`获取模型列表失败：${e instanceof Error ? e.message : String(e)}`);
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
						text: "请选择供应商。"
					};
					if (providers.length > 0 && !providers.some((p) => p.id === entry.provider)) return {
						kind: "provider-missing",
						text: `DSH 里没有叫「${entry.provider}」的供应商。请到 设置 → 模型 检查或重新添加，然后回来改选。`
					};
					const catalog = catalogOf(entry.provider);
					if (!entry.model) return {
						kind: "model-unknown",
						text: "请选择模型。"
					};
					if (catalog.length > 0 && !catalog.some((m) => m.id === entry.model)) return {
						kind: "model-unknown",
						text: `模型「${entry.model}」不在该供应商的模型列表里。请到 设置 → 模型 添加，或在这里改选。`
					};
					if (catalog.length === 0) return {
						kind: "catalog-unknown",
						text: `未取到「${entry.provider}」的模型列表（登录型账号的模型不在配置文件里）。已填写的模型会在调用时校验；也可以点「获取模型列表」再试。`
					};
					if (!allow.present) return {
						kind: "ok",
						text: "当前 DSH 组合没有子代理模型白名单，可直接使用。"
					};
					if (!allow.enabled) return {
						kind: "selection-off",
						text: "DSH 的「子代理模型选择」是关闭的，顾问无法使用和主对话不同的模型。「开启并授权」会打开它并把上面的模型加入白名单。"
					};
					if (!allow.routes.some((r) => r.provider === entry.provider && r.model === entry.model)) {
						const p = providers.find((x) => x.id === entry.provider);
						return {
							kind: "unauthorized",
							text: `这个模型还没授权给子代理。点「授权」即可——会把「${entry.provider} / ${entry.model}」写进 DSH 的子代理模型白名单${p?.name ? `（${p.name}）` : ""}。`
						};
					}
					if (entry.reasoningEffort) {
						const declared = catalog.find((m) => m.id === entry.model)?.efforts ?? [];
						if (declared.length === 0) return {
							kind: "effort-undeclared",
							text: `模型 ${entry.model} 没有声明推理等级，档位「${entry.reasoningEffort}」会被忽略。到 设置 → 模型 → 编辑该供应商 → 自定义设置 → 模型选项 → 推理等级 开启，或把档位留空。`
						};
						if (!declared.includes(entry.reasoningEffort)) return {
							kind: "effort-undeclared",
							text: `模型 ${entry.model} 声明的推理等级是 ${declared.join(" / ")}，档位「${entry.reasoningEffort}」会被忽略。`
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
						const ns = unwrap(await remote.settings.describe(), "读取设置").namespaces.find((n) => n.ns === SUBAGENT_NS);
						if (!ns) throw new Error("当前 DSH 组合没有「子代理模型选择」设置，无法自动授权。请到 设置 → 插件 → 子代理 手动开启。");
						const current = ns.value;
						const routes = Array.isArray(current?.allowedModels) ? [...current.allowedModels] : [];
						for (const e of entries) if (e.provider && e.model && !routes.some((r) => r.provider === e.provider && r.model === e.model)) routes.push({
							provider: e.provider,
							model: e.model
						});
						const view = unwrap(await remote.settings.update(SUBAGENT_NS, {
							enabled: true,
							allowedModels: routes
						}, ns.revision), "写入子代理模型白名单");
						setAllow((a) => ({
							...a,
							enabled: true,
							routes,
							revision: view.revision,
							present: true
						}));
						setMsg(`已授权 ${entries.length} 个模型给子代理（DSH 的子代理模型选择已${current?.enabled ? "保持开启" : "开启"}）。`);
					} catch (e) {
						const message = e instanceof Error ? e.message : String(e);
						if (/conflict|stale|changed since it was read|revision/i.test(message)) {
							await reload({ silent: true });
							setMsg("设置刚被别处修改，已重新加载；请再点一次「授权」。");
						} else {
							setAuthWritable(false);
							setError(`自动授权失败：${message}。请到 设置 → 插件 → 子代理 手动开启模型选择并添加模型。`);
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
						const view = unwrap(await remote.settings.update(NS, { legacyNoticeDismissed: true }, ns?.revision ?? revision), "记录提醒状态");
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
						setMsg("已记录，之后不再显示这条提醒。");
					} catch (e) {
						setError(`记录失败：${e instanceof Error ? e.message : String(e)}；本次关闭后下次仍会显示。`);
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
						const view = unwrap(await remote.settings.update(NS, sanitized, revision), "保存设置");
						setRevision(view.revision);
						setDraft(view.value);
						setSavedSnapshot(JSON.stringify(view.value));
						setMsg(`已保存并即时生效。${dropped > 0 ? ` 已忽略 ${dropped} 个未填供应商/模型的未完成条目。` : ""}`);
					} catch (e) {
						const message = e instanceof Error ? e.message : String(e);
						if (/conflict|stale|changed since it was read|revision/i.test(message)) {
							await reload({ silent: true });
							setMsg("检测到配置已被外部修改：已重新加载最新配置，未保存的修改已被替换，请重新调整后再保存。");
						} else setError(`保存失败：${message}`);
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
				}, h("div", { style: SET.row }, h("div", { style: error ? SET.msgErr : SET.desc }, error || "加载配置中…"), error ? h("button", {
					style: SET.btn,
					type: "button",
					onClick: () => reload()
				}, "重试") : null));
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
						label: `${entry.model}（不在已获取的模型列表里）`
					}] : []];
					const fetching = busy === `discover:${entry.provider}`;
					return h(Field, { label: "模型" }, h("div", { style: {
						display: "flex",
						gap: 6,
						width: "100%"
					} }, h(Dropdown, {
						width: "100%",
						ariaLabel: "模型",
						value: entry.model,
						options: options.length ? options : [{
							value: "",
							label: catalog.length ? "请选择" : "未取到模型列表"
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
					}, fetching ? "获取中…" : "获取模型列表") : null));
				};
				const effortField = (index, entry) => {
					const declared = catalogOf(entry.provider).find((m) => m.id === entry.model)?.efforts ?? [];
					const options = [
						{
							value: "",
							label: declared.length ? "默认（模型默认档位）" : "默认（该模型未声明推理等级）"
						},
						...declared.map((v) => ({
							value: v,
							label: v
						})),
						...entry.reasoningEffort && !declared.includes(entry.reasoningEffort) ? [{
							value: entry.reasoningEffort,
							label: `${entry.reasoningEffort}（未声明，会被忽略）`
						}] : []
					];
					return h(Field, { label: "推理档位" }, h(Dropdown, {
						width: 180,
						ariaLabel: "推理档位",
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
					} }, `#${index + 1}`), h("span", { style: status.kind === "ok" ? okStyle : status.kind === "effort-undeclared" || status.kind === "catalog-unknown" ? warnStyle : errorStyle }, status.kind === "ok" ? "✓ 可用" : status.kind === "provider-missing" ? "⚠ 供应商不存在" : status.kind === "model-unknown" ? "⚠ 模型未配置" : status.kind === "catalog-unknown" ? "⚠ 未取到模型列表" : status.kind === "selection-off" ? "⚠ 子代理模型选择已关闭" : status.kind === "unauthorized" ? "⚠ 未授权" : "⚠ 档位未声明"), h("span", { style: { flex: 1 } }), status.kind === "unauthorized" && authWritable ? h("button", {
						style: SET.btn,
						type: "button",
						disabled: busy !== null,
						onClick: () => authorize([entry])
					}, "授权") : null, status.kind === "selection-off" && authWritable ? h("button", {
						style: SET.btn,
						type: "button",
						disabled: busy !== null,
						onClick: () => authorize([entry])
					}, "开启并授权") : null, h("button", {
						style: SET.btn,
						type: "button",
						"aria-label": "上移",
						title: "上移",
						onClick: () => moveEntry(index, -1),
						disabled: index === 0
					}, "↑"), h("button", {
						style: SET.btn,
						type: "button",
						"aria-label": "下移",
						title: "下移",
						onClick: () => moveEntry(index, 1),
						disabled: index === draft.chain.length - 1
					}, "↓"), h("button", {
						style: SET.btn,
						type: "button",
						onClick: () => removeEntry(index)
					}, "删除")), h("div", { style: {
						display: "flex",
						gap: 12,
						flexWrap: "wrap"
					} }, h(Field, { label: "显示名（可选）" }, h("input", {
						style: {
							...SET.control,
							width: 150
						},
						placeholder: "如：架构顾问",
						value: entry.label ?? "",
						onChange: (e) => patchEntry(index, { label: e.target.value })
					})), h(Field, { label: "供应商" }, h(Dropdown, {
						width: "100%",
						ariaLabel: "供应商",
						value: entry.provider,
						options: providers.length ? providers.map((p) => ({
							value: p.id,
							label: p.name && p.name !== p.id ? `${p.id}（${p.name}）` : p.id
						})) : [{
							value: entry.provider,
							label: entry.provider || "（未获取到供应商）"
						}],
						onChange: (e) => patchProvider(index, e.target.value)
					})), modelField(index, entry)), h("div", { style: {
						display: "flex",
						gap: 12,
						flexWrap: "wrap",
						marginTop: 10
					} }, effortField(index, entry), h(Field, { label: "maxTokens" }, h("input", {
						style: {
							...SET.control,
							width: 120
						},
						type: "number",
						min: 1,
						value: entry.maxTokens ?? "",
						onChange: (e) => patchEntry(index, { maxTokens: e.target.value === "" ? void 0 : Number(e.target.value) })
					})), h(Field, { label: "超时（毫秒）" }, h("input", {
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
				} }, "你从旧版本升级而来"), h("div", null, "升级前的会话里留有旧版 Second Opinion 写入的咨询记录：只要本插件保持启用，这些会话可以正常打开；卸载本插件后它们可能无法打开。本版本不再写入这类记录，修复旧会话的工具将在下一版本提供。"), h("a", {
					href: UPGRADE_NOTES_URL,
					target: "_blank",
					rel: "noreferrer",
					style: {
						...smallStyle,
						color: "var(--dsw-alias-brand-primary)"
					}
				}, "详见 README「升级须知」")), h("button", {
					style: SET.btn,
					type: "button",
					onClick: dismissLegacyNotice
				}, "知道了")) : null, h(SRow, {
					title: "启用 Second Opinion",
					desc: "停用后 second_opinion 不可用，也不再注入使用边界提示。"
				}, h(Toggle, {
					checked: draft.enabled,
					label: "启用 Second Opinion",
					onChange: (next) => patch({ enabled: next })
				})), h(SRow, {
					title: "触发模式",
					desc: "auto：主模型按调用判据自主咨询；manual：仅用户明确要求时咨询。"
				}, h(Dropdown, {
					value: draft.mode,
					width: 240,
					ariaLabel: "触发模式",
					options: [{
						value: "auto",
						label: "auto（主模型自主判断）"
					}, {
						value: "manual",
						label: "manual（仅用户要求时）"
					}],
					onChange: (e) => patch({ mode: e.target.value })
				})), h(SRow, {
					title: "默认咨询模式",
					desc: "继承：顾问收到当前会话的有界抄本；盲审：顾问不看对话，只依据问题与补充背景独立判断。可在调用时按次覆盖。"
				}, h(Dropdown, {
					value: draft.contextMode,
					width: 240,
					ariaLabel: "默认咨询模式",
					options: [{
						value: "inherited",
						label: "继承（会话抄本）"
					}, {
						value: "standalone",
						label: "盲审（独立判断）"
					}],
					onChange: (e) => patch({ contextMode: e.target.value })
				})), h("div", { style: SET.groupHead }, h("div", null, h("div", { style: SET.title }, "顾问模型链"), h("div", { style: SET.desc }, "按顺序尝试；某项失败自动顺延下一个。顾问是只读子代理：能读文件、跑只读命令核实，改不了任何东西。模型与推理等级在 设置 → 模型 里配置，这里只从中选择。")), h("div", { style: {
					display: "flex",
					gap: 8
				} }, unauthorized.length > 0 && authWritable ? h("button", {
					style: SET.btn,
					type: "button",
					disabled: busy !== null,
					onClick: () => authorize(unauthorized)
				}, allow.enabled ? "授权全部" : "开启并授权全部") : null, h("button", {
					style: SET.btn,
					type: "button",
					onClick: addEntry
				}, "＋ 添加顾问模型"))), ...draft.chain.map((entry, index) => entryNode(index, entry)), draft.chain.length === 0 ? h("div", { style: {
					...SET.desc,
					padding: "0 0 12px"
				} }, "尚未配置顾问模型——先在 设置 → 模型 里添加供应商和模型，再在这里选择。") : null, h("div", { style: {
					padding: "16px 0",
					borderBottom: "0.5px solid var(--dsw-alias-border-l2)"
				} }, h("div", { style: SET.title }, "顾问提示词"), h("div", { style: SET.desc }, "整条链共用的回答要求；清空并保存可回落到插件默认。身份、只读与输出约束由插件固定追加，不在这里。"), h("textarea", {
					style: SET.textarea,
					value: draft.advisorPrompt,
					onChange: (e) => patch({ advisorPrompt: e.target.value })
				})), numRow("最多追问轮数", "每个咨询线程最多可追问多少轮；追问复用同一个顾问子会话。", draft.followup?.maxRounds ?? 8, 1, 20, 1, (v) => patch({ followup: { maxRounds: Math.min(20, Math.max(1, v || 8)) } })), numRow("默认超时（毫秒）", "顾问未单独配置超时时的上限。顾问可能先思考再作答；开始输出回答后只要持续输出就不会被打断。", draft.limits?.defaultTimeoutMs ?? 3e5, 1e3, 6e5, 500, (v) => patch({ limits: {
					...draft.limits,
					defaultTimeoutMs: v || 3e5
				} })), numRow("抄本字符预算", "继承模式下发给顾问的会话抄本总字符上限；超出时保留最新部分并附最初请求的摘要。", draft.limits?.transcriptMaxChars ?? 12e4, 2e3, 4e5, 1e3, (v) => patch({ limits: {
					...draft.limits,
					transcriptMaxChars: v || 12e4
				} })), numRow("单条消息上限", "抄本中单条消息（含工具输出）的最大字符数；超出部分被截断，顾问可按路径自行读取完整内容。", draft.limits?.perEntryMaxChars ?? 4e3, 200, 2e4, 100, (v) => patch({ limits: {
					...draft.limits,
					perEntryMaxChars: v || 4e3
				} })), numRow("重复提问强制咨询阈值", "同一用户问题重复达到该次数时，提示升级为强制咨询。", draft.trigger?.repeatThreshold ?? 3, 2, 10, 1, (v) => patch({ trigger: { repeatThreshold: Math.min(10, Math.max(2, v || 3)) } }), true), h("div", { style: {
					...SET.row,
					display: "block"
				} }, h("div", { style: SET.title }, "关于"), h("div", { style: {
					...SET.desc,
					marginTop: 4
				} }, "Second Opinion（dsh-advisor-chain）由 ", h("a", {
					href: REPO_URL,
					target: "_blank",
					rel: "noreferrer",
					style: { color: "var(--dsw-alias-brand-primary)" }
				}, "yyty947"), " 开发。灵感来自 ", h("a", {
					href: "https://github.com/pixelsama/codex-advisor",
					target: "_blank",
					rel: "noreferrer",
					style: { color: "var(--dsw-alias-brand-primary)" }
				}, "pixelsama/codex-advisor"), "。"), h("div", { style: SET.desc }, h("a", {
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
				} }, error ? h("div", { style: SET.msgErr }, error) : msg ? h("div", { style: SET.msgOk }, msg) : dirty ? h("div", { style: SET.msgErr }, "有未保存更改") : null), h("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: 10
				} }, dirty ? h("button", {
					style: SET.btn,
					type: "button",
					onClick: () => reload({ silent: true })
				}, "放弃修改") : null, h("button", {
					style: SET.btnPrimary,
					type: "button",
					disabled: saving,
					onClick: save
				}, saving ? "保存中…" : "保存"))));
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
					cursor: "pointer"
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
			const name = "dsh-advisor-chain";
			const inject = [
				"uiConversation",
				"slots",
				"remote",
				"remote.settings",
				"remote.llm"
			];
			let currentCtx = null;
			function apply(ctx) {
				currentCtx = ctx;
				if (ctx.uiConversation?.events?.register) ctx.uiConversation.events.register(legacyAdvisorCardDefinition);
				ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
					name: "tool.call.toolview",
					key: "second_opinion"
				}, SecondOpinionToolRow));
				ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
					name: "conversation.chat.node",
					key: "dsh-advisor-chain-legacy"
				}, LegacyAdvisorCardView));
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "dsh-advisor-chain",
					order: 0,
					label: "Second Opinion"
				}, AdvisorSettingsTab));
			}
			return {
				name,
				inject,
				apply
			};
		}
	});

})();