(function() {

// src/client.ts
	window.__ModuleLoader__.load({
		id: "dsh-second-opinion",
		factory(require) {
			const React = require("react");
			const h = React.createElement;
			const useState = React.useState;
			const useEffect = React.useEffect;
			const cardStyle = {
				border: "1px solid var(--dsw-alias-border-l1)",
				borderRadius: 10,
				background: "var(--dsw-alias-bg-layer-1)",
				padding: "10px 12px",
				margin: "6px 0",
				fontSize: 13,
				lineHeight: 1.6
			};
			const badgeStyle = (color) => ({
				display: "inline-block",
				padding: "0 6px",
				borderRadius: 8,
				fontSize: 11,
				lineHeight: "18px",
				color: "var(--dsw-alias-bg-base)",
				background: color,
				marginLeft: 6
			});
			const smallStyle = {
				fontSize: 12,
				opacity: .75
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
			const advisorCardDefinition = {
				kind: "dsh-second-opinion",
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
						turn: data.turn,
						step: data.step,
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
						kind: "dsh-second-opinion",
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
			function AdvisorCardView(props) {
				const data = props.node?.data;
				const [contextOpen, setContextOpen] = useState(false);
				if (!data) return null;
				const failed = data.status === "failed";
				const running = data.status === "running";
				const messages = data.messages ?? [];
				const followUps = data.followUps ?? [];
				const statusBadge = failed ? badgeStyle("var(--dsw-alias-state-error-primary)") : running ? badgeStyle("var(--dsw-alias-state-warn-primary)") : badgeStyle("var(--dsw-alias-state-success-primary)");
				const statusText = failed ? "失败" : running ? "咨询中…" : "完成";
				followUps.length > 0 && followUps[followUps.length - 1];
				return h("div", { style: cardStyle }, h("div", null, h("span", { style: labelStyle }, "Second Opinion 咨询"), h("span", { style: statusBadge }, statusText), messages.map((m) => h("span", {
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
				} }, data.context) : null) : null, messages.length > 0 && messages.some((m) => m.thinking) ? h(Fold, { title: "顾问思考过程" }, messages.map((m) => m.thinking).filter(Boolean).join("\n\n")) : null, !messages.length && data.liveThinking ? h(Fold, { title: "顾问思考过程" }, data.liveThinking) : null, messages.length > 0 ? messages.length > 1 ? h("div", { style: {
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
						borderRadius: 8,
						padding: "6px 8px"
					}
				}, h("div", { style: {
					...smallStyle,
					marginBottom: 4
				} }, m.label || m.model), h("div", { style: { whiteSpace: "pre-wrap" } }, m.content)))) : h("div", { style: {
					whiteSpace: "pre-wrap",
					marginTop: 6
				} }, messages[0].content) : running ? h("div", { style: {
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
				} }, `追问 ${i + 1}：${f.text}`), f.answer !== void 0 ? h("div", { style: {
					whiteSpace: "pre-wrap",
					marginTop: 4
				} }, f.answer, running && i === followUps.length - 1 && !f.answer ? "▍" : null) : h("div", { style: smallStyle }, "思考中…"))), !messages.length && !followUps.length && running && !data.liveContent && !data.liveThinking ? h("div", { style: smallStyle }, `正在咨询 ${data.chain?.[data.currentAttempt]?.label ?? ""} …`) : null, data.attempts?.length ? h("div", { style: {
					marginTop: 8,
					...smallStyle
				} }, "尝试记录：", data.attempts.map((attempt, i) => h("span", { key: i }, i > 0 ? " → " : "", attempt.ok ? "✓" : "✗", attempt.label, attempt.ok || !attempt.error ? "" : `（${attempt.error}）`))) : null);
			}
			function unwrap(response, what) {
				if (response && response.ok && response.value !== void 0) return response.value;
				throw new Error(`${what}失败：${response?.error?.message ?? "远程调用返回异常"}`);
			}
			function getRemote(ctx) {
				const candidate = ctx;
				return candidate.remote ?? (typeof candidate.get === "function" ? candidate.get("remote") : void 0);
			}
			const NS = "dsh-second-opinion";
			const EFFORTS = [
				{
					value: "",
					label: "默认（不指定）"
				},
				{
					value: "off",
					label: "off（关闭思考）"
				},
				{
					value: "low",
					label: "low"
				},
				{
					value: "high",
					label: "high"
				},
				{
					value: "max",
					label: "max"
				}
			];
			const SET = {
				root: {
					width: "100%",
					color: "var(--dsw-alias-label-primary)",
					fontFamily: "var(--dsw-font-family, inherit)"
				},
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
					borderRadius: 8,
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
					borderRadius: 8,
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
					borderRadius: 10,
					padding: 12,
					marginBottom: 12
				},
				btn: {
					height: 28,
					padding: "0 12px",
					borderRadius: 8,
					border: "1px solid var(--dsw-alias-border-l2)",
					background: "transparent",
					color: "var(--dsw-alias-label-primary)",
					fontSize: 12.5,
					cursor: "pointer"
				},
				btnPrimary: {
					height: 32,
					padding: "0 18px",
					borderRadius: 8,
					border: "1px solid transparent",
					background: "var(--dsw-alias-label-primary)",
					color: "var(--dsw-alias-bg-base)",
					fontSize: 13,
					cursor: "pointer"
				},
				msgOk: {
					fontSize: 12,
					color: "var(--dsw-alias-state-success-primary)"
				},
				msgErr: {
					fontSize: 12,
					color: "var(--dsw-alias-state-error-primary)"
				},
				fieldLabel: {
					display: "block",
					marginBottom: 4,
					color: "var(--dsw-alias-label-secondary)",
					fontSize: 12,
					lineHeight: "18px"
				}
			};
			/** Native-style pill switch (role="switch" + aria-checked kept; the
			*  visual mirrors the shipped settings toggle with token colors).
			*  The focus ring is emulated through state because inline styles
			*  cannot express :focus-visible; disabled dims via opacity. */
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
			/** One native-style settings row: title + description left, control right. */
			function SRow({ title, desc, last, children }) {
				return h("div", { style: {
					...SET.row,
					...last ? { borderBottom: "none" } : null
				} }, h("div", { style: { minWidth: 0 } }, h("div", { style: SET.title }, title), desc ? h("div", { style: SET.desc }, desc) : null), children ?? null);
			}
			/** Labeled field: the label wraps its control (implicit association), so
			*  clicking the label focuses the control and screen readers announce it. */
			function Field({ label, children }) {
				return h("label", { style: {
					display: "flex",
					flexDirection: "column",
					gap: 4,
					minWidth: 0
				} }, h("span", { style: SET.fieldLabel }, label), children);
			}
			/**
			* Native-style dropdown: the closed control matches the host's rounded
			* bordered selector, and the expanded list is a self-drawn listbox that
			* mirrors the official popover (rounded card, hover highlight, checkmark
			* on the selected option) — a <select>'s OS-rendered popup cannot be
			* styled with CSS, so the whole listbox is drawn here. Keyboard: the
			* closed trigger opens on ArrowUp/Down/Enter/Space; Escape closes;
			* ArrowUp/Down move the highlight; Enter/Space select it. Outside
			* mousedown closes via a containment check on the wrapper.
			*/
			function Dropdown({ value, onChange, width, ariaLabel, options }) {
				const [open, setOpen] = useState(false);
				const [highlight, setHighlight] = useState(0);
				const wrapRef = React.useRef?.(null) ?? { current: null };
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
					onChange({ target: { value: v } });
					setOpen(false);
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
						setHighlight((h) => Math.min(options.length - 1, Math.max(0, h + (ev.key === "ArrowDown" ? 1 : -1))));
					} else if (open && (ev.key === "Enter" || ev.key === " ")) {
						ev.preventDefault();
						if (options[highlight]) select(options[highlight].value);
					}
				};
				const current = options.find((o) => o.value === value);
				return h("div", {
					ref: wrapRef.current === void 0 ? void 0 : (node) => {
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
						borderRadius: 10,
						padding: 4,
						boxShadow: "0 4px 16px rgba(0,0,0,0.14)"
					}
				}, options.map((o, i) => h("div", {
					key: o.value,
					role: "option",
					"aria-selected": o.value === value,
					onClick: () => select(o.value),
					onMouseEnter: () => setHighlight(i),
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
						gap: 8,
						padding: "6px 10px",
						borderRadius: 6,
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
			function AdvisorSettingsTab() {
				const [draft, setDraft] = useState(null);
				const [revision, setRevision] = useState(0);
				const [allNamespaces, setAllNamespaces] = useState([]);
				const [providers, setProviders] = useState([]);
				const [nsByProvider, setNsByProvider] = useState({});
				const [modelOptions, setModelOptions] = useState({});
				const [fetchingProvider, setFetchingProvider] = useState(null);
				const [saving, setSaving] = useState(false);
				const [msg, setMsg] = useState("");
				const [error, setError] = useState("");
				const [savedSnapshot, setSavedSnapshot] = useState("");
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
						const ns = namespaces.find((n) => n.ns === NS);
						if (!ns) {
							setError("未找到本插件的配置命名空间（插件可能未启用或未安装完成）。");
							return;
						}
						setDraft(ns.value);
						setRevision(ns.revision);
						setSavedSnapshot(JSON.stringify(ns.value));
						const [provs, confs] = await Promise.all([remote.llm.listProviders().catch(() => void 0), remote.llm.listConfigurableProviders().catch(() => void 0)]);
						setProviders(provs && provs.ok && Array.isArray(provs.value) ? provs.value : []);
						setNsByProvider(confs && confs.ok && Array.isArray(confs.value) ? Object.fromEntries(confs.value.map((c) => [c.provider, c.settingsNs])) : {});
						if (provs === void 0 || confs === void 0) setError("供应商列表获取失败（设置 → 模型 页可能尚未就绪）；仍可手动输入 provider 和模型 id。");
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
				/**
				* Model suggestions already stored in DSH's own provider config — no
				* network involved. Shapes differ per adapter:
				* - llm-deepseek / llm-deepseek-account: a volatile `models` catalog
				*   array (objects with `id`, defaulting to the shipped catalog);
				* - llm-pi-ai: `providers` dict keyed by route id; a route carries its
				*   own `models` list (replaces the catalog) and the `baseURL` endpoint
				*   interrogation needs, since llm/discoverModels never reads stored
				*   settings or credentials ("the caller owns both").
				*/
				const storedModelInfo = (namespaces, provider, settingsNs) => {
					const value = (namespaces ?? []).find((n) => n.ns === settingsNs)?.value;
					const models = [];
					const push = (m) => {
						const id = typeof m === "string" ? m : m?.id;
						if (typeof id === "string" && id && !models.includes(id)) models.push(id);
					};
					if (!value) return { models };
					if (Array.isArray(value.models)) value.models.forEach(push);
					let baseURL;
					if (value.providers && typeof value.providers === "object") {
						const route = value.providers[provider];
						if (route && typeof route === "object") {
							const r = route;
							if (Array.isArray(r.models)) r.models.forEach(push);
							if (typeof r.baseURL === "string" && r.baseURL) baseURL = r.baseURL;
						}
					}
					return {
						models,
						baseURL
					};
				};
				const fetchModels = async (provider) => {
					if (!provider) return;
					setFetchingProvider(provider);
					setMsg("");
					setError("");
					try {
						const settingsNs = nsByProvider[provider];
						const stored = storedModelInfo(allNamespaces, provider, settingsNs);
						const models = [...stored.models];
						let discoveryNote = "";
						if (settingsNs) try {
							const discovered = unwrap(await getRemote(currentCtx).llm.discoverModels(settingsNs, {
								provider,
								...stored.baseURL ? { baseURL: stored.baseURL } : {}
							}), "获取模型列表");
							for (const m of discovered) if (!models.includes(m.id)) models.push(m.id);
						} catch (e) {
							discoveryNote = e instanceof Error ? e.message : String(e);
						}
						if (models.length > 0) {
							setError("");
							setModelOptions((prev) => ({
								...prev,
								[provider]: models
							}));
							const sources = [stored.models.length > 0 ? `DSH 配置 ${stored.models.length} 个` : "", discoveryNote === "" && settingsNs ? "端点探测" : ""].filter(Boolean).join(" + ");
							setMsg(`已加载 ${models.length} 个模型（${sources}），下拉中可选。${discoveryNote ? ` 端点探测未成功：${discoveryNote}` : ""}`);
						} else if (/no model discovery is registered/i.test(discoveryNote)) {
							setMsg("");
							setError("该供应商的适配器没有提供模型发现，请直接手动填写模型 id（可从 设置 → 模型 里复制）。");
						} else if (/baseURL/i.test(discoveryNote)) {
							setMsg("");
							setError("该自定义供应商需要先在 设置 → 模型 里配置 baseURL（保存后回来重新获取），或直接手动填写模型 id。");
						} else {
							setMsg("");
							setError(`获取模型列表失败：${discoveryNote || "无可用来源"}。可直接手动填写模型 id。`);
						}
					} finally {
						setFetchingProvider(null);
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
							...draft,
							chain: draft.chain.filter((e) => e.provider && e.model).map((e) => ({
								...e,
								temperature: clamp(e.temperature, 0, 2),
								maxTokens: clamp(e.maxTokens, 1, 1e6),
								timeoutMs: clamp(e.timeoutMs, 1e3, 6e5)
							}))
						};
						const view = unwrap(await remote.settings.update(NS, sanitized, revision), "保存设置");
						setRevision(view.revision);
						setDraft(view.value);
						setSavedSnapshot(JSON.stringify(view.value));
						setMsg(`已保存并即时生效。${dropped > 0 ? ` 已忽略 ${dropped} 个未填 provider/模型 的未完成条目。` : ""}`);
					} catch (e) {
						const message = e instanceof Error ? e.message : String(e);
						if (/conflict|stale/i.test(message)) {
							await reload({ silent: true });
							setMsg("检测到配置已被外部修改：已重新加载最新配置，未保存的修改已被替换，请重新调整后再保存。");
						} else setError(`保存失败：${message}`);
					} finally {
						setSaving(false);
					}
				};
				if (!draft) return h("li", {
					className: "dsh-second-opinion-settings",
					style: {
						...SET.root,
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
				const entryNode = (index, entry) => h("div", {
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
				} }, `#${index + 1}`), h("span", { style: { flex: 1 } }), h("button", {
					style: {
						...SET.btn,
						opacity: fetchingProvider === entry.provider || !entry.provider ? .5 : 1
					},
					type: "button",
					title: !entry.provider ? "先选择 provider 后再获取模型列表" : void 0,
					disabled: fetchingProvider === entry.provider || !entry.provider,
					onClick: () => fetchModels(entry.provider)
				}, fetchingProvider === entry.provider ? "获取中…" : "获取模型列表"), h("button", {
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
				})), h(Field, { label: "Provider" }, h(Dropdown, {
					width: "100%",
					ariaLabel: "Provider",
					value: entry.provider,
					options: providers.length > 0 ? providers.map((p) => ({
						value: p.id,
						label: p.name || p.id
					})) : [{
						value: entry.provider,
						label: entry.provider || "（未获取到供应商）"
					}],
					onChange: (e) => patchEntry(index, { provider: e.target.value })
				})), h(Field, { label: "模型 id" }, h("input", {
					style: {
						...SET.control,
						width: "100%",
						boxSizing: "border-box"
					},
					list: `dsh-advisor-models-${index}`,
					placeholder: "模型 id",
					value: entry.model,
					onChange: (e) => patchEntry(index, { model: e.target.value })
				})), (modelOptions[entry.provider] ?? []).length > 0 ? h("datalist", { id: `dsh-advisor-models-${index}` }, modelOptions[entry.provider].map((id) => h("option", {
					key: id,
					value: id
				}))) : null), h("div", { style: {
					display: "flex",
					gap: 12,
					flexWrap: "wrap",
					marginTop: 10
				} }, h(Field, { label: "推理档位" }, h(Dropdown, {
					width: 170,
					ariaLabel: "推理档位",
					value: entry.reasoningEffort ?? "",
					options: EFFORTS.map((effort) => ({
						value: effort.value,
						label: effort.label
					})),
					onChange: (e) => patchEntry(index, { reasoningEffort: e.target.value || void 0 })
				})), h(Field, { label: "温度（0–2）" }, h("input", {
					style: {
						...SET.control,
						width: 110
					},
					type: "number",
					min: 0,
					max: 2,
					step: .1,
					value: entry.temperature ?? "",
					onChange: (e) => patchEntry(index, { temperature: e.target.value === "" ? void 0 : Number(e.target.value) })
				})), h(Field, { label: "maxTokens" }, h("input", {
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
				}))));
				return h("li", {
					className: "dsh-second-opinion-settings",
					style: {
						...SET.root,
						listStyle: "none",
						padding: 0,
						margin: 0
					}
				}, h("div", { style: {
					pointerEvents: saving ? "none" : "auto",
					opacity: saving ? .6 : 1
				} }, h(SRow, {
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
					desc: "inherited：顾问自动继承完整对话；standalone：盲审——顾问只看问题与补充背景，独立判断。可在调用时按次覆盖。"
				}, h(Dropdown, {
					value: draft.contextMode ?? "inherited",
					width: 240,
					ariaLabel: "默认咨询模式",
					options: [{
						value: "inherited",
						label: "inherited（继承完整对话）"
					}, {
						value: "standalone",
						label: "standalone（盲审）"
					}],
					onChange: (e) => patch({ contextMode: e.target.value })
				})), h("div", { style: SET.groupHead }, h("div", null, h("div", { style: SET.title }, "顾问模型链"), h("div", { style: SET.desc }, "按顺序尝试；某项失败（出错或超时无产出）自动顺延下一个。")), h("button", {
					style: SET.btn,
					type: "button",
					onClick: addEntry
				}, "＋ 添加顾问模型")), ...draft.chain.map((entry, index) => entryNode(index, entry)), draft.chain.length === 0 ? h("div", { style: {
					...SET.desc,
					padding: "0 0 12px"
				} }, "尚未配置顾问模型——配置后 second_opinion 才可用。") : null, h("div", { style: {
					padding: "16px 0",
					borderBottom: "0.5px solid var(--dsw-alias-border-l2)"
				} }, h("div", { style: SET.title }, "顾问系统提示词"), h("div", { style: SET.desc }, "整条链共用；清空并保存可回落到插件默认。"), h("textarea", {
					style: SET.textarea,
					value: draft.advisorPrompt,
					onChange: (e) => patch({ advisorPrompt: e.target.value })
				})), numRow("重复提问强制咨询阈值", "同一用户问题重复达到该次数时，提示升级为强制咨询（单位：次）。", draft.trigger?.repeatThreshold ?? 3, 2, 10, 1, (v) => patch({ trigger: { repeatThreshold: Math.min(10, Math.max(2, v || 3)) } })), numRow("抄本字符预算", "发送给顾问的对话抄本总字符上限；超出时保留最新部分并标注省略。", draft.limits?.transcriptMaxChars ?? 6e4, 2e3, 4e5, 1e3, (v) => patch({ limits: {
					...draft.limits,
					transcriptMaxChars: v || 6e4
				} })), numRow("单条消息上限", "抄本中单条消息（含工具结果）的最大字符数。", draft.limits?.perEntryMaxChars ?? 2e3, 200, 2e4, 100, (v) => patch({ limits: {
					...draft.limits,
					perEntryMaxChars: v || 2e3
				} })), numRow("默认超时（毫秒）", "链上条目未单独配置超时时的单次调用上限。", draft.limits?.defaultTimeoutMs ?? 12e4, 1e3, 6e5, 500, (v) => patch({ limits: {
					...draft.limits,
					defaultTimeoutMs: v || 12e4
				} }), true)), h("div", { style: {
					position: "sticky",
					bottom: 0,
					display: "flex",
					alignItems: "center",
					justifyContent: "flex-end",
					gap: 12,
					padding: "10px 2px",
					background: "var(--dsw-alias-bg-base)",
					borderBottom: "none",
					borderTop: "0.5px solid var(--dsw-alias-border-l1)"
				} }, h("div", {
					role: "status",
					"aria-live": "polite",
					style: {
						flex: 1,
						minWidth: 0
					}
				}, error ? h("span", { style: SET.msgErr }, error) : msg ? h("span", { style: SET.msgOk }, msg) : null), dirty ? h("span", { style: SET.msgErr }, "有未保存更改") : null, dirty ? h("button", {
					style: SET.btn,
					type: "button",
					onClick: () => reload({ silent: true })
				}, "放弃修改") : null, h("button", {
					style: SET.btnPrimary,
					type: "button",
					disabled: saving,
					onClick: save
				}, saving ? "保存中…" : "保存")));
			}
			const name = "dsh-second-opinion";
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
				if (ctx.uiConversation?.events?.register) ctx.uiConversation.events.register(advisorCardDefinition);
				ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
					name: "conversation.chat.node",
					key: "dsh-second-opinion",
					locale: "chat"
				}, AdvisorCardView));
				ctx.slots.inject("settings.section", () => ctx.slots.register({
					name: "settings.section",
					id: "dsh-second-opinion",
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