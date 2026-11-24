import { defineTool, type ToolOutputDefinition, type ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SubagentActivation } from "@deepseek-ai/dsh-subagent";
import { foldSubagentDescriptor } from "@deepseek-ai/dsh-subagent";
import { buildTranscript, type TranscriptMessageLike } from "./transcript";
import type { AdvisorConfig, ChainEntry } from "./config";
import { entryName } from "./chain";
import { ADVISOR_LABEL_PREFIX, type AdvisorRegistry } from "./advisor/identify";
import { buildAdvisorPrompt } from "./advisor/preamble";
import { startAdvisor, type Refusal } from "./advisor/start";
import { beginFollowUp, finishFollowUp } from "./advisor/followup";
import { classifySubagentError, settleOutcome, waitWithTimeout, type AdvisorOutcome } from "./advisor/result";
import { noopLogger, type HostServices, type Logger } from "./advisor/types";
import { detectLanguage, resolveLanguage, t, type Lang } from "./i18n";

export const TOOL_NAME = "second_opinion";

/** JsonValue type `presentationMeta` must return, without importing a transitive package. */
type JsonMeta = ReturnType<NonNullable<ToolOutputDefinition["presentationMeta"]>>;

export interface AdvisorDeps {
  host: HostServices;
  registry: AdvisorRegistry;
  getConfig: () => AdvisorConfig;
  log?: Logger;
}

interface ToolArgs {
  question?: string;
  context?: string;
  mode?: string;
  consult_id?: string;
  follow_up?: string;
  dual_opinions?: boolean;
}

export type AttemptRecord = {
  label: string;
  ok: boolean;
  reason?: string;
};

/** Token usage and wall time of one advisor call, when the child reported it.
 *  `inputTokens` excludes cache traffic; cache reads/writes are separate. */
export type UsageRecord = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
};

/** Canonical tool value (validated against `output.schema`). */
export interface ToolValue {
  advice: string;
  model: string;
  consultId: string;
  dual: boolean;
  truncated: boolean;
  attempts: AttemptRecord[];
  /** Facts the main model should know: ignored efforts, transcript truncation, timeouts. */
  notes: string[];
  /** Follow-up round this answer belongs to; absent on a new consultation. */
  round?: number;
  usage?: UsageRecord;
}

const isRefusal = (r: AdvisorOutcome | Refusal | (AdvisorOutcome & { childId: string })): r is Refusal =>
  "kind" in r && typeof (r as Refusal).kind === "string";

function clipForMeta(text: string | undefined, max = 2000): string | undefined {
  if (typeof text !== "string") return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Model-visible text: the advice, then the notes and the follow-up hint.
 *  The hint follows the advice's own language (the canonical value carries no
 *  locale and render has no config access). */
function textOfAdvice(value: ToolValue): string {
  const lang: Lang = detectLanguage(value.advice) ?? "zh";
  const notes = value.notes.length ? `\n\n${t(lang, "tool.notes", { notes: value.notes.join(lang === "zh" ? "；" : "; ") })}` : "";
  const hint = value.consultId ? (value.dual ? t(lang, "tool.hintDual") : t(lang, "tool.hintFollowUp", { id: value.consultId })) : "";
  return value.advice + notes + hint;
}

