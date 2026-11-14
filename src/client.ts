// Client half of dsh-advisor-plugin: chat card + settings tab.
//
// The web ModuleLoader evaluates this bundle and passes a `require` shim that
// resolves shared client modules (react) from the browser module table, so
// react is taken from the factory argument instead of a bundled import.

interface ModuleLoaderGlobal {
  __ModuleLoader__?: {
    load(mod: { id: string; factory: (require: (id: string) => unknown) => unknown }): unknown;
  };
}
const moduleLoaderWindow = window as unknown as ModuleLoaderGlobal;

moduleLoaderWindow.__ModuleLoader__!.load({
  id: "dsh-advisor-plugin",
  factory(require) {
    const React = require("react") as typeof import("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    // ---------- shared styles (theme tokens with literal fallbacks) ----------
    const cardStyle: React.CSSProperties = {
      border: "1px solid var(--dsw-alias-color-border, rgba(127,127,127,.35))",
      borderRadius: 10,
      background: "var(--dsw-alias-color-bg-subtle, rgba(127,127,127,.06))",
      padding: "10px 12px",
      margin: "6px 0",
      fontSize: 13,
      lineHeight: 1.6,
    };
    const badgeStyle = (color: string): React.CSSProperties => ({
      display: "inline-block",
      padding: "0 6px",
      borderRadius: 8,
      fontSize: 11,
      lineHeight: "18px",
      color: "#fff",
      background: color,
      marginLeft: 6,
    });
    const smallStyle: React.CSSProperties = { fontSize: 12, opacity: 0.75 };
    const labelStyle: React.CSSProperties = { fontWeight: 600, marginRight: 6 };
    const toggleStyle: React.CSSProperties = {
      background: "transparent",
      border: "none",
      color: "var(--dsw-alias-color-link, #3b82f6)",
      cursor: "pointer",
      padding: 0,
      fontSize: 12,
    };
    const inputStyle: React.CSSProperties = {
      boxSizing: "border-box",
      width: "100%",
      padding: "4px 8px",
      borderRadius: 6,
      border: "1px solid var(--dsw-alias-color-border, rgba(127,127,127,.4))",
      background: "var(--dsw-alias-color-bg, transparent)",
      color: "inherit",
      fontSize: 13,
    };
    const buttonStyle: React.CSSProperties = {
      padding: "3px 10px",
      borderRadius: 6,
      border: "1px solid var(--dsw-alias-color-border, rgba(127,127,127,.4))",
      background: "transparent",
      color: "inherit",
      cursor: "pointer",
      fontSize: 12,
    };

    // ---------- chat card event definition ----------
    interface ChainRow { label?: string; provider: string; model: string }
    interface AttemptRow { label: string; ok: boolean; error?: string }
    interface CardState {
      consultId: string;
      turn: number;
      step: number;
      question: string;
      context?: string;
      chain: ChainRow[];
      status: "running" | "done" | "failed";
      currentAttempt: number;
      liveContent: string;
      liveThinking: string;
      message?: { label: string; model: string; content: string; thinking?: string; truncated?: boolean };
      attempts: AttemptRow[];
      truncated?: boolean;
    }

    const advisorCardDefinition = {
      kind: "dsh-advisor-plugin",
      target: "chat",
      match(event: { type?: string; data?: { consultId?: string } }) {
        if (event.type === "advisor/start" && event.data?.consultId) return { id: event.data.consultId, role: "start" };
        if ((event.type === "advisor/delta" || event.type === "advisor/message" || event.type === "advisor/end") && event.data?.consultId) {
          return { id: event.data.consultId, role: "update" };
        }
        return null;
      },
      start(_context: unknown, match: { event: { data: Record<string, unknown> } }) {
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
          attempts: [],
        } as CardState;
      },
      update(context: { state: CardState }, match: { event: { type: string; data: Record<string, unknown> } }) {
        const data = match.event.data;
        const state = context.state;
        if (match.event.type === "advisor/delta") {
          const attemptIndex = (data.attemptIndex as number) ?? 0;
          const reset = attemptIndex !== state.currentAttempt;
          return {
            ...state,
            currentAttempt: attemptIndex,
            liveContent: (reset ? "" : state.liveContent) + ((data.contentDelta as string) ?? ""),
            liveThinking: (reset ? "" : state.liveThinking) + ((data.thinkingDelta as string) ?? ""),
          };
        }
        if (match.event.type === "advisor/message") {
          return {
            ...state,
            message: {
              label: (data.label as string) ?? "",
              model: `${data.provider}/${data.model}`,
              content: (data.content as string) ?? "",
              thinking: data.thinking as string | undefined,
              truncated: data.truncated === true,
            },
            liveContent: "",
            liveThinking: "",
          };
        }
        if (match.event.type === "advisor/end") {
          return {
            ...state,
            status: (data.status as CardState["status"]) ?? "done",
            attempts: (data.attempts as AttemptRow[]) ?? state.attempts,
            truncated: data.truncated === true || state.truncated,
          };
        }
        return state;
      },
      // A conversation Definition must declare target and buildViewNode
      // together: this builds the chat-target view node for one assembled
      // Context. The generic face is { key, kind, id, target, data }; the
      // chat snapshot builder reads the extras (anchorSeq/location/visibility)
      // at runtime — same technique the official chat definitions use.
      buildViewNode(context: {
        key?: string;
        id?: string;
        state?: CardState;
        start?: { event?: { seq?: number }; location?: unknown };
        matches?: Array<{ event?: { seq?: number }; location?: unknown }>;
      }) {
        if (context.state === undefined) return null;
        return {
          key: context.key,
          kind: "dsh-advisor-plugin",
          id: context.id,
          target: "chat",
          anchorSeq: context.start?.event?.seq ?? context.matches?.[0]?.event?.seq ?? 0,
          location: context.start?.location ?? context.matches?.[0]?.location ?? { kind: "unresolved" },
          visibility: "visible",
          data: context.state,
        };
      },
    };

    // ---------- chat card view ----------
    function Fold({ title, children, defaultOpen = false }: { title: string; children?: React.ReactNode; defaultOpen?: boolean }) {
      const [open, setOpen] = useState(defaultOpen);
      return h("div", null,
        h("button", { style: toggleStyle, onClick: () => setOpen(!open), type: "button" }, `${open ? "▾" : "▸"} ${title}`),
        open ? h("div", { style: { whiteSpace: "pre-wrap", ...smallStyle, marginTop: 4 } }, children) : null);
    }

    function AdvisorCardView(props: { node?: { data?: CardState } }) {
      const data = props.node?.data;
      const [contextOpen, setContextOpen] = useState(false);
      if (!data) return null;
      const message = data.message;
      const content = message ? message.content : data.liveContent;
      const thinking = message?.thinking || data.liveThinking;
      const failed = data.status === "failed";
      const running = data.status === "running";
      const statusBadge = failed ? badgeStyle("#dc2626") : running ? badgeStyle("#d97706") : badgeStyle("#16a34a");
      const statusText = failed ? "失败" : running ? "咨询中…" : "完成";
      return h("div", { style: cardStyle },
        h("div", null,
          h("span", { style: labelStyle }, "顾问咨询"),
          h("span", { style: statusBadge }, statusText),
          message ? h("span", { style: badgeStyle("#2563eb") }, message.model) : null,
          data.truncated ? h("span", { style: badgeStyle("#b45309") }, "已截断") : null),
        h("div", { style: { fontWeight: 600, margin: "6px 0 2px" } }, data.question),
        data.context ? h("div", null,
          h("button", { style: toggleStyle, type: "button", onClick: () => setContextOpen(!contextOpen) }, `${contextOpen ? "▾" : "▸"} 补充背景`),
          contextOpen ? h("div", { style: { whiteSpace: "pre-wrap", ...smallStyle, marginTop: 4 } }, data.context) : null) : null,
        thinking && thinking.trim() ? h(Fold, { title: "顾问思考过程" }, thinking) : null,
        content ? h("div", { style: { whiteSpace: "pre-wrap", marginTop: 6 } }, content, running ? "▍" : null) : null,
        !content && running && !thinking ? h("div", { style: smallStyle }, `正在咨询 ${data.chain?.[data.currentAttempt]?.label ?? ""} …`) : null,
        data.attempts.length > 0 ? h("div", { style: { marginTop: 8, ...smallStyle } },
          "尝试记录：",
          data.attempts.map((attempt, i) => h("span", { key: i },
            i > 0 ? " → " : "",
            attempt.ok ? "✓" : "✗",
            attempt.label,
            attempt.ok || !attempt.error ? "" : `（${attempt.error}）`))) : null,
      );
    }

    // ---------- settings tab ----------
    interface DraftChainEntry {
      label?: string;
      provider: string;
      model: string;
      reasoningEffort?: string;
      temperature?: number;
      maxTokens?: number;
      timeoutMs?: number;
    }
    interface DraftConfig {
      enabled: boolean;
      mode: "auto" | "manual";
      advisorPrompt: string;
      chain: DraftChainEntry[];
      trigger: { repeatThreshold: number };
      limits: { defaultTimeoutMs: number; transcriptMaxChars: number; perEntryMaxChars: number };
    }
    interface NamespaceView {
      ns: string;
      value: DraftConfig;
      revision: number;
    }
    interface NamespaceDescribe {
      writable: boolean;
      namespaces: Array<{ ns: string; value: unknown; revision: number }>;
    }
    interface RemoteLike {
      settings: {
        describe: () => Promise<RemoteEnvelope<NamespaceDescribe>>;
        update: (ns: string, patch: unknown, expectedRevision?: number) => Promise<RemoteEnvelope<NamespaceView>>;
      };
      llm: {
        listProviders: () => Promise<RemoteEnvelope<Array<{ id: string; name: string }>>>;
        listConfigurableProviders: () => Promise<RemoteEnvelope<Array<{ provider: string; settingsNs: string }>>>;
        discoverModels: (settingsNs: string, request: { provider?: string }) => Promise<RemoteEnvelope<Array<{ id: string; name?: string }>>>;
      };
    }
    /** Every ctx.remote call resolves to one wire envelope: { ok, value } or
     *  { ok: false, error } — same shape the official ui-settings mirror
     *  consumes (settings-mirror.ts `response.ok ? response.value : ...`). */
    interface RemoteEnvelope<T> {
      ok: boolean;
      value?: T;
      error?: { message?: string };
    }
    function unwrap<T>(response: RemoteEnvelope<T> | undefined, what: string): T {
      if (response && response.ok && response.value !== undefined) return response.value;
      throw new Error(`${what}失败：${response?.error?.message ?? "远程调用返回异常"}`);
    }

    function getRemote(ctx: unknown): RemoteLike | undefined {
      const candidate = ctx as { remote?: RemoteLike; get?: (key: string) => unknown };
      return candidate.remote ?? (typeof candidate.get === "function" ? (candidate.get("remote") as RemoteLike) : undefined);
    }

    const NS = "dsh-advisor-plugin";
    const EFFORTS: Array<{ value: string; label: string }> = [
      { value: "", label: "默认（不指定）" },
      { value: "off", label: "off（关闭思考）" },
      { value: "low", label: "low" },
      { value: "high", label: "high" },
      { value: "max", label: "max" },
    ];

    function AdvisorSettingsTab() {
      const [draft, setDraft] = useState<DraftConfig | null>(null);
      const [revision, setRevision] = useState(0);
      const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
      const [nsByProvider, setNsByProvider] = useState<Record<string, string>>({});
      const [modelOptions, setModelOptions] = useState<Record<string, string[]>>({});
      const [fetchingProvider, setFetchingProvider] = useState<string | null>(null);
      const [saving, setSaving] = useState(false);
      const [msg, setMsg] = useState("");
      const [error, setError] = useState("");

      const reload = async () => {
        setMsg("");
        setError("");
        try {
          const remote = getRemote(currentCtx);
          if (!remote) {
            setError("当前环境没有 remote 服务，无法读写配置。");
            return;
          }
          const desc = unwrap(await remote.settings.describe(), "读取设置");
          const namespaces = Array.isArray(desc?.namespaces) ? desc.namespaces : [];
          const ns = namespaces.find((n) => n.ns === NS);
          if (!ns) {
            setError("未找到本插件的配置命名空间（插件可能未启用或未安装完成）。");
            return;
          }
          setDraft(ns.value as DraftConfig);
          setRevision(ns.revision);
          const [provs, confs] = await Promise.all([
            remote.llm.listProviders().catch(() => undefined),
            remote.llm.listConfigurableProviders().catch(() => undefined),
          ]);
          setProviders(provs && provs.ok && Array.isArray(provs.value) ? provs.value : []);
          setNsByProvider(
            confs && confs.ok && Array.isArray(confs.value)
              ? Object.fromEntries(confs.value.map((c) => [c.provider, c.settingsNs]))
              : {},
          );
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      };

      useEffect(() => { reload(); }, []);

      const patch = (part: Partial<DraftConfig>) => setDraft((d) => (d ? { ...d, ...part } : d));
      const patchEntry = (index: number, part: Partial<DraftChainEntry>) =>
        setDraft((d) => (d ? { ...d, chain: d.chain.map((e, i) => (i === index ? { ...e, ...part } : e)) } : d));
      const removeEntry = (index: number) => setDraft((d) => (d ? { ...d, chain: d.chain.filter((_, i) => i !== index) } : d));
      const moveEntry = (index: number, delta: number) =>
        setDraft((d) => {
          if (!d) return d;
          const target = index + delta;
          if (target < 0 || target >= d.chain.length) return d;
          const chain = [...d.chain];
          const [item] = chain.splice(index, 1);
          chain.splice(target, 0, item);
          return { ...d, chain };
        });
      const addEntry = () =>
        setDraft((d) => (d ? {
          ...d,
          chain: [...d.chain, { label: "", provider: providers[0]?.id ?? "", model: "" }],
        } : d));

      const fetchModels = async (provider: string) => {
        if (!provider) return;
        setFetchingProvider(provider);
        setMsg("");
        setError("");
        try {
          const remote = getRemote(currentCtx)!;
          const settingsNs = nsByProvider[provider];
          if (!settingsNs) {
            setError(`provider「${provider}」没有已注册的模型发现通道，请直接手动填写模型 id。`);
            return;
          }
          const models = unwrap(await remote.llm.discoverModels(settingsNs, { provider }), "获取模型列表");
          setModelOptions((prev) => ({ ...prev, [provider]: models.map((m) => m.id) }));
          setMsg(`已获取 ${models.length} 个模型，下拉中可选。`);
        } catch (e) {
          setError(`获取模型列表失败：${e instanceof Error ? e.message : String(e)}`);
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
          const remote = getRemote(currentCtx)!;
          const view = unwrap(await remote.settings.update(NS, draft, revision), "保存设置");
          setRevision(view.revision);
          setDraft(view.value);
          setMsg("已保存并即时生效。");
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (/conflict|stale/i.test(message)) {
            setError("配置已被其他页面修改，正在重新加载…");
            await reload();
          } else {
            setError(`保存失败：${message}`);
          }
        } finally {
          setSaving(false);
        }
      };

      if (!draft) {
        return h("li", { className: "dsh-advisor-plugin-settings", style: cardStyle },
          error || "加载配置中…");
      }

      return h("li", { className: "dsh-advisor-plugin-settings", style: cardStyle },
        h("div", { style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
          h("span", { style: labelStyle, fontSize: 14 }, "Advisor 顾问"),
          h("button", {
            role: "switch",
            "aria-checked": draft.enabled,
            style: { ...buttonStyle, color: draft.enabled ? "#16a34a" : "inherit" },
            type: "button",
            onClick: () => patch({ enabled: !draft.enabled }),
          }, draft.enabled ? "已启用" : "已停用"),
          h("label", { style: smallStyle }, "触发模式：",
            h("select", {
              style: { ...inputStyle, width: "auto" },
              value: draft.mode,
              onChange: (e: React.ChangeEvent<HTMLSelectElement>) => patch({ mode: e.target.value as DraftConfig["mode"] }),
            },
              h("option", { value: "auto" }, "auto（主模型自主判断）"),
              h("option", { value: "manual" }, "manual（仅用户要求时）"))),
          h("span", { style: { flex: 1 } }),
          h("button", { style: buttonStyle, type: "button", disabled: saving, onClick: save }, saving ? "保存中…" : "保存")),
        msg ? h("div", { style: { ...smallStyle, color: "#16a34a", marginTop: 6 } }, msg) : null,
        error ? h("div", { style: { ...smallStyle, color: "#dc2626", marginTop: 6 } }, error) : null,
        h("div", { style: { marginTop: 10 } },
          h("div", { style: labelStyle }, "顾问模型链（按顺序尝试，失败自动顺延）"),
          draft.chain.map((entry, index) =>
            h("div", { key: index, style: { border: "1px dashed var(--dsw-alias-color-border, rgba(127,127,127,.35))", borderRadius: 8, padding: 8, margin: "6px 0" } },
              h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
                h("span", { style: smallStyle }, `#${index + 1}`),
                h("input", {
                  style: { ...inputStyle, width: 120 },
                  placeholder: "显示名（可选）",
                  value: entry.label ?? "",
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { label: e.target.value }),
                }),
                h("select", {
                  style: { ...inputStyle, width: "auto" },
                  value: entry.provider,
                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => patchEntry(index, { provider: e.target.value }),
                }, providers.length > 0
                  ? providers.map((p) => h("option", { key: p.id, value: p.id }, p.name || p.id))
                  : h("option", { value: entry.provider }, entry.provider)),
                h("input", {
                  style: { ...inputStyle, width: 200 },
                  list: `dsh-advisor-models-${entry.provider || index}`,
                  placeholder: "模型 id",
                  value: entry.model,
                  onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { model: e.target.value }),
                }),
                (modelOptions[entry.provider] ?? []).length > 0
                  ? h("datalist", { id: `dsh-advisor-models-${entry.provider || index}` },
                      modelOptions[entry.provider].map((id) => h("option", { key: id, value: id })))
                  : null,
                h("button", {
                  style: buttonStyle, type: "button",
                  disabled: fetchingProvider === entry.provider || !entry.provider,
                  onClick: () => fetchModels(entry.provider),
                }, fetchingProvider === entry.provider ? "获取中…" : "获取模型列表"),
                h("span", { style: { flex: 1 } }),
                h("button", { style: buttonStyle, type: "button", onClick: () => moveEntry(index, -1), disabled: index === 0 }, "↑"),
                h("button", { style: buttonStyle, type: "button", onClick: () => moveEntry(index, 1), disabled: index === draft.chain.length - 1 }, "↓"),
                h("button", { style: buttonStyle, type: "button", onClick: () => removeEntry(index) }, "删除")),
              h("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 } },
                h("label", { style: smallStyle }, "推理档位：",
                  h("select", {
                    style: { ...inputStyle, width: "auto" },
                    value: entry.reasoningEffort ?? "",
                    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => patchEntry(index, { reasoningEffort: e.target.value || undefined }),
                  }, EFFORTS.map((effort) => h("option", { key: effort.value, value: effort.value }, effort.label)))),
                h("label", { style: smallStyle }, "温度：",
                  h("input", {
                    style: { ...inputStyle, width: 70 }, type: "number", min: 0, max: 2, step: 0.1,
                    value: entry.temperature ?? "",
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { temperature: e.target.value === "" ? undefined : Number(e.target.value) }),
                  })),
                h("label", { style: smallStyle }, "maxTokens：",
                  h("input", {
                    style: { ...inputStyle, width: 90 }, type: "number", min: 1,
                    value: entry.maxTokens ?? "",
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { maxTokens: e.target.value === "" ? undefined : Number(e.target.value) }),
                  })),
                h("label", { style: smallStyle }, "超时ms：",
                  h("input", {
                    style: { ...inputStyle, width: 90 }, type: "number", min: 1000, max: 600000, step: 500,
                    value: entry.timeoutMs ?? "",
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { timeoutMs: e.target.value === "" ? undefined : Number(e.target.value) }),
                  }))))),
          h("button", { style: buttonStyle, type: "button", onClick: addEntry }, "＋ 添加顾问模型")),
        h("div", { style: { marginTop: 10 } },
          h("div", { style: labelStyle }, "顾问系统提示词（整条链共用）"),
          h("textarea", {
            style: { ...inputStyle, minHeight: 110, fontFamily: "inherit" },
            value: draft.advisorPrompt,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => patch({ advisorPrompt: e.target.value }),
          })),
        h("div", { style: { display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, ...smallStyle } },
          h("label", null, "重复提问强制咨询阈值：",
            h("input", {
              style: { ...inputStyle, width: 60 }, type: "number", min: 2, max: 10,
              value: draft.trigger?.repeatThreshold ?? 3,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patch({ trigger: { repeatThreshold: Number(e.target.value) || 3 } }),
            }), " 次"),
          h("label", null, "抄本字符预算：",
            h("input", {
              style: { ...inputStyle, width: 80 }, type: "number", min: 2000, max: 400000, step: 1000,
              value: draft.limits?.transcriptMaxChars ?? 60000,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patch({ limits: { ...draft.limits, transcriptMaxChars: Number(e.target.value) || 60000 } }),
            })),
          h("label", null, "单条消息上限：",
            h("input", {
              style: { ...inputStyle, width: 80 }, type: "number", min: 200, max: 20000, step: 100,
              value: draft.limits?.perEntryMaxChars ?? 2000,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patch({ limits: { ...draft.limits, perEntryMaxChars: Number(e.target.value) || 2000 } }),
            })),
          h("label", null, "默认超时ms：",
            h("input", {
              style: { ...inputStyle, width: 90 }, type: "number", min: 1000, max: 600000, step: 500,
              value: draft.limits?.defaultTimeoutMs ?? 120000,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patch({ limits: { ...draft.limits, defaultTimeoutMs: Number(e.target.value) || 120000 } }),
            }))));
    }

    // ---------- module ----------
    const name = "dsh-advisor-plugin";
    // Cordis requires every accessed service AND each remote.<namespace>
    // child service declared in inject (same pattern as the official
    // ui-settings client: ['remote', 'remote.settings']). We use the
    // settings namespace for config read/write and the llm namespace for
    // provider/model listing in the settings tab.
    const inject = ["uiConversation", "slots", "remote", "remote.settings", "remote.llm"];
    let currentCtx: unknown = null;

    function apply(ctx: {
      uiConversation?: { events?: { register: (definition: unknown) => unknown } };
      slots: {
        inject: (ownerKey: string, factory: () => unknown) => unknown;
        register: (options: Record<string, unknown>, component: (props: unknown) => React.ReactElement) => unknown;
      };
    }) {
      currentCtx = ctx;
      if (ctx.uiConversation?.events?.register) ctx.uiConversation.events.register(advisorCardDefinition);
      ctx.slots.inject("conversation.chat.node", () =>
        ctx.slots.register({ name: "conversation.chat.node", key: "dsh-advisor-plugin", locale: "chat" }, AdvisorCardView as (props: unknown) => React.ReactElement));
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register({ name: "settings.section", id: "dsh-advisor-plugin", order: 0, label: "Advisor 顾问" }, AdvisorSettingsTab as unknown as (props: unknown) => React.ReactElement));
    }

    return { name, inject, apply };
  },
});
