// Client half of dsh-advisor-chain: toolview card + settings tab + legacy card replay.
//
// The web ModuleLoader evaluates this bundle and passes a `require` shim that
// resolves shared client modules (react) from the browser module table, so
// react is taken from the factory argument instead of a bundled import.
//
// All user-facing copy goes through `t()` (see ./client/i18n.ts): the
// dictionaries are registered with the host's locale service, which resolves
// the active language and re-renders the outlets registered with `locale: NS`.

import { CLIENT_DICTIONARIES, CLIENT_NS, fallbackTranslate, type Translate } from "./client/i18n";

interface ModuleLoaderGlobal {
  __ModuleLoader__?: {
    load(mod: { id: string; factory: (require: (id: string) => unknown) => unknown }): unknown;
  };
}
const moduleLoaderWindow = window as unknown as ModuleLoaderGlobal;

moduleLoaderWindow.__ModuleLoader__!.load({
  id: "dsh-advisor-chain",
  factory(require) {
    const React = require("react") as typeof import("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useRef = React.useRef;
    /** Translator; replaced by the host-bound one once the locale service registers our namespace. */
    let t: Translate = fallbackTranslate;

    // ---------- shared styles (theme tokens with literal fallbacks) ----------
    // Radii follow the DSH radius scale: controls R12 (--dsw-radius-md),
    // compact buttons R8 (--dsw-radius-sm), nested groups R16, cards R20.
    const R = {
      sm: "var(--dsw-radius-sm, 8px)",
      md: "var(--dsw-radius-md, 12px)",
      lg: "var(--dsw-radius-lg, 16px)",
      xl: "var(--dsw-radius-xl, 20px)",
    };
    const cardStyle: React.CSSProperties = {
      border: "1px solid var(--dsw-alias-border-l1)",
      borderRadius: R.xl,
      background: "var(--dsw-alias-bg-layer-1)",
      padding: "12px 14px",
      margin: "6px 0",
      fontSize: 13,
      lineHeight: 1.6,
    };
    const badgeStyle = (color: string): React.CSSProperties => ({
      display: "inline-block",
      padding: "0 8px",
      borderRadius: R.sm,
      fontSize: 11,
      lineHeight: "20px",
      color: "var(--dsw-alias-bg-base)",
      background: color,
      marginLeft: 6,
    });
    /** Neutral outline badge: readable in both themes, unlike a layer fill
     *  paired with the base text color (dark-on-dark in the dark theme). */
    const subtleBadgeStyle: React.CSSProperties = {
      display: "inline-block",
      padding: "0 8px",
      borderRadius: R.sm,
      fontSize: 11,
      lineHeight: "18px",
      border: "1px solid var(--dsw-alias-border-l2)",
      color: "var(--dsw-alias-label-secondary)",
      background: "transparent",
      marginLeft: 6,
    };
    const smallStyle: React.CSSProperties = { fontSize: 12, opacity: 0.75 };
    const warnStyle: React.CSSProperties = { fontSize: 12, color: "var(--dsw-alias-state-warn-primary)" };
    const errorStyle: React.CSSProperties = { fontSize: 12, color: "var(--dsw-alias-state-error-primary)" };
    const okStyle: React.CSSProperties = { fontSize: 12, color: "var(--dsw-alias-state-success-primary)" };
    const labelStyle: React.CSSProperties = { fontWeight: 600, marginRight: 6 };
    const toggleStyle: React.CSSProperties = {
      background: "transparent",
      border: "none",
      color: "var(--dsw-alias-brand-primary)",
      cursor: "pointer",
      padding: 0,
      fontSize: 12,
    };
    // Right-aligned link in the card header ("查看过程").
    const linkButtonStyle: React.CSSProperties = { ...toggleStyle, marginLeft: "auto", whiteSpace: "nowrap" };

    // ---------- legacy chat card (read-only replay of advisor/* events) ----------
    // Versions <= 0.3.9 wrote `advisor/*` events for the chat card. 0.3.10
    // never writes them; this definition only replays what old sessions hold.
    interface LegacyCardState {
      consultId: string;
      question: string;
      context?: string;
      chain: Array<{ label?: string }>;
      status: "running" | "done" | "failed";
      currentAttempt: number;
      liveContent: string;
      liveThinking: string;
      messages: Array<{ attemptIndex: number; label: string; model: string; content: string; thinking?: string; truncated?: boolean }>;
      followUps: Array<{ text: string; answer?: string; truncated?: boolean }>;
      attempts: Array<{ label: string; ok: boolean; error?: string }>;
      truncated?: boolean;
    }
    const legacyAdvisorCardDefinition = {
      kind: "dsh-advisor-chain-legacy",
      target: "chat",
      match(event: { type?: string; data?: { consultId?: string } }) {
        if ((event.type === "advisor/start" || event.type === "advisor/followup") && event.data?.consultId) {
          return { id: event.data.consultId, role: event.type === "advisor/start" ? "start" : "update" };
        }
        if ((event.type === "advisor/delta" || event.type === "advisor/message" || event.type === "advisor/end") && event.data?.consultId) {
          return { id: event.data.consultId, role: "update" };
        }
        return null;
      },
      start(_context: unknown, match: { event: { data: Record<string, unknown> } }) {
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
          attempts: [],
        } as LegacyCardState;
      },
      update(context: { state: LegacyCardState }, match: { event: { type: string; data: Record<string, unknown> } }) {
        const data = match.event.data;
        const state = context.state;
        if (match.event.type === "advisor/delta") {
          const attemptIndex = (data.attemptIndex as number) ?? 0;
          const round = typeof data.round === "number" ? data.round : 0;
          if (round >= 1) {
            const followUps = state.followUps.map((f, i) => (i === round - 1 ? { ...f, answer: (f.answer ?? "") + ((data.contentDelta as string) ?? "") } : f));
            return { ...state, currentAttempt: attemptIndex, followUps };
          }
          const reset = attemptIndex !== state.currentAttempt;
          return {
            ...state,
            currentAttempt: attemptIndex,
            liveContent: (reset ? "" : state.liveContent) + ((data.contentDelta as string) ?? ""),
            liveThinking: (reset ? "" : state.liveThinking) + ((data.thinkingDelta as string) ?? ""),
          };
        }
        if (match.event.type === "advisor/followup") {
          const round = (data.round as number) ?? state.followUps.length + 1;
          const followUps = [...state.followUps];
          followUps[round - 1] = { text: (data.followUp as string) ?? "" };
          return { ...state, followUps, liveContent: "", liveThinking: "" };
        }
        if (match.event.type === "advisor/message") {
          const round = typeof data.round === "number" ? data.round : 0;
          if (round >= 1) {
            const followUps = state.followUps.map((f, i) => (i === round - 1 ? { ...f, answer: (data.content as string) ?? "", truncated: data.truncated === true || f.truncated } : f));
            return { ...state, followUps, liveContent: "", liveThinking: "" };
          }
          const attemptIndex = (data.attemptIndex as number) ?? 0;
          const row = {
            attemptIndex,
            label: (data.label as string) ?? "",
            model: `${data.provider}/${data.model}`,
            content: (data.content as string) ?? "",
            thinking: data.thinking as string | undefined,
            truncated: data.truncated === true,
          };
          const messages = state.messages.filter((m) => m.attemptIndex !== attemptIndex);
          messages.push(row);
          return { ...state, messages, liveContent: "", liveThinking: "" };
        }
        if (match.event.type === "advisor/end") {
          return {
            ...state,
            status: (data.status as LegacyCardState["status"]) ?? "done",
            attempts: (data.attempts as LegacyCardState["attempts"]) ?? state.attempts,
            truncated: data.truncated === true || state.truncated,
          };
        }
        return state;
      },
      buildViewNode(context: { key?: string; id?: string; state?: LegacyCardState; start?: { event?: { seq?: number }; location?: unknown }; matches?: Array<{ event?: { seq?: number }; location?: unknown }> }) {
        if (context.state === undefined) return null;
        return {
          key: context.key,
          kind: "dsh-advisor-chain-legacy",
          id: context.id,
          target: "chat",
          anchorSeq: context.start?.event?.seq ?? context.matches?.[0]?.event?.seq ?? 0,
          location: context.start?.location ?? context.matches?.[0]?.location ?? { kind: "unresolved" },
          visibility: "visible",
          data: context.state,
        };
      },
    };

    function Fold({ title, children, defaultOpen = false }: { title: string; children?: React.ReactNode; defaultOpen?: boolean }) {
      const [open, setOpen] = useState(defaultOpen);
      return h("div", null,
        h("button", { style: toggleStyle, onClick: () => setOpen(!open), type: "button" }, `${open ? t("common.foldOpen") : t("common.foldClosed")} ${title}`),
        open ? h("div", { style: { whiteSpace: "pre-wrap", ...smallStyle, marginTop: 4 } }, children) : null);
    }

    // ---------- conservative Markdown rendering ----------
    // The host's MarkdownText primitive lives in an internal package that is
    // inlined into the shell bundles and not reachable from a plugin bundle,
    // so advisor answers are rendered here: paragraphs, bold, inline code,
    // bullet / numbered lists, headings, fenced code. Output is React nodes
    // (never innerHTML), so model text cannot inject markup.
    const codeFont = "var(--dsw-font-markdown-code-block-small, ui-monospace, Consolas, monospace)";
    const inlineCodeStyle: React.CSSProperties = { fontFamily: codeFont, fontSize: 12, background: "var(--dsw-alias-markdown-code-block)", padding: "0 4px", borderRadius: 4 };
    const preStyle: React.CSSProperties = { margin: "8px 0", padding: "8px 10px", borderRadius: R.sm, background: "var(--dsw-alias-markdown-code-block)", overflowX: "auto", fontSize: 12, lineHeight: 1.5 };
    const paraStyle: React.CSSProperties = { whiteSpace: "pre-wrap", marginTop: 6 };
    const listStyle: React.CSSProperties = { margin: "6px 0", paddingLeft: 20 };

    function inlineSpans(text: string, keyPrefix: string): React.ReactNode[] {
      const parts: React.ReactNode[] = [];
      const re = /(\*\*[^*\n]+?\*\*|`[^`\n]+`)/g;
      let last = 0;
      let i = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(text)) !== null) {
        if (match.index > last) parts.push(text.slice(last, match.index));
        const token = match[0];
        if (token.startsWith("**")) parts.push(h("strong", { key: `${keyPrefix}-b${i++}` }, token.slice(2, -2)));
        else parts.push(h("code", { key: `${keyPrefix}-c${i++}`, style: inlineCodeStyle }, token.slice(1, -1)));
        last = match.index + token.length;
      }
      if (last < text.length) parts.push(text.slice(last));
      return parts;
    }

    function renderMarkdown(text: string): React.ReactNode[] {
      const lines = text.replace(/\r\n/g, "\n").split("\n");
      const out: React.ReactNode[] = [];
      let para: string[] = [];
      let list: string[] | null = null;
      let ordered = false;
      let code: string[] | null = null;
      let k = 0;
      const flushPara = () => {
        if (!para.length) return;
        const key = k++;
        out.push(h("div", { key, style: paraStyle }, inlineSpans(para.join("\n"), `p${key}`)));
        para = [];
      };
      const flushList = () => {
        if (!list) return;
        const key = k++;
        const items = list;
        out.push(h(ordered ? "ol" : "ul", { key, style: listStyle }, items.map((item, idx) => h("li", { key: idx, style: { whiteSpace: "pre-wrap", marginBottom: 2 } }, inlineSpans(item, `l${key}-${idx}`)))));
        list = null;
      };
      const flushCode = () => {
        if (!code) return;
        const key = k++;
        out.push(h("pre", { key, style: preStyle }, h("code", { style: { fontFamily: codeFont } }, code.join("\n"))));
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
          out.push(h("div", { key, style: { fontWeight: 600, fontSize: level <= 2 ? 15 : 13.5, marginTop: 10, marginBottom: 2 } }, inlineSpans(heading[2], `h${key}`)));
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
          list.push((bullet ?? numbered)![1]);
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

    function LegacyAdvisorCardView(props: { node?: { data?: LegacyCardState } }) {
      const data = props.node?.data;
      const [contextOpen, setContextOpen] = useState(false);
      if (!data) return null;
      const failed = data.status === "failed";
      const running = data.status === "running";
      const messages = data.messages ?? [];
      const followUps = data.followUps ?? [];
      const statusBadge = failed ? badgeStyle("var(--dsw-alias-state-error-primary)") : running ? badgeStyle("var(--dsw-alias-state-warn-primary)") : badgeStyle("var(--dsw-alias-state-success-primary)");
      const statusText = failed ? t("card.statusFailed") : running ? t("card.statusRunning") : t("card.statusDone");
      return h("div", { style: cardStyle },
        h("div", null,
          h("span", { style: labelStyle }, t("card.title")),
          h("span", { style: subtleBadgeStyle }, t("legacy.badge")),
          h("span", { style: statusBadge }, statusText),
          messages.map((m) => h("span", { key: m.attemptIndex, style: badgeStyle("var(--dsw-alias-brand-primary)") }, m.model)),
          data.truncated ? h("span", { style: badgeStyle("var(--dsw-alias-state-warn-primary)") }, t("card.truncated")) : null),
        h("div", { style: { fontWeight: 600, margin: "6px 0 2px" } }, data.question),
        data.context ? h("div", null,
          h("button", { style: toggleStyle, type: "button", onClick: () => setContextOpen(!contextOpen) }, `${contextOpen ? t("common.foldOpen") : t("common.foldClosed")} ${t("card.contextToggle")}`),
          contextOpen ? h("div", { style: { whiteSpace: "pre-wrap", ...smallStyle, marginTop: 4 } }, data.context) : null) : null,
        messages.length > 0 && messages.some((m) => m.thinking) ? h(Fold, { title: t("legacy.thinking") }, messages.map((m) => m.thinking).filter(Boolean).join("\n\n")) : null,
        messages.length > 0
          ? h("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 6 } },
              messages.map((m) => h("div", { key: m.attemptIndex, style: { flex: "1 1 240px", minWidth: 240, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: R.lg, padding: "6px 8px" } },
                h("div", { style: { ...smallStyle, marginBottom: 4 } }, m.label || m.model),
                h("div", null, renderMarkdown(m.content)))))
          : running ? h("div", { style: { whiteSpace: "pre-wrap", marginTop: 6 } }, data.liveContent ? data.liveContent + "▍" : t("legacy.consulting", { label: data.chain?.[data.currentAttempt]?.label ?? "" })) : null,
        followUps.map((f, i) => h("div", { key: i, style: { marginTop: 10, paddingTop: 8, borderTop: "0.5px solid var(--dsw-alias-border-l1)" } },
          h("div", { style: { fontWeight: 600, ...smallStyle } }, t("legacy.followUp", { n: i + 1, text: f.text })),
          h("div", null, f.answer === undefined ? h("span", { style: smallStyle }, t("legacy.thinkingEllipsis")) : renderMarkdown(f.answer)))),
        data.attempts?.length ? h("div", { style: { marginTop: 8, ...smallStyle } },
          t("card.attempts"),
          data.attempts.map((attempt, i) => h("span", { key: i }, i > 0 ? " → " : "", attempt.ok ? t("common.okMark") : t("common.failMark"), attempt.label, attempt.ok || !attempt.error ? "" : `（${attempt.error}）`))) : null);
    }

    // ---------- toolview card for second_opinion ----------
    interface Meta {
      kind?: string;
      question?: string;
      context?: string;
      mode?: string;
      followUp?: string;
      model?: string;
      consultId?: string;
      dual?: boolean;
      truncated?: boolean;
      round?: number;
      attempts?: Array<{ label: string; ok: boolean; reason?: string }>;
      notes?: string[];
      usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; durationMs: number };
      /** Session the consultation was made from; with consultId this addresses the advisor child's conversation. */
      parent?: string;
      /** Dual consultations: each advisor's opinion in chain order. */
      opinions?: Array<{ label: string; ok: boolean; content: string; consultId?: string }>;
    }
    /** Opens a `dsh-resource://` address in the right Sidebar; bound when the host provides `sidebarRight`. */
    let openInSidebar: ((address: string) => void) | undefined;

    /** Address of an advisor child's conversation in the Session panel's Subagents catalog. */
    function subagentChatAddress(parent: string, child: string): string {
      return `dsh-resource://subagentchat/session/${encodeURIComponent(child)}?parent=${encodeURIComponent(parent)}&mode=continuable`;
    }
    interface ToolBlock {
      kind?: string;
      phase?: "preparing" | "start" | "result";
      name?: string;
      /** `PartialArguments`: a method-style reader over possibly incomplete streamed args. */
      args?: unknown;
      argsRaw?: string;
      call?: { argsRaw?: string } | null;
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
      error?: { name?: string; code?: string; reason?: string };
      meta?: unknown;
    }
    interface ToolRowProps {
      phase?: "preparing" | "start" | "result";
      block?: ToolBlock;
      toolName?: string;
    }

    interface ToolArgsLike {
      question?: string;
      context?: string;
      mode?: string;
      follow_up?: string;
      consult_id?: string;
      dual_opinions?: boolean;
    }

    /** Read the call's arguments from the host's `PartialArguments` reader
     *  (`text(key)` / `value(key)`), falling back to the raw JSON when the
     *  reader is unavailable (malformed or older blocks). */
    function argsOf(block: ToolBlock | undefined): ToolArgsLike {
      const a = block?.args as { text?: (key: string) => string | undefined; value?: (key: string) => unknown } | undefined;
      if (a && typeof a.text === "function") {
        const text = (key: keyof ToolArgsLike) => (a.text as (k: string) => string | undefined)(key) || undefined;
        return {
          question: text("question"),
          context: text("context"),
          mode: text("mode"),
          follow_up: text("follow_up"),
          consult_id: text("consult_id"),
          dual_opinions: typeof a.value === "function" ? a.value("dual_opinions") === true : undefined,
        };
      }
      const raw = typeof block?.argsRaw === "string" ? block.argsRaw : typeof block?.call?.argsRaw === "string" ? block.call.argsRaw : undefined;
      if (typeof raw === "string" && raw.trim()) {
        try {
          return JSON.parse(raw) as ToolArgsLike;
        } catch {
          return {};
        }
      }
      return {};
    }
    function metaOf(block: ToolBlock | undefined): Meta | undefined {
      const m = block?.meta;
      return m && typeof m === "object" && (m as Meta).kind === "second-opinion" ? (m as Meta) : undefined;
    }
    function contentText(block: ToolBlock | undefined): string {
      return (block?.content ?? []).map((c) => (c?.type === "text" && typeof c.text === "string" ? c.text : "")).join("").trim();
    }

    /** Keyed `tool.call.toolview` row for `second_opinion`. Malformed input
     *  degrades to a plain rendering of whatever the block carries. */
    function SecondOpinionToolRow(props: ToolRowProps) {
      const block = props.block;
      const [contextOpen, setContextOpen] = useState(false);
      const running = props.phase !== "result" && block?.kind !== "tool-result";
      const args = argsOf(block);
      const meta = metaOf(block);
      const question = meta?.question ?? meta?.followUp ?? args.question ?? args.follow_up ?? "";
      const context = meta?.context ?? args.context;
      const attempts = meta?.attempts ?? [];
      const okCount = attempts.filter((a) => a.ok).length;
      const failed = !running && (block?.isError === true || (attempts.length > 0 && okCount === 0));
      const truncated = meta?.truncated === true;
      const statusBadge = running ? badgeStyle("var(--dsw-alias-state-warn-primary)") : failed ? badgeStyle("var(--dsw-alias-state-error-primary)") : badgeStyle("var(--dsw-alias-state-success-primary)");
      const statusText = running ? t("card.statusRunning") : failed ? t("card.statusFailed") : t("card.statusDone");
      const models = (meta?.model ?? "").split(" + ").filter(Boolean);
      const text = contentText(block);
      const isFollowUp = (meta?.round ?? 0) >= 1 || (!!args.consult_id && !args.question);
      const title = isFollowUp ? (meta?.round ? t("card.followUpTitle", { round: meta.round }) : t("card.followUpTitlePlain")) : t("card.title");
      const mode = meta?.mode ?? args.mode;
      // Dual results render as two columns, each with its own "查看过程" link;
      // otherwise the header link opens the (single) advisor's conversation.
      const dualColumns = meta?.dual && Array.isArray(meta.opinions) && meta.opinions.length === 2 ? meta.opinions : undefined;
      const processLink = (childId: string | undefined, style: React.CSSProperties = linkButtonStyle) =>
        openInSidebar && childId && meta?.parent
          ? h("button", { style, type: "button", title: t("card.openProcessHint"), onClick: () => openInSidebar!(subagentChatAddress(meta.parent!, childId)) }, t("card.openProcess"))
          : null;
      return h("div", { style: cardStyle, "data-dsh-advisor": "card" },
        h("div", { style: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 } },
          h("span", { style: labelStyle }, title),
          h("span", { style: statusBadge }, statusText),
          mode ? h("span", { style: subtleBadgeStyle }, mode === "standalone" ? t("card.modeStandalone") : t("card.modeInherited")) : null,
          models.map((m, i) => h("span", { key: i, style: badgeStyle("var(--dsw-alias-brand-primary)") }, m)),
          truncated ? h("span", { style: badgeStyle("var(--dsw-alias-state-warn-primary)") }, t("card.truncated")) : null,
          // The advisor's own conversation (its reads and reasoning) opens in the right Sidebar.
          dualColumns ? null : processLink(meta?.consultId)),
        question ? h("div", { style: { fontWeight: 600, margin: "6px 0 2px" } }, question) : null,
        context ? h("div", null,
          h("button", { style: toggleStyle, type: "button", onClick: () => setContextOpen(!contextOpen) }, `${contextOpen ? t("common.foldOpen") : t("common.foldClosed")} ${t("card.contextToggle")}`),
          contextOpen ? h("div", { style: { whiteSpace: "pre-wrap", ...smallStyle, marginTop: 4 } }, context) : null) : null,
        running ? h("div", { style: smallStyle }, t("card.runningHint")) : null,
        attempts.length ? h("div", { style: { marginTop: 8, ...smallStyle } },
          t("card.attempts"),
          attempts.map((a, i) => h("span", { key: i, style: a.ok ? okStyle : errorStyle }, i > 0 ? " → " : "", a.ok ? `${t("common.okMark")} ` : `${t("common.failMark")} `, a.label, !a.ok && a.reason ? `（${a.reason.length > 300 ? a.reason.slice(0, 300) + "…" : a.reason}）` : ""))) : null,
        (meta?.notes ?? []).length ? h("ul", { style: { ...warnStyle, margin: "6px 0 0", paddingLeft: 18 } }, meta!.notes!.map((n, i) => h("li", { key: i }, n))) : null,
        meta?.usage ? h("div", { style: smallStyle }, t("card.usage", {
          input: meta.usage.inputTokens + meta.usage.cacheReadTokens + meta.usage.cacheWriteTokens,
          output: meta.usage.outputTokens,
          cached: meta.usage.cacheReadTokens + meta.usage.cacheWriteTokens > 0 ? t("card.usageCached", { cached: meta.usage.cacheReadTokens + meta.usage.cacheWriteTokens }) : "",
          duration: t("card.usageSeconds", { s: Math.max(1, Math.round(meta.usage.durationMs / 1000)) }),
        })) : null,
        !running && dualColumns
          ? h("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 } }, dualColumns.map((o, i) =>
            h("div", { key: i, style: { flex: "1 1 240px", minWidth: 240, border: "1px solid var(--dsw-alias-border-l1)", borderRadius: R.lg, padding: "6px 8px" } },
              h("div", { style: { display: "flex", alignItems: "center", fontWeight: 600, marginBottom: 2 } },
                h("span", { style: { minWidth: 0 } }, `${t("card.opinion", { n: i + 1 })} · ${o.label}`),
                processLink(o.consultId, { ...linkButtonStyle, marginLeft: 6 })),
              o.ok ? h("div", null, renderMarkdown(o.content)) : h("div", { style: errorStyle }, o.content))))
          : null,
        !running && text && !dualColumns ? h("div", { style: { marginTop: 2 } }, renderMarkdown(text)) : null,
        !running && !text && block?.error ? h("div", { style: errorStyle }, block.error.reason ?? block.error.code ?? block.error.name ?? t("card.toolFailed")) : null);
    }

    // ---------- settings tab ----------
    interface DraftChainEntry {
      label?: string;
      provider: string;
      model: string;
      reasoningEffort?: string;
      maxTokens?: number;
      timeoutMs?: number;
    }
    interface DraftConfig {
      enabled: boolean;
      mode: "auto" | "manual";
      contextMode: "inherited" | "standalone";
      advisorComposition: "lean" | "inherit";
      advisorPrompt: string;
      chain: DraftChainEntry[];
      followup: { maxRounds: number };
      legacyNoticeDismissed: boolean;
      trigger: { repeatThreshold: number };
      limits: { defaultTimeoutMs: number; transcriptMaxChars: number; perEntryMaxChars: number };
    }
    interface NamespaceView { ns: string; value: unknown; revision: number }
    interface NamespaceDescribe { writable: boolean; namespaces: NamespaceView[] }
    interface RemoteLike {
      settings: {
        describe: () => Promise<RemoteEnvelope<NamespaceDescribe>>;
        /** Patch-merge with optimistic revision; the host replaces arrays wholesale. */
        update: (ns: string, patch: unknown, expectedRevision?: number) => Promise<RemoteEnvelope<NamespaceView>>;
      };
      llm: {
        listProviders: () => Promise<RemoteEnvelope<Array<{ id: string; name: string }>>>;
        /** Provider → settings namespace that configures it (needed for discovery). */
        listConfigurableProviders: () => Promise<RemoteEnvelope<Array<{ provider: string; settingsNs: string }>>>;
        /** Official model discovery for a provider (the 模型 page's own source). */
        discoverModels: (settingsNs: string, request: { provider?: string }) => Promise<RemoteEnvelope<Array<{ id: string; name?: string }>>>;
      };
    }
    interface RemoteEnvelope<T> { ok: boolean; value?: T; error?: { message?: string; code?: string } }
    function unwrap<T>(response: RemoteEnvelope<T> | undefined, what: string): T {
      if (response && response.ok && response.value !== undefined) return response.value;
      const detail = response?.error?.code ? `${response.error.code}：${response.error.message ?? ""}` : response?.error?.message ?? t("common.remoteAbnormal");
      throw new Error(t("common.remoteFailed", { what, detail }));
    }
    function getRemote(ctx: unknown): RemoteLike | undefined {
      const candidate = ctx as { remote?: RemoteLike; get?: (key: string) => unknown };
      return candidate.remote ?? (typeof candidate.get === "function" ? (candidate.get("remote") as RemoteLike) : undefined);
    }

    const NS = "dsh-advisor-chain";
    const SUBAGENT_NS = "subagent-model-selection-settings";
    /** Built-in DeepSeek routes advertise these; adapter-owned, not in settings. */
    const BUILTIN_DEEPSEEK_EFFORTS = ["off", "low", "high", "max"];
    const REPO_URL = "https://github.com/yyty947/dsh-advisor-chain";
    const UPGRADE_NOTES_URL = `${REPO_URL}#升级须知`;

    interface ModelInfo { id: string; name?: string; efforts?: string[]; discovered?: boolean }
    interface ProviderInfo { models: ModelInfo[]; builtin: boolean }

    function effortsOf(raw: unknown): string[] | undefined {
      if (Array.isArray(raw)) return raw.map(String);
      if (raw && typeof raw === "object") return Object.keys(raw as object);
      return undefined;
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
    function providerModels(namespaces: NamespaceView[], provider: string): ProviderInfo {
      const out: ProviderInfo = { models: [], builtin: false };
      const byId = new Map<string, ModelInfo>();
      const register = (m: unknown) => {
        const id = typeof m === "string" ? m : (m as { id?: unknown } | null)?.id;
        if (typeof id !== "string" || !id || byId.has(id)) return;
        const entry: ModelInfo = { id, name: typeof (m as { name?: unknown })?.name === "string" ? (m as { name: string }).name : undefined, efforts: undefined };
        const efforts = effortsOf((m as { reasoningEfforts?: unknown } | null)?.reasoningEfforts);
        if (efforts && efforts.length) entry.efforts = efforts;
        byId.set(id, entry);
      };
      const applyOverride = (id: string, o: unknown) => {
        const entry = byId.get(id);
        if (!entry || !o || typeof o !== "object") return;
        const raw = (o as { reasoningEfforts?: unknown }).reasoningEfforts;
        if (raw === false) entry.efforts = undefined;
        else {
          const efforts = effortsOf(raw);
          if (efforts) entry.efforts = efforts;
        }
      };
      const isDeepSeekNs = (ns: string) => /deepseek/i.test(ns);
      const isDeepSeekRoute = /deepseek/i.test(provider);
      for (const section of namespaces ?? []) {
        const value = section.value as Record<string, unknown> | undefined;
        if (!value || typeof value !== "object") continue;
        const route = (value.providers as Record<string, { models?: unknown; modelOverrides?: unknown }> | undefined)?.[provider];
        if (route && typeof route === "object") {
          if (Array.isArray(route.models)) route.models.forEach(register);
          if (route.modelOverrides && typeof route.modelOverrides === "object") {
            for (const [id, o] of Object.entries(route.modelOverrides as Record<string, unknown>)) applyOverride(id, o);
          }
        }
        if (isDeepSeekNs(section.ns) && isDeepSeekRoute) {
          if (Array.isArray(value.models)) {
            out.builtin = true;
            value.models.forEach(register);
          }
          if (value.modelOverrides && typeof value.modelOverrides === "object") {
            out.builtin = true;
            for (const [id, o] of Object.entries(value.modelOverrides as Record<string, unknown>)) applyOverride(id, o);
          }
        }
      }
      if (out.builtin) {
        for (const m of byId.values()) if (!m.efforts) m.efforts = [...BUILTIN_DEEPSEEK_EFFORTS];
        out.builtin = true;
      } else if (/deepseek/i.test(provider)) {
        // Account route without a catalog: models come from discovery, efforts from the adapter.
        out.builtin = true;
      }
      out.models = [...byId.values()];
      return out;
    }

    type EntryStatus = { kind: "ok" | "provider-missing" | "model-unknown" | "catalog-unknown" | "unauthorized" | "selection-off" | "effort-undeclared"; text: string };

    function AdvisorSettingsTab() {
      const [draft, setDraft] = useState<DraftConfig | null>(null);
      const [revision, setRevision] = useState(0);
      const [savedSnapshot, setSavedSnapshot] = useState("");
      const [allNamespaces, setAllNamespaces] = useState<NamespaceView[]>([]);
      const [providers, setProviders] = useState<Array<{ id: string; name: string }>>([]);
      const [allow, setAllow] = useState<{ enabled: boolean; routes: Array<{ provider: string; model: string }>; revision: number; present: boolean }>({ enabled: false, routes: [], revision: 0, present: false });
      const [authWritable, setAuthWritable] = useState(true);
      /** Models discovered through the official `discoverModels` remote, per provider
       *  (for routes whose models live outside the settings document, e.g. a
       *  signed-in DeepSeek account). */
      const [discovered, setDiscovered] = useState<Record<string, string[]>>({});
      /** True when the stored config still carries keys only 0.3.9 wrote — the
       *  signal that this installation has sessions with legacy `advisor/*` events. */
      const [legacyUser, setLegacyUser] = useState(false);
      const [busy, setBusy] = useState<string | null>(null);
      const [saving, setSaving] = useState(false);
      const [msg, setMsg] = useState("");
      const [error, setError] = useState("");
      const dockRef = useRef<HTMLElement | null>(null);
      const [surface, setSurface] = useState("var(--dsw-alias-bg-base)");
      const [scrollerPad, setScrollerPad] = useState(0);
      const [dockHeight, setDockHeight] = useState(48);

      useEffect(() => {
        let node = dockRef.current as HTMLElement | null;
        while (node) {
          const bg = getComputedStyle(node).backgroundColor;
          if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") { setSurface(bg); break; }
          node = node.parentElement;
        }
        let scroller: HTMLElement | undefined;
        let p: HTMLElement | null = (dockRef.current as HTMLElement | null)?.parentElement ?? null;
        while (p) {
          const oy = getComputedStyle(p).overflowY;
          if (oy === "auto" || oy === "scroll" || oy === "overlay") { scroller = p; break; }
          p = p.parentElement;
        }
        if (scroller) setScrollerPad(parseFloat(getComputedStyle(scroller).paddingBottom) || 0);
        const onResize = () => { if (scroller) setScrollerPad(parseFloat(getComputedStyle(scroller).paddingBottom) || 0); };
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
      }, []);

      useEffect(() => {
        const dock = dockRef.current as HTMLElement | null;
        if (dock) setDockHeight(dock.offsetHeight + 8);
      }, [msg, error]);

      const readAllow = (namespaces: NamespaceView[]) => {
        const ns = namespaces.find((n) => n.ns === SUBAGENT_NS);
        const value = ns?.value as { enabled?: boolean; allowedModels?: Array<{ provider: string; model: string }> } | undefined;
        setAllow({
          present: !!ns,
          enabled: value?.enabled === true,
          routes: Array.isArray(value?.allowedModels) ? value.allowedModels.filter((r) => r && typeof r.provider === "string" && typeof r.model === "string") : [],
          revision: ns?.revision ?? 0,
        });
      };

      const reload = async (opts?: { silent?: boolean }) => {
        if (!opts?.silent) { setMsg(""); setError(""); }
        try {
          const remote = getRemote(currentCtx);
          if (!remote) { setError(t("common.remoteMissing")); return; }
          const desc = unwrap(await remote.settings.describe(), t("common.readSettings"));
          const namespaces = Array.isArray(desc?.namespaces) ? desc.namespaces : [];
          setAllNamespaces(namespaces);
          readAllow(namespaces);
          const ns = namespaces.find((n) => n.ns === NS);
          if (!ns) { setError(t("common.nsMissing")); return; }
          const value = ns.value as Partial<DraftConfig>;
          const next: DraftConfig = {
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
              defaultTimeoutMs: value.limits?.defaultTimeoutMs ?? 300000,
              transcriptMaxChars: value.limits?.transcriptMaxChars ?? 120000,
              perEntryMaxChars: value.limits?.perEntryMaxChars ?? 4000,
            },
          };
          setDraft(next);
          setRevision(ns.revision);
          setSavedSnapshot(JSON.stringify(next));
          const raw = ns.value as Record<string, unknown>;
          setLegacyUser(
            Object.prototype.hasOwnProperty.call(raw, "modelCatalog") ||
              (Array.isArray(raw.chain) && raw.chain.some((e) => e && typeof e === "object" && "temperature" in (e as object))),
          );
          const provs = await remote.llm.listProviders().catch(() => undefined);
          setProviders(provs && provs.ok && Array.isArray(provs.value) ? provs.value : []);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      };

      useEffect(() => { reload(); }, []);

      const patch = (part: Partial<DraftConfig>) => setDraft((d) => (d ? { ...d, ...part } : d));
      const patchEntry = (index: number, part: Partial<DraftChainEntry>) => setDraft((d) => (d ? { ...d, chain: d.chain.map((e, i) => (i === index ? { ...e, ...part } : e)) } : d));
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
      const addEntry = () => setDraft((d) => (d ? { ...d, chain: [...d.chain, { label: "", provider: providers[0]?.id ?? "", model: "" }] } : d));
      // Changing the provider invalidates the model and the effort.
      // Changing the provider invalidates the model and the effort; when the
      // settings document holds no catalog for it, fetch the list the way the
      // 模型 page does.
      const patchProvider = (index: number, provider: string) => {
        patchEntry(index, { provider, model: "", reasoningEffort: undefined });
        if (provider && providerModels(allNamespaces, provider).models.length === 0) void discover(provider);
      };

      const discover = async (provider: string) => {
        if (!provider) return;
        setBusy(`discover:${provider}`);
        setMsg("");
        setError("");
        try {
          const remote = getRemote(currentCtx)!;
          const confs = await remote.llm.listConfigurableProviders().catch(() => undefined);
          const settingsNs = confs && confs.ok && Array.isArray(confs.value) ? confs.value.find((c) => c.provider === provider)?.settingsNs : undefined;
          const found = settingsNs ? unwrap(await remote.llm.discoverModels(settingsNs, { provider }), t("entry.discover")) : [];
          setDiscovered((d) => ({ ...d, [provider]: found.map((m) => m.id) }));
          setMsg(found.length ? t("entry.discoveredCount", { provider, count: found.length }) : t("entry.discoveredNone", { provider }));
        } catch (e) {
          setError(t("entry.discoverFailed", { message: e instanceof Error ? e.message : String(e) }));
        } finally {
          setBusy(null);
        }
      };

      /** Everything the model dropdown may offer for a provider right now. */
      const catalogOf = (provider: string): ModelInfo[] => {
        const info = providerModels(allNamespaces, provider);
        const extra = (discovered[provider] ?? []).filter((id) => !info.models.some((m) => m.id === id)).map((id) => ({ id, efforts: info.builtin ? [...BUILTIN_DEEPSEEK_EFFORTS] : undefined, discovered: true }));
        return [...info.models, ...extra];
      };

      const statusOf = (entry: DraftChainEntry): EntryStatus => {
        if (!entry.provider) return { kind: "provider-missing", text: t("status.pickProvider") };
        if (providers.length > 0 && !providers.some((p) => p.id === entry.provider)) {
          return { kind: "provider-missing", text: t("status.providerMissingDetail", { provider: entry.provider }) };
        }
        const catalog = catalogOf(entry.provider);
        if (!entry.model) return { kind: "model-unknown", text: t("status.pickModel") };
        if (catalog.length > 0 && !catalog.some((m) => m.id === entry.model)) {
          return { kind: "model-unknown", text: t("status.modelUnknownDetail", { model: entry.model }) };
        }
        if (catalog.length === 0) {
          return { kind: "catalog-unknown", text: t("status.catalogUnknownDetail", { provider: entry.provider }) };
        }
        if (!allow.present) return { kind: "ok", text: t("status.noAllowlist") };
        if (!allow.enabled) {
          return { kind: "selection-off", text: t("status.selectionOffDetail") };
        }
        if (!allow.routes.some((r) => r.provider === entry.provider && r.model === entry.model)) {
          const p = providers.find((x) => x.id === entry.provider);
          return { kind: "unauthorized", text: t("status.unauthorizedDetail", { route: `${entry.provider} / ${entry.model}`, name: p?.name ? t("status.unauthorizedName", { name: p.name }) : "" }) };
        }
        if (entry.reasoningEffort) {
          const declared = catalog.find((m) => m.id === entry.model)?.efforts ?? [];
          if (declared.length === 0) {
            return { kind: "effort-undeclared", text: t("status.effortUndeclaredNone", { model: entry.model, effort: entry.reasoningEffort }) };
          }
          if (!declared.includes(entry.reasoningEffort)) {
            return { kind: "effort-undeclared", text: t("status.effortUndeclaredOther", { model: entry.model, declared: declared.join(" / "), effort: entry.reasoningEffort }) };
          }
        }
        return { kind: "ok", text: "" };
      };

      const authorize = async (entries: DraftChainEntry[]) => {
        const remote = getRemote(currentCtx)!;
        setBusy("authorize");
        setMsg(""); setError("");
        try {
          // Read-modify-write with the revision we last saw; the host replaces
          // arrays wholesale, so the full merged list goes back.
          const desc = unwrap(await remote.settings.describe(), t("common.readSettings"));
          const ns = desc.namespaces.find((n) => n.ns === SUBAGENT_NS);
          if (!ns) throw new Error(t("auth.noSetting"));
          const current = ns.value as { enabled?: boolean; allowedModels?: Array<{ provider: string; model: string }> } | undefined;
          const routes = Array.isArray(current?.allowedModels) ? [...current.allowedModels] : [];
          for (const e of entries) {
            if (e.provider && e.model && !routes.some((r) => r.provider === e.provider && r.model === e.model)) routes.push({ provider: e.provider, model: e.model });
          }
          const view = unwrap(await remote.settings.update(SUBAGENT_NS, { enabled: true, allowedModels: routes }, ns.revision), t("auth.write"));
          setAllow((a) => ({ ...a, enabled: true, routes, revision: view.revision, present: true }));
          setMsg(t("auth.done", { count: entries.length, state: current?.enabled ? t("auth.stateKept") : t("auth.stateOn") }));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (/conflict|stale|changed since it was read|revision/i.test(message)) { await reload({ silent: true }); setMsg(t("auth.conflict")); }
          else { setAuthWritable(false); setError(t("auth.failed", { message })); }
        } finally { setBusy(null); }
      };

      const dismissLegacyNotice = async () => {
        // Only the flag is persisted — never the (possibly half-edited) draft.
        patch({ legacyNoticeDismissed: true });
        try {
          const remote = getRemote(currentCtx)!;
          const ns = (await remote.settings.describe()).value?.namespaces.find((n) => n.ns === NS);
          const view = unwrap(await remote.settings.update(NS, { legacyNoticeDismissed: true }, ns?.revision ?? revision), t("banner.write"));
          setRevision(view.revision);
          // The flag is now saved; keep other unsaved edits visibly unsaved.
          setSavedSnapshot((snap) => {
            try {
              const parsed = JSON.parse(snap) as DraftConfig;
              return JSON.stringify({ ...parsed, legacyNoticeDismissed: true });
            } catch {
              return snap;
            }
          });
          setMsg(t("banner.dismissed"));
        } catch (e) { setError(t("banner.dismissFailed", { message: e instanceof Error ? e.message : String(e) })); }
      };

      const save = async () => {
        if (!draft) return;
        setSaving(true); setMsg(""); setError("");
        try {
          const remote = getRemote(currentCtx)!;
          const dropped = draft.chain.filter((e) => !e.provider || !e.model).length;
          const clamp = (v: number | undefined, lo: number, hi: number) => (v === undefined ? undefined : Math.min(hi, Math.max(lo, Math.round(v))));
          // Only schema fields are written. The host MERGES patches: a rewritten
          // `chain` array drops legacy entry keys (temperature), while top-level
          // keys from earlier releases (modelCatalog) persist harmlessly and are
          // ignored at runtime.
          const sanitized: DraftConfig = {
            enabled: draft.enabled,
            mode: draft.mode,
            contextMode: draft.contextMode,
            advisorComposition: draft.advisorComposition,
            advisorPrompt: draft.advisorPrompt,
            chain: draft.chain.filter((e) => e.provider && e.model).map((e) => ({
              ...(e.label?.trim() ? { label: e.label } : {}),
              provider: e.provider,
              model: e.model,
              ...(e.reasoningEffort ? { reasoningEffort: e.reasoningEffort } : {}),
              maxTokens: clamp(e.maxTokens, 1, 1000000),
              timeoutMs: clamp(e.timeoutMs, 1000, 600000),
            })),
            followup: { maxRounds: Math.min(20, Math.max(1, draft.followup.maxRounds || 8)) },
            legacyNoticeDismissed: draft.legacyNoticeDismissed,
            trigger: { repeatThreshold: Math.min(10, Math.max(2, draft.trigger.repeatThreshold || 3)) },
            limits: {
              defaultTimeoutMs: clamp(draft.limits.defaultTimeoutMs, 1000, 600000) ?? 300000,
              transcriptMaxChars: clamp(draft.limits.transcriptMaxChars, 2000, 400000) ?? 120000,
              perEntryMaxChars: clamp(draft.limits.perEntryMaxChars, 200, 20000) ?? 4000,
            },
          };
          const view = unwrap(await remote.settings.update(NS, sanitized, revision), t("save.write"));
          setRevision(view.revision);
          setDraft(view.value as DraftConfig);
          setSavedSnapshot(JSON.stringify(view.value));
          setMsg(t("save.done", { dropped: dropped > 0 ? t("save.dropped", { count: dropped }) : "" }));
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (/conflict|stale|changed since it was read|revision/i.test(message)) { await reload({ silent: true }); setMsg(t("save.conflict")); }
          else setError(t("save.failed", { message }));
        } finally { setSaving(false); }
      };

      if (!draft) {
        return h("li", { className: "dsh-advisor-chain-settings", style: { width: "100%", color: "var(--dsw-alias-label-primary)", fontFamily: "var(--dsw-font-family, inherit)", listStyle: "none", padding: 0, margin: 0 } },
          h("div", { style: SET.row },
            h("div", { style: error ? SET.msgErr : SET.desc }, error || t("common.loading")),
            error ? h("button", { style: SET.btn, type: "button", onClick: () => reload() }, t("common.retry")) : null));
      }

      const dirty = savedSnapshot !== "" && JSON.stringify(draft) !== savedSnapshot;
      // Shown once, only to installations that actually carry 0.3.9 data — a
      // fresh install must never see it.
      const showLegacyNotice = legacyUser && !draft.legacyNoticeDismissed;
      const unauthorized = draft.chain.filter((e) => e.provider && e.model && ["unauthorized", "selection-off"].includes(statusOf(e).kind));

      const numRow = (title: string, desc: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, last = false) =>
        h("div", { style: { ...SET.row, ...(last ? { borderBottom: "none" } : null) } },
          h("div", { style: { minWidth: 0 } }, h("div", { style: SET.title }, title), h("div", { style: SET.desc }, desc)),
          h("input", { style: { ...SET.control, width: 110 }, type: "number", min, max, step, value, "aria-label": title, disabled: saving, onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value)) }));

      const modelField = (index: number, entry: DraftChainEntry) => {
        const catalog = catalogOf(entry.provider);
        const options = [
          ...catalog.map((m) => ({ value: m.id, label: m.name && m.name !== m.id ? `${m.id}（${m.name}）` : m.id })),
          ...(entry.model && !catalog.some((m) => m.id === entry.model) ? [{ value: entry.model, label: t("entry.modelNotListed", { model: entry.model }) }] : []),
        ];
        const fetching = busy === `discover:${entry.provider}`;
        return h(Field, { label: t("entry.modelField") },
          h("div", { style: { display: "flex", gap: 6, width: "100%", minWidth: 0 } },
            h(Dropdown, { width: "100%", ariaLabel: t("entry.modelField"), value: entry.model, options: options.length ? options : [{ value: "", label: catalog.length ? t("entry.modelPick") : t("entry.modelCatalogEmpty") }], onChange: (e: { target: { value: string } }) => patchEntry(index, { model: e.target.value, reasoningEffort: undefined }) }),
            catalog.length === 0
              ? h("button", { style: { ...SET.btn, height: 32, whiteSpace: "nowrap", flexShrink: 0 }, type: "button", disabled: !entry.provider || busy !== null, onClick: () => void discover(entry.provider) }, fetching ? t("entry.discovering") : t("entry.discover"))
              : null));
      };
      const effortField = (index: number, entry: DraftChainEntry) => {
        const declared = catalogOf(entry.provider).find((m) => m.id === entry.model)?.efforts ?? [];
        const options = [{ value: "", label: declared.length ? t("entry.effortDefault") : t("entry.effortDefaultUndeclared") }, ...declared.map((v) => ({ value: v, label: v })), ...(entry.reasoningEffort && !declared.includes(entry.reasoningEffort) ? [{ value: entry.reasoningEffort, label: t("entry.effortUndeclaredOption", { effort: entry.reasoningEffort }) }] : [])];
        return h(Field, { label: t("entry.effortField") }, h(Dropdown, { width: 180, ariaLabel: t("entry.effortField"), value: entry.reasoningEffort ?? "", options, onChange: (e: { target: { value: string } }) => patchEntry(index, { reasoningEffort: e.target.value || undefined }) }));
      };

      const entryNode = (index: number, entry: DraftChainEntry) => {
        const status = statusOf(entry);
        return h("div", { key: index, style: SET.entry },
          h("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 } },
            h("span", { style: { ...SET.desc, marginTop: 0, width: 22 } }, `#${index + 1}`),
            h("span", { style: status.kind === "ok" ? okStyle : status.kind === "effort-undeclared" || status.kind === "catalog-unknown" ? warnStyle : errorStyle }, status.kind === "ok" ? t("status.ok") : status.kind === "provider-missing" ? t("status.providerMissing") : status.kind === "model-unknown" ? t("status.modelUnknown") : status.kind === "catalog-unknown" ? t("status.catalogUnknown") : status.kind === "selection-off" ? t("status.selectionOff") : status.kind === "unauthorized" ? t("status.unauthorized") : t("status.effortUndeclared")),
            h("span", { style: { flex: 1 } }),
            status.kind === "unauthorized" && authWritable ? h("button", { style: SET.btn, type: "button", disabled: busy !== null, onClick: () => authorize([entry]) }, t("entry.authorize")) : null,
            status.kind === "selection-off" && authWritable ? h("button", { style: SET.btn, type: "button", disabled: busy !== null, onClick: () => authorize([entry]) }, t("entry.authorizeEnable")) : null,
            h("button", { style: SET.btn, type: "button", "aria-label": t("common.moveUp"), title: t("common.moveUp"), onClick: () => moveEntry(index, -1), disabled: index === 0 }, "↑"),
            h("button", { style: SET.btn, type: "button", "aria-label": t("common.moveDown"), title: t("common.moveDown"), onClick: () => moveEntry(index, 1), disabled: index === draft.chain.length - 1 }, "↓"),
            h("button", { style: SET.btn, type: "button", onClick: () => removeEntry(index) }, t("common.delete"))),
          // Grid (not flex): a long provider name must not squeeze the model
          // field. Fixed name column; provider and model split the rest evenly
          // and ellipsize instead of overflowing.
          h("div", { style: { display: "grid", gridTemplateColumns: "minmax(130px, 160px) minmax(0, 1fr) minmax(0, 1fr)", gap: 12, alignItems: "end" } },
            h(Field, { label: t("entry.labelField") }, h("input", { style: { ...SET.control, width: "100%", boxSizing: "border-box" }, placeholder: t("entry.labelPlaceholder"), value: entry.label ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { label: e.target.value }) })),
            h(Field, { label: t("entry.providerField") }, h(Dropdown, { width: "100%", ariaLabel: t("entry.providerField"), value: entry.provider, options: providers.length ? providers.map((p) => ({ value: p.id, label: p.name && p.name !== p.id ? `${p.id}（${p.name}）` : p.id })) : [{ value: entry.provider, label: entry.provider || t("entry.providerNone") }], onChange: (e: { target: { value: string } }) => patchProvider(index, e.target.value) })),
            modelField(index, entry)),
          h("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 } },
            effortField(index, entry),
            h(Field, { label: t("entry.maxTokensField") }, h("input", { style: { ...SET.control, width: 120 }, type: "number", min: 1, value: entry.maxTokens ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { maxTokens: e.target.value === "" ? undefined : Number(e.target.value) }) })),
            h(Field, { label: t("entry.timeoutField") }, h("input", { style: { ...SET.control, width: 130 }, type: "number", min: 1000, max: 600000, step: 500, value: entry.timeoutMs ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => patchEntry(index, { timeoutMs: e.target.value === "" ? undefined : Number(e.target.value) }) }))),
          status.kind !== "ok" ? h("div", { style: { ...smallStyle, ...(status.kind === "effort-undeclared" || status.kind === "catalog-unknown" ? warnStyle : errorStyle), marginTop: 8 } }, status.text) : null);
      };

      return h("li", { className: "dsh-advisor-chain-settings", style: { width: "100%", color: "var(--dsw-alias-label-primary)", fontFamily: "var(--dsw-font-family, inherit)", listStyle: "none", padding: 0, margin: 0, paddingBottom: dockHeight } },
        h("div", { style: { pointerEvents: saving ? "none" : "auto", opacity: saving ? 0.6 : 1 } },
          showLegacyNotice ? h("div", { role: "status", style: SET.banner },
            h("div", { style: { flex: 1, minWidth: 0 } },
              h("div", { style: { fontWeight: 600, marginBottom: 4 } }, t("banner.title")),
              h("div", null, t("banner.body")),
              h("a", { href: UPGRADE_NOTES_URL, target: "_blank", rel: "noreferrer", style: { ...smallStyle, color: "var(--dsw-alias-brand-primary)" } }, t("banner.link"))),
            h("button", { style: SET.btn, type: "button", onClick: dismissLegacyNotice }, t("banner.dismiss"))) : null,
          h(SRow, { title: t("settings.enabledTitle"), desc: t("settings.enabledDesc") },
            h(Toggle, { checked: draft.enabled, label: t("settings.enabledTitle"), onChange: (next: boolean) => patch({ enabled: next }) })),
          h(SRow, { title: t("settings.triggerTitle"), desc: t("settings.triggerDesc") },
            h(Dropdown, { value: draft.mode, width: 240, ariaLabel: t("settings.triggerTitle"), options: [{ value: "auto", label: t("settings.triggerAuto") }, { value: "manual", label: t("settings.triggerManual") }], onChange: (e: { target: { value: string } }) => patch({ mode: e.target.value as DraftConfig["mode"] }) })),
          h(SRow, { title: t("settings.modeTitle"), desc: t("settings.modeDesc") },
            h(Dropdown, { value: draft.contextMode, width: 240, ariaLabel: t("settings.modeTitle"), options: [{ value: "inherited", label: t("settings.modeInherited") }, { value: "standalone", label: t("settings.modeStandalone") }], onChange: (e: { target: { value: string } }) => patch({ contextMode: e.target.value as DraftConfig["contextMode"] }) })),
          h(SRow, { title: t("settings.compositionTitle"), desc: t("settings.compositionDesc") },
            // Wider than the other rows: the menu carries a check column and
            // the English options are long, so a 240 trigger lets the menu overrun the column.
            h(Dropdown, { value: draft.advisorComposition, width: 300, ariaLabel: t("settings.compositionTitle"), options: [{ value: "lean", label: t("settings.compositionLean") }, { value: "inherit", label: t("settings.compositionInherit") }], onChange: (e: { target: { value: string } }) => patch({ advisorComposition: e.target.value as DraftConfig["advisorComposition"] }) })),          h("div", { style: { ...SET.groupHead, alignItems: "flex-start" } },
            h("div", { style: { minWidth: 0 } },
              h("div", { style: SET.title }, t("settings.chainTitle")),
              h("div", { style: SET.desc }, t("settings.chainDesc"))),
            h("div", { style: { display: "flex", gap: 8, flexShrink: 0 } },
              unauthorized.length > 0 && authWritable ? h("button", { style: SET.btn, type: "button", disabled: busy !== null, onClick: () => authorize(unauthorized) }, allow.enabled ? t("settings.chainAuthorizeAll") : t("settings.chainEnableAndAuthorizeAll")) : null,
              h("button", { style: SET.btn, type: "button", onClick: addEntry }, t("settings.chainAdd")))),
          ...draft.chain.map((entry, index) => entryNode(index, entry)),
          draft.chain.length === 0 ? h("div", { style: { ...SET.desc, padding: "0 0 12px" } }, t("settings.chainEmpty")) : null,
          h("div", { style: { padding: "16px 0", borderBottom: "0.5px solid var(--dsw-alias-border-l2)" } },
            h("div", { style: SET.title }, t("settings.promptTitle")),
            h("div", { style: SET.desc }, t("settings.promptDesc")),
            h("textarea", { style: SET.textarea, value: draft.advisorPrompt, onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => patch({ advisorPrompt: e.target.value }) })),
          numRow(t("settings.followUpTitle"), t("settings.followUpDesc"), draft.followup?.maxRounds ?? 8, 1, 20, 1, (v) => patch({ followup: { maxRounds: Math.min(20, Math.max(1, v || 8)) } })),
          numRow(t("settings.timeoutTitle"), t("settings.timeoutDesc"), draft.limits?.defaultTimeoutMs ?? 300000, 1000, 600000, 500, (v) => patch({ limits: { ...draft.limits, defaultTimeoutMs: v || 300000 } })),
          numRow(t("settings.transcriptTitle"), t("settings.transcriptDesc"), draft.limits?.transcriptMaxChars ?? 120000, 2000, 400000, 1000, (v) => patch({ limits: { ...draft.limits, transcriptMaxChars: v || 120000 } })),
          numRow(t("settings.perEntryTitle"), t("settings.perEntryDesc"), draft.limits?.perEntryMaxChars ?? 4000, 200, 20000, 100, (v) => patch({ limits: { ...draft.limits, perEntryMaxChars: v || 4000 } })),
          numRow(t("settings.repeatTitle"), t("settings.repeatDesc"), draft.trigger?.repeatThreshold ?? 3, 2, 10, 1, (v) => patch({ trigger: { repeatThreshold: Math.min(10, Math.max(2, v || 3)) } }), true),
          h("div", { style: { ...SET.row, display: "block" } },
            h("div", { style: SET.title }, t("about.title")),
            h("div", { style: { ...SET.desc, marginTop: 4 } }, t("about.by"), h("a", { href: REPO_URL, target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-brand-primary)" } }, "yyty947"), t("about.inspired"), h("a", { href: "https://github.com/pixelsama/codex-advisor", target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-brand-primary)" } }, "pixelsama/codex-advisor"), t("about.end")),
            h("div", { style: SET.desc }, h("a", { href: REPO_URL, target: "_blank", rel: "noreferrer", style: { color: "var(--dsw-alias-brand-primary)" } }, REPO_URL.replace("https://", ""))))),
        h("div", {
          ref: (node: HTMLElement) => { (dockRef as { current: unknown }).current = node; },
          role: "status", "aria-live": "polite",
          style: { position: "sticky", bottom: 0, marginBottom: scrollerPad ? -scrollerPad : 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 16px", background: surface, borderTop: "1px solid var(--dsw-alias-border-l2)", borderRadius: R.md, boxShadow: "0 -4px 16px rgba(0,0,0,0.12)" },
        },
          h("div", { style: { flex: 1, minWidth: 0, maxHeight: 72, overflowY: "auto" } },
            error ? h("div", { style: SET.msgErr }, error) : msg ? h("div", { style: SET.msgOk }, msg) : dirty ? h("div", { style: SET.msgErr }, t("common.unsaved")) : null),
          h("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
            dirty ? h("button", { style: SET.btn, type: "button", onClick: () => reload({ silent: true }) }, t("common.cancelEdits")) : null,
            h("button", { style: SET.btnPrimary, type: "button", disabled: saving, onClick: save }, saving ? t("common.saving") : t("common.save")))));
    }

    // ---------- settings primitives ----------
    const SET = {
      row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "16px 0", borderBottom: "0.5px solid var(--dsw-alias-border-l2)" } as React.CSSProperties,
      title: { fontSize: 14, lineHeight: "20px" } as React.CSSProperties,
      desc: { marginTop: 4, color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "18px" } as React.CSSProperties,
      groupHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "16px 0 8px" } as React.CSSProperties,
      control: { height: 32, borderRadius: R.md, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: 13, padding: "0 10px" } as React.CSSProperties,
      textarea: { width: "100%", boxSizing: "border-box", minHeight: 120, marginTop: 8, borderRadius: R.md, border: "1px solid var(--dsw-alias-border-l2)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontSize: 13, lineHeight: 1.6, padding: "8px 10px", resize: "vertical", fontFamily: "inherit" } as React.CSSProperties,
      entry: { border: "1px solid var(--dsw-alias-border-l1)", borderRadius: R.lg, padding: 12, marginBottom: 12 } as React.CSSProperties,
      banner: { display: "flex", alignItems: "flex-start", gap: 12, margin: "12px 0 4px", padding: "12px 14px", borderRadius: R.lg, background: "var(--dsw-alias-bg-warn)", border: "1px solid var(--dsw-alias-state-warn-primary)", fontSize: 13, lineHeight: 1.6 } as React.CSSProperties,
      btn: { height: 28, padding: "0 12px", borderRadius: R.sm, border: "1px solid var(--dsw-alias-border-l2)", background: "transparent", color: "var(--dsw-alias-label-primary)", fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 } as React.CSSProperties,
      btnPrimary: { height: 32, padding: "0 18px", borderRadius: R.md, border: "1px solid transparent", background: "var(--dsw-alias-label-primary)", color: "var(--dsw-alias-bg-base)", fontSize: 13, cursor: "pointer" } as React.CSSProperties,
      msgOk: okStyle,
      msgErr: errorStyle,
      fieldLabel: { display: "block", marginBottom: 4, color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "18px" } as React.CSSProperties,
    };

    function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
      const [focused, setFocused] = useState(false);
      return h("button", {
        role: "switch", "aria-checked": checked, "aria-label": label, type: "button", disabled,
        onClick: () => onChange(!checked), onFocus: () => setFocused(true), onBlur: () => setFocused(false),
        style: { position: "relative", width: 40, height: 22, borderRadius: 999, border: checked ? "none" : "1px solid var(--dsw-alias-border-l1)", padding: 0, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1, background: checked ? "var(--dsw-alias-brand-primary)" : "var(--dsw-alias-bg-layer-2)", outline: focused ? "2px solid var(--dsw-alias-brand-primary)" : "none", outlineOffset: 1, transition: "background 160ms ease" },
      }, h("span", { style: { position: "absolute", top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "var(--dsw-alias-bg-base)", transition: "left 160ms ease" } }));
    }

    function SRow({ title, desc, last, children }: { title: string; desc?: string; last?: boolean; children?: React.ReactNode }) {
      return h("div", { style: { ...SET.row, ...(last ? { borderBottom: "none" } : null) } },
        h("div", { style: { minWidth: 0 } }, h("div", { style: SET.title }, title), desc ? h("div", { style: SET.desc }, desc) : null),
        children ?? null);
    }

    function Field({ label, children }: { label: string; children?: React.ReactNode }) {
      return h("label", { style: { display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } }, h("span", { style: SET.fieldLabel }, label), children);
    }

    function Dropdown({ value, onChange, width, ariaLabel, options }: { value: string; onChange: (e: { target: { value: string } }) => void; width: number | string; ariaLabel?: string; options: Array<{ value: string; label: string }> }) {
      const [open, setOpen] = useState(false);
      const [highlight, setHighlight] = useState(0);
      const wrapRef = useRef<{ contains?: (n: Node) => boolean } | null>(null);

      useEffect(() => {
        if (!open) return;
        const close = (ev: Event) => {
          const wrap = wrapRef.current;
          const target = (ev as MouseEvent).target as Node | null;
          if (wrap?.contains?.(target as Node)) return;
          setOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
      }, [open]);

      const select = (v: string) => { setOpen(false); onChange({ target: { value: v } }); };
      const openAt = (index: number) => { setHighlight(index); setOpen(true); };
      const key = (ev: React.KeyboardEvent) => {
        const selected = options.findIndex((o) => o.value === value);
        if (!open && (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openAt(selected >= 0 ? selected : 0); }
        else if (open && ev.key === "Escape") setOpen(false);
        else if (open && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) { ev.preventDefault(); setHighlight((x) => Math.min(options.length - 1, Math.max(0, x + (ev.key === "ArrowDown" ? 1 : -1)))); }
        else if (open && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); if (options[highlight]) select(options[highlight].value); }
      };
      const current = options.find((o) => o.value === value);
      return h("div", { ref: (node: unknown) => { (wrapRef as { current: unknown }).current = node; }, style: { position: "relative", display: "inline-flex", width } },
        h("button", { type: "button", "aria-haspopup": "listbox", "aria-expanded": open, "aria-label": ariaLabel, onClick: () => (open ? setOpen(false) : openAt(Math.max(0, options.findIndex((o) => o.value === value)))), onKeyDown: key,
          style: { ...SET.control, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, textAlign: "left", cursor: "pointer" } },
          h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, current?.label ?? ""),
          h("span", { "aria-hidden": true, style: { fontSize: 10, color: "var(--dsw-alias-label-secondary)", flexShrink: 0 } }, open ? "▴" : "▾")),
        open ? h("div", { role: "listbox", "aria-label": ariaLabel, style: { position: "absolute", top: "calc(100% + 4px)", left: 0, width: "100%", minWidth: 160, maxHeight: 240, overflowY: "auto", zIndex: 30, background: "var(--dsw-alias-bg-overlay)", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: R.xl, padding: 4, boxShadow: "0 4px 16px rgba(0,0,0,0.14)" } },
          options.map((o, i) => h("div", { key: o.value, role: "option", "aria-selected": o.value === value, onMouseDown: (ev: MouseEvent) => { ev.stopPropagation(); select(o.value); }, onClick: (ev: MouseEvent) => ev.stopPropagation(), onMouseEnter: () => setHighlight(i),
            style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 10px", borderRadius: R.sm, fontSize: 13, cursor: "pointer", background: i === highlight ? "var(--dsw-alias-bg-layer-1)" : "transparent", color: "var(--dsw-alias-label-primary)" } },
            h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, o.label),
            o.value === value ? h("span", { style: { color: "var(--dsw-alias-brand-primary)", flexShrink: 0 } }, "✓") : null))) : null);
    }

    // ---------- settings navigation icon ----------
    // Registered under the section's id in `settings.section.icon`; the shell
    // keeps its default gear when a section has no icon. Line icon on the
    // host's 24px grid: a speech bubble with a check — one consultation, one
    // confirmed answer.
    function AdvisorNavIcon(props: { size?: number; active?: boolean }) {
      const size = props.size ?? 22;
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: props.active ? "var(--dsw-alias-brand-primary)" : "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          "aria-hidden": true,
          focusable: false,
        },
        h("path", { d: "M4 5.5h16v10.5H9l-4.5 3.5v-3.5H4z" }),
        h("path", { d: "M8.5 10.5l2.3 2.3 4.7-4.6" }),
      );
    }

    // ---------- module ----------
    const name = "dsh-advisor-chain";
    const inject = ["uiConversation", "slots", "locale", "remote", "remote.settings", "remote.llm"];
    let currentCtx: unknown = null;

    interface LocaleService {
      register(ns: string, dicts: Record<string, Record<string, string>>): () => void;
      bind(ns: string): Translate;
    }

    function apply(ctx: {
      uiConversation?: { events?: { register: (definition: unknown) => unknown } };
      slots: {
        inject: (ownerKey: string, factory: () => unknown) => unknown;
        register: (options: Record<string, unknown>, component: (props: unknown) => React.ReactElement) => unknown;
      };
      /** Cordis scoped injection for optional services (`sidebarRight`). */
      inject?: (services: string[], callback: (scoped: unknown) => unknown) => unknown;
      locale?: LocaleService;
      effect?: (setup: () => unknown, label?: string) => unknown;
    }) {
      currentCtx = ctx;
      // Copy: register both dictionaries with the host (one disposer covers
      // them), then bind the translator the outlets read at render time.
      if (ctx.locale && typeof ctx.locale.register === "function" && typeof ctx.locale.bind === "function") {
        const register = () => ctx.locale!.register(CLIENT_NS, CLIENT_DICTIONARIES);
        t = ctx.locale.bind(CLIENT_NS);
        if (typeof ctx.effect === "function") ctx.effect(register, "dsh-advisor-chain: locale dictionaries");
        else register();
      }
      // The right Sidebar service opens the advisor child's conversation; the
      // card's "查看过程" link is hidden when the host does not provide it.
      if (typeof ctx.inject === "function") {
        ctx.inject(["sidebarRight"], ((scoped: { sidebarRight: { openResource: (address: string) => void } }) => {
          openInSidebar = (address) => scoped.sidebarRight.openResource(address);
        }) as unknown as (scoped: unknown) => unknown);
      }
      // Legacy cards: replay only.
      if (ctx.uiConversation?.events?.register) ctx.uiConversation.events.register(legacyAdvisorCardDefinition);
      // The tool's own row in the chat (keyed by wire tool name).
      ctx.slots.inject("tool.call.toolview", () =>
        ctx.slots.register({ name: "tool.call.toolview", key: "second_opinion", locale: CLIENT_NS }, SecondOpinionToolRow as unknown as (props: unknown) => React.ReactElement));
      ctx.slots.inject("conversation.chat.node", () =>
        ctx.slots.register({ name: "conversation.chat.node", key: "dsh-advisor-chain-legacy", locale: CLIENT_NS }, LegacyAdvisorCardView as unknown as (props: unknown) => React.ReactElement));
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register({ name: "settings.section", id: "dsh-advisor-chain", order: 0, label: () => t("nav.title"), locale: CLIENT_NS }, AdvisorSettingsTab as unknown as (props: unknown) => React.ReactElement));
      // Navigation icon for our section (same id as the section above).
      ctx.slots.inject("settings.section.icon", () =>
        ctx.slots.register({ name: "settings.section.icon", id: "dsh-advisor-chain" }, AdvisorNavIcon as unknown as (props: unknown) => React.ReactElement));
    }

    return { name, inject, apply };
  },
});