export function createSecondOpinionTool(deps: AdvisorDeps) {
  const log = deps.log ?? noopLogger;
  return defineTool({
    name: TOOL_NAME,
    description:
      "Ask a configured advisor model chain for a second opinion. The advisor is a read-only subagent: it can read files and run read-only commands to verify, " +
      "cannot change anything, and reports only to you. Default inherited mode: the advisor receives a bounded text transcript of this conversation " +
      "(tool outputs may be clipped, older messages may be omitted), so ask the specific question and do not restate background; put facts the transcript " +
      "cannot hold (your intent, unstated constraints, omitted earlier points) in context, and give file paths when the question depends on a large file or long " +
      "output so the advisor reads it itself. Blind-review mode (mode=standalone): the advisor sees no conversation; state the goal, constraints, what was " +
      "tried and the relevant file paths in context. Supports follow-ups (consult_id + follow_up; also the way to add information the advisor says is missing) " +
      "and dual opinions (dual_opinions: the first two advisors of the chain consulted in parallel). Use it before major decisions, for high-risk judgements, " +
      "when unsure of a conclusion or repeatedly stuck; always when the user explicitly asks for an advisor.",
    parameters: {
      question: {
        type: "string",
        description: "The question for a new consultation, e.g. \"Does plan A hold under constraint X?\". Either this or consult_id: with consult_id, follow_up is used instead.",
      },
      context: {
        type: "string",
        description: "Optional. Information the conversation record does not hold: your private intent, unstated constraints, earlier points the transcript omitted. In blind-review mode state the goal, constraints, what was tried and the relevant file paths.",
      },
      mode: {
        type: "string",
        description: "Optional per-call override of the default mode. inherited: the advisor receives the conversation transcript (default); standalone: blind review — the advisor judges only from the question and context.",
      },
      consult_id: {
        type: "string",
        description: "Optional. The consult_id returned by a previous consultation; with it this call is a follow-up answered by the same advisor with that thread's context.",
      },
      follow_up: {
        type: "string",
        description: "The follow-up; only with consult_id, e.g. \"expand on X\" or \"what if Y instead\".",
      },
      dual_opinions: {
        type: "boolean",
        description: "Optional. true consults the first two advisors of the chain in parallel (blind to each other; with a single model, two independent samples) and returns two independent opinions; cannot be followed up.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          advice: { type: "string", required: true },
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
              properties: { label: { type: "string", required: true }, ok: { type: "boolean", required: true }, reason: { type: "string" } },
            },
          },
          notes: { type: "array", items: { type: "string" } },
          usage: {
            type: "object",
            additionalProperties: false,
            properties: {
              inputTokens: { type: "number", required: true },
              outputTokens: { type: "number", required: true },
              cacheReadTokens: { type: "number", required: true },
              cacheWriteTokens: { type: "number", required: true },
              durationMs: { type: "number", required: true },
            },
          },
        },
      },
      render: (_args: unknown, value: unknown) => [{ type: "text", text: textOfAdvice(value as ToolValue) }],
      presentationMeta: (args: unknown, value: unknown) => {
        const a = (args ?? {}) as ToolArgs;
        const v = value as ToolValue;
        // JSON-safe: undefined members are omitted rather than emitted.
        const meta: Record<string, JsonMeta> = {
          kind: "second-opinion",
          model: v.model,
          consultId: v.consultId,
          dual: v.dual,
          truncated: v.truncated,
          attempts: v.attempts,
          notes: v.notes,
        };
        const optional: Record<string, JsonMeta | undefined> = {
          question: clipForMeta(a.question),
          context: clipForMeta(a.context),
          mode: typeof a.mode === "string" ? a.mode : undefined,
          followUp: clipForMeta(a.follow_up),
          round: v.round,
          usage: v.usage,
        };
        for (const [key, val] of Object.entries(optional)) if (val !== undefined) meta[key] = val;
        return meta as JsonMeta;
      },
    },
    async execute(args: ToolArgs, exec: ToolRunContext) {
      const cfg = deps.getConfig();
      const lang = resolveLanguage(`${args.question ?? ""}\n${args.context ?? ""}\n${args.follow_up ?? ""}`);
      const fail = (message: string): ToolValue => ({ advice: message, model: "", consultId: "", dual: false, truncated: false, attempts: [], notes: [] });
      if (!cfg.enabled) return fail(t(lang, "tool.disabled"));
      if (cfg.chain.length === 0) return fail(t(lang, "tool.noChain"));

      const parent = exec.agent as Agent | undefined;
      if (!parent) return fail(t(lang, "tool.noSession"));
      if (deps.registry.isAdvisor(String(parent.id)) || isAdvisorChild(parent)) return fail(t(lang, "tool.isAdvisor"));

      // ---------- follow-up branch ----------
      if (args.consult_id) {
        if (args.dual_opinions) return fail(t(lang, "tool.dualNoFollowUp"));
        if (typeof args.follow_up !== "string" || !args.follow_up.trim()) return fail(t(lang, "tool.followUpNeedsText"));
        const begin = await beginFollowUp(deps.host, deps.registry, {
          parent,
          signal: exec.signal,
          consultId: args.consult_id,
          followUp: args.follow_up,
          maxRounds: cfg.followup.maxRounds,
          lang,
        });
        if (!begin.ok) return { ...fail(begin.message), consultId: args.consult_id };
        // The follow-up inherits the winning entry's timeout when it is still configured.
        const record = deps.registry.get(args.consult_id);
        const entryTimeout = record ? cfg.chain.find((e) => e.provider === record.provider && e.model === record.model)?.timeoutMs : undefined;
        const startedAt = Date.now();
        const outcome = await finishFollowUp(deps.host, deps.registry, begin, { timeoutMs: entryTimeout ?? cfg.limits.defaultTimeoutMs }, parent, exec.signal);
        const attempts: AttemptRecord[] = [{ label: t(lang, "tool.followUpLabel"), ok: outcome.ok, ...(outcome.failure ? { reason: outcome.failure } : {}) }];
        if (!outcome.ok) return { advice: t(lang, "tool.followUpFailed", { reason: outcome.failure }), model: "", consultId: args.consult_id, dual: false, truncated: false, attempts, notes: [], round: begin.round };
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
          ...(usage ? { usage } : {}),
        };
      }

      // ---------- new consultation ----------
      if (typeof args.question !== "string" || !args.question.trim()) return fail(t(lang, "tool.missingQuestion"));
      const question = args.question.trim();
      const mode: "inherited" | "standalone" = args.mode === "standalone" ? "standalone" : args.mode === "inherited" ? "inherited" : cfg.contextMode;
      const notes: string[] = [];
      const prompt = buildPrompt(deps, parent, cfg, mode, question, args.context, notes);
      const live: SubagentActivation[] = [];
      /** An attempt's outcome plus the child that produced it; `consult_id` is the child's session id so follow-ups can find the thread. */
      type RunResult = (AdvisorOutcome & { childId: string; usage?: UsageRecord }) | Refusal;
      const runEntry = async (entry: ChainEntry, promptText: string): Promise<RunResult> => {
        const label = entryName(entry);
        const startedAt = Date.now();
        const started = await startAdvisor(deps.host, deps.registry, { parent, signal: exec.signal, entry, entryLabel: label, promptText, mode, lang });
        if (!started.ok) return started;
        live.push(started.activation);
        if (started.effortIgnored) notes.push(t(prompt.lang, "tool.effortIgnored", { effort: entry.reasoningEffort, route: `${entry.provider}/${entry.model}` }));
        const childId = String(started.activation.childId);
        try {
          const { value, abortedBy } = await waitWithTimeout({
            run: started.activation.result,
            observation: () => deps.registry.observation(childId) ?? started.observation,
            policy: { timeoutMs: entry.timeoutMs ?? cfg.limits.defaultTimeoutMs },
            abort: () => void started.activation.dispose().catch(() => {}),
            signal: exec.signal,
            lang: prompt.lang,
          });
          const outcome = settleOutcome({ result: value, observation: deps.registry.observation(childId) ?? started.observation, abortedBy, lang: prompt.lang });
          if (outcome.ok && outcome.truncated) notes.push(t(prompt.lang, "tool.truncatedNote", { label }));
          const usage = usageOf(started.observation, Date.now() - startedAt);
          return { ...outcome, childId, ...(usage ? { usage } : {}) };
        } catch (error) {
          // Caller cancellation is not a failure of this entry.
          if (exec.signal.aborted) throw error;
          // A rejected activation result (infrastructure fault) or a child that
          // never settled: route it through the same classification table so the
          // chain can fall through (model class) or stop with an actionable message.
          const classified = classifySubagentError(error);
          return { ok: false, kind: classified.kind, message: t(prompt.lang, "tool.aborted", { label, message: classified.message }) };
        } finally {
          live.splice(live.indexOf(started.activation), 1);
          // The streamed text was only a fallback for partial output; release it.
          started.observation.text = "";
        }
      };
      const isRun = (r: RunResult): r is AdvisorOutcome & { childId: string; usage?: UsageRecord } => !isRefusal(r);

      try {
        if (args.dual_opinions) {
          const pair = cfg.chain.slice(0, 2);
          if (pair.length === 1) pair.push(pair[0]);
          const results = await Promise.all(pair.map((entry) => runEntry(entry, prompt.text)));
          const sections: string[] = [];
          const models: string[] = [];
          const attempts: AttemptRecord[] = [];
          let anyTruncated = false;
          let usage: UsageRecord | undefined;
          results.forEach((result, i) => {
            const label = entryName(pair[i]);
            if (!isRefusal(result) && result.ok && result.content.trim()) {
              models.push(`${pair[i].provider}/${pair[i].model}`);
              attempts.push({ label, ok: true });
              if (result.truncated) anyTruncated = true;
              if (result.usage) {
                const u = result.usage;
                usage = usage
                  ? { inputTokens: usage.inputTokens + u.inputTokens, outputTokens: usage.outputTokens + u.outputTokens, cacheReadTokens: usage.cacheReadTokens + u.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens + u.cacheWriteTokens, durationMs: Math.max(usage.durationMs, u.durationMs) }
                  : u;
              }
              sections.push(t(prompt.lang, "tool.dualSection", { label, truncated: result.truncated ? t(prompt.lang, "tool.dualTruncatedMark") : "", content: result.content }));
            } else {
              const reason = isRefusal(result) ? result.message : (result.failure ?? t(prompt.lang, "tool.dualNoContent"));
              attempts.push({ label, ok: false, reason });
              sections.push(t(prompt.lang, "tool.dualFailedSection", { label, reason }));
            }
          });
          const okCount = attempts.filter((a) => a.ok).length;
          if (okCount === 0) {
            const hardStop = results.find((r) => isRefusal(r));
            return {
              ...fail(
                t(prompt.lang, "tool.dualAllFailed", {
                  attempts: attempts.filter((a) => !a.ok).map((a) => t(prompt.lang, "tool.attemptFailed", { label: a.label, reason: a.reason })).join(prompt.lang === "zh" ? "；" : "; "),
                  tail: hardStop && isRefusal(hardStop) ? hardStop.message : t(prompt.lang, "tool.dualProceed"),
                }),
              ),
              consultId: "",
              dual: true,
              attempts,
              notes,
            };
          }
          const failedNote = okCount < attempts.length ? t(prompt.lang, "tool.dualPartialNote") : "";
          const firstChild = results.filter(isRun).find((r) => r.ok)?.childId ?? "";
          // Dual children are not follow-up-able; remember that on each record.
          for (const r of results.filter(isRun)) {
            if (r.ok) deps.registry.record({ childId: r.childId, parentSessionId: String(parent.id), consultId: r.childId, label: ADVISOR_LABEL_PREFIX + "dual", provider: "", model: "", dual: true });
          }
          return { advice: sections.join("\n\n———\n\n") + failedNote, model: models.join(" + "), consultId: firstChild, dual: true, truncated: anyTruncated, attempts, notes, ...(usage ? { usage } : {}) };
        }

        const attempts: AttemptRecord[] = [];
        for (const entry of cfg.chain) {
          const label = entryName(entry);
          const result = await runEntry(entry, prompt.text);
          if (!isRefusal(result) && result.ok) {
            attempts.push({ label, ok: true });
            // consult_id IS the winning child's session id: follow-ups address that thread.
            deps.registry.record({ childId: result.childId, parentSessionId: String(parent.id), consultId: result.childId, label: ADVISOR_LABEL_PREFIX + label, provider: entry.provider, model: entry.model });
            return {
              advice: result.content,
              model: `${entry.provider}/${entry.model}`,
              consultId: result.childId,
              dual: false,
              truncated: result.truncated,
              attempts,
              notes,
              ...(result.usage ? { usage: result.usage } : {}),
            };
          }
          if (isRefusal(result)) {
            // authorization / infrastructure / other: the next entry would hit the same wall.
            attempts.push({ label, ok: false, reason: result.message });
            return { ...fail(result.message), consultId: "", dual: false, attempts, notes };
          }
          attempts.push({ label, ok: false, reason: result.failure });
          log(`advisor: ${label} failed: ${result.failure}`);
        }
        return {
          ...fail(
            t(prompt.lang, "tool.chainFailed", {
              attempts: attempts.map((a) => t(prompt.lang, "tool.attemptFailed", { label: a.label, reason: a.reason ?? "" })).join(prompt.lang === "zh" ? "；" : "; "),
            }),
          ),
          consultId: "",
          dual: false,
          attempts,
          notes,
        };
      } catch (error) {
        await Promise.allSettled(live.map((a) => a.dispose()));
        throw error;
      } finally {
        // Successful children settle on their own; dispose anything left only on abnormal exits.
        if (exec.signal.aborted) await Promise.allSettled(live.map((a) => a.dispose()));
      }
    },
  });
}

