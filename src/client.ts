// Client half of dsh-second-opinion: chat card + settings tab.
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
  id: "dsh-second-opinion",
  factory(require) {
    const React = require("react") as typeof import("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    // ---------- shared styles (theme tokens with literal fallbacks) ----------
    const cardStyle: React.CSSProperties = {
      border: "1px solid var(--dsw-alias-border-l1)",
      borderRadius: 10,
      background: "var(--dsw-alias-bg-layer-1)",
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
      color: "var(--dsw-alias-bg-base)",
      background: color,
      marginLeft: 6,
    });
    const smallStyle: React.CSSProperties = { fontSize: 12, opacity: 0.75 };
    const labelStyle: React.CSSProperties = { fontWeight: 600, marginRight: 6 };
    const toggleStyle: React.CSSProperties = {
      background: "transparent",
      border: "none",
      color: "var(--dsw-alias-brand-primary)",
      cursor: "pointer",
      padding: 0,
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
      kind: "dsh-second-opinion",
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
          kind: "dsh-second-opinion",
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
      const statusBadge = failed ? badgeStyle("var(--dsw-alias-state-error-primary)") : running ? badgeStyle("var(--dsw-alias-state-warn-primary)") : badgeStyle("var(--dsw-alias-state-success-primary)");
      const statusText = failed ? "失败" : running ? "咨询中…" : "完成";
      return h("div", { style: cardStyle },
        h("div", null,
          h("span", { style: labelStyle }, "Second Opinion 咨询"),
          h("span", { style: statusBadge }, statusText),
          message ? h("span", { style: badgeStyle("var(--dsw-alias-brand-primary)") }, message.model) : null,
          data.truncated ? h("span", { style: badgeStyle("var(--dsw-alias-state-warn-primary)") }, "已截断") : null),
        h("div", { style: { fontWeight: 600, margin: "6px 0 2px" } }, data.question),
        data.context ? h("div", null,
          h("button", { style: toggleStyle, type: "button", onClick: () => setContextOpen(!contextOpen) }, `${contextOpen ? "▾" : "▸"} 补充背景`),
          contextOpen ? h("div", { style: { whiteSpace: "pre-wrap", ...smallStyle, marginTop: 4 } }, data.context) : null) : null,
        thinking && thinking.trim() ? h(Fold, { title: "顾问思考过程" }, thinking) : null,
        content ? h("div", { style: { whiteSpace: "pre-wrap", marginTop: 6 } }, content, running ? "▍" : null) : null,
        !content && running && !thinking ? h("div", { style: smallStyle }, `正在咨询 ${data.chain?.[data.currentAttempt]?.label ?? ""} …`) : null,
        data.attempts?.length ? h("div", { style: { marginTop: 8, ...smallStyle } },
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

    const NS = "dsh-second-opinion";
    const EFFORTS: Array<{ value: string; label: string }> = [
      { value: "", label: "默认（不指定）" },
      { value: "off", label: "off（关闭思考）" },
      { value: "low", label: "low" },
      { value: "high", label: "high" },
      { value: "max", label: "max" },
    ];

    // ---------- settings styles ----------
    // Native settings row pattern copied from the shipped 通用设置 page
    // (ui-settings-general DeveloperToolsRow): flat rows, title 14px left,
    // description 12px secondary below it, control right, 16px padding,
    // 0.5px token separators. Theme tokens only — no literal colors.
    const SET = {
      root: {
        width: "100%",
        color: "var(--dsw-alias-label-primary)",
        // The host defines --dsw-font-family in its own CSS (Inter + CJK
        // stack); without it Chinese glyphs fall back to a serif default.
        // Not in the Theme-inspected alias list, but it is the host's own
        // public font variable — no font files are bundled (MIT repo).
        fontFamily: "var(--dsw-font-family, inherit)",
      } as React.CSSProperties,
      row: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "16px 0",
        borderBottom: "0.5px solid var(--dsw-alias-border-l2)",
      } as React.CSSProperties,
      title: { fontSize: 14, lineHeight: "20px" } as React.CSSProperties,
      desc: {
        marginTop: 4,
        color: "var(--dsw-alias-label-secondary)",
        fontSize: 12,
        lineHeight: "18px",
      } as React.CSSProperties,
      groupHead: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "16px 0 8px",
      } as React.CSSProperties,
      control: {
        height: 32,
        borderRadius: 8,
        border: "1px solid var(--dsw-alias-border-l2)",
        background: "var(--dsw-alias-bg-base)",
        color: "var(--dsw-alias-label-primary)",
        fontSize: 13,
        padding: "0 10px",
      } as React.CSSProperties,
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
        fontFamily: "inherit",
      } as React.CSSProperties,
      entry: {
        border: "1px solid var(--dsw-alias-border-l1)",
        borderRadius: 10,
        padding: 12,
        marginBottom: 12,
      } as React.CSSProperties,
      btn: {
        height: 28,
        padding: "0 12px",
        borderRadius: 8,
        border: "1px solid var(--dsw-alias-border-l2)",
        background: "transparent",
        color: "var(--dsw-alias-label-primary)",
        fontSize: 12.5,
        cursor: "pointer",
      } as React.CSSProperties,
      btnPrimary: {
        height: 32,
        padding: "0 18px",
        borderRadius: 8,
        border: "1px solid transparent",
        // label-primary on bg-base is an inverted fill that keeps AA contrast
        // in both themes (brand-primary text pairing was contrast-risky).
        background: "var(--dsw-alias-label-primary)",
        color: "var(--dsw-alias-bg-base)",
        fontSize: 13,
        cursor: "pointer",
      } as React.CSSProperties,
      msgOk: { fontSize: 12, color: "var(--dsw-alias-state-success-primary)" } as React.CSSProperties,
      msgErr: { fontSize: 12, color: "var(--dsw-alias-state-error-primary)" } as React.CSSProperties,
      fieldLabel: {
        display: "block",
        marginBottom: 4,
        color: "var(--dsw-alias-label-secondary)",
        fontSize: 12,
        lineHeight: "18px",
      } as React.CSSProperties,
    };

    /** Native-style pill switch (role="switch" + aria-checked kept; the
     *  visual mirrors the shipped settings toggle with token colors).
     *  The focus ring is emulated through state because inline styles
     *  cannot express :focus-visible; disabled dims via opacity. */
    function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
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
          opacity: disabled ? 0.4 : 1,
          background: checked ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-bg-layer-2)",
          outline: focused ? "2px solid var(--dsw-alias-brand-primary)" : "none",
          outlineOffset: 1,
          transition: "background 160ms ease",
        },
      }, h("span", {
        style: {
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "var(--dsw-alias-bg-base)",
          transition: "left 160ms ease",
        },
      }));
    }

    /** One native-style settings row: title + description left, control right. */
    function SRow({ title, desc, last, children }: { title: string; desc?: string; last?: boolean; children?: React.ReactNode }) {
      return h("div", { style: { ...SET.row, ...(last ? { borderBottom: "none" } : null) } },
        h("div", { style: { minWidth: 0 } },
          h("div", { style: SET.title }, title),
          desc ? h("div", { style: SET.desc }, desc) : null),
        children ?? null);
    }

    /** Labeled field: the label wraps its control (implicit association), so
     *  clicking the label focuses the control and screen readers announce it. */
    function Field({ label, children }: { label: string; children?: React.ReactNode }) {
      return h("label", { style: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } },
        h("span", { style: SET.fieldLabel }, label),
        children);
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
    function Dropdown({ value, onChange, width, ariaLabel, options }: {
      value: string;
      onChange: (e: { target: { value: string } }) => void;
      width: number | string;
      ariaLabel?: string;
      options: Array<{ value: string; label: string }>;
    }) {
      const [open, setOpen] = useState(false);
      const [highlight, setHighlight] = useState(0);
      const wrapRef = (React as { useRef?: (v: unknown) => { current: unknown } }).useRef?.(null) ?? { current: null };

      useEffect(() => {
        if (!open) return;
        const close = (ev: Event) => {
          const wrap = wrapRef.current as { contains?: (n: Node) => boolean } | null;
          const target = (ev as MouseEvent).target as Node | null;
          if (wrap?.contains?.(target as Node)) return;
          setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
      }, [open]);

      const select = (v: string) => {
        onChange({ target: { value: v } });
        setOpen(false);
      };
      const openAt = (index: number) => {
        setHighlight(index);
        setOpen(true);
      };
      const key = (ev: React.KeyboardEvent) => {
        const selected = options.findIndex((o) => o.value === value);
        if (!open && (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === " ")) {
          ev.preventDefault();
          openAt(selected >= 0 ? selected : 0);
        } else if (open && ev.key === "Escape") {
          setOpen(false);
        } else if (open && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
          ev.preventDefault();
          setHighlight((h) => Math.min(options.length - 1, Math.max(0, h + (ev.key === "ArrowDown" ? 1 : -1))));
        } else if (open && (ev.key === "Enter" || ev.key === " ")) {
          ev.preventDefault();
          if (options[highlight]) select(options[highlight].value);
        }
      };
      const current = options.find((o) => o.value === value);
      return h("div", {
        ref: (wrapRef as { current: unknown }).current === undefined ? undefined : (node: unknown) => { (wrapRef as { current: unknown }).current = node; },
        style: { position: "relative", display: "inline-flex", width },
      },
        h("button", {
          type: "button",
          "aria-haspopup": "listbox",
          "aria-expanded": open,
          "aria-label": ariaLabel,
          onClick: () => (open ? setOpen(false) : openAt(Math.max(0, options.findIndex((o) => o.value === value)))),
          onKeyDown: key,
          style: {
            ...SET.control,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            textAlign: "left",
            cursor: "pointer",
          },
        },
          h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, current?.label ?? ""),
          h("span", { "aria-hidden": true, style: { fontSize: 10, color: "var(--dsw-alias-label-secondary)", flexShrink: 0 } }, open ? "▴" : "▾")),
        open ? h("div", {
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
            boxShadow: "0 4px 16px rgba(0,0,0,0.14)",
          },
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
            color: "var(--dsw-alias-label-primary)",
          },
        },
          h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, o.label),
          o.value === value ? h("span", { style: { color: "var(--dsw-alias-brand-primary)", flexShrink: 0 } }, "✓") : null))) : null);
    }

    function AdvisorSettingsTab() {
      const [draft, setDraft] = useState<DraftConfig | null>(null);
      const [revision, setRevision] = useState(0);
      const [allNamespaces, setAllNamespaces] = useState<Array<{ ns: string; value: unknown }>>([]);
      const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
      const [nsByProvider, setNsByProvider] = useState<Record<string, string>>({});
      const [modelOptions, setModelOptions] = useState<Record<string, string[]>>({});
      const [fetchingProvider, setFetchingProvider] = useState<string | null>(null);
      const [saving, setSaving] = useState(false);
      const [msg, setMsg] = useState("");
      const [error, setError] = useState("");
      // Draft vs last-saved snapshot: drives the unsaved-changes bar (H1).
      const [savedSnapshot, setSavedSnapshot] = useState("");

      const reload = async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) { setMsg(""); setError(""); }
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
          setDraft(ns.value as DraftConfig);
          setRevision(ns.revision);
          setSavedSnapshot(JSON.stringify(ns.value));
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
          if (provs === undefined || confs === undefined) {
            setError("供应商列表获取失败（设置 → 模型 页可能尚未就绪）；仍可手动输入 provider 和模型 id。");
          }
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
      const storedModelInfo = (namespaces: Array<{ ns: string; value: unknown }>, provider: string, settingsNs?: string): { models: string[]; baseURL?: string } => {
        const section = (namespaces ?? []).find((n) => n.ns === settingsNs);
        const value = section?.value as Record<string, unknown> | undefined;
        const models: string[] = [];
        const push = (m: unknown) => {
          const id = typeof m === "string" ? m : (m as { id?: unknown } | null)?.id;
          if (typeof id === "string" && id && !models.includes(id)) models.push(id);
        };
        if (!value) return { models };
        if (Array.isArray(value.models)) value.models.forEach(push);
        let baseURL: string | undefined;
        if (value.providers && typeof value.providers === "object") {
          const route = (value.providers as Record<string, unknown>)[provider];
          if (route && typeof route === "object") {
            const r = route as Record<string, unknown>;
            if (Array.isArray(r.models)) r.models.forEach(push);
            if (typeof r.baseURL === "string" && r.baseURL) baseURL = r.baseURL;
          }
        }
        return { models, baseURL };
      };

      const fetchModels = async (provider: string) => {
        if (!provider) return;
        setFetchingProvider(provider);
        setMsg("");
        setError("");
        try {
          const settingsNs = nsByProvider[provider];
          const stored = storedModelInfo(allNamespaces, provider, settingsNs);
          const models = [...stored.models];
          let discoveryNote = "";
          if (settingsNs) {
            try {
              const remote = getRemote(currentCtx)!;
              const discovered = unwrap(
                await remote.llm.discoverModels(settingsNs, {
                  provider,
                  ...(stored.baseURL ? { baseURL: stored.baseURL } : {}),
                }),
                "获取模型列表",
              );
              for (const m of discovered) if (!models.includes(m.id)) models.push(m.id);
            } catch (e) {
              discoveryNote = e instanceof Error ? e.message : String(e);
            }
          }
          if (models.length > 0) {
            setError("");
            setModelOptions((prev) => ({ ...prev, [provider]: models }));
            const sources = [
              stored.models.length > 0 ? `DSH 配置 ${stored.models.length} 个` : "",
              discoveryNote === "" && settingsNs ? "端点探测" : "",
            ].filter(Boolean).join(" + ");
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
          const remote = getRemote(currentCtx)!;
          // Sanitize before persisting: drop unfinished entries and clamp
          // numeric ranges (number-input min/max only constrain the spinner).
          const dropped = draft.chain.filter((e) => !e.provider || !e.model).length;
          const clamp = (v: number | undefined, lo: number, hi: number) =>
            v === undefined ? undefined : Math.min(hi, Math.max(lo, Math.round(v)));
          const sanitized: DraftConfig = {
            ...draft,
            chain: draft.chain
              .filter((e) => e.provider && e.model)
              .map((e) => ({
                ...e,
                temperature: clamp(e.temperature, 0, 2),
                maxTokens: clamp(e.maxTokens, 1, 1000000),
                timeoutMs: clamp(e.timeoutMs, 1000, 600000),
              })),
          };
          const view = unwrap(await remote.settings.update(NS, sanitized, revision), "保存设置");
          setRevision(view.revision);
          setDraft(view.value);
          setSavedSnapshot(JSON.stringify(view.value));
          setMsg(`已保存并即时生效。${dropped > 0 ? ` 已忽略 ${dropped} 个未填 provider/模型 的未完成条目。` : ""}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (/conflict|stale/i.test(message)) {
            // Reload the freshest config without clearing messages first, then
            // SAY that the draft was replaced — never drop changes silently.
            await reload({ silent: true });
            setMsg("检测到配置已被外部修改：已重新加载最新配置，未保存的修改已被替换，请重新调整后再保存。");
          } else {
            setError(`保存失败：${message}`);
          }
        } finally {
          setSaving(false);
        }
      };

      if (!draft) {
        return h("li", { className: "dsh-second-opinion-settings", style: { ...SET.root, listStyle: "none", padding: 0, margin: 0 } },
          h("div", { style: SET.row },
            h("div", { style: error ? SET.msgErr : SET.desc }, error || "加载配置中…"),
            error ? h("button", { style: SET.btn, type: "button", onClick: () => reload() }, "重试") : null));
      }

      const dirty = savedSnapshot !== "" && JSON.stringify(draft) !== savedSnapshot;

      const numRow = (title: string, desc: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, last = false) =>
        h("div", { style: { ...SET.row, ...(last ? { borderBottom: "none" } : null) } },
          h("div", { style: { minWidth: 0 } }, h("div", { style: SET.title }, title), h("div", { style: SET.desc }, desc)),
          h("input", {
            style: { ...SET.control, width: 110 }, type: "number", min, max, step, value,
            "aria-label": title, disabled: saving,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value)),
          }));

      const entryNode = (index: number, entry: DraftChainEntry) =>
        h("div", { key: index, style: SET.entry },
          h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 } },
            h("span", { style: { ...SET.desc, marginTop: 0, width: 22 } }, `#${index + 1}`),
            h("span", { style: { flex: 1 } }),
            h("button", {
              style: { ...SET.btn, opacity: fetchingProvider === entry.provider || !entry.provider ? 0.5 : 1 },
              type: "button",
              title: !entry.provider ? "先选择 provider 后再获取模型列表" : undefined,
              disabled: fetchingProvider === entry.provider || !entry.provider,
              onClick: () => fetchModels(entry.provider),
            }, fetchingProvider === entry.provider ? "获取中…" : "获取模型列表"),
            h("button", { style: SET.btn, type: "button", "aria-label": "上移", title: "上移", onClick: () => moveEntry(index, -1), disabled: index === 0 }, "↑"),
            h("button", { style: SET.btn, type: "button", "aria-label": "下移", title: "下移", onClick: () => moveEntry(index, 1), disabled: index === draft.chain.length - 1 }, "↓"),
            h("button", { style: SET.btn, type: "button", onClick: () => removeEntry(index) }, "删除")),
          h("div", { style: { display: "flex", gap: 12, flexWrap: "wrap" } },
            h(Field, { label: "显示名（可选）" }, h("input", {
              style: { ...SET.control, width: 150 },
              placeholder: "如：架构顾问",
              value: entry.label ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { label: e.target.value }),
            })),
            h(Field, { label: "Provider" }, h(Dropdown, {
              width: "100%",
              ariaLabel: "Provider",
              value: entry.provider,
              options: providers.length > 0
                ? providers.map((p) => ({ value: p.id, label: p.name || p.id }))
                : [{ value: entry.provider, label: entry.provider || "（未获取到供应商）" }],
              onChange: (e: { target: { value: string } }) => patchEntry(index, { provider: e.target.value }),
            })),
            h(Field, { label: "模型 id" }, h("input", {
              style: { ...SET.control, width: "100%", boxSizing: "border-box" },
              list: `dsh-advisor-models-${index}`,
              placeholder: "模型 id",
              value: entry.model,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { model: e.target.value }),
            })),
            (modelOptions[entry.provider] ?? []).length > 0
              ? h("datalist", { id: `dsh-advisor-models-${index}` },
                  modelOptions[entry.provider].map((id) => h("option", { key: id, value: id })))
              : null),
          h("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 } },
            h(Field, { label: "推理档位" }, h(Dropdown, {
              width: 170,
              ariaLabel: "推理档位",
              value: entry.reasoningEffort ?? "",
              options: EFFORTS.map((effort) => ({ value: effort.value, label: effort.label })),
              onChange: (e: { target: { value: string } }) => patchEntry(index, { reasoningEffort: e.target.value || undefined }),
            })),
            h(Field, { label: "温度（0–2）" }, h("input", {
              style: { ...SET.control, width: 110 }, type: "number", min: 0, max: 2, step: 0.1,
              value: entry.temperature ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { temperature: e.target.value === "" ? undefined : Number(e.target.value) }),
            })),
            h(Field, { label: "maxTokens" }, h("input", {
              style: { ...SET.control, width: 120 }, type: "number", min: 1,
              value: entry.maxTokens ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { maxTokens: e.target.value === "" ? undefined : Number(e.target.value) }),
            })),
            h(Field, { label: "超时（毫秒）" }, h("input", {
              style: { ...SET.control, width: 130 }, type: "number", min: 1000, max: 600000, step: 500,
              value: entry.timeoutMs ?? "",
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { timeoutMs: e.target.value === "" ? undefined : Number(e.target.value) }),
            }))));

      return h("li", { className: "dsh-second-opinion-settings", style: { ...SET.root, listStyle: "none", padding: 0, margin: 0 } },
        // Saving locks every control below (M3): responses never race edits.
        h("div", { style: { pointerEvents: saving ? "none" : "auto", opacity: saving ? 0.6 : 1 } },
          h(SRow, { title: "启用 Second Opinion", desc: "停用后 second_opinion 不可用，也不再注入使用边界提示。" },
            h(Toggle, { checked: draft.enabled, label: "启用 Second Opinion", onChange: (next: boolean) => patch({ enabled: next }) })),
          h(SRow, { title: "触发模式", desc: "auto：主模型按调用判据自主咨询；manual：仅用户明确要求时咨询。" },
            h(Dropdown, {
              value: draft.mode,
              width: 240,
              ariaLabel: "触发模式",
              options: [
                { value: "auto", label: "auto（主模型自主判断）" },
                { value: "manual", label: "manual（仅用户要求时）" },
              ],
              onChange: (e: { target: { value: string } }) => patch({ mode: e.target.value as DraftConfig["mode"] }),
            })),
          h("div", { style: SET.groupHead },
            h("div", null,
              h("div", { style: SET.title }, "顾问模型链"),
              h("div", { style: SET.desc }, "按顺序尝试；某项失败（出错或超时无产出）自动顺延下一个。")),
            h("button", { style: SET.btn, type: "button", onClick: addEntry }, "＋ 添加顾问模型")),
          ...draft.chain.map((entry, index) => entryNode(index, entry)),
          draft.chain.length === 0 ? h("div", { style: { ...SET.desc, padding: "0 0 12px" } }, "尚未配置顾问模型——配置后 second_opinion 才可用。") : null,
          h("div", { style: { padding: "16px 0", borderBottom: "0.5px solid var(--dsw-alias-border-l2)" } },
            h("div", { style: SET.title }, "顾问系统提示词"),
            h("div", { style: SET.desc }, "整条链共用；清空并保存可回落到插件默认。"),
            h("textarea", {
              style: SET.textarea,
              value: draft.advisorPrompt,
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => patch({ advisorPrompt: e.target.value }),
            })),
          numRow("重复提问强制咨询阈值", "同一用户问题重复达到该次数时，提示升级为强制咨询（单位：次）。", draft.trigger?.repeatThreshold ?? 3, 2, 10, 1, (v) => patch({ trigger: { repeatThreshold: Math.min(10, Math.max(2, v || 3)) } })),
          numRow("抄本字符预算", "发送给顾问的对话抄本总字符上限；超出时保留最新部分并标注省略。", draft.limits?.transcriptMaxChars ?? 60000, 2000, 400000, 1000, (v) => patch({ limits: { ...draft.limits, transcriptMaxChars: v || 60000 } })),
          numRow("单条消息上限", "抄本中单条消息（含工具结果）的最大字符数。", draft.limits?.perEntryMaxChars ?? 2000, 200, 20000, 100, (v) => patch({ limits: { ...draft.limits, perEntryMaxChars: v || 2000 } })),
          numRow("默认超时（毫秒）", "链上条目未单独配置超时时的单次调用上限。", draft.limits?.defaultTimeoutMs ?? 120000, 1000, 600000, 500, (v) => patch({ limits: { ...draft.limits, defaultTimeoutMs: v || 120000 } }), true)),
        // Sticky save bar: status announcements live here (aria-live), and the
        // unsaved-changes chip keeps the draft model from silently eating edits.
        // Same background as the page so the bar blends in instead of reading
        // as a gray band; only the hairline separates it from scrolled content.
        h("div", {
          style: {
            position: "sticky",
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 12,
            padding: "10px 2px",
            background: "var(--dsw-alias-bg-base)",
            borderBottom: "none",
            borderTop: "0.5px solid var(--dsw-alias-border-l1)",
          },
        },
          h("div", { role: "status", "aria-live": "polite", style: { flex: 1, minWidth: 0 } },
            error ? h("span", { style: SET.msgErr }, error) : msg ? h("span", { style: SET.msgOk }, msg) : null),
          dirty ? h("span", { style: SET.msgErr }, "有未保存更改") : null,
          dirty ? h("button", { style: SET.btn, type: "button", onClick: () => reload({ silent: true }) }, "放弃修改") : null,
          h("button", { style: SET.btnPrimary, type: "button", disabled: saving, onClick: save }, saving ? "保存中…" : "保存")));
    }

    // ---------- module ----------
    const name = "dsh-second-opinion";
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
        ctx.slots.register({ name: "conversation.chat.node", key: "dsh-second-opinion", locale: "chat" }, AdvisorCardView as (props: unknown) => React.ReactElement));
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register({ name: "settings.section", id: "dsh-second-opinion", order: 0, label: "Second Opinion" }, AdvisorSettingsTab as unknown as (props: unknown) => React.ReactElement));
    }

    return { name, inject, apply };
  },
});