interface BuiltPrompt {
  text: string;
  lang: Lang;
}

/** Resolve the call's language from the question, the context and (inherited
 *  mode) the user's latest message, then assemble the advisor prompt. */
function buildPrompt(deps: AdvisorDeps, parent: Agent, cfg: AdvisorConfig, mode: "inherited" | "standalone", question: string, context: string | undefined, notes: string[]): BuiltPrompt {
  if (mode === "standalone") {
    const lang = resolveLanguage(`${question}\n${context ?? ""}`);
    return { lang, text: buildAdvisorPrompt({ mode, lang, advisorPrompt: cfg.advisorPrompt, question, context }) };
  }
  let history: TranscriptMessageLike[] = [];
  try {
    history = parent.session.deriveMessages() as never;
  } catch (error) {
    deps.log?.(`advisor: deriveMessages failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const lang = resolveLanguage(`${lastUserText(history)}\n${question}\n${context ?? ""}`);
  const transcript = buildTranscript(history, {
    maxChars: cfg.limits.transcriptMaxChars,
    perEntryMaxChars: cfg.limits.perEntryMaxChars,
    excludeToolName: TOOL_NAME,
    lang,
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
      transcriptClipped: transcript.clippedCount,
    }),
  };
}

function lastUserText(history: readonly TranscriptMessageLike[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.role !== "user") continue;
    if (message.source?.kind !== undefined && message.source.kind !== "user") continue;
    const text = (message.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join(" ");
    if (text.trim()) return text;
  }
  return "";
}

/** Token usage of a finished child from the `usage` records its stream carried (if any). */
function usageOf(observation: { usage?: { requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number } } | undefined, durationMs: number): UsageRecord | undefined {
  const usage = observation?.usage;
  if (!usage || usage.requests === 0) return undefined;
  return { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, durationMs };
}

function isAdvisorChild(agent: Agent): boolean {
  try {
    const descriptor = foldSubagentDescriptor(agent.session.snapshotEvents());
    return typeof descriptor?.label === "string" && descriptor.label.startsWith(ADVISOR_LABEL_PREFIX);
  } catch {
    return false;
  }
}
